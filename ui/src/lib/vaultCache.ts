import type { Log } from "viem";
import { EXPLORER_URL, readClient } from "./config";
import { BASE_PATH } from "./site";

/**
 * One shared on-chain log store for the whole app: the activity page, the
 * home-page dashboard and the overview all read vault events through the
 * same useVaultData hook, so they all share this one cache.
 *
 * The app is a static export with no backend, so the cache lives in the
 * browser (localStorage, per vault). First visit: the full log scan runs
 * once and is saved. Later visits: cached events render instantly and only
 * blocks after the saved tip are fetched from the RPC.
 *
 * Only the raw logs are stored (small, plain JSON). Sessions and activity
 * are always re-derived from them, and live session state (spent, active)
 * is always re-read from the chain, so cached data can never show a stale
 * balance or a stale spent amount: at worst the activity list is a few
 * blocks behind until the background sync lands.
 */

export type CachedLog = {
  /** blockNumber as a hex string. */
  b: string;
  /** transactionHash. */
  h: `0x${string}`;
  /** logIndex, for stable ordering. */
  i: number;
  /** topics. */
  t: `0x${string}`[];
  /** data. */
  d: `0x${string}`;
};

export type VaultLogCache = {
  version: 1;
  vault: string;
  /** Last block fully scanned, as a decimal string. */
  scannedThrough: string;
  /** Logs oldest-first, as fetched. */
  logs: CachedLog[];
};

const PREFIX = "spendguard-vault-logs-v1:";
/** Bound the store: ~5000 logs is well under localStorage limits. */
const MAX_LOGS = 5000;

export function readVaultLogCache(vault: `0x${string}`): VaultLogCache | null {
  try {
    const raw = localStorage.getItem(PREFIX + vault.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultLogCache;
    if (
      parsed.version !== 1 ||
      typeof parsed.vault !== "string" ||
      parsed.vault.toLowerCase() !== vault.toLowerCase() ||
      typeof parsed.scannedThrough !== "string" ||
      !Array.isArray(parsed.logs)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeVaultLogCache(
  vault: `0x${string}`,
  scannedThrough: bigint,
  logs: Log[],
): void {
  try {
    const cached: CachedLog[] = logs.map((l) => ({
      b: `0x${(l.blockNumber ?? 0n).toString(16)}`,
      h: l.transactionHash as `0x${string}`,
      i: l.logIndex ?? 0,
      t: [...(l.topics as `0x${string}`[])],
      d: l.data as `0x${string}`,
    }));
    const payload: VaultLogCache = {
      version: 1,
      vault: vault.toLowerCase(),
      scannedThrough: scannedThrough.toString(),
      logs: cached.slice(-MAX_LOGS),
    };
    localStorage.setItem(PREFIX + vault.toLowerCase(), JSON.stringify(payload));
  } catch {
    // Storage full or unavailable: the app keeps working, it just rescans.
  }
}

/** Rebuild the minimal viem Log shape decodeActivity needs. */
export function cachedLogToLog(c: CachedLog, address: `0x${string}`): Log {
  return {
    address,
    blockHash: null,
    blockNumber: BigInt(c.b),
    data: c.d,
    logIndex: c.i,
    removed: false,
    topics: c.t,
    transactionHash: c.h,
    transactionIndex: 0,
  } as unknown as Log;
}

/**
 * The demo vault's history, shipped with the app as a static seed
 * (public/demo-vault-logs.json, regenerated at build time). A cold first
 * visit to a new origin has no localStorage cache, and scanning ~255k
 * blocks in 1,000-block chunks takes minutes on a phone. The seed is the
 * same VaultLogCache shape, so hydrating from it is identical to hydrating
 * from the local cache: the app renders instantly and only fetches blocks
 * after the seed's tip. Returns null when the seed is missing, stale for a
 * different vault, or unreadable, and the caller falls back to the full
 * scan. Only the demo vault has a seed; other vaults always scan.
 */
export async function fetchDemoVaultSeed(
  vault: `0x${string}`,
): Promise<VaultLogCache | null> {
  try {
    const res = await fetch(`${BASE_PATH}/demo-vault-logs.json`);
    if (!res.ok) return null;
    const parsed = (await res.json()) as VaultLogCache;
    if (
      parsed.version !== 1 ||
      typeof parsed.vault !== "string" ||
      parsed.vault.toLowerCase() !== vault.toLowerCase() ||
      typeof parsed.scannedThrough !== "string" ||
      !Array.isArray(parsed.logs)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const CREATED_PREFIX = "spendguard-vault-created-v1:";

/** The block a vault was created in, when already known on this device. */
export function readVaultCreationBlock(vault: `0x${string}`): bigint | null {
  try {
    const raw = localStorage.getItem(CREATED_PREFIX + vault.toLowerCase());
    if (!raw) return null;
    const n = BigInt(raw);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function writeVaultCreationBlock(vault: `0x${string}`, block: bigint): void {
  try {
    localStorage.setItem(CREATED_PREFIX + vault.toLowerCase(), block.toString());
  } catch {
    // Storage unavailable: the app keeps working, it just re-resolves.
  }
}

/**
 * The block a vault was created in, so a first load can scan from there
 * instead of the factory deploy block. A vault created today has only a
 * few blocks of history, so this turns a ~255k-block cold scan into a
 * handful of calls. Resolved from the explorer (one fast address lookup
 * for the creation transaction, then one receipt read for its block) and
 * cached on this device, so it is paid once per vault. Returns null when
 * the explorer or the receipt cannot be read, and the caller falls back
 * to scanning from the factory deploy block.
 */
export async function resolveVaultCreationBlock(
  vault: `0x${string}`,
): Promise<bigint | null> {
  const stored = readVaultCreationBlock(vault);
  if (stored !== null) return stored;
  try {
    const res = await fetch(`${EXPLORER_URL}/api/v2/addresses/${vault}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { creation_transaction_hash?: unknown };
    const txHash = data.creation_transaction_hash;
    if (typeof txHash !== "string" || !txHash.startsWith("0x")) return null;
    const receipt = await readClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    const block = receipt.blockNumber;
    if (block > 0n) {
      writeVaultCreationBlock(vault, block);
      return block;
    }
    return null;
  } catch {
    return null;
  }
}
