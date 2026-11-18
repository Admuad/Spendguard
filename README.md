# SpendGuard

**Give an agent a key that can only spend a little, only to approved merchants, only until Friday — and take it back in one click.**

SpendGuard is a scoped session-key vault for tUSD8 on the QDay Aevum testnet (chain 44005), built for the [Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail). The owner deposits tUSD8 once, then grants session keys — to a person, a bot, an AI agent, or a cashier — that may spend only within tight, on-chain-enforced bounds: an allowlisted set of recipients, a per-transaction cap, a cumulative spend cap, and an expiry. Every bound is enforced by the contract, not by the frontend. The owner can revoke any key instantly and can always sweep the remaining balance.

Spending authority becomes a grantable, revocable, auditable object — not a shared wallet key.

- **Track:** Decentralized Payments, with the Native AI Assistants angle as the innovation story (an autonomous agent pays merchants within bounds while the owner watches the audit trail).
- **Status:** contracts + full test suite complete. Testnet deployment, UI, and demo video follow in the build window (see [Roadmap](#roadmap)).

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
- **Non-reverting token safe.** tUSD8 does not revert on transfer failure, so every token move goes through OpenZeppelin `SafeERC20`: a silent `false` reverts the vault operation and never corrupts cap accounting.
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
ARCHITECTURE.md           # Architecture, flows, and API examples
THREAT-MODEL.md           # Security specification and accepted risks
```

## Setup and reproduction

Prerequisites: [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`).

```bash
git clone https://github.com/Admuad/Spendguard.git
cd Spendguard
forge install   # fetches OpenZeppelin v5.4.0 + forge-std (see .gitmodules)
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
| SpendGuard vault | *(deployed during the build window; address + tx hashes recorded here on deploy)* |

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

- Testnet deployment + UI (grant / pay / revoke / pause / sweep + session list with spent-vs-cap bars + audit-trail view) + demo agent script holding only a session key.
- Demo video against the live deployment (over-cap revert, revoke, and pause shown on camera with tx hashes).
- Multisig owner / timelocked large grants.
- Migration to native ERC-4337 session keys when QDay publishes bundler, factory, and paymaster details (EntryPoint v0.7 is deployed on 44005 but undocumented and unusable without the rest of the stack — a roadmap footnote, not an integration claim).
- Optional EIP-3009 gasless path: a session key signs an authorization, a relayer submits. The core vault works without any relayer; gasless is an additive option, not a dependency.

## License

MIT. See [LICENSE](LICENSE).
