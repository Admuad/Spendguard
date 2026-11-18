# UI verification — 18 Nov 2026

Verified by independent review of the built code plus live checks against the
deployed vault (`0x9a113999851e446a7ab516472e2dae743fc2a0ca`, Aevum testnet
44005). All checks below were run against the production build (`npm run
build` + `npm run start`), not the dev server.

## What passed

- **Build.** `npm run build` green from a clean `.next/`: Next.js 16.4.3,
  TypeScript clean, static prerender of `/`.
- **ABI fidelity.** Every function, event, and error in `src/lib/config.ts`
  diffed against `src/SpendGuard.sol`: signatures, argument order, event
  parameters, and all 16 custom errors match. The `Session` struct field order
  matches the tuple declaration.
- **Live reads.** The app's exact read path (viem, public RPC) returns the
  real chain state: vault balance `0`, paused `false`, owner
  `0xE5e31bAB0976A568f009980Ed1da2B6A56D8D898`, token `0x456569838f1d…`.
  The chunked log scan (≤1,000 blocks/call) returns all 5 vault events from
  the 18 Nov E2E (deposit 1.00, grant cap 0.80, payment 0.30, revoke spent
  0.30, sweep 0.70), and the dashboard renders them with the correct amounts
  and transaction hashes.
- **Sessions list.** The one granted key renders with its true state:
  Revoked, spent 0.30 of 0.80, remaining 0.50, max per payment 0.40, expiry
  Nov 18 05:59 WAT. (This caught the tuple-ABI bug below.)
- **Rendering.** Headless Chromium at 1440px and 390px, light and dark:
  zero horizontal overflow at both widths in both themes; hero, dashboard,
  panels, and session rows all fit and stack correctly at 390px.
- **Interactions.** Theme toggle switches and persists (localStorage);
  mobile hamburger opens a 4-link menu; FAQ accordion expands; role tabs
  switch content; Watch Demo opens the modal with the honest placeholder and
  closes on Escape; no page errors in any run.
- **Copy audit.** Every number on the page traces to the repo: 17 invariants,
  15 adversarial tests, 12 fuzz properties (P-1..P-12), 30/30 tests, 32,768
  fuzz calls, INV/T references in the guarantees section. No fake
  testimonials, pricing, partners, or integrations. The FAQ's SDK answer
  matches the verified platform status (no bundler/paymaster/SDK; Q1 2027).
- **No secrets.** The tree contains no private keys, mnemonics, or `.env`
  files; the app builds and runs with zero environment variables.
  `.gitignore` covers `node_modules/`, `.next/`, `out/`, `.verification/`,
  `.env*`.
- **Wallet session persistence.** The wagmi config deliberately does NOT use
  `ssr` mode (see the comment in `src/lib/wagmi.ts`): with `ssr: true`,
  wagmi skips store hydration and only restores the connection from a
  server-provided cookie state, which a static build can never provide —
  the classic flaw where reopening the tab shows disconnected even though
  the wallet still has the site connected. Verified 18 Nov 2026 with a mock
  injected provider (MetaMask-shaped, chain 44005): fresh connect works;
  reload auto-reconnects with no wallet prompt (only `eth_accounts` /
  `eth_chainId` calls); a new tab in the same browser comes back connected;
  an explicit disconnect stays disconnected across reload; a wallet-side
  revoke (`accountsChanged: []`) disconnects the UI.
- **Brand, font, and link previews (18 Nov 2026).** Vellure's typeface was
  identified by live computed-style inspection as Neue Montreal (Medium 500
  headings at 72px / −0.02em, Regular 400 body), a commercial font; Inter
  Tight was chosen as the closest free match after rendering four candidates
  side by side against the Vellure hero, and is self-hosted via
  `next/font/local` (no outside font service; zero `fonts.googleapis.com`
  references in the export). The logo (shield + session key whose teeth are
  the three bounds) was designed as SVG, rendered and inspected at 16–128px
  on light and dark, with a simplified variant for favicons; see
  `BRANDING.md`. Full metadata verified in the built HTML: Open Graph
  (absolute image URL, 1200×630 + alt), X `summary_large_image`, favicon SVG
  + 32px PNG, Apple touch icon, manifest (relative paths, base-path safe),
  canonical URL, `theme-color` for both schemes, Apple web-app metas,
  `robots.txt`, `sitemap.xml`.
- **GitHub Pages deployment (18 Nov 2026).** Static export
  (`DEPLOY_TARGET=github-pages`, `basePath: "/Spendguard"`) pushed to the
  `gh-pages` branch (build output only; source of truth is `main`).
  Verified live at https://admuad.github.io/Spendguard/ in a headless
  browser: zero failed requests, zero page errors, font loaded, logo
  rendered, live balance and session reads working, zero horizontal
  overflow at 1440px and 390px. `og-image.png`, `favicon.svg`,
  `manifest.webmanifest`, `robots.txt`, and `sitemap.xml` all return 200.

## Bugs found and fixed during verification

1. **`getSession` tuple ABI (would have blanked the sessions list).** The ABI
   declared six flat outputs, but the contract returns a single `Session`
   struct, whose ABI encoding starts with a tuple offset. Decoding shifted by
   one slot and failed on the boolean. Fixed by declaring the single tuple
   return; verified by direct read and multicall against the live vault.
   A multicall→direct-read fallback was added so a multicall outage never
   blanks the list.
2. **Tuple result shape.** viem decodes the tuple as a named-key object, not
   an array; positional destructuring threw. Fixed to read by name with a
   positional fallback.
3. **Transaction hashes unshortened.** `shortenAddress` returns non-addresses
   whole, so full 66-char hashes rendered and clipped on mobile. Added
   `shortenHash` and used it for activity links.
4. **Wrong deploy block.** `DEPLOY_BLOCK` was 3458194; the deploy receipt says
   3461010. Fixed (harmless before: scanning from earlier only cost extra
   calls, no events were missed).
5. **Pause success label race.** The label read live `paused` state, which
   flips after refresh. It now records which action was submitted.

## What was NOT verified

- **Wallet write flows** (deposit, grant, pay, revoke, pause, sweep) were
  verified by code review and build only. No wallet signing was performed in
  automated checks, and no transaction was sent from the UI. The contract
  functions themselves are proven by the 18 Nov on-chain E2E. The first live
  click-through should be done by a human with a testnet wallet.
- **Inter font rendering.** The sandbox blocks Google Fonts, so screenshots
  show the fallback sans-serif. The Inter stylesheet link is in place; on any
  normal connection it loads.
- **Real-wallet connect.** Injected-wallet connection was not exercised
  (no wallet in the sandbox). The connect/disconnect/switch-chain code paths
  follow standard wagmi patterns and are code-reviewed only.
