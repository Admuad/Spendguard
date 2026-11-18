import { formatUnits, isAddress, parseUnits } from "viem";
import { TUSD8_DECIMALS } from "./config";

/** Format a tUSD8 base-unit amount as a human-readable string, e.g. 6.00. */
export function formatTusd8(amount: bigint, digits = 2): string {
  const value = formatUnits(amount, TUSD8_DECIMALS);
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "0".repeat(digits)).slice(0, digits);
  const grouped = Number(whole).toLocaleString("en-US");
  return digits > 0 ? `${grouped}.${padded}` : grouped;
}

/** Parse a human-entered tUSD8 amount ("1.5") to base units. Null if invalid. */
export function parseTusd8(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, TUSD8_DECIMALS);
  } catch {
    return null;
  }
}

export function shortenAddress(address: string): string {
  if (!isAddress(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Shorten a 66-char transaction hash: 0x4517d717…34f37d3. */
export function shortenHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function isValidAddress(value: string): boolean {
  return isAddress(value.trim());
}

/** Split a recipients textarea (one per line, or comma-separated) into addresses. */
export function parseRecipients(input: string): { valid: string[]; invalid: string[] } {
  const parts = input
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    if (isAddress(part)) valid.push(part);
    else invalid.push(part);
  }
  // De-duplicate (case-insensitive) while keeping order.
  const seen = new Set<string>();
  const deduped = valid.filter((a) => {
    const key = a.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { valid: deduped, invalid };
}

export function formatExpiry(expiresAt: bigint): string {
  const date = new Date(Number(expiresAt) * 1000);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Plain-language error mapping. Contract reverts and wallet errors are
 * translated to sentences a first-time user can act on. Raw revert hex is
 * never shown.
 */
export function plainErrorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.message} ${"cause" in error ? String((error as { cause?: unknown }).cause ?? "") : ""} ${"shortMessage" in error ? String((error as { shortMessage?: unknown }).shortMessage ?? "") : ""}`
      : String(error ?? "");

  const known: Array<[string, string]> = [
    ["CapExceeded", "This payment would push the session past its total spend cap. Lower the amount or ask the owner for a new grant."],
    ["PerTxLimitExceeded", "This payment is above the session's per-transaction limit. Split it into smaller payments within the limit."],
    ["RecipientNotAllowed", "That recipient is not on this session's allowlist. Payments can only go to approved recipients."],
    ["SessionNotActive", "This session is revoked or was never granted. The owner needs to grant a fresh session."],
    ["SessionExpired", "This session has expired. The owner needs to grant a fresh session."],
    ["CallerNotSessionKey", "Only the session key itself can make this payment. Connect the wallet whose address was granted the session."],
    ["InsufficientVaultBalance", "The vault does not hold enough tUSD8 for this payment. The owner needs to deposit more."],
    ["SessionAlreadyActive", "This key already has an active session. Revoke it first, then grant a new one."],
    ["MaxPerTxExceedsSpendCap", "The per-transaction limit cannot be larger than the total spend cap."],
    ["ZeroSpendCap", "The spend cap must be greater than zero."],
    ["ZeroMaxPerTx", "The per-transaction limit must be greater than zero."],
    ["ExpiryInPast", "The expiry must be in the future."],
    ["EmptyAllowlist", "Add at least one recipient to the allowlist."],
    ["ZeroAmount", "The amount must be greater than zero."],
    ["ZeroAddress", "A zero address is not allowed here. Check the addresses you entered."],
    ["OwnableUnauthorizedAccount", "Only the vault owner can do that."],
    ["EnforcedPause", "The vault is paused. Payments are frozen until the owner unpauses."],
  ];
  for (const [needle, message] of known) {
    if (text.includes(needle)) return message;
  }

  if (/user rejected|user denied|rejected the request|4001/i.test(text)) {
    return "Transaction rejected in your wallet. Nothing changed on-chain.";
  }
  if (/insufficient funds/i.test(text)) {
    return "Not enough tQDAY for gas. Top up from the Aevum faucet and try again.";
  }
  if (/nonce|replacement transaction underpriced/i.test(text)) {
    return "A conflicting transaction is already pending. Wait for it to confirm, then try again.";
  }
  if (/network|timeout|fetch failed|failed to fetch/i.test(text)) {
    return "Could not reach the Aevum testnet. Check your connection and try again.";
  }
  return "The transaction failed. Nothing changed on-chain. Check the details and try again.";
}

/** Plain-language wallet-connection failures. A failed connect must never
 * fail silently: the user needs to know whether there is no wallet, the
 * request was rejected, or something else went wrong. */
export function plainConnectErrorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${"cause" in error ? String((error as { cause?: unknown }).cause ?? "") : ""} ${"shortMessage" in error ? String((error as { shortMessage?: unknown }).shortMessage ?? "") : ""}`
      : String(error ?? "");
  if (/provider not found|providernotfound|no provider|connector not found|no injected|no wallet|no ethereum provider/i.test(text)) {
    return "No wallet was found in this browser. Install MetaMask, Rabby, or another injected wallet, then try again.";
  }
  if (/user rejected|user denied|rejected the request|4001/i.test(text)) {
    return "The connection request was rejected in your wallet. Nothing was connected. Try again when you are ready.";
  }
  if (/already.*pending|request already/i.test(text)) {
    return "A wallet request is already open. Check your wallet and answer it, then try again.";
  }
  return "Could not connect to a wallet. Make sure your wallet is unlocked and try again.";
}

/** Plain-language network-switch failures. */
export function plainSwitchErrorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${"cause" in error ? String((error as { cause?: unknown }).cause ?? "") : ""} ${"shortMessage" in error ? String((error as { shortMessage?: unknown }).shortMessage ?? "") : ""}`
      : String(error ?? "");
  if (/user rejected|user denied|rejected the request|4001/i.test(text)) {
    return "The network switch was rejected in your wallet. Switch to the Aevum testnet (chain 44005) manually, or try again.";
  }
  if (/4902|unrecognized chain|addethereumchain|chain.*not.*add/i.test(text)) {
    return "Your wallet could not add the Aevum testnet automatically. Add it manually: chain 44005, RPC https://rpc-test.qday.info. Then switch to it.";
  }
  return "Could not switch networks. Switch to the Aevum testnet (chain 44005) in your wallet and try again.";
}
