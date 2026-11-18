# SpendGuard agent: security audit

Audit of `agent.mjs` (the demo agent) against its threat model. Written
18 Nov 2026. The agent is a small Node program with one dependency (viem).
It pays a merchant from the SpendGuard vault using only a scoped session
key. It never holds the owner key.

Reading guide: each threat names the worst realistic outcome, the controls
that stop or bound it, and what is left over. Residual risks are stated
plainly at the end. Nothing in this document is a claim that the agent is
safe to run on mainnet with real money: it is a testnet demo, and the
controls below are sized for that.

## Ground rules the audit relies on

1. The contract is the final judge. Every bound the agent checks (active
   session, expiry, allowlist, per-tx limit, cumulative cap, vault balance,
   pause) is enforced on-chain by `SpendGuard.executePayment`. If the agent
   is wrong, outdated, or lied to, the worst case is a reverted transaction,
   not an over-cap payment. The agent's checks exist to fail early, readably,
   and without spending gas.
2. The session key is bounded by its grant. A stolen or misused key can only
   pay allowlisted recipients, up to the remaining cap, before the expiry.
   The owner revokes instantly and can sweep the vault at any time.
3. The agent holds exactly one secret: the session key, from the process
   environment. There is no config file, no key file, no second secret.

## Threats and controls

### T1. Session key theft

Outcome if unmitigated: the thief spends up to the remaining cap to
allowlisted recipients until expiry or revoke.

Controls:
- Least privilege by construction. The agent ABI contains only reads plus
  `executePayment`. The agent cannot grant, revoke, pause, deposit, or
  sweep, even if its code is tricked into trying. (Test: ABI allowlist.)
- The key is never the owner key. The setup docs and the error messages say
  so explicitly. A stolen session key cannot touch owner functions.
- The key lives only in the process environment. It is used once, to build
  the viem account object. It is never printed, never written to disk, and
  never included in the ledger, the lock file, or any error message.
  (Tests: leak checks on CLI output and on every validation error.)
- Blast radius is capped by the grant itself: per-tx limit, cumulative cap,
  allowlist, expiry. Small caps and short expiries are the operator's main
  lever; the README recommends them.
- Recovery is one click: the owner revokes the session in the UI, and the
  key is dead from the next block. The owner can also sweep the vault.

Residual: theft during the window between grant and revoke still allows
spending up to the remaining cap. That is inherent to the session-key
model, not a defect in this script. Short expiries and small caps are the
mitigation, and they are an operator decision at grant time.

### T2. Session key loss

Outcome: the key is lost (deleted env, lost machine). The grant cannot be
used by anyone.

Controls: none needed in the agent. Loss of a session key loses no funds:
the vault balance is untouched, the owner revokes the dead session and
grants a fresh one, and the owner can sweep at any time. Key loss is a
liveness hiccup, not a funds risk. This asymmetry (theft is bounded, loss
is harmless) is the point of the session-key design, and the UI grant
warnings should say so.

Residual: none for funds. An operator who loses the only session key for a
running integration must re-grant; the README documents the flow.

### T3. Malicious or mistaken grant

Outcome: the owner grants the wrong address, a too-generous cap, a wrong
recipient, or a too-long expiry. The agent then faithfully spends within a
bad grant.

Controls:
- The agent cannot fix a bad grant and does not try. It reports the live
  grant terms (spent, cap, per-tx limit, expiry, allowlist membership) on
  every run, so a mistaken grant is visible before money moves.
- The agent refuses to pay a recipient who is not allowlisted, and refuses
  amounts above the per-tx limit or remaining cap, even if the operator
  asks. The grant is the ceiling; the agent never exceeds it.
- Dry-run mode shows the full plan before any live run. The README tells
  the operator to dry-run first, every time.
- No edit operation exists on-chain: a mistaken grant is fixed by revoke
  plus a fresh grant, which resets `spent` to zero. The agent needs no
  change when a grant is replaced.

Residual: a grant to an attacker-controlled address with a large cap is a
real loss vector, and no agent-side check can distinguish "the owner meant
this address" from "the owner mistyped it". Grant hygiene (double-check the
address, start small, short expiry) is an operator duty. The UI grant panel
shows a review summary including "maximum loss if this key is stolen";
that warning is the main defense, and it lives outside this script.

### T4. RPC lies (malicious or stale RPC endpoint)

Outcome: a dishonest RPC could report a healthy session that is actually
revoked, a large remaining cap that is actually spent, or a wrong chain.

Controls:
- Chain guard: the agent reads the chain id from the RPC and refuses unless
  it is exactly 44005. The fork chain id 440050 and every other chain are
  refused. (Tests: chain guard table.)
- The wallet client is built with an explicit chain definition (id 44005),
  so a signed transaction is only valid on that chain.
- The contract re-checks everything at mine time. A lying RPC can make the
  agent attempt a payment that reverts; it cannot make the contract pay
  beyond the grant. The worst RPC-lie outcome is a wasted gas fee on a
  reverted transaction, bounded by the gas cap.
- Gas estimation is a second opinion: it simulates the call against chain
  state, and a simulation that reverts refuses the run before sending.
- The default RPC is the official Aevum endpoint. An override is allowed
  but must be http(s), and the chain guard still applies.

Residual: a malicious RPC could censor (hide a revoke until after the
payment mines) or delay. Censorship is bounded by the grant: the payment
still cannot exceed the cap or leave the allowlist. A stale RPC could also
report an old block timestamp near expiry; the 60 second expiry margin
reduces that race. For a production agent, run a trusted RPC or compare two
independent endpoints; that is out of scope for this demo.

### T5. Replay and double payment

Outcome: the same invoice is paid twice, or one send becomes two on-chain
payments.

Controls:
- Idempotency ledger. Every payment carries an invoice ID, recorded in an
  append-only JSONL ledger the moment a transaction hash exists. An invoice
  recorded as submitted or confirmed is never paid again. An invoice whose
  payment reverted may be retried, because a revert moved no funds.
  (Tests: ledger rules, duplicate refusal, corrupt-ledger fail-closed.)
- Pinned-nonce send discipline. The nonce is fetched once and reused for
  the single retry. If the first attempt actually landed, the retry with
  the same nonce is rejected by the chain, so one send cannot become two
  payments. If a send fails without a hash, the agent checks whether the
  nonce was consumed before retrying; if it was, the send is ambiguous and
  the agent stops instead of guessing.
- Send-once rule. Once a hash exists, the transaction is never resent. The
  agent only polls for the receipt.
- Single-instance lock. One lock file per ledger prevents two concurrent
  runs from fetching the same pending nonce and colliding. Stale locks
  (older than 5 minutes) are cleared automatically.
- Dry runs never touch the ledger, so checking never consumes an invoice ID.
  (Tests: CLI dry-run ledger behavior.)

Residual: the ambiguous-send case. If a send fails without a hash AND the
nonce was consumed, the agent cannot know whether a payment landed. It
stops and tells the operator to check the explorer. If the operator then
reruns without checking, and the ambiguous transaction did land, the
invoice could be paid twice. Both payments would still be within the
session cap and to the allowlisted recipient, so the loss is bounded by
the grant, but it is real. The README documents the check-the-explorer
procedure. A stronger design would query the chain for a transaction from
the session key with that nonce and resolve the ambiguity automatically;
that is a known improvement, not implemented here.

Residual: the ledger is a local file. If it is deleted, the agent loses its
memory of paid invoices. Deleting the ledger is an operator action with a
visible consequence; the README warns that the ledger is the record. A
production agent would store payment state in a database with backups.

Residual: a crash between broadcast and the ledger write leaves a paid
invoice looking unpaid. The window is one filesystem append immediately
after the hash returns; the README tells the operator to check the explorer
after any crash before rerunning.

### T6. Amount confusion

Outcome: the agent pays 100x too much, pays zero, or pays a fractional
amount the token cannot represent.

Controls:
- Strict parsing. Amounts must match `^\d+(\.\d{1,6})?$` after trimming.
  Scientific notation, commas, signs, hex, unit suffixes, and more than 6
  decimals are all rejected. Zero is rejected. Conversion is string
  splitting plus BigInt math; no floating point is used anywhere in the
  amount path. (Tests: 30+ parsing cases, including overflow past uint256.)
- The parsed amount is echoed in the pre-flight printout before sending,
  in both the operator's decimal form and the checked bounds, so a mistake
  is visible.
- Pre-flight bounds: amount must be at or under the per-tx limit, the
  remaining cap, and the vault balance. Any violation refuses.
- Gas estimation simulates the exact call; a call that would revert (for
  example, an amount the vault cannot cover) refuses the run.

Residual: an operator who types 25 instead of 0.25 gets a valid payment of
25 tUSD8 if the grant allows it. The pre-flight printout and dry-run mode
are the defense; there is no way for the script to know the operator's
intent. Amounts are echoed prominently for exactly this reason.

### T7. Wrong chain or wrong vault

Outcome: the agent signs a transaction valid on a different chain, or calls
`executePayment` on an attacker contract that mimics the vault.

Controls:
- Chain guard (see T4): exactly 44005, verified live from the RPC.
- The vault address defaults to the deployed SpendGuard vault. An override
  must be a valid address. The agent reads session state from the configured
  vault before sending; a non-vault address returns no session, and the run
  refuses on "no active session".
- The signed transaction includes the chain id and the vault address, so it
  cannot be replayed on another chain or redirected to another contract.

Residual: if the operator points the agent at a malicious contract that
implements the same view functions and returns fake "healthy" state, the
agent would sign an `executePayment` call to that contract. The call would
execute whatever the malicious contract does. This requires the operator to
override the vault address to an attacker contract, which is outside the
normal flow; the default is pinned to the real vault. A production agent
would verify the vault bytecode hash before first use.

### T8. Log and output leakage

Outcome: the session key appears in terminal output, logs, the ledger, or
an error message, and is later exposed.

Controls:
- The key is referenced in exactly one place: the `privateKeyToAccount`
  call. No log line, error message, ledger entry, or lock file contains it
  or any fragment of it. Error messages name the variable, never the value.
- The ledger records addresses, amounts, hashes, and statuses only.
- No `.env` file is read or written by the agent. There is no dotenv
  dependency and no config-file fallback that could surprise an operator.
- The agent has no telemetry, no analytics, and no network call except to
  the configured RPC.
- (Tests: CLI leak checks grep all output for the full key and for its
  first and last 12 characters; validation tests assert no error message
  contains key material; a standalone leak-check run with a throwaway key
  was grepped the same way.)

Residual: the operator's own shell history may contain the key if it is
passed on the command line (`SESSION_KEY_PRIVATE_KEY=0x... node agent.mjs`).
The README shows that form for clarity; in practice the operator should
export the variable from a secrets manager or a restricted file, and clear
shell history after pasting a key. The script cannot control its parent
shell. Terminal scrollback on a shared screen is the same class of risk:
the script prints the session key ADDRESS, which is public, never the key.

### T9. Time-of-check to time-of-use (state changes between checks and mining)

Outcome: the session is revoked, expires, or the vault is paused after the
pre-flight checks but before the transaction mines.

Controls: the contract enforces all bounds at mine time, so the payment
reverts and no funds move. The agent records the revert in the ledger and
reports it plainly. The 60 second expiry margin reduces the expiry race.
Gas estimation immediately before sending narrows the window further.

Residual: the gas fee for a reverted transaction. Bounded by the gas cap
(500,000 gas at most 10 gwei).

### T10. Dependency and supply-chain risk

Outcome: a compromised or buggy dependency exfiltrates the key or alters
behavior.

Controls: exactly one runtime dependency (viem), pinned by `package-lock.json`,
installed from the npm registry. No other packages, no dotenv, no logging
framework, no telemetry. The agent code itself is one file, readable end to
end. Viem is the same library the SpendGuard UI uses.

Residual: a compromised viem release would compromise the agent. The lock
file pins the exact version installed and audited here (viem 2.58.0); any
upgrade should be a deliberate, reviewed change.

## Controls checklist (for reviewers)

| Control | Where | Test |
|---|---|---|
| Chain guard, exactly 44005 | `assertChainId` | chainguard.test.mjs |
| Strict amount parsing, BigInt only | `parseAmount` | parsing.test.mjs |
| Env validation, fail closed | `loadConfig` | validation.test.mjs |
| Pre-flight decision table | `evaluatePreflight` | preflight.test.mjs |
| Live-state matrix, read-only | `fetchPreflightState` | live-reads.test.mjs |
| Idempotency ledger | `readLedgerEntries`, `isInvoicePayable` | ledger.test.mjs, cli.test.mjs |
| Pinned-nonce send, one retry | `sendWithPinnedNonce` | code review only (see below) |
| Gas estimate + gas/price caps | main flow | live estimation probe (see below) |
| Legacy transaction type | `sendWithPinnedNonce` | code review only |
| Single-instance lock | `acquireLock` | cli.test.mjs |
| Narrow ABI (no admin calls) | `AGENT_ABI_SIGNATURES` | validation.test.mjs |
| No secret in output | whole file | cli.test.mjs, standalone leak check |
| Dry-run mode | main flow | cli.test.mjs |

## Verification performed

- `npm install` succeeds; viem 2.58.0 installed (satisfies ^2.57.12).
- Test suite: 88 tests, 88 passing, 0 failing, across 7 files. The suite
  sends no transactions. It includes a read-only matrix against the live
  Aevum testnet using the known session addresses: the live demo key passes
  a valid intent and refuses over-cap and non-allowlisted intents; the
  revoked key is refused; a never-granted key is refused.
- Live gas-estimation probe (read-only, `eth_estimateGas`): a valid 0.10
  tUSD8 payment from the live demo key estimates 77,458 gas, well under
  the 500,000 cap. An over-cap payment and a non-allowlisted payment both
  revert in simulation with the expected custom error selectors.
- Standalone leak check: a dry run with a throwaway key was grepped for the
  full key and for its first and last 12 characters. No matches. No ledger
  file was created by the dry run. The throwaway key was generated for the
  check and never funded, granted, or reused.
- No `.env` file exists in the repo. No ledger file exists in the repo.
  The only key material that existed during this audit was throwaway test
  fixtures, held in memory or under /tmp, never inside the repo.

## Honest limitations of this audit

1. The live send path (`writeContract`, receipt polling, the pinned-nonce
   retry) was NOT executed. This audit ran under a hard no-transactions
   rule, so the send path is covered by code review and by the read-only
   estimation probe, not by a live payment. The first live run should use
   a fresh session with a small cap, a dry run first, and the operator
   watching the explorer. That run is the remaining proof.
2. The live-reads tests depend on the demo session grant, which expires
   about 19 Nov 2026 07:03 WAT. After expiry, the tests that assert the
   demo session is active will fail until a fresh session is granted to a
   known key and the fixtures are updated. The revoked-key and
   never-granted-key tests are not time sensitive.
3. The ambiguous-send residual (T5) and the malicious-RPC residual (T4)
   are accepted for a testnet demo. Neither can move funds beyond the
   grant, but both deserve the stronger designs noted if this agent ever
   handles real value.
4. This audit covers the agent script only. It does not re-audit
   SpendGuard.sol (covered by THREAT-MODEL.md and the Foundry suite) or
   the web UI.
