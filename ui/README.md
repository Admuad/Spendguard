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
framework), Inter Tight self-hosted (see Design). Wallet connect is injected
wallets only (MetaMask, Rabby, …): WalletConnect is deliberately excluded
because it needs a project-id secret, and this app has zero secrets by
design. The wallet connection persists in localStorage and reconnects
automatically after a tab close/reopen with no wallet prompt; the wagmi
config deliberately avoids `ssr` mode, which would skip that restore (see
`src/lib/wagmi.ts` and VERIFICATION.md). Transactions are submitted as
legacy type: the vault itself was deployed legacy, and the starter-kit docs
warn some tooling mishandles EIP-1559 fields on this chain.

## Design

The visual language follows the Vellure fintech template (dark navy-to-blue
gradient hero, `#0346FF` accent, pill buttons, white dashboard card) as a
reference, rebuilt in original code with fresh SpendGuard copy. No template
assets, images, or copy text are used. Sections are tailored to the vault:
capabilities, three roles (owner / agent / auditor), guarantees tied to the
threat-model invariants, how-it-works, FAQ with real answers, and the live
app. No fake testimonials, no fake pricing, no invented partners.

The typeface is Inter Tight (self-hosted variable font, SIL OFL 1.1, in
`src/app/fonts/`). Vellure's own typeface is Neue Montreal, a commercial
font; Inter Tight was picked by rendering four free candidates side by side
against the Vellure hero and choosing the closest match, with the same
500-weight / −0.02em heading treatment. The app loads no font from any
outside service. Full brand rules (logo, colors, type scale, voice,
do/don'ts) live in [`../BRANDING.md`](../BRANDING.md).

## Deploy (GitHub Pages)

The live site is a static export served from the `gh-pages` branch:

```bash
cd ui
DEPLOY_TARGET=github-pages NEXT_PUBLIC_BASE_PATH=/Spendguard npm run build
# then push the out/ tree to the gh-pages branch (build output only)
```

`DEPLOY_TARGET=github-pages` switches `next.config.ts` to `output: "export"`
with `basePath: "/Spendguard"`; `NEXT_PUBLIC_BASE_PATH` keeps metadata
icon/manifest links on the same prefix. Local dev and `next start` are
unaffected. Link previews, favicons, manifest, robots, and sitemap are all
in `public/` and verified live (see VERIFICATION.md).

## Deploy (Vercel)

The same repo deploys to Vercel as a standard Next.js app, no config change
needed: without `DEPLOY_TARGET`, `next.config.ts` is the default server
build with no base path. In the Vercel dashboard, import `Admuad/Spendguard`
and set:

- Root Directory: `ui`
- Framework Preset: Next.js (auto-detected)
- Environment variables:
  - `NEXT_PUBLIC_SITE_URL` = `https://<project>.vercel.app` (canonical links
    and previews; without it they default to the GitHub Pages URL)
  - leave `NEXT_PUBLIC_BASE_PATH` unset (empty = root deployment)

The demo video stays hosted on GitHub Pages
(`https://admuad.github.io/Spendguard/spendguard-demo-v5-web.mp4`), so the
Watch Demo button works from either host. Keep the Pages site live as a
fallback; point the submission and the repo homepage at the Vercel URL once
it is live.

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
