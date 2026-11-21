import { useCallback, useEffect, useRef, useState } from "react";
import type { Log } from "viem";
import {
  DEPLOY_BLOCK,
  FACTORY_ADDRESS,
  MAX_LOG_RANGE,
  TUSD8_ADDRESS,
  VAULT_ADDRESS,
  erc20Abi,
  factoryAbi,
  readClient,
  spendGuardAbi,
} from "./config";
import { cachedLogToLog, fetchDemoVaultSeed, readVaultLogCache, writeVaultLogCache } from "./vaultCache";

/** One decoded vault event, newest first in the activity list. */
export type VaultActivity =
  | {
      kind: "deposit";
      hash: `0x${string}`;
      blockNumber: bigint;
      depositor: `0x${string}`;
      amount: bigint;
    }
  | {
      kind: "grant";
      hash: `0x${string}`;
      blockNumber: bigint;
      sessionKey: `0x${string}`;
      recipients: readonly `0x${string}`[];
      maxPerTx: bigint;
      spendCap: bigint;
      expiresAt: bigint;
    }
  | {
      kind: "edit";
      hash: `0x${string}`;
      blockNumber: bigint;
      sessionKey: `0x${string}`;
      recipients: readonly `0x${string}`[];
      maxPerTx: bigint;
      spendCap: bigint;
      expiresAt: bigint;
    }
  | {
      kind: "revoke";
      hash: `0x${string}`;
      blockNumber: bigint;
      sessionKey: `0x${string}`;
      spent: bigint;
      remainingCap: bigint;
    }
  | {
      kind: "payment";
      hash: `0x${string}`;
      blockNumber: bigint;
      sessionKey: `0x${string}`;
      recipient: `0x${string}`;
      amount: bigint;
      newSpent: bigint;
    }
  | {
      kind: "withdraw";
      hash: `0x${string}`;
      blockNumber: bigint;
      owner: `0x${string}`;
      amount: bigint;
    };

export type SessionState = {
  key: `0x${string}`;
  maxPerTx: bigint;
  spendCap: bigint;
  spent: bigint;
  expiresAt: bigint;
  active: boolean;
  recipients: readonly `0x${string}`[];
  remainingCap: bigint;
};

export type VaultData = {
  balance: bigint | null;
  paused: boolean | null;
  owner: `0x${string}` | null;
  sessions: SessionState[];
  activity: VaultActivity[];
  grantsCount: number;
  paymentsCount: number;
  /** True while the first load is still in flight. */
  loading: boolean;
  /** Non-null when the last read failed; data shown may be stale. */
  error: string | null;
  refresh: () => void;
};

const POLL_MS = 20_000;

/** Chunks are fetched concurrently so a cold scan is seconds, not minutes. */
const LOG_CONCURRENCY = 6;

/** Fetch logs in ≤1,000-block chunks (Aevum's eth_getLogs limit), fetching
 * chunks concurrently. A cold scan over ~80k blocks is ~80 sequential
 * round trips one-by-one; in parallel it is a handful of rounds. */
async function getLogsChunked(from: bigint, to: bigint, address: `0x${string}`): Promise<Log[]> {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_LOG_RANGE - 1n > to ? to : cursor + MAX_LOG_RANGE - 1n;
    ranges.push({ from: cursor, to: end });
    cursor = end + 1n;
  }
  const results: Log[][] = new Array(ranges.length);
  let next = 0;
  async function worker() {
    while (next < ranges.length) {
      const i = next++;
      const r = ranges[i];
      results[i] = await readClient.getLogs({
        address,
        fromBlock: r.from,
        toBlock: r.to,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LOG_CONCURRENCY, ranges.length) }, () => worker()),
  );
  return results.flat();
}

function decodeActivity(log: Log): VaultActivity | null {
  try {
    return decodeWithAbi(log);
  } catch {
    return null;
  }
}

import { decodeEventLog } from "viem";

function decodeWithAbi(log: Log): VaultActivity | null {
  const decoded = decodeEventLog({
    abi: spendGuardAbi,
    data: log.data,
    topics: log.topics,
  });
  const hash = log.transactionHash as `0x${string}`;
  const blockNumber = log.blockNumber ?? 0n;
  switch (decoded.eventName) {
    case "Deposit":
      return {
        kind: "deposit",
        hash,
        blockNumber,
        depositor: decoded.args.depositor,
        amount: decoded.args.amount,
      };
    case "SessionGranted":
      return {
        kind: "grant",
        hash,
        blockNumber,
        sessionKey: decoded.args.sessionKey,
        recipients: decoded.args.recipients,
        maxPerTx: decoded.args.maxPerTx,
        spendCap: decoded.args.spendCap,
        expiresAt: decoded.args.expiresAt,
      };
    case "SessionEdited":
      return {
        kind: "edit",
        hash,
        blockNumber,
        sessionKey: decoded.args.sessionKey,
        recipients: decoded.args.recipients,
        maxPerTx: decoded.args.maxPerTx,
        spendCap: decoded.args.spendCap,
        expiresAt: decoded.args.expiresAt,
      };
    case "SessionRevoked":
      return {
        kind: "revoke",
        hash,
        blockNumber,
        sessionKey: decoded.args.sessionKey,
        spent: decoded.args.spent,
        remainingCap: decoded.args.remainingCap,
      };
    case "PaymentExecuted":
      return {
        kind: "payment",
        hash,
        blockNumber,
        sessionKey: decoded.args.sessionKey,
        recipient: decoded.args.recipient,
        amount: decoded.args.amount,
        newSpent: decoded.args.newSpent,
      };
    case "OwnerWithdraw":
      return {
        kind: "withdraw",
        hash,
        blockNumber,
        owner: decoded.args.owner,
        amount: decoded.args.amount,
      };
    default:
      return null;
  }
}

/**
 * Live vault state, read over the public RPC with no wallet required.
 * Polls over HTTPS (Aevum has no WebSocket RPC) and chunks log scans to
 * ≤1,000 blocks per call, fetched concurrently. After the first full scan,
 * only new blocks are fetched on each poll, and the scanned logs are kept
 * in a shared local cache (see vaultCache) so the activity page, the
 * home-page dashboard and the overview all render instantly on later
 * visits instead of rescanning from the deploy block every time.
 */
export function useVaultData(
  vaultAddress: `0x${string}` = VAULT_ADDRESS,
  fromBlock: bigint = DEPLOY_BLOCK,
): VaultData {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activity, setActivity] = useState<VaultActivity[]>([]);
  const [grantsCount, setGrantsCount] = useState(0);
  const [paymentsCount, setPaymentsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const vaultRef = useRef(vaultAddress);
  const runRef = useRef(0);
  const scannedThroughRef = useRef<bigint | null>(null);
  const activityRef = useRef<VaultActivity[]>([]);
  const logsRef = useRef<Log[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const refreshKeyRef = useRef(0);

  const load = useCallback(async () => {
    // A load that started for another vault (or an older run) must never
    // write its results after a newer load has begun: switching vaults
    // mid-scan would otherwise flash the old vault's sessions.
    const myRun = ++runRef.current;
    const myVault = vaultAddress;
    const stale = () => runRef.current !== myRun || vaultRef.current !== myVault;
    // Switching vaults resets every cache so the old vault's sessions and
    // activity never flash on the new vault's screen.
    if (vaultRef.current !== vaultAddress) {
      vaultRef.current = vaultAddress;
      scannedThroughRef.current = null;
      activityRef.current = [];
      logsRef.current = [];
      keysRef.current = new Set();
      setBalance(null);
      setPaused(null);
      setOwner(null);
      setSessions([]);
      setActivity([]);
      setLoading(true);
    }
    try {
      const [latest, vaultBalance, isPaused, vaultOwner] = await Promise.all([
        readClient.getBlockNumber(),
        readClient.readContract({
          address: vaultAddress,
          abi: spendGuardAbi,
          functionName: "vaultBalance",
        }),
        readClient.readContract({
          address: vaultAddress,
          abi: spendGuardAbi,
          functionName: "paused",
        }),
        readClient.readContract({
          address: vaultAddress,
          abi: spendGuardAbi,
          functionName: "owner",
        }),
      ]);
      if (stale()) return;
      setBalance(vaultBalance);
      setPaused(isPaused);
      setOwner(vaultOwner);

      // First load for this vault: hydrate from the shared log cache so the
      // activity feed and the session list render instantly, then only
      // blocks after the saved tip are fetched below. When there is no
      // local cache (a first visit, or a new origin such as the Vercel
      // deployment) the demo vault hydrates from the seed shipped with the
      // app instead, so it never pays the full ~255k-block cold scan.
      if (scannedThroughRef.current === null) {
        const cached =
          readVaultLogCache(vaultAddress) ??
          (vaultAddress.toLowerCase() === VAULT_ADDRESS.toLowerCase()
            ? await fetchDemoVaultSeed(vaultAddress)
            : null);
        if (cached) {
          const cachedLogs = cached.logs.map((c) => cachedLogToLog(c, vaultAddress));
          logsRef.current = cachedLogs;
          const items: VaultActivity[] = [];
          for (const log of cachedLogs) {
            const item = decodeActivity(log);
            if (item) {
              items.push(item);
              if (item.kind === "grant") keysRef.current.add(item.sessionKey.toLowerCase());
            }
          }
          if (items.length > 0) {
            activityRef.current = [...items.reverse(), ...activityRef.current];
            setActivity(activityRef.current.slice(0, 50));
          }
          scannedThroughRef.current = BigInt(cached.scannedThrough);
        }
      }

      const from = scannedThroughRef.current === null
        ? fromBlock
        : scannedThroughRef.current + 1n;
      if (from <= latest) {
        const logs = await getLogsChunked(from, latest, vaultAddress);
        if (stale()) return;
        scannedThroughRef.current = latest;
        logsRef.current = [...logsRef.current, ...logs];
        writeVaultLogCache(vaultAddress, latest, logsRef.current);
        const fresh: VaultActivity[] = [];
        for (const log of logs) {
          const item = decodeActivity(log);
          if (item) {
            fresh.push(item);
            if (item.kind === "grant") keysRef.current.add(item.sessionKey.toLowerCase());
          }
        }
        if (fresh.length > 0) {
          activityRef.current = [...fresh.reverse(), ...activityRef.current];
          setActivity(activityRef.current.slice(0, 50));
        }
      }

      // Session states for every key ever granted: one multicall, with a
      // per-key direct-read fallback if the multicall itself fails, so a
      // multicall outage never blanks the whole sessions list.
      const keys = [...keysRef.current] as `0x${string}`[];
      if (keys.length > 0) {
        let pairs: Array<{
          session: { status: "success" | "failure"; result?: unknown };
          remaining: { status: "success" | "failure"; result?: unknown };
        }> | null = null;
        try {
          const results = await readClient.multicall({
            contracts: keys.flatMap((key) => [
              {
                address: vaultAddress,
                abi: spendGuardAbi,
                functionName: "getSession",
                args: [key],
              } as const,
              {
                address: vaultAddress,
                abi: spendGuardAbi,
                functionName: "remainingCap",
                args: [key],
              } as const,
            ]),
          });
          pairs = keys.map((_, i) => ({
            session: results[i * 2] as { status: "success" | "failure"; result?: unknown },
            remaining: results[i * 2 + 1] as { status: "success" | "failure"; result?: unknown },
          }));
        } catch {
          pairs = null;
        }
        if (pairs === null) {
          pairs = [];
          for (const key of keys) {
            try {
              const [session, remaining] = await Promise.all([
                readClient.readContract({
                  address: vaultAddress,
                  abi: spendGuardAbi,
                  functionName: "getSession",
                  args: [key],
                }),
                readClient.readContract({
                  address: vaultAddress,
                  abi: spendGuardAbi,
                  functionName: "remainingCap",
                  args: [key],
                }),
              ]);
              pairs.push({
                session: { status: "success", result: session },
                remaining: { status: "success", result: remaining },
              });
            } catch {
              pairs.push({
                session: { status: "failure" },
                remaining: { status: "failure" },
              });
            }
          }
        }
        const next: SessionState[] = [];
        for (let i = 0; i < keys.length; i++) {
          const session = pairs[i].session;
          const remaining = pairs[i].remaining;
          if (session.status === "success" && remaining.status === "success") {
            // getSession returns a single tuple; viem decodes it as an
            // object with named keys (not an array). Read by name, with
            // positional fallback for robustness across viem versions.
            const s = session.result as unknown as {
              maxPerTx?: bigint;
              spendCap?: bigint;
              spent?: bigint;
              expiresAt?: bigint;
              active?: boolean;
              recipients?: readonly `0x${string}`[];
              0?: bigint;
              1?: bigint;
              2?: bigint;
              3?: bigint;
              4?: boolean;
              5?: readonly `0x${string}`[];
            };
            const maxPerTx = s.maxPerTx ?? s[0];
            const spendCap = s.spendCap ?? s[1];
            const spent = s.spent ?? s[2];
            const expiresAt = s.expiresAt ?? s[3];
            const active = s.active ?? s[4];
            const recipients = s.recipients ?? s[5];
            if (
              maxPerTx === undefined ||
              spendCap === undefined ||
              spent === undefined ||
              expiresAt === undefined ||
              active === undefined ||
              recipients === undefined
            ) {
              continue;
            }
            const remainingCap = remaining.result as bigint;
            next.push({
              key: keys[i],
              maxPerTx,
              spendCap,
              spent,
              expiresAt,
              active,
              recipients,
              remainingCap,
            });
          }
        }
        // Most recently granted first (event order is newest-first in activity).
        const grantOrder = activityRef.current
          .filter((a) => a.kind === "grant")
          .map((a) => (a.kind === "grant" ? a.sessionKey.toLowerCase() : ""));
        next.sort(
          (a, b) => grantOrder.indexOf(a.key.toLowerCase()) - grantOrder.indexOf(b.key.toLowerCase()),
        );
        if (stale()) return;
        setSessions(next);
      }

      setGrantsCount(activityRef.current.filter((a) => a.kind === "grant").length);
      setPaymentsCount(activityRef.current.filter((a) => a.kind === "payment").length);
      setError(null);
    } catch (err) {
      if (!stale()) setError("Live data could not be refreshed. Showing the last known state.");
      void err;
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [vaultAddress, fromBlock]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = useCallback(() => {
    refreshKeyRef.current += 1;
    void load();
  }, [load]);

  return { balance, paused, owner, sessions, activity, grantsCount, paymentsCount, loading, error, refresh };
}

/** The connected wallet's own tUSD8 balance + allowance for one vault (polling). */
export function useWalletTokenData(address: `0x${string}` | undefined, spender: `0x${string}` = VAULT_ADDRESS) {
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const runRef = useRef(0);

  const load = useCallback(async () => {
    const myRun = ++runRef.current;
    if (!address) {
      setTokenBalance(null);
      setAllowance(null);
      return;
    }
    try {
      const [bal, allow] = await Promise.all([
        readClient.readContract({
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        readClient.readContract({
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, spender],
        }),
      ]);
      if (runRef.current !== myRun) return;
      setTokenBalance(bal);
      setAllowance(allow);
    } catch {
      // Leave the last known values in place; the forms stay usable.
    }
  }, [address, spender]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return { tokenBalance, allowance, refreshTokenData: load };
}

/** Vaults owned by one address, read from the factory registry. Refreshed
 * on demand (after creating a vault); only the owner can add to their own
 * list, so no polling is needed. Returns the list so callers can act on
 * the fresh value immediately after a refresh. */
export function useMyVaults(ownerAddress: `0x${string}` | undefined) {
  const [vaults, setVaults] = useState<`0x${string}`[]>([]);
  const vaultsRef = useRef<`0x${string}`[]>([]);
  const runRef = useRef(0);

  const load = useCallback(async (): Promise<`0x${string}`[]> => {
    const myRun = ++runRef.current;
    if (!ownerAddress) {
      vaultsRef.current = [];
      setVaults([]);
      return [];
    }
    try {
      const list = await readClient.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "vaultsOf",
        args: [ownerAddress],
      });
      if (runRef.current !== myRun) return vaultsRef.current;
      // The demo vault is itself a factory vault owned by the project
      // wallet: listing it here too would show the same vault twice (a
      // Demo pill and a Your vault pill, both active, with conflicting
      // context lines). It is always presented as the demo vault.
      const next = ([...list] as `0x${string}`[]).filter(
        (v) => v.toLowerCase() !== VAULT_ADDRESS.toLowerCase(),
      );
      vaultsRef.current = next;
      setVaults(next);
      return next;
    } catch {
      // Keep the last known list; a failed read must not blank the switcher.
      return vaultsRef.current;
    }
  }, [ownerAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  return { vaults, refresh: load };
}

export type GrantedVault = { address: `0x${string}`; owner: `0x${string}` };

/** Vaults where this wallet holds an active session key, read from the
 * factory registry. A key holder owns no vault, so without this list the
 * switcher can never show them the vault they were granted a key on — and
 * after a refresh the app falls back to the demo vault, where the wallet
 * has no session and the Pay page is dead. Only vaults with an active
 * session are listed; the demo vault is always listed separately, and
 * vaults the wallet owns are already in useMyVaults. Refreshed when the
 * wallet changes; a grant or revoke after that needs a reload to appear
 * in the switcher (the selected vault itself always shows live data). */
export function useGrantedVaults(walletAddress: `0x${string}` | undefined) {
  const [vaults, setVaults] = useState<GrantedVault[]>([]);
  const vaultsRef = useRef<GrantedVault[]>([]);
  const runRef = useRef(0);

  const load = useCallback(async (): Promise<GrantedVault[]> => {
    const myRun = ++runRef.current;
    if (!walletAddress) {
      vaultsRef.current = [];
      setVaults([]);
      return [];
    }
    try {
      const count = await readClient.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "vaultCount",
      });
      const addresses: `0x${string}`[] = [];
      for (let i = 0; i < Number(count); i++) {
        addresses.push(
          (await readClient.readContract({
            address: FACTORY_ADDRESS,
            abi: factoryAbi,
            functionName: "allVaults",
            args: [BigInt(i)],
          })) as `0x${string}`,
        );
      }
      const next: GrantedVault[] = [];
      await Promise.all(
        addresses.map(async (v) => {
          if (v.toLowerCase() === VAULT_ADDRESS.toLowerCase()) return;
          try {
            const [session, owner] = await Promise.all([
              readClient.readContract({
                address: v,
                abi: spendGuardAbi,
                functionName: "getSession",
                args: [walletAddress],
              }),
              readClient.readContract({
                address: v,
                abi: spendGuardAbi,
                functionName: "owner",
              }),
            ]);
            // getSession decodes as a named object; read `active` by name
            // with a positional fallback, as useVaultData does.
            const s = session as unknown as { active?: boolean; 4?: boolean };
            const active = s.active ?? s[4] ?? false;
            const ownerAddr = owner as `0x${string}`;
            if (active && ownerAddr.toLowerCase() !== walletAddress.toLowerCase()) {
              next.push({ address: v, owner: ownerAddr });
            }
          } catch {
            // One unreadable vault must not hide the rest.
          }
        }),
      );
      if (runRef.current !== myRun) return vaultsRef.current;
      vaultsRef.current = next;
      setVaults(next);
      return next;
    } catch {
      // Keep the last known list; a failed read must not blank the switcher.
      return vaultsRef.current;
    }
  }, [walletAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  return { vaults, refresh: load };
}
