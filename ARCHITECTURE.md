# SpendGuard — Architecture

## Components

```
┌──────────┐  approve + deposit   ┌────────────────────┐  safeTransfer  ┌────────────┐
│  Owner   │─────────────────────>│                    │───────────────>│  Merchant  │
│  (EOA)   │<──ownerWithdraw──────│    SpendGuard      │                │ (allowlist)│
└──────────┘  grant/revoke/pause  │      Vault         │                └────────────┘
     │                             │  (Solidity, 44005) │
     │ grants                      └─────────┬──────────┘
     ▼                                       │ executePayment
┌──────────┐                                 │ (msg.sender == key)
│ Session  │─────────────────────────────────┘
│ key (EOA │
│ / agent) │
└──────────┘

Off-chain (convenience only, never trusted for security):
  UI: displays state, submits transactions, polls over HTTPS.
  Agent script: holds ONLY the session key; calls executePayment.
```

Two contracts, one token, no proxies, no upgrades. Each user gets their own
vault from the factory; the vault holds tUSD8 and enforces every bound
on-chain. The factory only creates vaults and records who owns which: it
holds no funds, has no owner, and cannot touch a vault after creation. The UI and agent script are convenience layers:
a compromised frontend cannot make the vault pay outside a session key's
bounds, because every check lives in `executePayment`.

## Contract: SpendGuardFactory

`src/SpendGuardFactory.sol` — one function that matters: `createVault()`
deploys a full `SpendGuard` with the caller as owner, records it in
`vaultsOf(caller)` and `allVaults`, and emits `VaultCreated`. Views:
`vaultsOf(owner)`, `vaultCount()`, `allVaults(i)`, `token()`. No admin
functions, no pause, no upgrade path, no funds. Full deployments (not
minimal-proxy clones) are deliberate: no initializer pattern, no proxy
storage-layout risk, and the vault logic stays exactly the code the test
suite proves. Clones are a roadmap gas optimisation.

## Contract: SpendGuard

`src/SpendGuard.sol` — Solidity 0.8.24, EVM Shanghai, OpenZeppelin 5.4.0
(`Ownable`, `ReentrancyGuard`, `Pausable`, `SafeERC20`). No custom access
control, no custom reentrancy guard, no transient storage, no delegate calls.

### State

| Item | Type | Notes |
|---|---|---|
| `token` | `IERC20 immutable` | The vault token (tUSD8). Set once in the constructor. |
| `_sessions` | `mapping(address => Session)` | Per-key grant: `maxPerTx`, `spendCap`, `spent`, `expiresAt`, `active`, `recipients[]`. |
| `_isRecipientAllowed` | `mapping(address => mapping(address => bool))` | O(1) allowlist check. Cleared on re-grant so a new session never inherits old recipients. |

No internal balance accounting: the token balance is the single source of
truth for solvency (INV-17). `spent` is the only cumulative accounting, and
it only ever increases within a session (INV-16).

### Workflows

**Deposit.** Caller approves exactly `amount`, calls `deposit(amount)`.
The vault pulls via `safeTransferFrom` and credits the balance delta
actually received (robust to fee-on-transfer tokens). Emits `Deposit`.

**Grant.** Owner calls `grantSession(key, recipients, maxPerTx, spendCap,
expiresAt)`. Validation (INV-11): non-zero key, non-empty allowlist with no
zero address, `spendCap > 0`, `maxPerTx > 0`, `maxPerTx <= spendCap`,
`expiresAt > block.timestamp`, key not already active. Re-granting a
revoked/expired key clears the old allowlist and resets `spent` to 0 — a
fresh session, never a resurrection. Emits `SessionGranted`. Grants are
allowed while paused (pause blocks payments, not admin).

**Pay.** The session key calls `executePayment(key, recipient, amount)`.
Checks, in order: caller is the key (INV-14); key active (INV-2); not
expired, `block.timestamp < expiresAt` — a payment in the exact expiry
second reverts; amount positive and within `maxPerTx` (INV-8); cumulative
`spent + amount <= spendCap` (INV-1); recipient allowlisted (INV-3); vault
balance covers `amount` (INV-17); vault not paused (INV-6). Effects
(`spent += amount`) happen before the `safeTransfer` (INV-9), under the
reentrancy guard (INV-10). Emits `PaymentExecuted`.

**Revoke.** Owner calls `revokeSession(key)`. Immediate and irreversible by
the key holder (INV-7). `spent` is preserved for the audit trail. Emits
`SessionRevoked`.

**Pause / unpause.** Owner-only circuit breaker. `pause` blocks
`executePayment` only; `ownerWithdraw`, grants, and revokes keep working.

**Sweep.** Owner calls `ownerWithdraw()`. Transfers the entire current
balance to the owner, in any state, with no dependency on session state
(INV-4). Emits `OwnerWithdraw`.

### API reference

```solidity
function deposit(uint256 amount) external;
function grantSession(address sessionKey, address[] calldata recipients,
    uint256 maxPerTx, uint256 spendCap, uint64 expiresAt) external;
function revokeSession(address sessionKey) external;
function executePayment(address sessionKey, address recipient, uint256 amount) external;
function ownerWithdraw() external;
function pause() external;
function unpause() external;

function getSession(address sessionKey) external view returns (Session memory);
function isRecipientAllowed(address sessionKey, address recipient) external view returns (bool);
function remainingCap(address sessionKey) external view returns (uint256);
function vaultBalance() external view returns (uint256);
function token() external view returns (address);
function owner() external view returns (address);
function paused() external view returns (bool);
```

### Events (the audit trail)

```solidity
event Deposit(address indexed depositor, uint256 amount, uint256 newBalance);
event SessionGranted(address indexed sessionKey, address[] recipients,
    uint256 maxPerTx, uint256 spendCap, uint256 expiresAt);
event SessionRevoked(address indexed sessionKey, uint256 spent, uint256 remainingCap);
event PaymentExecuted(address indexed sessionKey, address indexed recipient,
    uint256 amount, uint256 newSpent, uint256 remainingCap);
event OwnerWithdraw(address indexed owner, uint256 amount, uint256 newBalance);
// plus OpenZeppelin Paused(address account) / Unpaused(address account)
```

### Custom errors (plain-language mapping for UIs)

| Error | Meaning for the user |
|---|---|
| `CapExceeded()` | Over the session's cumulative cap |
| `PerTxLimitExceeded()` | Over the per-transaction limit |
| `RecipientNotAllowed()` | Recipient is not on this key's allowlist |
| `SessionExpired()` | The session has expired |
| `SessionNotActive()` | The session is revoked (or was never granted) |
| `CallerNotSessionKey()` | Only the session key itself can spend |
| `InsufficientVaultBalance()` | This payment exceeds the vault balance |
| `ZeroAmount()` | Amount must be greater than zero |
| `ZeroSpendCap()` / `ZeroMaxPerTx()` / `MaxPerTxExceedsSpendCap()` / `ExpiryInPast()` / `EmptyAllowlist()` / `SessionAlreadyActive()` / `ZeroAddress()` | Invalid grant parameters |
| `EnforcedPause()` | The vault is paused (OpenZeppelin) |
| `OwnableUnauthorizedAccount(address)` | Owner-only function (OpenZeppelin) |
| `SafeERC20FailedOperation(address)` | The token move failed (revert surfaced, or a silent `false` from a non-standard token) |

### Call flow: a payment

```
Agent (session key)
  │ executePayment(key, merchant, amount)
  ▼
SpendGuard ── checks ──► all bounds hold?
  │ no → revert with a granular error, no state change
  │ yes
  ▼
spent += amount            (effects)
  │
  ▼
token.safeTransfer(merchant, amount)   (interaction, return value checked)
  │
  ▼
emit PaymentExecuted
```

### Why this shape

- **Session key as an address, not a bearer secret.** The key *is* the
  identity (`msg.sender == sessionKey`). Naming another key's address
  authorises nothing, and there is no secret to leak in calldata.
- **Edit re-specifies bounds, never resets spending.** `editSession`
  re-specifies a live session's recipients, per-tx limit, cap, and expiry
  while `spent` is preserved, and the new cap must cover `spent`
  (`CapBelowSpent`), so `remainingCap` can never underflow. A revoked
  session can never be edited: revocation stays terminal, and only a fresh
  grant after a revoke starts a new session at `spent == 0` (INV-16,
  INV-19). Every edit emits `SessionEdited`, so the audit trail stays
  append-only in meaning.
- **Defence in depth on reentrancy.** Checks-effects-interactions *and* a
  reentrancy guard on all three fund-moving functions. Either layer alone
  stops the attack; both are required.
- **SafeERC20 everywhere.** The deployed tUSD8 reverts on failure
  (fork-verified), and SafeERC20 is retained as defense-in-depth so a
  silent `false` from any non-standard token would still revert the
  operation instead of corrupting accounting. Every move checks its
  return value.
- **No approvals granted by the vault.** The vault never approves any
  spender, so there is no approval for an attacker to exploit.

## Off-chain components (planned)

- **Web UI** (Next.js + viem/wagmi): connect wallet, vault view, grant form
  with confirmation summary, session list with spent-vs-cap bars, revoke /
  pause / sweep controls, audit-trail view from events. Polls over HTTPS
  (no WebSocket RPC on Aevum); chunks `eth_getLogs` to ≤1,000 blocks/call;
  maps custom errors to plain-language messages; de-duplicates retried
  payments (idempotency: the contract's `spent` accounting already makes a
  retried payment fail closed on the cap).
- **Demo agent script**: holds only a session key (env var, never in the
  repo), pays a merchant within bounds, prints tx hashes. Proves the
  agentic story: the agent can pay, and can only pay within bounds.

## Testing

- `test/SpendGuard.t.sol`: 29 tests — happy path, views, events, the 15
  scripted adversarial scenarios (T-1..T-15), reentrancy via a hook token,
  and non-reverting-token behaviour.
- `test/SpendGuardInvariant.t.sol`: stateful fuzz over random operation
  sequences from random actors; 4 invariant functions asserting the 12
  properties (P-1..P-12) after every step, 512 runs × 64 calls.
- `test/mocks/Mocks.sol`: plain 6-decimal token, non-reverting token,
  hook token, malicious recipient, malicious owner harness.

Run: `forge build && forge test`. Green suite is required before any
testnet deploy; no test may be skipped or marked expected-to-fail.
