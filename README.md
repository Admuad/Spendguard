# SpendGuard

**Give an agent a key that can only spend a little, only to approved merchants, only until Friday — and take it back in one click.**

SpendGuard is a scoped session-key vault for tUSD8 on the QDay Aevum testnet (chain 44005), built for the [Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail). The owner deposits tUSD8 once, then grants session keys — to a person, a bot, an AI agent, or a cashier — that may spend only within tight, on-chain-enforced bounds: an allowlisted set of recipients, a per-transaction cap, a cumulative spend cap, and an expiry. Every bound is enforced by the contract, not by the frontend. The owner can revoke any key instantly and can always sweep the remaining balance.

Spending authority becomes a grantable, revocable, auditable object — not a shared wallet key.

- **Track:** Decentralized Payments, with the Native AI Assistants angle as the innovation story (an autonomous agent pays merchants within bounds while the owner watches the audit trail).
- **Status:** contracts + full test suite + testnet deployment + UI complete and verified (see [ui/VERIFICATION.md](ui/VERIFICATION.md)). Demo video and submission package follow in the build window (see [Roadmap](#roadmap)).
- **Live demo:** https://admuad.github.io/Spendguard/ (static export of `ui/`, deployed to the `gh-pages` branch; source of truth is `main`).
- **Brand:** logo, colors, typography, and usage rules in [BRANDING.md](BRANDING.md).

## How it works

```
Owner ──deposit──> ┌────────────┐
                   │ SpendGuard │──pay──> Allowlisted merchant
Owner ──grant───>  │   Vault    │
                   └────────────┘
                        ▲   │
             revoke / pause │   │ session key calls executePayment
                        │   ▼   │ (caller must BE the key)
                   Owner owns  Agent / bot / cashier
                   recovery    holds ONLY the session key
```

1. **Deposit.** The owner approves exactly the deposit amount and calls `deposit`. The vault pulls exactly that amount — no unlimited approvals anywhere.
2. **Grant.** The owner calls `grantSession` with the session-key address, its recipient allowlist, per-transaction cap, cumulative cap, and expiry. A confirmation summary (key, cap, per-tx, expiry, recipients) is shown before the transaction.
3. **Pay.** The session-key holder calls `executePayment` naming itself, a recipient, and an amount. The contract checks: caller is the key, key is active, not expired, amount within the per-tx and cumulative caps, recipient allowlisted, vault funded, vault not paused. Then it updates accounting *before* the token transfer (checks-effects-interactions) under a reentrancy guard.
4. **Revoke / pause / sweep.** The owner revokes instantly (`revokeSession`), freezes all payments (`pause`, which never blocks the sweep), or recovers everything left (`ownerWithdraw`) — in any state, at any time.

Every state change emits an event: the on-chain audit trail.

## Security

The full specification is [THREAT-MODEL.md](THREAT-MODEL.md): 17 invariants, 12 stateful fuzz properties, 15 scripted adversarial tests, 10 accepted risks stated honestly, and the verification items for the tUSD8 token.

Headline guarantees, all proven by the test suite:

- **Bounded delegation.** The maximum loss from any single compromised session key is that key's remaining cap. No failure turns a bounded loss into a vault drain.
- **Instant, irreversible revocation.** Once a revoke is mined, the key can never spend again. Re-granting starts a fresh session with `spent == 0`.
- **Pause freezes spending, never recovery.** The owner sweep works while paused.
- **Token-behavior safe.** Fork-verified 18 Nov 2026: tUSD8 reverts on transfer failure, moves exact amounts, and calls no hooks. Every token move still goes through OpenZeppelin `SafeERC20` as defense-in-depth, and the non-reverting-token tests prove a silent `false` would revert the vault operation and never corrupt cap accounting.
- **Balance-delta deposits.** Deposits credit what actually arrived, so accounting stays correct even if the token ever takes a transfer fee.

Honest limits (see THREAT-MODEL.md §5): the owner key is the root of trust; session state is public on-chain (transparency is the audit trail — no privacy is claimed); mempool front-running of a revoke is bounded by the remaining cap, not preventable.

## Project layout

```
src/
  SpendGuard.sol          # The vault: sessions, caps, allowlist, pause, sweep
test/
  SpendGuard.t.sol        # Unit + 15 scripted adversarial tests (T-1..T-15)
  SpendGuardInvariant.t.sol # Stateful fuzz: 12 invariant properties (P-1..P-12)
  mocks/Mocks.sol         # Plain, non-reverting, and hook tokens + attackers
script/
  Deploy.s.sol            # Testnet deploy (env-based, no keys in repo)
ui/                       # Next.js frontend: live dashboard, deposit, grant,
                          # pay-as-key, revoke, pause/sweep, light/dark themes
                          # (see ui/README.md; verified in ui/VERIFICATION.md)
ARCHITECTURE.md           # Architecture, flows, and API examples
THREAT-MODEL.md           # Security specification and accepted risks
BRANDING.md               # Logo, colors, typography, and usage rules
```

## Setup and reproduction

Prerequisites: [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`).

```bash
git clone https://github.com/Admuad/Spendguard.git
cd Spendguard
git submodule update --init   # fetches OpenZeppelin v5.4.0 + forge-std (see .gitmodules)
forge build
forge test      # 29 unit/adversarial tests + 4 invariant properties
```

Expected: all green. The invariant suite runs 512 sequences of 64 random operations each (32,768 calls) and asserts all 12 properties.

### Environment variables

| Variable | Purpose |
|---|---|
| `PRIVATE_KEY` | Testnet-only deployer key. Never a mainnet key, never committed. |
| `TUSD8_ADDRESS` | tUSD8 token address on the target chain. |

Copy `.env.example` to `.env` (gitignored) and fill it in. Deploy scripts read the environment only.

### Testnet addresses (chain 44005, Aevum testnet)

| Item | Address |
|---|---|
| tUSD8 (6 decimals) | `0x456569838f1d43009A91ebA4263147Afd7233483` |
| RPC | `https://rpc-test.qday.info` |
| Explorer | `https://explorer-test.qday.info` |
| SpendGuard vault | `0x9a113999851e446a7ab516472e2dae743fc2a0ca` |
| Deploy tx | `0xbe573e67a296cab6bacb5cfb1cfe91bef681171037db06e4383d7caa666536d3` (18 Nov 2026, deployer `0xE5e31bAB0976A568f009980Ed1da2B6A56D8D898`) |

Live end-to-end proof on the testnet (18 Nov 2026, same deployer wallet): deposit 1,000,000 → grant session (cap 800,000, per-tx 400,000) → execute 300,000 → over-cap 500,000 reverted `PerTxLimitExceeded` → non-allowlist recipient reverted `RecipientNotAllowed` → revoke → post-revoke spend reverted `SessionNotActive` → `ownerWithdraw` swept the vault to 0 and the deployer ended back at exactly 6,000,000 tUSD8. Evidence txs: grant `0xc8827806fd60595f99d3e52b11abd2496bed06c3070a7debb2eb34ced693f1fc`, payment `0xe3634e7f7d467157fd82ccbbae1fafcb97374fbff3a0b56169badca880e3325f`, revoke `0x20a6058d105140758cf88c5befb577fda72d3e15cd76350fe42a8c7620e73769`, withdraw `0x4517d7175503af3de4fe20b2b636657a1d17e76db24eb2af28724ba9c34f37d3`.

### Deploy (testnet only)

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://rpc-test.qday.info --broadcast --legacy -vvvv
```

`--legacy` is deliberate: some tooling mishandles EIP-1559 fields on this chain (starter-kit docs). No contract verification step exists on the explorer yet — submission evidence is this repo plus deployment addresses and transaction hashes.

### Build constraints that matter on Aevum

- **`evm_version = "shanghai"` is pinned in `foundry.toml`.** Cancun builds deploy and then revert at runtime with `invalid opcode: MCOPY`. No transient storage, no Cancun-only opcodes. The built bytecode is checked for MCOPY before every deploy.
- **No WebSocket RPC; poll over HTTPS.** Any UI built on this vault must poll for confirmations and chunk `eth_getLogs` queries to ≤1,000 blocks per call.
- **Fork chain id 440050 ≠ Aevum 44005.** Signatures are chain-bound; never replay one across them.

## API

All amounts are tUSD8 base units (6 decimals). Full signatures, events, and custom errors: [ARCHITECTURE.md](ARCHITECTURE.md).

| Function | Caller | Effect |
|---|---|---|
| `deposit(uint256 amount)` | Anyone (with approval) | Pulls exactly `amount` into the vault |
| `grantSession(key, recipients, maxPerTx, spendCap, expiresAt)` | Owner | Creates a session key |
| `revokeSession(key)` | Owner | Deactivates a key immediately |
| `executePayment(key, recipient, amount)` | The session key itself | Pays within the key's bounds |
| `ownerWithdraw()` | Owner | Sweeps the full remaining balance |
| `pause()` / `unpause()` | Owner | Circuit breaker (payments only) |
| `getSession(key)` / `isRecipientAllowed(key, recipient)` / `remainingCap(key)` / `vaultBalance()` | Anyone | Views |

Custom errors are granular (`CapExceeded`, `PerTxLimitExceeded`, `RecipientNotAllowed`, `SessionExpired`, `SessionNotActive`, `CallerNotSessionKey`, …) so a UI can show plain-language explanations instead of raw revert data.

## Known constraints

- **DIY session keys.** QDay's session-key / smart-account infrastructure is announced as live but has no published bundler, paymaster, factory, or SDK addresses usable by builders, and the official SDK ships Q1 2027. SpendGuard therefore implements scoped session keys natively in Solidity. This is the correct and only shippable approach today — and the starter kit's own docs name "a smart account with scoped session keys" as the gap to build. No ERC-4337, ERC-8004, or x402 integration is claimed: none is built, and claiming it would be worse than documenting the DIY design.
- **Public session state.** Caps, recipients, spent amounts, and expiries are readable on-chain. That is the audit trail, not a leak — but no privacy is promised.
- **Single-owner admin.** No multisig, timelock, or upgrade path in this build (see roadmap).
- **Testnet only, test tokens only.** No tokens are issued or promised.

## Reuse

The vault is a single self-contained contract plus standard OpenZeppelin dependencies. To deploy your own: clone, `forge install`, set `TUSD8_ADDRESS` to your token, run the deploy script. To point an agent at a deployed vault, the agent needs only the vault address, its own session-key address, and the `executePayment` ABI — it must never hold the owner key.

## Roadmap

- [x] Testnet deployment (18 Nov 2026) + UI (grant / pay / revoke / pause / sweep + session list with spent-vs-cap bars + audit-trail view), verified at desktop and mobile widths.
- Demo agent script holding only a session key.
- Demo video against the live deployment (over-cap revert, revoke, and pause shown on camera with tx hashes).
- Multisig owner / timelocked large grants.
- Migration to native ERC-4337 session keys when QDay publishes bundler, factory, and paymaster details (EntryPoint v0.7 is deployed on 44005 but undocumented and unusable without the rest of the stack — a roadmap footnote, not an integration claim).
- No EIP-3009 gasless path: the deployed tUSD8 has no `receiveWithAuthorization`/`transferWithAuthorization` (verified 18 Nov 2026), so no gasless flow via the token is possible. The core vault works without any relayer. EIP-2612 `permit` is present on the token if a signed-approval flow is ever wanted.

## License

MIT. See [LICENSE](LICENSE).
