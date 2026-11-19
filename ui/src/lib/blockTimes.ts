"use client";

import { useEffect, useState } from "react";
import { readClient } from "./config";

/** Block number -> timestamp (ms). Block timestamps never change, so this
 * module-level cache is safe for the lifetime of the page. */
const cache = new Map<string, number>();
const inflight = new Set<string>();
const MAX_PARALLEL = 4;

/**
 * Resolves timestamps for the given block numbers, a few at a time, and
 * re-renders as they arrive. Callers show the block number until then.
 */
export function useBlockTimes(blocks: readonly bigint[]): ReadonlyMap<string, number> {
  const [, setVersion] = useState(0);
  const wanted = blocks.map((b) => b.toString()).join(",");

  useEffect(() => {
    let cancelled = false;
    const missing = [...new Set(wanted.split(",").filter((b) => b !== ""))].filter(
      (b) => !cache.has(b) && !inflight.has(b),
    );
    if (missing.length === 0) return;
    missing.forEach((b) => inflight.add(b));
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < missing.length) {
        const key = missing[next++];
        try {
          const block = await readClient.getBlock({ blockNumber: BigInt(key) });
          cache.set(key, Number(block.timestamp) * 1000);
        } catch {
          // Leave it uncached: the row keeps showing its block number.
        } finally {
          inflight.delete(key);
        }
        if (!cancelled) setVersion((v) => v + 1);
      }
    };
    void Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, missing.length) }, worker));
    return () => {
      cancelled = true;
      missing.forEach((b) => inflight.delete(b));
    };
  }, [wanted]);

  return cache;
}

export function timeAgo(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function dayLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** "2d 4h", "6h 12m", "35m", or "Expired". */
export function timeLeft(expiresAt: bigint, now: number): string {
  const ms = Number(expiresAt) * 1000 - now;
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}
