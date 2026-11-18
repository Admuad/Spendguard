# SpendGuard UI

Next.js frontend for the SpendGuard vault. No environment variables, no secrets,
no build-time configuration: every address, URL, and chain parameter is a public
constant in `src/lib/config.ts`. The app runs entirely against the public Aevum
testnet RPC.

## Run it

```bash
cd ui
npm install
npm run dev      # http://localhost:3000
npm run build && npm run start   # production build
```

## What it does

- **Live vault dashboard (no wallet needed).** Vault balance, active sessions,
  payments executed, owner, and the full on-chain activity feed, read over the
  public RPC and refreshed by polling (Aevum has no WebSocket RPC). Log scans
  are chunked to ≤1,000 blocks per call, the RPC's limit.
- **Deposit.** Exact-amount approve, then deposit. No unlimited approvals, ever.
- **Grant a session key (owner only).** Key address, recipient allowlist,
  per-payment limit, total cap, expiry — with a confirmation summary including
  the maximum loss if the key is stolen.
- **Pay as a session key.** The connected wallet pays only from its own
  session's allowlist, with pre-flight cap, expiry, pause, and balance checks.
  The caller must be the key itself; the contract enforces it.
- **Owner controls.** Pause/unpause and sweep, with confirmation. The sweep
  works while paused.
- **Sessions.** Every key ever granted, with live spent-vs-cap bars, remaining
  cap, expiry, recipients, and one-click revoke (with confirmation).
- **Plain-language errors.** Every contract revert maps to a sentence a
  first-time user can act on. Raw revert data is never shown.
- **Watch Demo.** Opens a modal wired to `DEMO_VIDEO_URL` in
  `src/lib/config.ts`. Until the video exists it shows an honest placeholder.
- **Light/dark themes.** A custom toggle in the navbar, persisted, honoring the
  OS preference as the default, resolved before first paint (no theme flash).
- **Mobile-first.** Hamburger menu, single-column stacking, and a dashboard
  that fits 390px widths. Verified at 390px and 1440px (see VERIFICATION.md).

## Stack

Next.js 16 + React 19 + wagmi/viem, plain CSS custom properties (no CSS
framework), Inter. Wallet connect is injected wallets only (MetaMask, Rabby,
…): WalletConnect is deliberately excluded because it needs a project-id
secret, and this app has zero secrets by design. Transactions are submitted
as legacy type: the vault itself was deployed legacy, and the starter-kit
docs warn some tooling mishandles EIP-1559 fields on this chain.

## Design

The visual language follows the Vellure fintech template (dark navy-to-blue
gradient hero, `#0346FF` accent, pill buttons, white dashboard card) as a
reference, rebuilt in original code with fresh SpendGuard copy. No template
assets, images, or copy text are used. Sections are tailored to the vault:
capabilities, three roles (owner / agent / auditor), guarantees tied to the
threat-model invariants, how-it-works, FAQ with real answers, and the live
app. No fake testimonials, no fake pricing, no invented partners.

## Layout

```
src/
  app/          # layout (theme init script, Inter), page composition, providers
  components/   # Navbar, Hero (live dashboard), VaultApp (all vault flows),
                # Sections (landing content), DemoModal, bits (reveal/count-up)
  lib/          # config (public constants + ABIs), wagmi, theme, format
                # (6-decimal amounts, plain-language errors), useVaultData
                # (live reads, chunked log scan, multicall + direct fallback)
```

## Verification

See [VERIFICATION.md](VERIFICATION.md): build, live-read, rendering, and
interaction checks, including the two real bugs found and fixed during
verification (the `getSession` tuple ABI and the transaction-hash shortening).
