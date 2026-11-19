"use client";

import { useState } from "react";
import { EXPLORER_URL, FACTORY_ADDRESS, FAUCET_URL, REPO_URL, TUSD8_ADDRESS, aevumTestnet, explorerAddressUrl, RPC_URL } from "@/lib/config";
import { formatTusd8Input, shortenAddress } from "@/lib/format";
import { useBlockTimes } from "@/lib/blockTimes";
import { AgentPanel, GrantPanel, OwnerPanel, SessionsPanel } from "@/components/VaultApp";
import { ActivityFeed, matchesFilter } from "./ActivityFeed";
import type { ActivityFilter } from "./ActivityFeed";
import { useApp } from "./AppProvider";

export function KeysPage() {
  const { vault, selected, isOwner, isConnected, now } = useApp();
  // The demo vault is view-only: a visitor who has not connected a wallet
  // (or does not own this vault) must not even see the grant affordance.
  // The grant form appears only for the connected owner of this vault.
  const canGrant = isConnected && isOwner;
  return (
    <div className="keys-layout">
      {canGrant && (
        <div className="keys-jump">
          <a href="#grant" className="btn btn-primary btn-sm">
            + Grant a key
          </a>
        </div>
      )}
      <div className="keys-list">
        <SessionsPanel vault={vault} vaultAddress={selected} isOwner={isOwner} now={now} />
      </div>
      {canGrant && (
        <div id="grant" className="keys-grant">
          <GrantPanel vault={vault} vaultAddress={selected} isOwner={isOwner} />
        </div>
      )}
    </div>
  );
}

export function PayPage() {
  const { vault, selected, mySession, now, isConnected } = useApp();
  return (
    <div className="stack-page">
      {isConnected && mySession === null && (
        <div className="info-banner info-banner-warn" role="status">
          <div>
            <strong>The connected wallet is not a key on this vault.</strong> This page is the
            agent&apos;s side: connect the wallet the owner granted a key to, or grant this wallet a key
            from the Keys page.
          </div>
        </div>
      )}
      <AgentPanel vault={vault} vaultAddress={selected} mySession={mySession} now={now} />
    </div>
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function ActivityPage() {
  const { vault, now } = useApp();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const items = vault.activity.filter((i) => matchesFilter(i, filter));
  const times = useBlockTimes(vault.activity.map((i) => i.blockNumber));

  const exportCsv = () => {
    const rows = [["time_utc", "type", "key", "counterparty", "amount_tusd8", "tx"]];
    for (const i of items) {
      const ms = times.get(i.blockNumber.toString());
      const time = ms !== undefined ? new Date(ms).toISOString() : `block ${i.blockNumber.toString()}`;
      const key = "sessionKey" in i ? i.sessionKey : "";
      const counterparty = i.kind === "payment" ? i.recipient : i.kind === "deposit" ? i.depositor : i.kind === "withdraw" ? i.owner : "";
      const amount = "amount" in i ? formatTusd8Input(i.amount) : i.kind === "grant" || i.kind === "edit" ? formatTusd8Input(i.spendCap) : i.kind === "revoke" ? formatTusd8Input(i.spent) : "";
      rows.push([time, i.kind, key, counterparty, amount, i.hash]);
    }
    const blob = new Blob([rows.map((r) => r.map(csvEscape).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spendguard-activity.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const filters: Array<{ id: ActivityFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "payments", label: "Payments" },
    { id: "deposits", label: "Deposits" },
    { id: "keys", label: "Keys" },
  ];

  return (
    <div className="stack-page">
      <div className="sec-head sec-head-wrap">
        <div className="chips" role="group" aria-label="Filter activity">
          {filters.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-outline btn-sm" disabled={items.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      {items.length === 0 ? (
        <div className="card empty-card">
          <p className="empty-title">{vault.loading ? "Loading activity…" : "Nothing here yet"}</p>
          {!vault.loading && <p className="card-note">No events match this filter.</p>}
        </div>
      ) : (
        <div className="card feed-card">
          <ActivityFeed items={items} grouped />
        </div>
      )}
      <p className="field-hint">Showing the latest {Math.min(vault.activity.length, 50)} events, read from the chain{now ? "" : ""}.</p>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: the address is selectable text above.
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="detail-val">
            {value}
          </a>
        ) : (
          <span className="detail-val">{value}</span>
        )}
      </dd>
    </div>
  );
}

export function SettingsPage() {
  const { vault, selected, isOwner } = useApp();
  return (
    <div className="settings-layout">
      <OwnerPanel vault={vault} vaultAddress={selected} isOwner={isOwner} />
      <div className="panel">
        <h3>Vault details</h3>
        <p className="panel-desc">Everything here is public and verifiable on the explorer.</p>
        <dl className="details">
          <div className="detail-row">
            <dt>Vault</dt>
            <dd>
              <a href={explorerAddressUrl(selected)} target="_blank" rel="noreferrer" className="detail-val">
                {shortenAddress(selected)}
              </a>
              <CopyButton value={selected} label="vault address" />
            </dd>
          </div>
          {vault.owner && (
            <div className="detail-row">
              <dt>Owner</dt>
              <dd>
                <a href={explorerAddressUrl(vault.owner)} target="_blank" rel="noreferrer" className="detail-val">
                  {shortenAddress(vault.owner)}
                </a>
                <CopyButton value={vault.owner} label="owner address" />
              </dd>
            </div>
          )}
          <DetailRow label="Token (tUSD8)" value={shortenAddress(TUSD8_ADDRESS)} href={explorerAddressUrl(TUSD8_ADDRESS)} />
          <DetailRow label="Vault factory" value={shortenAddress(FACTORY_ADDRESS)} href={explorerAddressUrl(FACTORY_ADDRESS)} />
          <DetailRow label="Network" value={`${aevumTestnet.name} · chain ${aevumTestnet.id}`} />
          <DetailRow label="RPC" value={RPC_URL} />
        </dl>
        <div className="link-row">
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">
            Test-token faucet ↗
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code ↗
          </a>
        </div>
      </div>
    </div>
  );
}
