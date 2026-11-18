"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { ThemeToggle } from "@/lib/theme";
import { aevumTestnet } from "@/lib/config";
import { shortenAddress } from "@/lib/format";

const NAV_LINKS = [
  { href: "#app", label: "Vault" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);

  const wrongChain = isConnected && chainId !== aevumTestnet.id;

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        className={`btn btn-primary nav-cta ${className}`}
        disabled={isPending}
        onClick={() => connect({ connector: injected() })}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (wrongChain) {
    return (
      <button
        type="button"
        className={`btn btn-primary nav-cta ${className}`}
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: aevumTestnet.id })}
      >
        {isSwitching ? "Switching…" : "Switch to Aevum Testnet"}
      </button>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="wallet-chip"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        title="Connected wallet — click to disconnect"
      >
        <span className="wallet-dot" />
        {shortenAddress(address)}
      </button>
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close wallet menu"
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "transparent",
              border: "none",
              cursor: "default",
              zIndex: 59,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 8px)",
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              boxShadow: "var(--shadow-pop)",
              padding: 8,
              minWidth: 220,
              color: "var(--text)",
            }}
          >
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-2)" }}>
              Connected on Aevum testnet
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                  color: "var(--text)",
                  marginTop: 4,
                  overflowWrap: "anywhere",
                }}
              >
                {address}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm btn-block"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isConnected } = useAccount();

  // Close the mobile menu on resize to desktop widths.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 860) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="#top" className="nav-logo" aria-label="SpendGuard home">
          <span className="nav-logo-mark">S</span>
          SpendGuard
        </a>
        <nav className="nav-links" aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <ConnectButton />
          <button
            type="button"
            className="hamburger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="mobile-menu">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          ))}
          {!isConnected && <MobileConnect onDone={() => setMenuOpen(false)} />}
        </div>
      )}
    </header>
  );
}

function MobileConnect({ onDone }: { onDone: () => void }) {
  const { connect, isPending } = useConnect();
  return (
    <button
      type="button"
      className="btn btn-primary btn-block"
      disabled={isPending}
      onClick={() => {
        connect({ connector: injected() });
        onDone();
      }}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
