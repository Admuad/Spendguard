# spendguard-sdk

TypeScript SDK for SpendGuard: scoped session-key vaults for tUSD8 on the QDay Aevum testnet (chain 44005). Give an agent a key that can only spend a little, only to approved merchants, only until Friday, and take it back in one click.

Built by Muhammed Adediran for the Aevum Builder Challenge #1. MIT licensed. The contracts are at `../src/`, the factory is deployed at `0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE`, and the live app is at https://admuad.github.io/Spendguard/.

## Install

```bash
npm install spendguard-sdk viem
```

Or, from this repo:

```bash
cd sdk && npm install && npm run build
```

Requires Node 20+. The only runtime dependency is `viem`.

## Quickstart

```ts
import {
  createSpendGuardClient,
  createSpendGuardWalletClient,
  toBaseUnits,
} from "spendguard-sdk";

// Owner: create a vault, fund it, grant a key to an agent.
const owner = createSpendGuardClient({
  walletClient: createSpendGuardWalletClient("0x...owner-test-key..."),
});
const { vault, transactionHash } = await owner.createVault();
await owner.deposit(vault, toBaseUnits("3.00"));
await owner.grantSession(vault, {
  sessionKey: "0x...agent-address...",
  recipients: ["0x...merchant-address..."],
  maxPerTx: toBaseUnits("0.10"),
  spendCap: toBaseUnits("1.00"),
  expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
});

// Agent: the agent holds ONLY the session key. It checks, then pays.
const agent = createSpendGuardClient({
  walletClient: createSpendGuardWalletClient("0x...agent-test-key..."),
});
const check = await agent.canSpend(vault, "0x...agent-address...", "0x...merchant-address...", toBaseUnits("0.05"));
if (check.ok) {
  await agent.executePayment(vault, "0x...agent-address...", "0x...merchant-address...", toBaseUnits("0.05"));
}

// Anyone: read state and history.
const readOnly = createSpendGuardClient();
const balance = await readOnly.vaultBalance(vault);
const payments = await readOnly.getPayments(vault);
```

## What the SDK covers

| Area | Methods |
|---|---|
| Factory | `createVault`, `vaultsOf`, `vaultCount`, `allVaults` |
| Owner | `deposit`, `grantSession`, `editSession`, `revokeSession`, `pause`, `unpause`, `ownerWithdraw` |
| Session key | `executePayment`, `canSpend` (pre-flight check) |
| Reads | `getSession`, `remainingCap`, `vaultBalance`, `isRecipientAllowed`, `isPaused`, `vaultOwner`, `vaultToken`, `tokenBalance`, `tokenAllowance` |
| History | `getPayments`, `getSessionGrants` (chunked log reads) |
| Helpers | `toBaseUnits`, `fromBaseUnits`, `explorerTxUrl`, `explorerAddressUrl`, `createSpendGuardWalletClient` |

## Rules the SDK follows (so you do not have to remember them)

- **Legacy transactions.** Every write uses a legacy (type 0) transaction, which is what Aevum expects.
- **1,000-block log limit.** Aevum caps `eth_getLogs` at 1,000 blocks. `getPayments` and `getSessionGrants` chunk their range automatically, starting from the factory deploy block.
- **Exact approvals.** `deposit` approves exactly the deposit amount, never an unlimited allowance.
- **Pre-flight checks.** `canSpend` mirrors the contract's checks (paused, active, expiry, per-tx limit, cap, allowlist, balance) before a payment is sent. The contract enforces the same bounds on-chain, so the check is a second layer, not the only layer.
- **One confirmation.** Every write waits for its receipt and throws if the transaction reverts.

## Session model

A session key may spend only within four bounds, all enforced on-chain:

- **Recipients:** an allowlist. Any other recipient reverts.
- **Per-transaction cap:** the largest single payment.
- **Cumulative cap:** the largest total the key may ever spend.
- **Expiry:** a Unix timestamp. A payment is valid only while now is before it.

The owner can revoke a key instantly, edit a live key's bounds without resetting what it already spent, pause all payments, and always sweep the full remaining balance, even while paused. Revocation is permanent: only a fresh grant resets `spent` to zero.

## Aevum notes

- Chain 44005, RPC `https://rpc-test.qday.info` (HTTPS only, no WebSocket).
- tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals.
- Explorer verification does not work on Aevum yet; the deployed addresses and the exact commit are in the repo README instead.
- There is no officially supported bundler or paymaster for this challenge, and account abstraction is not required. This SDK uses a normal wallet plus tUSD8 payments.
- Test tokens only. Never use a mainnet key with this SDK.

## Tests

```bash
npm test          # unit tests, no network needed
npm run smoke-test  # live end-to-end run on Aevum testnet (needs a test wallet)
```

The smoke test creates a fresh vault through the SDK, deposits 0.10 tUSD8, grants a session key, pays 0.01 tUSD8, revokes the key, and sweeps the vault back to zero. It prints every transaction hash. It needs `AEVUM_TESTNET_PRIVATE_KEY` set to a TEST wallet key, and never prints the key.

## License

MIT. See `../LICENSE`.
