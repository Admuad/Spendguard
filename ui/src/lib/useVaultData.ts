import { useCallback, useEffect, useRef, useState } from "react";
import type { Log } from "viem";
import {
  DEPLOY_BLOCK,
  MAX_LOG_RANGE,
  TUSD8_ADDRESS,
  VAULT_ADDRESS,
  erc20Abi,
  readClient,
  spendGuardAbi,
} from "./config";

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

/** Fetch logs in ≤1,000-block chunks (Aevum's eth_getLogs limit). */
async function getLogsChunked(from: bigint, to: bigint): Promise<Log[]> {
  const logs: Log[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_LOG_RANGE - 1n > to ? to : cursor + MAX_LOG_RANGE - 1n;
    const chunk = await readClient.getLogs({
      address: VAULT_ADDRESS,
      fromBlock: cursor,
      toBlock: end,
    });
    logs.push(...chunk);
    cursor = end + 1n;
  }
  return logs;
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
 * ≤1,000 blocks per call. After the first full scan, only new blocks are
 * fetched on each poll.
 */
export function useVaultData(): VaultData {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activity, setActivity] = useState<VaultActivity[]>([]);
  const [grantsCount, setGrantsCount] = useState(0);
  const [paymentsCount, setPaymentsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scannedThroughRef = useRef<bigint | null>(null);
  const activityRef = useRef<VaultActivity[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const refreshKeyRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const [latest, vaultBalance, isPaused, vaultOwner] = await Promise.all([
        readClient.getBlockNumber(),
        readClient.readContract({
          address: VAULT_ADDRESS,
          abi: spendGuardAbi,
          functionName: "vaultBalance",
        }),
        readClient.readContract({
          address: VAULT_ADDRESS,
          abi: spendGuardAbi,
          functionName: "paused",
        }),
        readClient.readContract({
          address: VAULT_ADDRESS,
          abi: spendGuardAbi,
          functionName: "owner",
        }),
      ]);
      setBalance(vaultBalance);
      setPaused(isPaused);
      setOwner(vaultOwner);

      const from = scannedThroughRef.current === null
        ? DEPLOY_BLOCK
        : scannedThroughRef.current + 1n;
      if (from <= latest) {
        const logs = await getLogsChunked(from, latest);
        scannedThroughRef.current = latest;
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
                address: VAULT_ADDRESS,
                abi: spendGuardAbi,
                functionName: "getSession",
                args: [key],
              } as const,
              {
                address: VAULT_ADDRESS,
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
                  address: VAULT_ADDRESS,
                  abi: spendGuardAbi,
                  functionName: "getSession",
                  args: [key],
                }),
                readClient.readContract({
                  address: VAULT_ADDRESS,
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
        setSessions(next);
      }

      setGrantsCount(activityRef.current.filter((a) => a.kind === "grant").length);
      setPaymentsCount(activityRef.current.filter((a) => a.kind === "payment").length);
      setError(null);
    } catch (err) {
      setError("Live data could not be refreshed. Showing the last known state.");
      void err;
    } finally {
      setLoading(false);
    }
  }, []);

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

/** The connected wallet's own tUSD8 balance + vault allowance (polling). */
export function useWalletTokenData(address: `0x${string}` | undefined) {
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);

  const load = useCallback(async () => {
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
          args: [address, VAULT_ADDRESS],
        }),
      ]);
      setTokenBalance(bal);
      setAllowance(allow);
    } catch {
      // Leave the last known values in place; the forms stay usable.
    }
  }, [address]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return { tokenBalance, allowance, refreshTokenData: load };
}
