"use client";

import { useEffect, useRef, useState } from "react";
import type { VaultActivity, VaultData } from "@/lib/useVaultData";
import {
  EXPLORER_URL,
  VAULT_ADDRESS,
  explorerAddressUrl,
  explorerTxUrl,
} from "@/lib/config";
import { APP_URL } from "@/lib/site";
import { formatExpiry, formatTusd8, shortenAddress, shortenHash } from "@/lib/format";
import { ChevronDown, Play } from "lucide-react";

function activityDescription(item: VaultActivity): string {
  switch (item.kind) {
    case "deposit":
      return `${shortenAddress(item.depositor)} deposited`;
    case "grant":
      return `Session granted to ${shortenAddress(item.sessionKey)} · ${item.recipients.length} recipient${item.recipients.length === 1 ? "" : "s"} · expires ${formatExpiry(item.expiresAt)}`;
    case "edit":
      return `Bounds edited for ${shortenAddress(item.sessionKey)} · ${item.recipients.length} recipient${item.recipients.length === 1 ? "" : "s"} · expires ${formatExpiry(item.expiresAt)}`;
    case "revoke":
      return `Session revoked for ${shortenAddress(item.sessionKey)}`;
    case "payment":
      return `${shortenAddress(item.sessionKey)} paid ${shortenAddress(item.recipient)}`;
    case "withdraw":
      return `${shortenAddress(item.owner)} swept the vault`;
  }
}

function activityAmount(item: VaultActivity): string | null {
  switch (item.kind) {
    case "deposit":
    case "withdraw":
      return `${formatTusd8(item.amount)} tUSD8`;
    case "payment":
      return `${formatTusd8(item.amount)} tUSD8`;
    case "grant":
    case "edit":
      return `cap ${formatTusd8(item.spendCap)}`;
    case "revoke":
      return `spent ${formatTusd8(item.spent)}`;
  }
}

const KIND_LABEL: Record<VaultActivity["kind"], string> = {
  deposit: "Deposit",
  grant: "Grant",
  edit: "Edit",
  revoke: "Revoke",
  payment: "Payment",
  withdraw: "Sweep",
};

export function Hero({
  vault,
  onWatchDemo,
}: {
  vault: VaultData;
  onWatchDemo: () => void;
}) {
  const activeSessions = vault.sessions.filter((s) => s.active).length;

  // Collapsible activity list: collapsed shows just the latest item,
  // expanded slides the rest down. Default collapsed: the card is long.
  const [activityExpanded, setActivityExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const collapseRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(collapseRaf.current), []);

  const toggleActivity = () => {
    if (!activityExpanded) {
      cancelAnimationFrame(collapseRaf.current);
      setActivityExpanded(true);
      return;
    }
    // Collapsing: the card shrinks while the user may be scrolled to its
    // bottom. Without help the browser clamps scrollY and the page jumps.
    // So scroll the window up exactly as much as the card shrinks, frame
    // by frame, while the slide runs: the toggle stays under the finger
    // and everything below the card stays in place.
    const card = cardRef.current;
    if (!card) {
      setActivityExpanded(false);
      return;
    }
    const startY = window.scrollY;
    const startH = card.offsetHeight;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActivityExpanded(false);
    if (reduced) {
      requestAnimationFrame(() => {
        window.scrollTo(0, Math.max(0, startY - (startH - card.offsetHeight)));
      });
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const shrunk = startH - card.offsetHeight;
      if (shrunk > 0) window.scrollTo(0, Math.max(0, startY - shrunk));
      if (now - started < 600) {
        collapseRaf.current = requestAnimationFrame(step);
      } else {
        window.scrollTo(0, Math.max(0, startY - (startH - card.offsetHeight)));
      }
    };
    collapseRaf.current = requestAnimationFrame(step);
  };

  return (
    <section className="hero" id="top">
      <div className="container hero-inner">
        <span className="eyebrow">Aevum Builder Challenge · Testnet</span>
        <h1>Give an agent a key that can only spend a little.</h1>
        <p className="hero-sub hero-sub-long">
          SpendGuard is a scoped session-key vault for tUSD8 on the Aevum
          testnet. Deposit once. Grant a key that pays only approved
          recipients, within a cap, before an expiry. Take it back in one
          click. The contract enforces every bound, not the interface.
        </p>
        <p className="hero-sub hero-sub-short">
          Deposit once, grant a key with a cap and an expiry, take it back
          in one click.
        </p>
        <div className="hero-cta-row">
          <a href={APP_URL} className="btn btn-white">
            Open the app
          </a>
          <button type="button" className="btn btn-ghost-dark" onClick={onWatchDemo}>
            <Play size={18} fill="currentColor" aria-hidden="true" />
            Watch demo
          </button>
        </div>

        <div className="dash-card" aria-live="polite" ref={cardRef}>
          <div className="dash-head">
            <h2>Vault dashboard</h2>
            {vault.paused === true && <span className="badge badge-paused">Paused</span>}
            <span className="dash-sub">
              <a href={explorerAddressUrl(VAULT_ADDRESS)} target="_blank" rel="noreferrer">
                {shortenAddress(VAULT_ADDRESS)}
              </a>{" "}
              · chain 44005
            </span>
          </div>

          <div className="dash-grid">
            <div className="kpi kpi-hero">
              <p className="kpi-label">Vault balance</p>
              <p className="kpi-value">
                {vault.balance === null ? "…" : formatTusd8(vault.balance)}
                <small>tUSD8</small>
              </p>
              <p className="kpi-foot">Read live from the contract</p>
            </div>
            <div className="kpi">
              <p className="kpi-label">Active sessions</p>
              <p className="kpi-value">{vault.loading ? "…" : activeSessions}</p>
              <p className="kpi-foot">
                {vault.sessions.length} granted in total
              </p>
            </div>
            <div className="kpi">
              <p className="kpi-label">Payments executed</p>
              <p className="kpi-value">{vault.loading ? "…" : vault.paymentsCount}</p>
              <p className="kpi-foot">All within caps</p>
            </div>
            <div className="kpi kpi-owner">
              <p className="kpi-label">Vault owner</p>
              <p className="kpi-value">
                {vault.owner ? shortenAddress(vault.owner) : "…"}
              </p>
              <p className="kpi-foot">Grants, revokes, pause, sweep</p>
            </div>
          </div>

          <div className="dash-activity">
            <h3>Recent activity</h3>
            {vault.loading && vault.activity.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Loading on-chain activity…
              </p>
            ) : vault.activity.length === 0 ? (
              <div className="empty-state">
                No vault activity yet. Deposits, grants, edits, payments,
                and revokes will appear here as they happen on-chain.
              </div>
            ) : (
              <>
                <div className="activity-item" key={vault.activity[0].hash + vault.activity[0].kind}>
                  <span className="activity-kind">{KIND_LABEL[vault.activity[0].kind]}</span>
                  <span className="activity-detail">{activityDescription(vault.activity[0])}</span>
                  <span className="activity-amount">{activityAmount(vault.activity[0])}</span>
                  <a
                    className="activity-hash"
                    href={explorerTxUrl(vault.activity[0].hash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortenHash(vault.activity[0].hash)} ↗
                  </a>
                </div>
                {vault.activity.length > 1 && (
                  <div
                    className="dash-activity-more"
                    id="dash-activity-more"
                    data-expanded={activityExpanded}
                  >
                    <div className="dash-activity-more-inner">
                      {vault.activity.slice(1, 5).map((item) => (
                        <div className="activity-item" key={item.hash + item.kind}>
                          <span className="activity-kind">{KIND_LABEL[item.kind]}</span>
                          <span className="activity-detail">{activityDescription(item)}</span>
                          <span className="activity-amount">{activityAmount(item)}</span>
                          <a
                            className="activity-hash"
                            href={explorerTxUrl(item.hash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortenHash(item.hash)} ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {vault.activity.length > 1 && (
              <button
                type="button"
                className="dash-activity-toggle"
                aria-expanded={activityExpanded}
                aria-controls="dash-activity-more"
                onClick={toggleActivity}
              >
                {activityExpanded ? "Show less" : "Show all activity"}
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )}
            {vault.error && (
              <p className="error-text" role="alert">
                {vault.error}
              </p>
            )}
            <p className="muted" style={{ fontSize: 13, margin: "14px 0 0" }}>
              Data refreshes automatically over the public RPC. Full history on{" "}
              <a href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">
                the Aevum explorer
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
