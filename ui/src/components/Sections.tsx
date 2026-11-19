"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { VaultData } from "@/lib/useVaultData";
import { CountUp, Chevron, Reveal } from "./bits";
import { LogoLockup } from "./Logo";
import { formatTusd8, shortenAddress } from "@/lib/format";
import { APP_URL, BASE_PATH } from "@/lib/site";
import {
  DEMO_VIDEO_URL,
  DORAHACKS_URL,
  EXPLORER_URL,
  FACTORY_ADDRESS,
  FAUCET_URL,
  REPO_URL,
  RPC_URL,
  TUSD8_ADDRESS,
  VAULT_ADDRESS,
  explorerAddressUrl,
} from "@/lib/config";

// ---------------------------------------------------------------------------
// Stat strip: real numbers only. Live chain reads plus the chain id.
// ---------------------------------------------------------------------------
export function StatStrip({ vault }: { vault: VaultData }) {
  return (
    <div className="container" style={{ marginTop: 40 }}>
      <div className="stat-strip">
        <div className="stat-strip-item">
          <div className="stat-strip-value">
            {vault.balance === null ? "…" : formatTusd8(vault.balance)}
          </div>
          <div className="stat-strip-label">tUSD8 in the vault, live</div>
        </div>
        <div className="stat-strip-item">
          <div className="stat-strip-value">{vault.loading ? "…" : vault.grantsCount}</div>
          <div className="stat-strip-label">Sessions granted, on-chain</div>
        </div>
        <div className="stat-strip-item">
          <div className="stat-strip-value">{vault.loading ? "…" : vault.paymentsCount}</div>
          <div className="stat-strip-label">Payments executed, on-chain</div>
        </div>
        <div className="stat-strip-item">
          <div className="stat-strip-value">44,005</div>
          <div className="stat-strip-label">Aevum testnet chain id</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About statement + real test-suite numbers.
// ---------------------------------------------------------------------------
export function About() {
  return (
    <section className="section section-tight">
      <div className="container about-grid">
        <Reveal>
          <div>
            <span className="eyebrow eyebrow-dark">Why SpendGuard</span>
            <p className="about-statement" style={{ marginTop: 18 }}>
              Agents need to pay. Giving one your wallet key is how a small
              mistake becomes a total loss.
            </p>
            <p className="about-body">
              SpendGuard turns spending authority into something you can
              grant. The owner keeps the only full key. Every agent, bot, or
              cashier gets a session key that pays only approved recipients,
              only up to a cap, only until an expiry. The contract enforces
              every bound. A compromised key can lose at most its remaining
              cap, and the owner takes it back in one click.
            </p>
          </div>
        </Reveal>
        <div className="about-stats">
          <Reveal delay={80}>
            <div className="about-stat">
              <span className="about-stat-value">
                <CountUp value={17} />
              </span>
              <span className="about-stat-label">
                Security invariants in the threat model, all tested
              </span>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="about-stat">
              <span className="about-stat-value">
                <CountUp value={30} />
                /30
              </span>
              <span className="about-stat-label">
                Foundry tests passing, including 15 scripted adversarial
                scenarios
              </span>
            </div>
          </Reveal>
          <Reveal delay={240}>
            <div className="about-stat">
              <span className="about-stat-value">
                <CountUp value={32768} />
              </span>
              <span className="about-stat-label">
                Randomized fuzz calls in the invariant suite, zero failures
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Core capabilities: four cards, each a real contract guarantee.
// ---------------------------------------------------------------------------
const CAPABILITIES = [
  {
    title: "Scoped session keys",
    body: "Each key carries its own allowlist, per-payment limit, total cap, and expiry. A key is good for exactly one job. Nothing more.",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="15" r="4" />
        <path d="m10.9 12.1 8.6-8.6M18 5l2 2M15 8l2 2" />
      </svg>
    ),
  },
  {
    title: "Caps that cannot be bypassed",
    body: "Every check runs on-chain before the transfer. No frontend, script, or prompt can talk the contract out of it.",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Instant revocation",
    body: "One owner transaction and the key is dead forever. A fresh grant starts at zero spent. A revoked key never comes back.",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.5 5.5l13 13" />
      </svg>
    ),
  },
  {
    title: "Full audit trail",
    body: "Every deposit, grant, payment, revoke, and sweep emits an event. The full history of the vault is readable on-chain. No logins. No private database.",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h6" />
      </svg>
    ),
  },
];

export function Capabilities() {
  return (
    <section className="section section-tight" id="capabilities">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Core capabilities</span>
          <h2 className="section-title">Bounded delegation, enforced by the contract</h2>
          <p className="section-sub">
            The interface shows state and submits transactions. It never
            authorizes anything. Every check lives in the vault itself.
          </p>
        </div>
        <div className="cap-grid">
          {CAPABILITIES.map((cap, i) => (
            <Reveal key={cap.title} delay={i * 80}>
              <div className="cap-card">
                <div className="cap-icon">{cap.icon}</div>
                <h3>{cap.title}</h3>
                <p>{cap.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabbed section: one vault, three roles.
// ---------------------------------------------------------------------------
const TABS = [
  {
    id: "owner",
    title: "For the owner",
    desc: "Grant, watch, revoke, recover.",
    heading: "Full control, one key, zero sharing",
    body: "You deposit once and hand out bounded keys instead of your wallet. You see every session's spent against its cap, live. You can revoke any key, pause all payments, or sweep the whole balance at any moment, including while paused.",
    points: [
      "Grant with a confirmation summary: key, recipients, caps, expiry",
      "One-click revoke. Immediate once mined.",
      "Pause freezes spending, never recovery",
    ],
  },
  {
    id: "agent",
    title: "For the agent",
    desc: "Pay merchants within your bounds.",
    heading: "A key that does its job and nothing else",
    body: "An agent, bot, or cashier holds only its session key. It pays approved recipients within its per-payment limit and total cap until expiry. If the key leaks or the agent goes rogue, the damage stops at the remaining allowance. The owner can kill it instantly.",
    points: [
      "Only the key itself can call. No impersonation.",
      "Plain-language errors when a payment breaks a bound",
      "No owner key anywhere near the agent's environment",
    ],
  },
  {
    id: "auditor",
    title: "For the auditor",
    desc: "Every state change, on-chain.",
    heading: "The audit trail is the chain",
    body: "Deposits, grants, payments, revokes, and sweeps all emit events with full parameters. Anyone can rebuild the vault's entire history from the public RPC. No account. No permission. No private log to trust.",
    points: [
      "17 invariants, 12 fuzz properties, 15 adversarial tests",
      "Checks-effects-interactions plus a reentrancy guard",
      "Balance-delta deposits keep accounting exact",
    ],
  },
];

export function RoleTabs() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <section className="section section-tight">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Three roles, one vault</span>
          <h2 className="section-title">Built for whoever holds the key</h2>
        </div>
        <div className="tabs">
          <div className="tab-list" role="tablist" aria-label="Roles">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active === t.id}
                className="tab-btn"
                onClick={() => setActive(t.id)}
              >
                <span className="tab-btn-title">{t.title}</span>
                <span className="tab-btn-desc">{t.desc}</span>
              </button>
            ))}
          </div>
          <div
            key={tab.id}
            className="tab-panel"
            role="tabpanel"
            aria-label={tab.title}
          >
            <h3>{tab.heading}</h3>
            <p>{tab.body}</p>
            <ul>
              {tab.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stats band: real verification numbers from the repo.
// ---------------------------------------------------------------------------
export function StatsBand() {
  return (
    <section className="section-tight">
      <div className="container">
        <div className="stats-band">
          <div>
            <div className="stats-band-value">
              <CountUp value={17} />
            </div>
            <div className="stats-band-label">Security invariants specified and tested</div>
          </div>
          <div>
            <div className="stats-band-value">
              <CountUp value={15} />
            </div>
            <div className="stats-band-label">Scripted adversarial scenarios, all passing</div>
          </div>
          <div>
            <div className="stats-band-value">
              <CountUp value={12} />
            </div>
            <div className="stats-band-label">Stateful fuzz properties holding</div>
          </div>
          <div>
            <div className="stats-band-value">
              <CountUp value={32768} />
            </div>
            <div className="stats-band-label">Randomized fuzz calls, zero failures</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento: three guarantees, each tied to a proven invariant.
// ---------------------------------------------------------------------------
export function Bento() {
  return (
    <section className="section section-tight">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Guarantees</span>
          <h2 className="section-title">What the contract promises</h2>
        </div>
        <div className="bento-grid">
          <Reveal>
            <div className="bento-card">
              <h3>Bounded loss, always</h3>
              <p>
                The worst case for one compromised key is its remaining
                cap. A stolen key, a malicious recipient, reentrancy, a
                frontrun: none of them turns a bounded loss into a vault
                drain.
              </p>
              <p className="bento-foot">
                Proven by <strong>INV-1, INV-9, INV-10</strong> in the threat
                model.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="bento-card">
              <h3>Pause never blocks recovery</h3>
              <p>
                Pausing freezes every payment instantly. The owner sweep
                works in every state: paused, keys revoked, keys expired.
                Recovery is never locked behind the circuit breaker.
              </p>
              <p className="bento-foot">
                Proven by <strong>INV-4, INV-6</strong> and adversarial test{" "}
                <strong>T-7</strong>.
              </p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="bento-card">
              <h3>No silent state changes</h3>
              <p>
                Every state-changing operation emits an event with full
                parameters. If it happened, it is on the chain, readable by
                anyone, forever.
              </p>
              <p className="bento-foot">
                Proven by <strong>INV-15</strong>; verified in the unit suite
                with event assertions.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Setup guide: from zero to a working session. No code, no SDK, no smart
// account. Every value here matches ui/src/lib/config.ts.
// ---------------------------------------------------------------------------
export function SetupGuide() {
  return (
    <section className="section section-tight" id="start">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Setup guide</span>
          <h2 className="section-title">From zero to a working session</h2>
          <p className="section-sub">
            Five steps. No code, no SDK, no smart account. A plain browser
            wallet is enough.
          </p>
        </div>
        <div className="steps steps-two">
          <Reveal>
            <div className="step-card">
              <div className="step-num">1</div>
              <h3>Install a wallet</h3>
              <p>
                Install MetaMask, Rabby, or any injected wallet in your
                browser. SpendGuard works with plain wallets. No smart
                account is needed.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="step-card">
              <div className="step-num">2</div>
              <h3>Add the Aevum testnet</h3>
              <p>
                Connect your wallet on this page and approve the network
                switch when your wallet asks. If your wallet cannot add the
                network on its own, add it manually with these values:
              </p>
              <div className="setup-net">
                <div className="setup-net-row">
                  <span>Network name</span>
                  <code>QDay Aevum Testnet</code>
                </div>
                <div className="setup-net-row">
                  <span>Chain ID</span>
                  <code>44005</code>
                </div>
                <div className="setup-net-row">
                  <span>RPC URL</span>
                  <code>{RPC_URL}</code>
                </div>
                <div className="setup-net-row">
                  <span>Explorer</span>
                  <code>{EXPLORER_URL}</code>
                </div>
                <div className="setup-net-row">
                  <span>Currency</span>
                  <code>tQDAY</code>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="step-card">
              <div className="step-num">3</div>
              <h3>Claim test tokens</h3>
              <p>
                You need tQDAY for gas and tUSD8 to deposit. The web faucet
                gives 1 tUSD8 per claim, with a 24 hour cooldown. The
                Discord #faucet channel gives 1 tQDAY plus 5 tUSD8 once per
                person. Gas costs a fraction of a tQDAY per transaction.
              </p>
              <p className="setup-links">
                <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                  Web faucet ↗
                </a>
                <a
                  href="https://discord.gg/bYPhjmrSfK"
                  target="_blank"
                  rel="noreferrer"
                >
                  QDay Discord ↗
                </a>
              </p>
            </div>
          </Reveal>
          <Reveal delay={240}>
            <div className="step-card">
              <div className="step-num">4</div>
              <h3>Deposit</h3>
              <p>
                Connect your wallet, open the vault below, and approve
                exactly the amount you want to deposit. The vault pulls
                exactly that amount and credits what actually arrived.
              </p>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <div className="step-card">
              <div className="step-num">5</div>
              <h3>Grant a key</h3>
              <p>
                Name the key, its recipients, its per-payment limit, its
                total cap, and its expiry. Sign once. The key pays within
                those bounds, and you can revoke it in one click.
              </p>
            </div>
          </Reveal>
          <Reveal delay={400}>
            <div className="step-card setup-cta">
              <h3>You are ready</h3>
              <p>
                The vault is live on the Aevum testnet with real test
                tokens. Deposit, grant, pay, and revoke for real.
              </p>
              <a href={APP_URL} className="btn btn-primary">
                Open the vault
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works: three steps + safety guarantees. No pricing. The vault is free.
// ---------------------------------------------------------------------------
export function HowItWorks() {
  return (
    <section className="section section-tight" id="how-it-works">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">How it works</span>
          <h2 className="section-title">Three steps to bounded spending</h2>
          <p className="section-sub">
            Aevum has no session-key tooling yet. The official SDK ships in
            Q1 2027, and no published bundler, paymaster, or factory is
            usable by builders today. SpendGuard is that missing piece,
            built in plain Solidity. It works on the testnet now, with a
            plain wallet.
          </p>
        </div>
        <div className="steps">
          <Reveal>
            <div className="step-card">
              <div className="step-num">1</div>
              <h3>Deposit once</h3>
              <p>
                Approve exactly the amount you want to deposit, then
                deposit it. The vault pulls exactly that amount. No
                unlimited approvals anywhere. It credits what actually
                arrived.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="step-card">
              <div className="step-num">2</div>
              <h3>Grant a session key</h3>
              <p>
                Name the key, its recipient allowlist, its per-payment limit,
                its total cap, and its expiry. Review the summary, sign once.
                The key is live the moment the grant is mined.
              </p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="step-card">
              <div className="step-num">3</div>
              <h3>The key pays, within bounds</h3>
              <p>
                The session key pays merchants itself. Every payment is
                checked on-chain: caller, active, unexpired, within caps,
                recipient allowlisted, vault funded, vault unpaused. Anything
                else reverts with a plain-language reason.
              </p>
            </div>
          </Reveal>
        </div>
        <div className="guarantees">
          <div className="guarantee">
            <h4>Revoke in one click</h4>
            <p>
              A revoked key can never spend again. Re-granting starts fresh at
              zero spent.
            </p>
          </div>
          <div className="guarantee">
            <h4>Expiry is a hard cutoff</h4>
            <p>
              A payment in the exact expiry second reverts. There is no grace
              period to exploit.
            </p>
          </div>
          <div className="guarantee">
            <h4>Testnet only, test tokens only</h4>
            <p>
              SpendGuard runs on the Aevum testnet with tUSD8 test tokens. No
              tokens are issued or promised.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ: real questions, real answers from the threat model and the build.
// ---------------------------------------------------------------------------
const FAQS = [
  {
    q: "What is a session key?",
    a: "A session key is an address the vault owner authorizes to spend within tight bounds: approved recipients, a maximum per payment, a maximum total, and an expiry time. The key has no other power. It cannot grant, revoke, pause, or sweep.",
  },
  {
    q: "What happens if a session key is stolen?",
    a: "The thief can spend at most the key's remaining cap, only to its approved recipients, only until expiry. The owner can revoke the key instantly. The loss is bounded by design. It can never become a vault drain. Keep caps small and expiries short, and revoke fast.",
  },
  {
    q: "Can the owner always get the money back?",
    a: "Yes. The owner sweep recovers the full remaining balance in every state: paused or not, keys revoked or expired. Pausing freezes payments only. It never blocks recovery.",
  },
  {
    q: "Does the vault need the QDay SDK or smart accounts?",
    a: "No. QDay's session-key and smart-account infrastructure is announced but has no published bundler, paymaster, factory, or SDK addresses usable by builders, and the official SDK ships in Q1 2027. SpendGuard implements scoped session keys natively in Solidity, so it works today with plain wallets. No ERC-4337, ERC-8004, or x402 integration is claimed.",
  },
  {
    q: "Where do I get tUSD8 and tQDAY for gas?",
    a: "Both come from the Aevum faucets: the web faucet at faucet.qday.info gives 1 tUSD8 per claim with a 24-hour cooldown, and the Discord #faucet channel gives 1 tQDAY plus 5 tUSD8 once per person. Gas on the testnet is a fraction of a tQDAY per transaction.",
  },
  {
    q: "Is my session data private?",
    a: "No, and that is deliberate. Caps, recipients, spent amounts, and expiries are readable on-chain by anyone. That transparency is the audit trail. SpendGuard promises no privacy it does not deliver.",
  },
  {
    q: "What does it cost to use SpendGuard?",
    a: "Nothing but testnet gas. There are no fees, no subscriptions, and no tokens. This is a hackathon build on a testnet, and the vault charges nothing for deposits, grants, or payments.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section section-tight" id="faq">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">FAQ</span>
          <h2 className="section-title">Questions, answered honestly</h2>
        </div>
        <div className="faq-list">
          {FAQS.map((faq, i) => (
            <div className="faq-item" key={faq.q} data-open={open === i}>
              <button
                type="button"
                className="faq-q"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {faq.q}
                <span className="faq-chevron">
                  <Chevron />
                </span>
              </button>
              <div className="faq-a">
                <div className="faq-a-inner">
                  <p>{faq.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA banner + footer.
// ---------------------------------------------------------------------------
export function CtaBanner({ onWatchDemo }: { onWatchDemo: () => void }) {
  return (
    <section className="section-tight">
      <div className="container">
        <div className="cta-banner">
          <h2>Stop handing agents your wallet key.</h2>
          <p>
            Grant a bounded key instead. The vault is live on Aevum
            testnet. Deposit, grant, pay, and revoke for real, with test
            tokens.
          </p>
          <div className="hero-cta-row">
            <a href={APP_URL} className="btn btn-white">
              Open the app
            </a>
            <button type="button" className="btn btn-ghost-dark" onClick={onWatchDemo}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5z" />
              </svg>
              Watch demo
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  const onAppPage = /^\/app(\/|$)/.test(usePathname());
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <a href={onAppPage ? `${BASE_PATH}/` : "#top"} className="nav-logo footer-logo" aria-label="SpendGuard home">
              <LogoLockup size={34} />
            </a>
            <p>
              A scoped session-key vault for tUSD8 on the QDay Aevum testnet.
              Built for the Aevum Builder Challenge #1. Testnet only, test
              tokens only.
            </p>
          </div>
          <div className="footer-links">
            <div>
              <h4>Project</h4>
              <ul>
                <li>
                  <a href={REPO_URL} target="_blank" rel="noreferrer">
                    GitHub repository
                  </a>
                </li>
                <li>
                  <a href={DORAHACKS_URL} target="_blank" rel="noreferrer">
                    Aevum Builder Challenge
                  </a>
                </li>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>On-chain</h4>
              <ul>
                <li>
                  <a href={explorerAddressUrl(VAULT_ADDRESS)} target="_blank" rel="noreferrer">
                    SpendGuard vault
                  </a>
                </li>
                <li>
                  <a href={explorerAddressUrl(TUSD8_ADDRESS)} target="_blank" rel="noreferrer">
                    tUSD8 token
                  </a>
                </li>
                <li>
                  <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
                    Aevum explorer
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Testnet</h4>
              <ul>
                <li>
                  <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                    tUSD8 faucet
                  </a>
                </li>
                <li>
                  <a href="https://discord.gg/bYPhjmrSfK" target="_blank" rel="noreferrer">
                    QDay Discord
                  </a>
                </li>
                <li>
                  <a href="https://qday.io" target="_blank" rel="noreferrer">
                    QDay
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>MIT licensed. Built during the Aevum Builder Challenge build window.</span>
          <span>Chain 44005 · Vault {VAULT_ADDRESS.slice(0, 10)}…</span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Verify it yourself: every claim on this page maps to a link a judge can open.
// ---------------------------------------------------------------------------
export function VerifySection() {
  const rows: { label: string; note: string; href: string; value: string }[] = [
    { label: "Demo vault", note: "The contract behind the dashboard above", href: explorerAddressUrl(VAULT_ADDRESS), value: VAULT_ADDRESS },
    { label: "Vault factory", note: "Anyone can create their own vault here", href: explorerAddressUrl(FACTORY_ADDRESS), value: FACTORY_ADDRESS },
    { label: "tUSD8 token", note: "Test token held by the vault", href: explorerAddressUrl(TUSD8_ADDRESS), value: TUSD8_ADDRESS },
    { label: "Source code", note: "Contract, tests and this interface", href: REPO_URL, value: "github.com/Admuad/Spendguard" },
    { label: "Demo video", note: "A full grant, pay, revoke run", href: DEMO_VIDEO_URL, value: "Watch the recording" },
    { label: "Test tokens", note: "Get tUSD8 to try it yourself", href: FAUCET_URL, value: "Aevum faucet" },
  ];
  return (
    <section className="section section-tight" id="verify">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Verify it yourself</span>
          <h2 className="section-title">Don&apos;t trust this page. Check the chain.</h2>
          <p className="section-sub">
            Every number above is read from the contract. These are the
            addresses and sources behind it. Testnet only, and the contract
            has not been professionally audited.
          </p>
        </div>
        <ul className="verify-grid">
          {rows.map((r) => (
            <li key={r.label}>
              <a className="card verify-card" href={r.href} target="_blank" rel="noreferrer">
                <span className="verify-label">{r.label}</span>
                <span className="verify-value">{r.value.startsWith("0x") ? shortenAddress(r.value) : r.value}</span>
                <span className="verify-note">{r.note} ↗</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="hero-cta-row verify-cta">
          <a href={APP_URL} className="btn btn-primary">Open the app</a>
        </div>
      </div>
    </section>
  );
}
