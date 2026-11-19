"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useConnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { VAULT_ADDRESS, aevumTestnet, explorerAddressUrl } from "@/lib/config";
import { plainConnectErrorMessage, plainSwitchErrorMessage, shortenAddress } from "@/lib/format";
import { TxStatus } from "@/components/VaultApp";
import { useApp } from "./AppProvider";

const TABS = [
  { href: "/app/", label: "Overview", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" },
  { href: "/app/keys/", label: "Keys", icon: "M15 7a4 4 0 1 0-3.9 4.9L4 19v2h3v-2h2v-2h2l1.6-1.6A4 4 0 0 0 15 7Zm1-1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" },
  { href: "/app/pay/", label: "Pay", icon: "M3 7h18v10H3V7Zm0 3h18M7 14h4" },
  { href: "/app/activity/", label: "Activity", icon: "M4 12h4l2-6 4 12 2-6h4" },
  { href: "/app/settings/", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-2a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1L11 21h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5Z" },
] as const;

function isActive(pathname: string, href: string): boolean {
  const here = pathname.replace(/\/$/, "");
  const target = href.replace(/\/$/, "");
  return here === target;
}

function TabIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function InlineConnect() {
  const { connect, isPending, error, reset } = useConnect();
  return (
    <div className="app-connect">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={isPending}
        onClick={() => {
          reset();
          connect({ connector: injected() });
        }}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {plainConnectErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

function VaultHeader() {
  const app = useApp();
  const known = app.myVaults.some((v) => v.toLowerCase() === app.selected.toLowerCase());
  const extra = !app.isDemo && !known ? app.selected : null;
  const status = app.vault.paused === null ? null : app.vault.paused ? "Paused" : "Active";

  return (
    <div className="app-head">
      <div className="app-head-main">
        <div className="app-head-title">
          <h1>{app.isDemo ? "Demo vault" : "Your vault"}</h1>
          {app.isDemo && <span className="demo-badge">Demo</span>}
          {status !== null && (
            <span className={`badge ${status === "Active" ? "badge-live" : "badge-paused"}`}>{status}</span>
          )}
        </div>
        <p className="app-head-sub">
          <a href={explorerAddressUrl(app.selected)} target="_blank" rel="noreferrer">
            {shortenAddress(app.selected)}
          </a>
          <span aria-hidden="true"> · </span>
          {app.isDemo
            ? "The project's demo vault. Read-only unless you own it."
            : app.isOwner
              ? "You are the owner."
              : "Viewing a vault you do not own."}
        </p>
      </div>
      <div className="app-head-actions">
        <label className="app-select">
          <span className="sr-only">Choose a vault</span>
          <select
            value={app.selected}
            onChange={(event) => app.selectVault(event.target.value as `0x${string}`)}
          >
            <option value={VAULT_ADDRESS}>Demo vault · {shortenAddress(VAULT_ADDRESS)}</option>
            {app.myVaults.map((v, i) => (
              <option key={v} value={v}>
                {app.myVaults.length > 1 ? `Your vault ${i + 1}` : "Your vault"} · {shortenAddress(v)}
              </option>
            ))}
            {extra !== null && <option value={extra}>Vault · {shortenAddress(extra)}</option>}
          </select>
        </label>
        {app.isConnected && !app.wrongChain && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={app.createBusy}
            onClick={app.createVault}
          >
            {app.createBusy ? "Creating…" : "+ New vault"}
          </button>
        )}
      </div>
      {app.createPhase !== "idle" && (
        <div className="app-head-tx">
          <TxStatus
            phase={app.createPhase}
            hash={app.createHash}
            errorMessage={app.createError}
            successLabel="Vault created. You are now viewing your new vault."
          />
        </div>
      )}
    </div>
  );
}

function Banners() {
  const app = useApp();
  const { switchChain, isPending, error, reset } = useSwitchChain();
  return (
    <>
      {app.wrongChain && (
        <div className="net-banner" role="alert">
          <div>
            <strong>Wrong network.</strong> Your wallet is on chain {app.chainId}; this app runs on{" "}
            {aevumTestnet.name} (chain {aevumTestnet.id}). Switch to make changes.
            {error && <div className="error-text">{plainSwitchErrorMessage(error)}</div>}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isPending}
            onClick={() => {
              reset();
              switchChain({ chainId: aevumTestnet.id });
            }}
          >
            {isPending ? "Switching…" : `Switch to ${aevumTestnet.name}`}
          </button>
        </div>
      )}
      {!app.isConnected && (
        <div className="info-banner">
          <div>
            <strong>You are browsing read-only.</strong> Everything on this page is live from the
            chain. Connect a wallet to create your own vault and make changes.
          </div>
          <InlineConnect />
        </div>
      )}
      {app.vault.paused === true && (
        <div className="net-banner net-banner-danger" role="status">
          <div>
            <strong>Payments are frozen.</strong> This vault is paused. Keys cannot spend until the
            owner unpauses; the owner can still sweep the balance.
          </div>
        </div>
      )}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <div className="container app-wrap">
        <VaultHeader />
        <Banners />
        <nav className="app-tabs" aria-label="App sections">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="app-tab"
              aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            >
              <TabIcon d={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          ))}
        </nav>
        <div className="app-page">{children}</div>
      </div>
      <nav className="app-tabbar" aria-label="App sections">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="app-tab"
            aria-current={isActive(pathname, tab.href) ? "page" : undefined}
          >
            <TabIcon d={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
