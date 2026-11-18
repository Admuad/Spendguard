"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { ThemeToggle } from "@/lib/theme";
import { LogoLockup } from "./Logo";
import { aevumTestnet } from "@/lib/config";
import { plainConnectErrorMessage, plainSwitchErrorMessage, shortenAddress } from "@/lib/format";

const NAV_LINKS = [
  { href: "#app", label: "Vault" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

/** Small popover under a navbar button: a failed connect or switch must say
 * why, instead of failing silently. Dismissed by retrying or by the ×. */
function NavErrorPopover({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 8px)",
        zIndex: 60,
        background: "var(--surface)",
        border: "1px solid var(--danger)",
        borderRadius: 14,
        boxShadow: "var(--shadow-pop)",
        padding: "12px 14px",
        width: 280,
        maxWidth: "calc(100vw - 48px)",
        color: "var(--text)",
        fontSize: 13.5,
        lineHeight: 1.5,
      }}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "none",
          border: "none",
          color: "var(--text-2)",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
      <span style={{ paddingRight: 20, display: "block" }}>{message}</span>
    </div>
  );
}

export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending, error: connectError, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the wallet menu, like every other dismissible surface.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const wrongChain = isConnected && chainId !== aevumTestnet.id;

  if (!isConnected || !address) {
    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={`btn btn-primary nav-cta ${className}`}
          disabled={isPending}
          onClick={() => {
            resetConnect();
            connect({ connector: injected() });
          }}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {connectError && (
          <NavErrorPopover
            message={plainConnectErrorMessage(connectError)}
            onDismiss={resetConnect}
          />
        )}
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={`btn btn-primary nav-cta ${className}`}
          disabled={isSwitching}
          onClick={() => {
            resetSwitch();
            switchChain({ chainId: aevumTestnet.id });
          }}
        >
          {isSwitching ? "Switching…" : "Switch to Aevum Testnet"}
        </button>
        {switchError && (
          <NavErrorPopover
            message={plainSwitchErrorMessage(switchError)}
            onDismiss={resetSwitch}
          />
        )}
      </div>
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
        title="Connected wallet, click for options"
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

  // Escape closes the menu, and the page behind it does not scroll while
  // it is open. Same behaviour as the demo modal.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // A successful connect closes the menu; a failed one leaves it open so
  // the error stays visible.
  useEffect(() => {
    if (isConnected) setMenuOpen(false);
  }, [isConnected]);

  return (
    <header className="nav">
      <div className={`container nav-inner${menuOpen ? " nav-inner-menu-open" : ""}`}>
        <a href="#top" className="nav-logo" aria-label="SpendGuard home">
          <LogoLockup size={34} />
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
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="mobile-menu-backdrop"
            onClick={() => setMenuOpen(false)}
          />
          <div className="mobile-menu">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            {!isConnected && <MobileConnect />}
          </div>
        </>
      )}
    </header>
  );
}

function MobileConnect() {
  const { connect, isPending, error, reset } = useConnect();
  return (
    <div>
      <button
        type="button"
        className="btn btn-primary btn-block"
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
