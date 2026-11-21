#!/usr/bin/env node
/**
 * Live smoke test for spendguard-sdk on the Aevum testnet.
 *
 * Creates a FRESH vault through the SDK (the demo vault is untouched),
 * deposits 0.10 tUSD8, grants a fresh session key, pays 0.01 tUSD8 to the
 * deployer as the recipient, revokes the key, and sweeps the vault back to
 * zero. Prints every transaction hash. Net cost is ~0: the payment goes to
 * the deployer itself and the sweep returns the rest.
 *
 * Needs AEVUM_TESTNET_PRIVATE_KEY set to a TEST wallet key. The key is
 * never printed. Run with `npm run smoke-test`.
 *
 * Usage:
 *   AEVUM_TESTNET_PRIVATE_KEY=0x... node examples/smoke-test.mjs
 *   # or: source ~/workspace/aevum-prep/aevum-testnet-wallet.env && npm run smoke-test
 */

import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createSpendGuardClient,
  createSpendGuardWalletClient,
  explorerTxUrl,
  fromBaseUnits,
  toBaseUnits,
} from "../dist/index.js";

const RPC = "https://rpc-test.qday.info";
const key = process.env.AEVUM_TESTNET_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
  console.error("Set AEVUM_TESTNET_PRIVATE_KEY to a TEST wallet key first.");
  process.exit(2);
}

const ownerAccount = privateKeyToAccount(key);
const owner = createSpendGuardClient({
  walletClient: createSpendGuardWalletClient(key, RPC),
});

// A fresh session key, generated in memory, never funded with anything.
const sessionPrivateKey = generatePrivateKey();
const sessionKeyAccount = privateKeyToAccount(sessionPrivateKey);
const sessionKey = sessionKeyAccount.address;
const agent = createSpendGuardClient({
  walletClient: createSpendGuardWalletClient(sessionPrivateKey, RPC),
});

const now = () => BigInt(Math.floor(Date.now() / 1000));
const log = (label, value) => console.log(`${label}: ${value}`);

console.log(`Owner: ${ownerAccount.address}`);
console.log(`Session key: ${sessionKey}`);

// 1. Create a fresh vault.
const { vault, transactionHash: createHash } = await owner.createVault();
log("Vault created", `${vault} (${explorerTxUrl(createHash)})`);

// 2. Deposit 0.10 tUSD8.
const { approveHash, depositHash } = await owner.deposit(vault, toBaseUnits("0.10"));
if (approveHash) log("Approve tx", explorerTxUrl(approveHash));
log("Deposit tx", explorerTxUrl(depositHash));
const balanceAfterDeposit = await owner.vaultBalance(vault);
console.log(`Vault balance after deposit: ${fromBaseUnits(balanceAfterDeposit)} tUSD8`);
if (balanceAfterDeposit !== toBaseUnits("0.10")) throw new Error("Deposit did not land");

// 3. Grant the session key: cap 0.05, per-tx 0.02, 1 hour, recipient = owner.
const grantHash = await owner.grantSession(vault, {
  sessionKey,
  recipients: [ownerAccount.address],
  maxPerTx: toBaseUnits("0.02"),
  spendCap: toBaseUnits("0.05"),
  expiresAt: now() + 3600n,
});
log("Grant tx", explorerTxUrl(grantHash));
const session = await owner.getSession(vault, sessionKey);
if (!session.active || session.spendCap !== toBaseUnits("0.05")) throw new Error("Grant did not land");

// 3b. A session key pays its own gas, so the owner funds it with a little
// tQDAY. This is the real-world setup: the agent key holds gas, never the
// owner key.
const { sendTransaction } = await import("viem/actions");
const fundHash = await sendTransaction(owner.walletClient, {
  account: ownerAccount,
  to: sessionKey,
  value: 10n ** 16n, // 0.01 tQDAY
  type: "legacy",
});
await owner.publicClient.waitForTransactionReceipt({ hash: fundHash });
log("Fund session key gas tx", explorerTxUrl(fundHash));

// 4. Pre-flight check, then pay 0.01 as the session key.
const check = await agent.canSpend(vault, sessionKey, ownerAccount.address, toBaseUnits("0.01"));
if (!check.ok) throw new Error(`Pre-flight refused: ${check.reason}`);
const payHash = await agent.executePayment(vault, sessionKey, ownerAccount.address, toBaseUnits("0.01"));
log("Payment tx", explorerTxUrl(payHash));
const sessionAfter = await owner.getSession(vault, sessionKey);
console.log(`Session spent after payment: ${fromBaseUnits(sessionAfter.spent)} tUSD8`);
if (sessionAfter.spent !== toBaseUnits("0.01")) throw new Error("Payment did not land");

// 5. Over-cap payment must be refused by the pre-flight check.
const overCap = await agent.canSpend(vault, sessionKey, ownerAccount.address, toBaseUnits("0.05"));
if (overCap.ok) throw new Error("Pre-flight should have refused the over-cap payment");
console.log(`Over-cap correctly refused: ${overCap.reason}`);

// 6. Revoke, then sweep the vault back to zero.
const revokeHash = await owner.revokeSession(vault, sessionKey);
log("Revoke tx", explorerTxUrl(revokeHash));
const sweepHash = await owner.ownerWithdraw(vault);
log("Sweep tx", explorerTxUrl(sweepHash));
const balanceAfterSweep = await owner.vaultBalance(vault);
console.log(`Vault balance after sweep: ${fromBaseUnits(balanceAfterSweep)} tUSD8`);
if (balanceAfterSweep !== 0n) throw new Error("Sweep did not return the vault to zero");

// 7. History: the payment must be readable from the logs.
const payments = await owner.getPayments(vault);
console.log(`Payments in vault history: ${payments.length}`);
if (payments.length !== 1 || payments[0].amount !== toBaseUnits("0.01")) {
  throw new Error("Payment history did not return the expected payment");
}

console.log("\nSDK smoke test PASSED. Vault:", vault);
