#!/usr/bin/env node
/**
 * SpendGuard LLM agent.
 *
 * The demo agent with a real language model in the loop. You give it a
 * task in plain language ("pay the freelancer 0.10 tUSD8 for the logo")
 * and an LLM decides the payment: which payee, how much, and whether it
 * fits the session key's bounds. The decision is printed as a visible
 * transcript, so the demo can show the model reasoning.
 *
 * The LLM decides. The chain enforces. The model can only pick a
 * recipient from the payee directory you supply, and the payment still
 * goes through the SDK's canSpend pre-flight and the contract's on-chain
 * bounds. If the model is unreachable, replies with garbage, picks an
 * unknown address, or asks for more than the session allows, the agent
 * refuses and sends nothing.
 *
 * The default model provider is Pollinations, which is free and needs
 * no API key and no account. Set LLM_PROVIDER=openai with OPENAI_API_KEY
 * to use an OpenAI-compatible endpoint instead.
 *
 * Configuration comes only from environment variables (see .env.example
 * and README.md). This script never reads a .env file and never prints
 * a secret. Testnet only: chain 44005.
 *
 * Usage:
 *   node llm-agent.mjs --task "pay the freelancer 0.10 tUSD8 for the logo" --dry-run
 *   node llm-agent.mjs --task "pay the freelancer 0.10 tUSD8 for the logo"
 *   node llm-agent.mjs --help
 *
 * Exit codes: 0 = paid (or dry-run passed), 2 = refused (safe, nothing
 * sent), 1 = unexpected error, ambiguous send, or unconfirmed transaction.
 *
 * No em dashes are used in user-facing copy in this project.
 */

import { appendFileSync } from "node:fs";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AEVUM_CHAIN_ID,
  DEFAULT_RPC_URL,
  DEFAULT_VAULT_ADDRESS,
  Refusal,
  appendLedgerEntry,
  explorerTxUrl,
  findLatestEntry,
  formatAmount,
  isInvoicePayable,
  parseAmount,
  readLedgerEntries,
} from "./agent.mjs";
import {
  createSpendGuardClient,
  createSpendGuardWalletClient,
  explorerTxUrl as sdkExplorerTxUrl,
  fromBaseUnits,
  spendGuardAbi,
} from "../sdk/dist/index.js";
import { resolveProvider } from "./llm-providers.mjs";

// ---------------------------------------------------------------------------
// Constants. Same safety caps as the scripted agent.
// ---------------------------------------------------------------------------

/** Refuse to send if the gas estimate is above this. executePayment is cheap. */
export const MAX_GAS = 500_000n;
/** Refuse to send if the network gas price is above this (10 gwei). */
export const MAX_GAS_PRICE = 10_000_000_000n;
/** How long to wait for the payment receipt before reporting unconfirmed. */
export const RECEIPT_TIMEOUT_MS = 120_000;
export const DEFAULT_TRANSCRIPT_PATH = "llm-agent-transcript.jsonl";
export const DEFAULT_LEDGER_PATH = "agent-ledger.jsonl";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_PRIVATE_KEY = `0x${"0".repeat(64)}`;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_TASK_LENGTH = 500;

// ---------------------------------------------------------------------------
// Payee directory. The model may only pay an address listed here, by name.
// The on-chain session allowlist is the final check either way.
// ---------------------------------------------------------------------------

/**
 * Parse AGENT_PAYEES, a JSON object mapping a payee name to an address,
 * for example {"freelancer": "0x...", "designer": "0x..."}. Returns a Map
 * from lowercase name to checksummed address. Fails closed on bad JSON,
 * a non-object, an empty directory, a bad name, or a bad address.
 */
export function parsePayees(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Refusal("AGENT_PAYEES is not set. Give the model a payee directory, for example {\"freelancer\": \"0x...\"}.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Refusal("AGENT_PAYEES is not valid JSON. It must be an object mapping a payee name to an address.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Refusal("AGENT_PAYEES must be a JSON object mapping a payee name to an address.");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new Refusal("AGENT_PAYEES is empty. Give the model at least one named payee.");
  }
  const payees = new Map();
  for (const [name, address] of entries) {
    if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(name)) {
      throw new Refusal(`AGENT_PAYEES has a bad payee name: ${JSON.stringify(name)}. Use letters, digits, spaces, dashes, or underscores.`);
    }
    if (typeof address !== "string" || !isAddress(address)) {
      throw new Refusal(`AGENT_PAYEES has a bad address for payee "${name}". It must be a valid address.`);
    }
    payees.set(name.toLowerCase(), address);
  }
  return payees;
}

/** Find a payee by address (case-insensitive). Returns the name, or null. */
export function payeeNameForAddress(payees, address) {
  const wanted = address.toLowerCase();
  for (const [name, listed] of payees) {
    if (listed.toLowerCase() === wanted) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt. The model gets the task, the payee directory, and the live
// session limits, so its decision can already respect the bounds.
// ---------------------------------------------------------------------------

export function buildPrompt({ task, payees, session, remainingCap, vaultBalance, paused }) {
  const lines = payees.size === 0
    ? ["(none)"]
    : [...payees].map(([name, address]) => `- ${name}: ${address}`);
  const expires = new Date(Number(session.expiresAt) * 1000).toISOString();
  return [
    "You are the payment brain for a SpendGuard session key on the Aevum testnet.",
    "You decide whether a task should be paid, to whom, and how much.",
    "You never move funds yourself. You only return a JSON decision. The chain enforces the session bounds.",
    "",
    `Task: "${task}"`,
    "",
    "Known payees (name -> address). You may ONLY pay an address from this list:",
    ...lines,
    "",
    "Session limits for this key:",
    `- per-payment limit: ${formatAmount(session.maxPerTx)} tUSD8`,
    `- remaining cap: ${formatAmount(remainingCap)} tUSD8`,
    `- already spent: ${formatAmount(session.spent)} tUSD8`,
    `- vault balance: ${formatAmount(vaultBalance)} tUSD8`,
    `- vault paused: ${paused ? "yes" : "no"}`,
    `- session active: ${session.active ? "yes" : "no"}`,
    `- session expires: ${expires}`,
    "",
    "Rules:",
    "- If the task names a payee and an amount, and the amount fits the per-payment limit, the remaining cap, and the vault balance, return {\"recipient\": \"<address>\", \"amount\": \"<decimal>\", \"reason\": \"<one short sentence>\"}.",
    "- If the task is unclear, names no known payee, asks for more than the limits allow, or is not a payment at all, return {\"refuse\": true, \"reason\": \"<one short sentence>\"}.",
    "- Reply with ONLY the JSON object. No other text, no markdown fences.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Decision parsing and validation. The model output is untrusted input:
// it is parsed strictly, and the recipient must be in the payee directory.
// ---------------------------------------------------------------------------

/**
 * Extract a JSON object from the model's reply. Models sometimes wrap the
 * object in prose or markdown fences, so the first {...} block is taken.
 * Returns the parsed object, or null when no valid JSON object is found.
 */
export function extractDecisionJson(rawText) {
  if (typeof rawText !== "string") return null;
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(rawText.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Validate a parsed decision against the payee directory.
 * Returns { ok: true, recipient, amount, reason } for a payment, or
 * { ok: false, refused: true, reason } for a model refusal, or
 * { ok: false, reason } for an invalid decision.
 */
export function validateDecision(decision, payees) {
  if (decision === null) {
    return { ok: false, reason: "The model reply contained no valid JSON object." };
  }
  if (decision.refuse === true) {
    const reason = typeof decision.reason === "string" && decision.reason.trim()
      ? decision.reason.trim()
      : "The model refused the task.";
    return { ok: false, refused: true, reason };
  }
  const recipient = decision.recipient;
  if (typeof recipient !== "string" || !isAddress(recipient)) {
    return { ok: false, reason: "The model returned a recipient that is not a valid address." };
  }
  const name = payeeNameForAddress(payees, recipient);
  if (name === null) {
    return { ok: false, reason: `The model picked ${recipient}, which is not in the payee directory. Only listed payees may be paid.` };
  }
  const amount = parseAmount(typeof decision.amount === "string" ? decision.amount : "");
  if (amount === null) {
    return { ok: false, reason: "The model returned an amount that is not a valid positive tUSD8 amount." };
  }
  const reason = typeof decision.reason === "string" && decision.reason.trim()
    ? decision.reason.trim()
    : "Model decision.";
  return { ok: true, recipient, amount, amountRaw: decision.amount.trim(), payeeName: name, reason };
}

// ---------------------------------------------------------------------------
// Transcript. One JSON line per run, so the demo can display the model's
// reasoning: the task, the prompt, the raw reply, the decision, the
// pre-flight result, and the outcome. No secrets are ever written here.
// ---------------------------------------------------------------------------

export function appendTranscript(transcriptPath, entry) {
  appendFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Config.
// ---------------------------------------------------------------------------

function isValidPrivateKeyFormat(value) {
  return typeof value === "string" && PRIVATE_KEY_PATTERN.test(value) && value.toLowerCase() !== ZERO_PRIVATE_KEY;
}

function isValidInvoiceId(value) {
  return typeof value === "string" && value.length <= 128 && INVOICE_ID_PATTERN.test(value);
}

function isValidRpcUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function loadLlmConfig(env, argv = []) {
  const args = [...argv];
  let dryRun = false;
  let ledgerOverride = null;
  let taskOverride = null;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--ledger") {
      ledgerOverride = args.shift();
      if (!ledgerOverride) throw new Refusal("--ledger needs a file path.");
    } else if (arg === "--task") {
      taskOverride = args.shift();
      if (!taskOverride) throw new Refusal("--task needs a task in plain language.");
    } else if (arg === "--help" || arg === "-h") {
      throw new Refusal("__HELP__");
    } else {
      throw new Refusal(`Unknown argument: ${arg}. Use --task "...", --dry-run, --ledger <path>, or --help.`);
    }
  }

  const privateKey = env.SESSION_KEY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Refusal("SESSION_KEY_PRIVATE_KEY is not set. The agent needs the session key, never the owner key.");
  }
  if (!isValidPrivateKeyFormat(privateKey)) {
    throw new Refusal("SESSION_KEY_PRIVATE_KEY is malformed. It must be a 0x-prefixed 64 hex character key.");
  }

  const task = (taskOverride || env.AGENT_TASK || "").trim();
  if (!task) {
    throw new Refusal("No task given. Pass --task \"pay the freelancer 0.10 tUSD8 for the logo\" or set AGENT_TASK.");
  }
  if (task.length > MAX_TASK_LENGTH) {
    throw new Refusal(`The task is ${task.length} characters, over the ${MAX_TASK_LENGTH} limit. Keep it to one short instruction.`);
  }

  const payees = parsePayees(env.AGENT_PAYEES);

  const invoiceId = env.AGENT_INVOICE_ID;
  if (!invoiceId) throw new Refusal("AGENT_INVOICE_ID is not set. Every payment needs a unique invoice ID.");
  if (!isValidInvoiceId(invoiceId)) {
    throw new Refusal("AGENT_INVOICE_ID is invalid. Use up to 128 letters, digits, dots, dashes, or underscores, starting with a letter or digit.");
  }

  const rpcUrl = env.RPC_URL || DEFAULT_RPC_URL;
  if (!isValidRpcUrl(rpcUrl)) throw new Refusal("RPC_URL is not a valid http or https URL.");

  const vaultAddress = env.VAULT_ADDRESS || DEFAULT_VAULT_ADDRESS;
  if (!isAddress(vaultAddress)) throw new Refusal("VAULT_ADDRESS is not a valid address.");

  const providerName = env.LLM_PROVIDER || "pollinations";
  const transcriptPath = env.LLM_TRANSCRIPT_PATH || DEFAULT_TRANSCRIPT_PATH;
  const ledgerPath = ledgerOverride || env.AGENT_LEDGER_PATH || DEFAULT_LEDGER_PATH;

  return { privateKey, task, payees, invoiceId, rpcUrl, vaultAddress, providerName, transcriptPath, ledgerPath, dryRun };
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

const USAGE = `SpendGuard LLM agent: a language model decides the payment, the chain enforces the bounds.

Usage:
  node llm-agent.mjs --task "pay the freelancer 0.10 tUSD8 for the logo" --dry-run
  node llm-agent.mjs --task "pay the freelancer 0.10 tUSD8 for the logo"
  node llm-agent.mjs --ledger <path> --task "..."
  node llm-agent.mjs --help

Environment (no defaults for secrets):
  SESSION_KEY_PRIVATE_KEY   The session key. Never the owner key.
  AGENT_TASK                Plain-language task, or pass --task "...".
  AGENT_PAYEES              JSON map of payee name to address, for example {"freelancer": "0x..."}.
  AGENT_INVOICE_ID          Unique ID for this payment. A paid ID is never paid twice.
  RPC_URL                   Optional. Defaults to the Aevum testnet RPC.
  VAULT_ADDRESS             Optional. Defaults to the deployed SpendGuard vault.
  LLM_PROVIDER              Optional. "pollinations" (default, free, no key) or "openai" (needs OPENAI_API_KEY).
  LLM_MODEL                 Optional. Model name for the provider.
  OPENAI_API_KEY            Needed only for LLM_PROVIDER=openai.
  OPENAI_BASE_URL           Optional. OpenAI-compatible endpoint for LLM_PROVIDER=openai.
  AGENT_LEDGER_PATH         Optional. Defaults to agent-ledger.jsonl.
  LLM_TRANSCRIPT_PATH       Optional. Defaults to llm-agent-transcript.jsonl.

The owner must grant a session to the agent key address before the first run.
See README.md in this folder for the full setup and security model.`;

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

export async function main(argv, env) {
  let config;
  try {
    config = loadLlmConfig(env, argv);
  } catch (error) {
    if (error instanceof Refusal && error.message === "__HELP__") {
      console.log(USAGE);
      return 0;
    }
    throw error;
  }

  const account = privateKeyToAccount(config.privateKey);
  const provider = resolveProvider(config.providerName, env);
  const transcript = { task: config.task, provider: provider.name, at: new Date().toISOString() };

  // The private key is used exactly once, to build the account object. It is
  // never printed, never written to disk, and never leaves this process
  // except inside the signed transaction (which reveals only the address).
  console.log("SpendGuard LLM agent:");
  console.log(`  task:         ${config.task}`);
  console.log(`  session key:  ${account.address}`);
  console.log(`  vault:        ${config.vaultAddress}`);
  console.log(`  provider:     ${provider.name} (free, no key)`);
  console.log(`  invoice:      ${config.invoiceId}`);

  const entries = readLedgerEntries(config.ledgerPath);
  if (!isInvoicePayable(entries, config.invoiceId)) {
    const latest = findLatestEntry(entries, config.invoiceId);
    throw new Refusal(
      `Invoice ${config.invoiceId} was already paid (tx ${latest.txHash}, status ${latest.status}). Refusing to pay it twice. ` +
        `Explorer: ${explorerTxUrl(latest.txHash)}`
    );
  }

  const walletClient = createSpendGuardWalletClient(config.privateKey, config.rpcUrl);
  const client = createSpendGuardClient({ rpcUrl: config.rpcUrl, walletClient });

  const chainId = await client.publicClient.getChainId();
  if (chainId !== AEVUM_CHAIN_ID) {
    throw new Refusal(
      `Wrong chain: the RPC reports chain ${chainId}, this agent only runs on chain ${AEVUM_CHAIN_ID} (QDay Aevum Testnet). Refusing.`
    );
  }

  const [session, remainingCap, vaultBalance, paused] = await Promise.all([
    client.getSession(config.vaultAddress, account.address),
    client.remainingCap(config.vaultAddress, account.address),
    client.vaultBalance(config.vaultAddress),
    client.isPaused(config.vaultAddress),
  ]);

  console.log("  session state:");
  console.log(`    active: ${session.active}, per-payment limit ${formatAmount(session.maxPerTx)} tUSD8, cap ${formatAmount(session.spendCap)} tUSD8`);
  console.log(`    spent ${formatAmount(session.spent)} tUSD8, remaining ${formatAmount(remainingCap)} tUSD8, vault holds ${formatAmount(vaultBalance)} tUSD8, paused: ${paused}`);

  const prompt = buildPrompt({ task: config.task, payees: config.payees, session, remainingCap, vaultBalance, paused });
  transcript.prompt = prompt;

  console.log("  model: asking the LLM to decide...");
  const rawReply = await provider.call(prompt);
  transcript.rawReply = rawReply;
  console.log("  model reply:");
  console.log(`    ${rawReply.replace(/\n/g, "\n    ")}`);

  const parsed = extractDecisionJson(rawReply);
  const decision = validateDecision(parsed, config.payees);
  transcript.decision = decision.ok
    ? { recipient: decision.recipient, amount: decision.amountRaw, payee: decision.payeeName, reason: decision.reason }
    : { refused: true, reason: decision.reason };

  if (!decision.ok) {
    console.log(`  REFUSED: ${decision.reason}`);
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: decision.reason });
    throw new Refusal(`The model decision was refused: ${decision.reason} Nothing was sent.`);
  }

  console.log(`  decision: pay ${decision.payeeName} (${decision.recipient}) ${decision.amountRaw} tUSD8`);
  console.log(`  reasoning: ${decision.reason}`);

  const check = await client.canSpend(config.vaultAddress, account.address, decision.recipient, decision.amount);
  transcript.preflight = check;
  if (!check.ok) {
    console.log(`  REFUSED by pre-flight: ${check.reason}`);
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: check.reason });
    throw new Refusal(`Pre-flight check failed: ${check.reason} Nothing was sent.`);
  }
  console.log("  pre-flight: all checks passed");

  // Gas estimation is read-only and doubles as a would-it-revert check.
  let gasEstimate;
  try {
    gasEstimate = await client.publicClient.estimateContractGas({
      address: config.vaultAddress,
      abi: spendGuardAbi,
      functionName: "executePayment",
      args: [account.address, decision.recipient, decision.amount],
      account: account.address,
    });
  } catch (error) {
    const reason = `Gas estimation failed, which means the payment would revert on-chain. Nothing was sent. Detail: ${error.shortMessage || error.message}`;
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: reason });
    throw new Refusal(reason);
  }
  if (gasEstimate > MAX_GAS) {
    const reason = `Gas estimate ${gasEstimate} is above the safety cap of ${MAX_GAS}. Refusing.`;
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: reason });
    throw new Refusal(reason);
  }
  const gasPrice = await client.publicClient.getGasPrice();
  if (gasPrice > MAX_GAS_PRICE) {
    const reason = `Network gas price ${gasPrice} wei is above the safety cap of ${MAX_GAS_PRICE} wei. Refusing.`;
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: reason });
    throw new Refusal(reason);
  }
  const gasBalance = await client.publicClient.getBalance({ address: account.address });
  const gasCost = gasEstimate * gasPrice;
  console.log(`  gas estimate: ${gasEstimate}, price ${gasPrice} wei, key holds ${gasBalance} wei of tQDAY`);
  if (!config.dryRun && gasBalance < gasCost) {
    const reason = "The session key does not hold enough tQDAY to pay for gas. Fund it with a little tQDAY and retry.";
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "refused", outcomeReason: reason });
    throw new Refusal(reason);
  }

  if (config.dryRun) {
    console.log("DRY RUN: the model decided and every check passed. Nothing was sent and the ledger was not touched.");
    console.log(`Would send: executePayment(${account.address}, ${decision.recipient}, ${decision.amountRaw} tUSD8) as a legacy transaction.`);
    appendTranscript(config.transcriptPath, { ...transcript, outcome: "dry-run-ok" });
    return 0;
  }

  const hash = await client.executePayment(config.vaultAddress, account.address, decision.recipient, decision.amount);
  console.log(`Sent: ${hash}`);
  console.log(`Explorer: ${sdkExplorerTxUrl(hash)}`);

  const base = {
    invoiceId: config.invoiceId,
    sessionKey: account.address,
    recipient: decision.recipient,
    amount: decision.amount,
    amountRaw: decision.amountRaw,
    txHash: hash,
  };
  appendLedgerEntry(config.ledgerPath, ledgerEntry({ ...base, status: "confirmed" }));
  appendTranscript(config.transcriptPath, { ...transcript, outcome: "confirmed", txHash: hash });
  console.log(`Confirmed. Paid ${decision.amountRaw} tUSD8 to ${decision.payeeName}.`);
  return 0;
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
