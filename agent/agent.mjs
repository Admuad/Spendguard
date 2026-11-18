#!/usr/bin/env node
/**
 * SpendGuard demo agent.
 *
 * Pays a merchant from the SpendGuard vault using ONLY a scoped session key.
 * The agent never holds the owner key, never calls any admin function, and
 * refuses to send unless every on-chain bound checks out first. The contract
 * enforces the same bounds on-chain, so these pre-flight checks are a second
 * layer, not the only layer.
 *
 * Configuration comes only from environment variables (see .env.example).
 * This script never reads a .env file and never prints a secret.
 *
 * Usage:
 *   node agent.mjs --dry-run          Check everything, send nothing.
 *   node agent.mjs                   Run the pre-flight checks, then pay once.
 *   node agent.mjs --ledger <path>   Use a different idempotency ledger file.
 *   node agent.mjs --help            Show usage.
 *
 * Exit codes: 0 = paid (or dry-run passed), 2 = refused (safe, nothing sent),
 * 1 = unexpected error, ambiguous send, or unconfirmed transaction.
 *
 * No em dashes are used in user-facing copy in this project.
 */

import { appendFileSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Constants. The chain guard and the defaults pin this agent to the Aevum
// testnet and the deployed SpendGuard vault. Nothing here is a secret.
// ---------------------------------------------------------------------------

export const AEVUM_CHAIN_ID = 44005;
export const DEFAULT_RPC_URL = "https://rpc-test.qday.info";
export const DEFAULT_VAULT_ADDRESS = "0x048a64225419C11C9Ff0CB39aA925902c5e965Ac";
export const EXPLORER_URL = "https://explorer-test.qday.info";
export const TUSD8_DECIMALS = 6;

/** Refuse a payment when the session expires within this many seconds. */
export const EXPIRY_SAFETY_MARGIN_SECONDS = 60n;
/** Refuse to send if the gas estimate is above this. executePayment is cheap. */
export const MAX_GAS = 500_000n;
/** Refuse to send if the network gas price is above this (10 gwei). */
export const MAX_GAS_PRICE = 10_000_000_000n;
/** Invoice IDs are ledger keys: short, no whitespace, no newlines. */
export const MAX_INVOICE_ID_LENGTH = 128;
/** A lock older than this is treated as stale (a crashed run). */
export const LOCK_STALE_MS = 5 * 60 * 1000;
/** How long to wait for the payment receipt before reporting unconfirmed. */
export const RECEIPT_TIMEOUT_MS = 120_000;

const UINT256_MAX = 2n ** 256n - 1n;
const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ZERO_PRIVATE_KEY = `0x${"0".repeat(64)}`;

// ---------------------------------------------------------------------------
// Minimal ABI. Deliberately narrow: reads plus executePayment only. The agent
// cannot grant, revoke, pause, deposit, or sweep, even if asked, because the
// functions are not in this ABI. Mirrors src/SpendGuard.sol for these entries.
// ---------------------------------------------------------------------------

export const AGENT_ABI_SIGNATURES = [
  "function paused() view returns (bool)",
  "function executePayment(address sessionKey, address recipient, uint256 amount)",
  "function getSession(address sessionKey) view returns ((uint256 maxPerTx, uint256 spendCap, uint256 spent, uint64 expiresAt, bool active, address[] recipients))",
  "function isRecipientAllowed(address sessionKey, address recipient) view returns (bool)",
  "function remainingCap(address sessionKey) view returns (uint256)",
  "function vaultBalance() view returns (uint256)",
];

export const agentAbi = parseAbi(AGENT_ABI_SIGNATURES);

export const aevumTestnet = defineChain({
  id: AEVUM_CHAIN_ID,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_RPC_URL] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: EXPLORER_URL } },
  testnet: true,
});

// ---------------------------------------------------------------------------
// Errors. A Refusal is an expected, safe stop: nothing was sent. Anything
// else is unexpected and exits 1.
// ---------------------------------------------------------------------------

export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers. These carry no I/O so the test suite can hammer them.
// ---------------------------------------------------------------------------

/**
 * Strict amount parsing. Accepts only a plain decimal string with at most
 * 6 fractional digits (tUSD8 has 6 decimals). No floats anywhere: the
 * conversion is string splitting plus BigInt math. Returns the amount in
 * base units, or null for anything malformed, zero, negative, or too large
 * for a uint256.
 */
export function parseAmount(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(TUSD8_DECIMALS, "0");
  let amount;
  try {
    amount = BigInt(whole) * 10n ** BigInt(TUSD8_DECIMALS) + BigInt(padded);
  } catch {
    return null;
  }
  if (amount === 0n) return null;
  if (amount > UINT256_MAX) return null;
  return amount;
}

/** Format base units back to a plain decimal string, no floats. */
export function formatAmount(amount) {
  const units = 10n ** BigInt(TUSD8_DECIMALS);
  const whole = amount / units;
  const fraction = amount % units;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(TUSD8_DECIMALS, "0").replace(/0+$/, "")}`;
}

/** The chain guard. Only the Aevum testnet, exactly. */
export function assertChainId(chainId) {
  if (chainId !== AEVUM_CHAIN_ID) {
    throw new Refusal(
      `Wrong chain: the RPC reports chain ${chainId}, this agent only runs on chain ${AEVUM_CHAIN_ID} (QDay Aevum Testnet). Refusing.`
    );
  }
}

function isValidPrivateKeyFormat(value) {
  return typeof value === "string" && PRIVATE_KEY_PATTERN.test(value) && value.toLowerCase() !== ZERO_PRIVATE_KEY;
}

function isValidInvoiceId(value) {
  return typeof value === "string" && value.length <= MAX_INVOICE_ID_LENGTH && INVOICE_ID_PATTERN.test(value);
}

function isValidRpcUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Load and validate configuration from the environment. Fails closed with a
 * plain-language message on the first problem. Never includes secret values
 * in any message.
 */
export function loadConfig(env, argv = []) {
  const args = [...argv];
  let ledgerOverride = null;
  let dryRun = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--ledger") {
      ledgerOverride = args.shift();
      if (!ledgerOverride) throw new Refusal("--ledger needs a file path.");
    } else if (arg === "--help" || arg === "-h") {
      throw new Refusal("__HELP__");
    } else {
      throw new Refusal(`Unknown argument: ${arg}. Use --dry-run, --ledger <path>, or --help.`);
    }
  }

  const privateKey = env.SESSION_KEY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Refusal("SESSION_KEY_PRIVATE_KEY is not set. The agent needs the session key, never the owner key.");
  }
  if (!isValidPrivateKeyFormat(privateKey)) {
    throw new Refusal("SESSION_KEY_PRIVATE_KEY is malformed. It must be a 0x-prefixed 64 hex character key.");
  }

  const recipient = env.AGENT_RECIPIENT;
  if (!recipient) throw new Refusal("AGENT_RECIPIENT is not set. Set the merchant address this payment goes to.");
  if (!isAddress(recipient)) throw new Refusal("AGENT_RECIPIENT is not a valid address.");

  const amountRaw = env.AGENT_AMOUNT;
  if (!amountRaw) throw new Refusal("AGENT_AMOUNT is not set. Set the payment amount, for example 0.25.");
  const amount = parseAmount(amountRaw);
  if (amount === null) {
    throw new Refusal("AGENT_AMOUNT is not a valid positive amount with at most 6 decimals. Examples: 0.25, 1, 1.000001.");
  }

  const invoiceId = env.AGENT_INVOICE_ID;
  if (!invoiceId) throw new Refusal("AGENT_INVOICE_ID is not set. Every payment needs a unique invoice ID.");
  if (!isValidInvoiceId(invoiceId)) {
    throw new Refusal(
      "AGENT_INVOICE_ID is invalid. Use up to 128 letters, digits, dots, dashes, or underscores, starting with a letter or digit."
    );
  }

  const rpcUrl = env.RPC_URL || DEFAULT_RPC_URL;
  if (!isValidRpcUrl(rpcUrl)) throw new Refusal("RPC_URL is not a valid http or https URL.");

  const vaultAddress = env.VAULT_ADDRESS || DEFAULT_VAULT_ADDRESS;
  if (!isAddress(vaultAddress)) throw new Refusal("VAULT_ADDRESS is not a valid address.");

  const ledgerPath = ledgerOverride || env.AGENT_LEDGER_PATH || "agent-ledger.jsonl";

  return { privateKey, recipient, amount, amountRaw: amountRaw.trim(), invoiceId, rpcUrl, vaultAddress, ledgerPath, dryRun };
}

// ---------------------------------------------------------------------------
// Pre-flight evaluation. Pure: given chain state and the intended payment,
// decide. Every failure is a plain-language reason. The contract enforces
// the same rules on-chain; this is the early, readable layer.
// ---------------------------------------------------------------------------

/**
 * @param state { paused, sessionActive, expiresAt, blockTimestamp,
 *   recipientAllowed, maxPerTx, remainingCap, vaultBalance }
 * @param intent { amount }
 */
export function evaluatePreflight(state, intent) {
  const failures = [];
  if (state.paused) {
    failures.push("The vault is paused. Payments are frozen until the owner unpauses.");
  }
  if (!state.sessionActive) {
    failures.push("No active session for this key. Ask the owner to grant a session to this key address first.");
  } else if (state.blockTimestamp >= state.expiresAt) {
    failures.push("The session has expired. Ask the owner for a fresh grant.");
  } else if (state.expiresAt - state.blockTimestamp <= EXPIRY_SAFETY_MARGIN_SECONDS) {
    failures.push("The session expires within 60 seconds. Refusing to race the expiry; ask the owner for a fresh grant.");
  }
  if (!state.recipientAllowed) {
    failures.push("The recipient is not on this session allowlist. The contract would revert this payment.");
  }
  if (intent.amount > state.maxPerTx) {
    failures.push(`The amount is above the per-payment limit of ${formatAmount(state.maxPerTx)} tUSD8.`);
  }
  if (intent.amount > state.remainingCap) {
    failures.push(`The amount is above the remaining cap of ${formatAmount(state.remainingCap)} tUSD8.`);
  }
  if (intent.amount > state.vaultBalance) {
    failures.push(`The payment of ${formatAmount(intent.amount)} tUSD8 exceeds the vault balance of ${formatAmount(state.vaultBalance)} tUSD8. The owner needs to deposit ${formatAmount(intent.amount - state.vaultBalance)} tUSD8 more before this payment can go through.`);
  }
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Idempotency ledger. Append-only JSONL: one line per payment attempt.
// An invoice is payable only when it has no entry, or when its latest entry
// is "reverted" (a reverted payment moved no funds). A corrupt ledger fails
// closed: if we cannot prove the invoice is unpaid, we do not pay.
// ---------------------------------------------------------------------------

export function readLedgerEntries(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const text = readFileSync(ledgerPath, "utf8");
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      throw new Refusal(`The ledger file ${ledgerPath} is corrupt (a line is not valid JSON). Refusing to pay until it is fixed.`);
    }
    if (typeof entry !== "object" || entry === null || typeof entry.invoiceId !== "string" || typeof entry.status !== "string") {
      throw new Refusal(`The ledger file ${ledgerPath} is corrupt (a line has an unexpected shape). Refusing to pay until it is fixed.`);
    }
    entries.push(entry);
  }
  return entries;
}

export function findLatestEntry(entries, invoiceId) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].invoiceId === invoiceId) return entries[i];
  }
  return null;
}

/** True when the invoice may be attempted: never seen, or last attempt reverted. */
export function isInvoicePayable(entries, invoiceId) {
  const latest = findLatestEntry(entries, invoiceId);
  if (latest === null) return true;
  return latest.status === "reverted";
}

export function appendLedgerEntry(ledgerPath, entry) {
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function ledgerEntry({ invoiceId, sessionKey, recipient, amount, amountRaw, txHash, status }) {
  return {
    invoiceId,
    sessionKey,
    recipient,
    amount: amount.toString(),
    amountDisplay: `${amountRaw} tUSD8`,
    txHash,
    status,
    at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Single-instance lock. Two concurrent runs could fetch the same pending
// nonce and collide. The lock file holds only a PID and a timestamp.
// ---------------------------------------------------------------------------

function acquireLock(ledgerPath) {
  const lockPath = `${ledgerPath}.lock`;
  const writeLock = () => writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
  try {
    writeLock();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let ageMs = Infinity;
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      ageMs = Infinity;
    }
    if (ageMs > LOCK_STALE_MS) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Another process removed it first; fall through to retry.
      }
      writeLock();
    } else {
      throw new Refusal(
        `Another agent run holds the lock (${lockPath}). Run one instance at a time. If no run is active, delete the lock file and retry.`
      );
    }
  }
  return () => {
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock already gone; nothing to do.
    }
  };
}

// ---------------------------------------------------------------------------
// Chain reads. Read-only: safe to run in dry-run mode and in tests.
// ---------------------------------------------------------------------------

export function createPublicClientFor(rpcUrl) {
  return createPublicClient({ chain: aevumTestnet, transport: http(rpcUrl) });
}

export async function fetchPreflightState(publicClient, vaultAddress, sessionKey, recipient) {
  const [paused, session, recipientAllowed, remainingCap, vaultBalance, block] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: agentAbi, functionName: "paused" }),
    publicClient.readContract({ address: vaultAddress, abi: agentAbi, functionName: "getSession", args: [sessionKey] }),
    publicClient.readContract({
      address: vaultAddress,
      abi: agentAbi,
      functionName: "isRecipientAllowed",
      args: [sessionKey, recipient],
    }),
    publicClient.readContract({ address: vaultAddress, abi: agentAbi, functionName: "remainingCap", args: [sessionKey] }),
    publicClient.readContract({ address: vaultAddress, abi: agentAbi, functionName: "vaultBalance" }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);
  return {
    paused,
    sessionActive: session.active,
    expiresAt: session.expiresAt,
    blockTimestamp: block.timestamp,
    recipientAllowed,
    maxPerTx: session.maxPerTx,
    spendCap: session.spendCap,
    spent: session.spent,
    remainingCap,
    vaultBalance,
  };
}

export function explorerTxUrl(hash) {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address) {
  return `${EXPLORER_URL}/address/${address}`;
}

// ---------------------------------------------------------------------------
// Sending. Send-once discipline with a pinned nonce:
//  - The nonce is fetched once and reused for the single retry, so a retry
//    can never create a second payment if the first attempt actually landed:
//    a reused nonce is rejected by the chain.
//  - If a hash is obtained, the transaction is never resent. We only poll
//    for its receipt.
//  - If a send fails without a hash, we check whether the nonce was consumed
//    before retrying once. If the nonce was consumed, the send is ambiguous
//    and we stop: the operator checks the explorer before doing anything.
// ---------------------------------------------------------------------------

async function sendWithPinnedNonce({ walletClient, publicClient, account, config, gas, gasPrice }) {
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const request = {
    address: config.vaultAddress,
    abi: agentAbi,
    functionName: "executePayment",
    args: [account.address, config.recipient, config.amount],
    account,
    nonce,
    gas,
    gasPrice,
    type: "legacy",
  };

  const nonceConsumed = async () => {
    const count = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    return count > nonce;
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const hash = await walletClient.writeContract(request);
      return hash;
    } catch (error) {
      const consumed = await nonceConsumed().catch(() => true);
      if (consumed) {
        throw new Error(
          `Send attempt ${attempt} failed without returning a hash, but the nonce was consumed, so a transaction may have landed. ` +
            `NOT retrying. Check the explorer for ${account.address} before running again. ` +
            `Original error: ${error.shortMessage || error.message}`
        );
      }
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Unreachable: send loop ended without a hash or an error.");
}

async function waitForReceipt(publicClient, hash) {
  try {
    return await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch {
    // Timeout or RPC hiccup: one last direct check before giving up.
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) return receipt;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

const USAGE = `SpendGuard demo agent: pay from the vault with a scoped session key.

Usage:
  node agent.mjs --dry-run          Check everything, send nothing.
  node agent.mjs                   Check everything, then pay once.
  node agent.mjs --ledger <path>   Use a different idempotency ledger file.
  node agent.mjs --help            Show this text.

Environment (no defaults for secrets):
  SESSION_KEY_PRIVATE_KEY   The session key. Never the owner key.
  AGENT_RECIPIENT           Merchant address, must be on the session allowlist.
  AGENT_AMOUNT              Decimal amount, for example 0.25 (tUSD8, 6 decimals).
  AGENT_INVOICE_ID          Unique ID for this payment. A paid ID is never paid twice.
  RPC_URL                   Optional. Defaults to the Aevum testnet RPC.
  VAULT_ADDRESS             Optional. Defaults to the deployed SpendGuard vault.
  AGENT_LEDGER_PATH         Optional. Defaults to agent-ledger.jsonl.

The owner must grant a session to the agent key address before the first run.
See README.md in this folder for the full setup and security model.`;

export async function main(argv, env) {
  let config;
  try {
    config = loadConfig(env, argv);
  } catch (error) {
    if (error instanceof Refusal && error.message === "__HELP__") {
      console.log(USAGE);
      return 0;
    }
    throw error;
  }

  // The private key is used exactly once, to build the account object. It is
  // never printed, never written to disk, and never leaves this process
  // except inside the signed transaction (which reveals only the address).
  const account = privateKeyToAccount(config.privateKey);
  const releaseLock = acquireLock(config.ledgerPath);
  try {
    const entries = readLedgerEntries(config.ledgerPath);
    if (!isInvoicePayable(entries, config.invoiceId)) {
      const latest = findLatestEntry(entries, config.invoiceId);
      throw new Refusal(
        `Invoice ${config.invoiceId} was already paid (tx ${latest.txHash}, status ${latest.status}). Refusing to pay it twice. ` +
          `Explorer: ${explorerTxUrl(latest.txHash)}`
      );
    }

    const publicClient = createPublicClientFor(config.rpcUrl);
    const chainId = await publicClient.getChainId();
    assertChainId(chainId);

    const state = await fetchPreflightState(publicClient, config.vaultAddress, account.address, config.recipient);
    const decision = evaluatePreflight(state, { amount: config.amount });

    console.log("SpendGuard agent pre-flight:");
    console.log(`  session key:  ${account.address}`);
    console.log(`  recipient:    ${config.recipient}`);
    console.log(`  amount:       ${config.amountRaw} tUSD8`);
    console.log(`  invoice:      ${config.invoiceId}`);
    console.log(`  vault paused: ${state.paused}`);
    console.log(`  session:      ${state.sessionActive ? "active" : "not active"}, spent ${formatAmount(state.spent)} of ${formatAmount(state.spendCap)} tUSD8`);
    console.log(`  remaining:    ${formatAmount(state.remainingCap)} tUSD8, per-payment limit ${formatAmount(state.maxPerTx)} tUSD8`);
    console.log(`  vault holds:  ${formatAmount(state.vaultBalance)} tUSD8`);
    console.log(`  recipient on allowlist: ${state.recipientAllowed}`);

    if (!decision.ok) {
      for (const failure of decision.failures) console.log(`  REFUSED: ${failure}`);
      throw new Refusal("Pre-flight checks failed. Nothing was sent.");
    }
    console.log("  checks:       all passed");

    // Gas estimation is read-only and doubles as a would-it-revert check.
    let gasEstimate;
    try {
      gasEstimate = await publicClient.estimateContractGas({
        address: config.vaultAddress,
        abi: agentAbi,
        functionName: "executePayment",
        args: [account.address, config.recipient, config.amount],
        account: account.address,
      });
    } catch (error) {
      throw new Refusal(
        `Gas estimation failed, which means the payment would revert on-chain. Nothing was sent. ` +
          `Detail: ${error.shortMessage || error.message}`
      );
    }
    if (gasEstimate > MAX_GAS) {
      throw new Refusal(`Gas estimate ${gasEstimate} is above the safety cap of ${MAX_GAS}. Refusing.`);
    }
    const gas = (gasEstimate * 120n) / 100n > MAX_GAS ? MAX_GAS : (gasEstimate * 120n) / 100n;

    const gasPrice = await publicClient.getGasPrice();
    if (gasPrice > MAX_GAS_PRICE) {
      throw new Refusal(`Network gas price ${gasPrice} wei is above the safety cap of ${MAX_GAS_PRICE} wei. Refusing.`);
    }

    const gasBalance = await publicClient.getBalance({ address: account.address });
    const gasCost = gas * gasPrice;
    console.log(`  gas estimate: ${gasEstimate} (limit ${gas}), price ${gasPrice} wei, key holds ${gasBalance} wei of tQDAY`);
    if (!config.dryRun && gasBalance < gasCost) {
      throw new Refusal("The session key does not hold enough tQDAY to pay for gas. Fund it with a little tQDAY and retry.");
    }

    if (config.dryRun) {
      console.log("DRY RUN: all checks passed. Nothing was sent and the ledger was not touched.");
      console.log(
        `Would send: executePayment(${account.address}, ${config.recipient}, ${config.amountRaw} tUSD8) as a legacy transaction.`
      );
      return 0;
    }

    const walletClient = createWalletClient({ account, chain: aevumTestnet, transport: http(config.rpcUrl) });
    const hash = await sendWithPinnedNonce({ walletClient, publicClient, account, config, gas, gasPrice });
    console.log(`Sent: ${hash}`);
    console.log(`Explorer: ${explorerTxUrl(hash)}`);

    // Record the payment the moment we hold a hash, before waiting for the
    // receipt, so a crash cannot leave a paid invoice looking unpaid.
    const base = {
      invoiceId: config.invoiceId,
      sessionKey: account.address,
      recipient: config.recipient,
      amount: config.amount,
      amountRaw: config.amountRaw,
      txHash: hash,
    };
    appendLedgerEntry(config.ledgerPath, ledgerEntry({ ...base, status: "submitted" }));

    const receipt = await waitForReceipt(publicClient, hash);
    if (receipt === null) {
      console.log("The receipt could not be confirmed within the timeout. The transaction was recorded as submitted.");
      console.log("Do NOT resend: check the explorer link above. The invoice stays blocked until this is resolved.");
      return 1;
    }
    if (receipt.status === "success") {
      appendLedgerEntry(config.ledgerPath, ledgerEntry({ ...base, status: "confirmed" }));
      console.log(`Confirmed in block ${receipt.blockNumber}. Paid ${config.amountRaw} tUSD8 to ${config.recipient}.`);
      return 0;
    }
    appendLedgerEntry(config.ledgerPath, ledgerEntry({ ...base, status: "reverted" }));
    console.log("The transaction reverted on-chain. No funds moved. The invoice may be retried after the cause is fixed.");
    return 1;
  } finally {
    releaseLock();
  }
}

// Run only when executed directly, not when imported by the tests.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env)
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof Refusal) {
        console.error(`Refused: ${error.message}`);
        process.exit(2);
      }
      console.error(`Error: ${error.shortMessage || error.message}`);
      process.exit(1);
    });
}
