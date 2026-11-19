"use client";

import { useMemo } from "react";
import { explorerTxUrl } from "@/lib/config";
import { formatTusd8, shortenAddress } from "@/lib/format";
import { dayLabel, timeAgo, useBlockTimes } from "@/lib/blockTimes";
import { getKeyLabel, useKeyLabels } from "@/lib/keyLabels";
import type { VaultActivity } from "@/lib/useVaultData";
import { useApp } from "./AppProvider";

export type ActivityFilter = "all" | "payments" | "deposits" | "keys";

export function matchesFilter(item: VaultActivity, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "payments") return item.kind === "payment" || item.kind === "withdraw";
  if (filter === "deposits") return item.kind === "deposit";
  return item.kind === "grant" || item.kind === "edit" || item.kind === "revoke";
}

type Row = {
  item: VaultActivity;
  tone: "in" | "out" | "key" | "rev";
  icon: string;
  title: string;
  detail: string;
  amount: string | null;
};

function useRows(items: readonly VaultActivity[]): Row[] {
  const { selected } = useApp();
  const { labels } = useKeyLabels();
  return useMemo(() => {
    const who = (key: string) => getKeyLabel(labels, selected, key) ?? shortenAddress(key);
    return items.map((item): Row => {
      switch (item.kind) {
        case "deposit":
          return { item, tone: "in", icon: "↓", title: "Deposit", detail: `From ${shortenAddress(item.depositor)}`, amount: `+${formatTusd8(item.amount)}` };
        case "payment":
          return { item, tone: "out", icon: "↗", title: `Payment · ${who(item.sessionKey)}`, detail: `To ${shortenAddress(item.recipient)}`, amount: `−${formatTusd8(item.amount)}` };
        case "withdraw":
          return { item, tone: "out", icon: "⤓", title: "Sweep to owner", detail: `To ${shortenAddress(item.owner)}`, amount: `−${formatTusd8(item.amount)}` };
        case "grant":
          return { item, tone: "key", icon: "+", title: `Key granted · ${who(item.sessionKey)}`, detail: `Cap ${formatTusd8(item.spendCap)} · max ${formatTusd8(item.maxPerTx)} per payment`, amount: null };
        case "edit":
          return { item, tone: "key", icon: "✎", title: `Limits edited · ${who(item.sessionKey)}`, detail: `Cap ${formatTusd8(item.spendCap)} · max ${formatTusd8(item.maxPerTx)} per payment`, amount: null };
        case "revoke":
          return { item, tone: "rev", icon: "×", title: `Key revoked · ${who(item.sessionKey)}`, detail: `${formatTusd8(item.spent)} had been spent`, amount: null };
      }
    });
  }, [items, labels, selected]);
}

/** Activity rows, grouped by day once block timestamps resolve. */
export function ActivityFeed({ items, grouped = false }: { items: readonly VaultActivity[]; grouped?: boolean }) {
  const { now } = useApp();
  const rows = useRows(items);
  const times = useBlockTimes(items.map((i) => i.blockNumber));

  if (rows.length === 0) return null;

  const groups: Array<{ label: string | null; rows: Row[] }> = [];
  for (const row of rows) {
    const ms = times.get(row.item.blockNumber.toString());
    const label = grouped && ms !== undefined ? dayLabel(ms, now) : null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="feed">
      {groups.map((group, gi) => (
        <div key={`${group.label ?? "g"}-${gi}`} className="feed-group">
          {group.label !== null && <p className="feed-day">{group.label}</p>}
          {group.rows.map((row) => {
            const ms = times.get(row.item.blockNumber.toString());
            return (
              <a
                key={`${row.item.hash}-${row.item.kind}-${row.item.blockNumber}-${row.title}`}
                className="feed-row"
                href={explorerTxUrl(row.item.hash)}
                target="_blank"
                rel="noreferrer"
              >
                <span className={`feed-ico feed-ico-${row.tone}`} aria-hidden="true">
                  {row.icon}
                </span>
                <span className="feed-main">
                  <span className="feed-title">{row.title}</span>
                  <span className="feed-detail">
                    {row.detail} · {ms !== undefined ? timeAgo(ms, now) : `block ${row.item.blockNumber.toString()}`}
                  </span>
                </span>
                {row.amount !== null && (
                  <span className={`feed-amt feed-amt-${row.tone}`}>
                    {row.amount}
                    <small>tUSD8</small>
                  </span>
                )}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}
