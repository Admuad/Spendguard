import type { Log } from "viem";

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
