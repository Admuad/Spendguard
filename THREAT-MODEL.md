# SpendGuard — Threat Model & Invariant List

**Chain:** Aevum testnet, chain ID 44005; token tUSD8
`0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals).
**Status:** Security specification for the implementation in this repo.
The implementation must satisfy every invariant below; a violation is a bug.
**Version:** 2.2 — 2026-11-18 (factory model: per-user vaults, INV-18, R-11; v2.1 was the fork-verified token behavior update).

## 1. System overview

A non-custodial vault holds tUSD8 deposited once by an owner. The owner
grants *session keys* — to a person, a bot, an AI agent, or a cashier — that
may spend only within tight, on-chain-enforced bounds. The owner never
shares their main key. A compromised or runaway session key can lose at
most its remaining cap, and the owner can revoke it instantly.

| Operation | Who calls it | Effect |
|---|---|---|
| `deposit` | Anyone (with approval) | tUSD8 moves in |
| `executePayment(key, recipient, amount)` | The session-key holder | tUSD8 moves out to an allowlisted recipient, within the key's limits |
| `ownerWithdraw` | Owner only | Remaining tUSD8 moves out to the owner |
| `grantSession` / `revokeSession` / `pause` / `unpause` | Owner only | Security-state changes |

Every state-changing operation emits an event — the on-chain audit trail.

### Vaults are per-user (factory model, 18 Nov 2026)

`SpendGuardFactory` creates one independent vault per user: the caller of
`createVault` becomes that vault's owner. Vaults are full deployments, not
proxies, and share nothing: no shared pool, no per-user ledger. One vault
can never spend, sweep, pause, or read another vault's funds or sessions
(INV-18). The factory holds no funds, has no owner, and owns no vault; it
cannot move funds under any circumstances. The demo vault on the homepage
is one ordinary vault owned by the project wallet; the UI labels it as a
demo and locks its deposit panel to its owner, so visitors cannot mistake
it for their own vault or deposit into it by accident.

### Actors

- **Owner** — trusted root of trust. Grants, revokes, pauses, sweeps. If the
  owner key is lost or stolen, the vault's guarantees do not hold (R-1).
- **Session-key holder** — untrusted and compromisable. Every bound exists
  because the key may be in hostile hands. No property may depend on the
  holder behaving well.
- **Recipient / merchant** — untrusted passive payee. Must not trigger
  payments, change session state, or pull funds. A malicious recipient
  contract is an attacker (A-6).
- **Attacker** — holds a stolen session key, possibly controls a malicious
  recipient, submits transactions in any order, knows the source.
- **Observers** — no trust required. All session state is public by design.

### Trust assumptions

1. The owner key is trusted and competently held; owner-key compromise is
   out of scope (R-1). A testnet-only key is used.
2. Session keys are untrusted and compromisable.
3. The tUSD8 token behaves as a plain ERC-20: fork-verified 18 Nov 2026
   (see §6) — transfers revert on failure, move exact amounts, call no
   hooks, and carry no blacklist. The starter-kit docs claim that it
   does not revert; that claim is WRONG for the deployed token. A pause
   mechanism exists (currently unpaused) under a single owner key.
4. Aevum testnet behaves as a standard EVM chain (Shanghai EVM).
5. The owner is the only administrator. No timelock, multisig, or upgrade
   path in this build.
6. Off-chain components are not trusted for security. Every check is
   enforced on-chain; the frontend displays state and submits transactions,
   never authorises them.

### Security goal: bounded delegation

The maximum loss from any single session-key compromise is the key's
remaining cap, and no single failure — stolen key, malicious recipient,
reentrancy, frontrun — may turn a bounded loss into an unbounded drain.
The owner must always retain the ability to stop the bleeding (revoke,
pause, sweep) and recover what is left.

## 2. Attacks and the invariants that stop them

| # | Attack | Stopping invariant(s) | Expected outcome |
|---|---|---|---|
| A-1 | Repeated payments cumulatively exceeding `spendCap` | INV-1 (cumulative check before transfer; `spent` updated in the same tx) | Excess payment reverts; `spent` stays at the cap |
| A-2 | One payment above `maxPerTx` | INV-8 | Reverts; `spent` unchanged |
| A-3 | Payment to a non-allowlisted recipient | INV-3 | Reverts; nothing moves |
| A-4 | Spending after `expiresAt` | INV-2 (`block.timestamp < expiresAt` on every payment) | Reverts, including in the exact expiry second |
| A-5 | Spending after revocation | INV-2, INV-7 | Reverts; revoke is immediate once mined |
| A-6 | Reentrancy via a malicious recipient / token hook | INV-9 (checks-effects-interactions) + INV-10 (guard) | Inner call reverts; outer payment completes exactly once |
| A-7 | Frontrunning the revoke | None fully (public mempool); INV-1 + INV-7 bound it | Loss at most the remaining cap, in either ordering (R-4) |
| A-8 | Session key pausing/unpausing; pause locking the sweep | INV-6, INV-12 | Non-owner pause calls revert; sweep works while paused |
| A-9 | Frontrunning the sweep | INV-1, INV-4 | Payment bounded by remaining cap; sweep recovers the rest |
| A-10 | Abusive grant parameters (zero cap, per-tx > cap, past expiry, empty allowlist, silent overwrite of a live key) | INV-11 | Invalid grants revert at grant time |
| A-11 | Unlimited-approval abuse | INV-13 (no approvals granted; exact-amount pulls only) | No approval exists to exploit |
| A-12 | Impersonation: calling `executePayment` naming another key | INV-14 (`msg.sender == sessionKey`) | Reverts; victim key untouched |
| A-13 | Cross-vault spend, sweep, grant, or pause (key or owner of vault A acting on vault B) | INV-18, INV-12, INV-14 | Reverts; victim vault untouched |

## 3. Invariants

| # | Invariant |
|---|---|
| INV-1 | Cumulative `spent` per key never exceeds its `spendCap`. Check `spent + amount <= spendCap` before the transfer; increase `spent` by exactly `amount` in the same transaction. |
| INV-2 | No payment executes from a revoked or expired key. Every payment checks `active == true` and `block.timestamp < expiresAt`. |
| INV-3 | No payment to a non-allowlisted recipient. |
| INV-4 | The owner can always sweep the full remaining balance, in any state (paused or not, keys revoked or expired). No dependency on session state. |
| INV-5 | Total outflows (payments + sweeps) never exceed total deposits. |
| INV-6 | Pause blocks payments but never blocks the owner sweep. (Design choice: pause freezes spending, never recovery.) |
| INV-7 | Revoke is immediate and cannot be undone by the key holder. A fresh grant creates a new session; it does not resurrect the old one. |
| INV-8 | No single payment exceeds `maxPerTx`; zero-amount payments revert. |
| INV-9 | Checks-effects-interactions on every fund-moving function. |
| INV-10 | A reentrancy guard protects all fund-moving functions (`deposit`, `executePayment`, `ownerWithdraw`). |
| INV-11 | Grant validation: revert on `spendCap == 0`, `maxPerTx == 0`, `maxPerTx > spendCap`, `expiresAt <= block.timestamp`, empty allowlist, zero-address key/recipient, or a grant to an already-active key. |
| INV-12 | Admin functions (`grantSession`, `revokeSession`, `pause`, `unpause`, `ownerWithdraw`) are owner-only. |
| INV-13 | No unlimited approvals. The vault never approves any spender; deposits pull exactly the deposit amount. |
| INV-14 | The caller of `executePayment` must be the session-key address itself. |
| INV-15 | Events for every state-changing operation, with full parameters. No silent state change. |
| INV-16 | `spent` is monotonic per key and resets only by a fresh grant after revocation (which starts a new session at `spent == 0`). |
| INV-17 | The vault's token balance is the single source of truth for solvency. No payment succeeds when the balance is below `amount`. |
| INV-18 | Vault isolation: no vault's funds, sessions, or admin powers are reachable from any other vault or from the factory. Each vault's owner, sessions, and balance are independent; the factory holds no funds and owns no vault. |

### Addendum (18 Nov 2026, from the starter-kit read)

- **A-1.** CORRECTED 18 Nov 2026: the kit-docs claim that tUSD8 does not
  revert is WRONG. Fork-verified: over-balance `transfer` and unapproved
  `transferFrom` both REVERT with error data. Every ERC-20 move still
  uses SafeERC20 as defense-in-depth, and the non-reverting-token tests
  prove the vault stays safe even against a token that returns `false`.
- **A-2.** DEAD 18 Nov 2026: EIP-3009 is NOT present on the deployed
  tUSD8. Selector scan of the implementation plus fork probes confirm
  `receiveWithAuthorization` and `transferWithAuthorization` do not
  exist on the pinned token, whatever the kit docs say. No gasless path
  via the token is possible. The core vault works without any relayer.
  EIP-2612 `permit` IS present (domain separator set, `nonces` live).
- **A-3.** Fork chain id 440050 ≠ Aevum 44005; signatures are chain-bound.
- **A-4.** Pin `evm_version = "shanghai"`; prefer legacy tx type in scripts.

## 4. Tests

### Stateful fuzz properties (P-1..P-12) — `test/SpendGuardInvariant.t.sol`

Random sequences of all operations from random actors, asserting each
call's expected outcome immediately and the global properties after every
step (512 runs × 64 calls). P-1 spent ≤ cap; P-2 no payment from a revoked
or expired key; P-3 every successful payment's recipient was allowlisted;
P-4 sweep always succeeds when funded, in any state; P-5 solvency
(balance == deposits − payments − sweeps); P-6 pause blocks payments, not
sweeps; P-7 revoke-then-regrant starts at `spent == 0`; P-8 payments within
per-tx bounds and positive; P-9 events (checked via `expectEmit` in the
unit suite); P-10 no non-owner admin call succeeds; P-11 no payment from a
caller other than the key; P-12 no grant creates an invalid session.

### Scripted adversarial scenarios (T-1..T-15) — `test/SpendGuard.t.sol`

T-1 over-cap revert; T-2 expiry boundary (expiry−1 succeeds, expiry and
expiry+1 revert); T-3 revoke-then-spend; T-4 wrong recipient; T-5 over
per-tx; T-6 reentrancy via a hook token (plus owner-withdraw reentrancy);
T-7 pause blocks pay, sweep works; T-8 non-owner admin reverts; T-9
impersonation; T-10 sweep after revoke; T-11 grant validation (including
the allowed case: cap above current balance); T-12 frontrun orderings
bounded; T-13 zero amount; T-14 exact-cap boundary; T-15 exact deposit
pull. Plus happy-path, view, event, and non-reverting-token tests.

**Green means:** all scripted tests pass, all fuzz properties hold, nothing
skipped or marked expected-to-fail. No deploy with a failing adversarial
test.

## 5. Accepted risks

| # | Risk | Why accepted | Mitigation |
|---|---|---|---|
| R-1 | Owner key compromise | The vault cannot distinguish the owner from a key holder | Fresh testnet-only key; roadmap: multisig/timelock |
| R-2 | tUSD8 compromise / behaviour change | Third-party infrastructure | Verify items below; document platform risk honestly |
| R-3 | Slow bleed under the cap | A cap is a limit, not a fraud detector | Small caps, short expiries, prompt revoke, event monitoring |
| R-4 | Mempool frontrunning of revoke/sweep | No on-chain check can see the future | Loss bounded by remaining cap in every ordering |
| R-5 | Grant sniping (mempool reveals grant params early) | Params are public once mined; the key address is not a secret | None needed |
| R-6 | Malicious or mistaken grant by the owner | The vault enforces the grant as written | INV-11 validation; UI confirmation summary; one-click revoke |
| R-7 | Testnet reliability / reorgs | Infrastructure risk, not contract risk | Deploy early, script-runnable demo, submit early |
| R-8 | Privacy: all session state is public | Transparency is the audit trail | Accepted; no privacy claimed |
| R-9 | Griefing/social engineering of the owner | Operational, not contractual | Owner discipline |
| R-10 | Compiler / library / EVM platform risk | Out of scope for this build | Audited OpenZeppelin primitives, pinned solc, full test suite |
| R-11 | Pooled deposits within one vault | `deposit` stays permissionless by design (anyone may top up a vault); deposits join that vault's single pool with no per-depositor ledger, so a non-owner deposit is spendable by the owner's keys and sweepable by the owner | UI gates each vault's deposit panel to its owner and labels the demo vault; the factory model bounds the exposure to one vault at a time |

## 6. Verification items

| # | Item | Status |
|---|---|---|
| V-1 | tUSD8 has no fee-on-transfer | CLOSED 18 Nov 2026 — fork-verified: a 1,000,000-unit transfer delivered exactly 1,000,000. Token source is unverified on the explorer (proxy + implementation), so behavior was proven on a local fork instead. Deposits use balance-delta accounting regardless. |
| V-2 | No transfer hooks / callbacks | CLOSED 18 Nov 2026 — fork-verified: transfer to a contract whose fallback reverts succeeded. No ERC-777-style hooks. Guard + checks-effects-interactions proven against a hook token in T-6 regardless. |
| V-3 | No blacklist / pause / per-address restriction on the token | CLOSED 18 Nov 2026 with one live caveat — fork-verified: no blacklist selector exists; `paused()` reads `false`. A pause mechanism DOES exist (`pause`/`unpause` selectors, single owner `0x94ef5dB164e7BBf4149e298c5588C035Ea8E9C05`): if the token owner pauses, vault payments freeze until unpaused. Accepted external risk; the vault cannot mitigate a token-level pause. |
| V-4 | Decimals are 6; address correct for 44005 | CLOSED — corroborated by four official sources (FAQ, token list, MetaMask guide, starter guide). |
| V-5 | How to obtain tUSD8 | CLOSED — web faucet (1 tUSD8/claim, 24h cooldown) + Discord #faucet (once per person). |
| V-6 | Starter-kit contents | ANSWERED as far as public sources allow — kit repo is public (qday-io/aevum-starter-kit); no session-key code exists in it. |
| V-7 | Session-key / AA / x402 tooling live on 44005 | ANSWERED as far as public sources allow — announced live, no usable addresses/endpoints/SDK. DIY is the only shippable approach. EntryPoint v0.7 is deployed but undocumented; roadmap footnote only. |
| V-8 | Kit-imposed constraints | CLOSED — five gotchas adopted (Shanghai EVM, 1,000-block log chunks, no WebSocket, no explorer verification, on-Aevum activity only). |
| V-9 | Foundry → Aevum deploy toolchain | CLOSED — live deploy pipeline proven (throwaway contract, pre-window; not submission evidence). |
| V-10 | tQDAY faucet for the testnet wallet | CLOSED — wallet funded. |
| V-11 | DoraHacks registration requirements | CLOSED — registered 18 Nov 2026. |
| V-12 | USDT payout mechanics | OPEN — unstated anywhere public. |
| V-13 | Transfer failure behavior (kit docs: does not revert) | CLOSED 18 Nov 2026 — REFUTED. Fork-verified: over-balance transfer and unapproved transferFrom both REVERT with error data. SafeERC20 retained as defense-in-depth. |
| V-14 | EIP-3009 present on tUSD8 (kit docs claim) | CLOSED 18 Nov 2026 — ABSENT. Selector scan + fork probes: no `receiveWithAuthorization`/`transferWithAuthorization`. EIP-2612 `permit` present. Gasless path via the token is impossible; A-2 dead. |

## 7. Document control

- v1.0 — 2026-11-10 (prep draft, pre-window).
- v2.0 — 2026-11-18 (build-window spec: addendum A-1..A-4 folded in,
  verification statuses updated, grant validation extended with
  zero-address checks, deposit balance-delta accounting recorded).
- v2.1 — 2026-11-18 (fork-verified tUSD8 behavior: reverts on failure,
  exact amounts, no hooks, no blacklist, pause exists but inactive,
  EIP-3009 absent, EIP-2612 present; A-1 corrected, A-2 dead, V-1..V-3
  closed, V-13/V-14 added).
- v2.2 — 2026-11-18 (factory model: SpendGuardFactory creates one vault per
  user, constructor takes the owner, INV-18 + A-13 + R-11 added, 11 factory
  isolation tests; demo-vault UI labelling and deposit gating recorded).
- Record future changes here with date and outcome. Do not silently edit
  the invariant list.
