"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Activity, CreditCard, House, KeyRound, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSwitchChain } from "wagmi";
import { VAULT_ADDRESS, aevumTestnet, explorerAddressUrl } from "@/lib/config";
import { plainSwitchErrorMessage, shortenAddress } from "@/lib/format";
import { TxStatus } from "@/components/VaultApp";
import { useApp } from "./AppProvider";

const TABS = [
  { href: "/app/", label: "Overview", icon: House },
  { href: "/app/keys/", label: "Keys", icon: KeyRound },
  { href: "/app/pay/", label: "Pay", icon: CreditCard },
  { href: "/app/activity/", label: "Activity", icon: Activity },
  { href: "/app/settings/", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  const here = pathname.replace(/\/$/, "");
  const target = href.replace(/\/$/, "");
  return here === target;
}

function TabIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={20} strokeWidth={1.8} aria-hidden="true" />;
}

function VaultHeader() {
  const app = useApp();
  const known = app.myVaults.some((v) => v.toLowerCase() === app.selected.toLowerCase());
  const extra = !app.isDemo && !known ? app.selected : null;

  return (
    <div className="app-head">
      <div className="app-head-main">
        <div className="app-head-title">
          <h1>{app.isDemo ? "Demo vault" : "Your vault"}</h1>
          {app.isDemo && <span className="demo-badge">Demo</span>}
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
  const barRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    visible: false,
  });

  // The sliding glass pill tracks the active tab: measure it from the
  // rendered link so the pill glides on every route change and resize.
  useEffect(() => {
    const measure = () => {
      const bar = barRef.current;
      if (!bar) return;
      const active = bar.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        setIndicator((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }
      setIndicator({
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        visible: true,
      });
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    if (document.fonts) void document.fonts.ready.then(measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [pathname]);

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
              <TabIcon icon={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          ))}
        </nav>
        <div className="app-page">{children}</div>
      </div>
      <nav className="app-tabbar" aria-label="App sections" ref={barRef}>
        <span
          className="app-tabbar-indicator"
          aria-hidden="true"
          style={{
            left: indicator.left,
            top: indicator.top,
            width: indicator.width,
            height: indicator.height,
            opacity: indicator.visible ? 1 : 0,
          }}
        />
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="app-tab"
            aria-current={isActive(pathname, tab.href) ? "page" : undefined}
          >
            <TabIcon icon={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
