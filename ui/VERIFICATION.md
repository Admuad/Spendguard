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
  click-through should be done by a human with a testnet wallet. The
  reverted-transaction handling in `useWriteFlow` (receipt-status check plus
  wagmi's bare-Error revert throw) is verified against the wagmi/viem source
  behaviour, not by a live reverted transaction through the UI.
- **Font rendering.** Inter Tight is self-hosted (no outside font service)
  and verified loaded on the live Pages site: `document.fonts` shows it
  loaded and the H1 computes to 500/72px/−1.44px, matching the Vellure
  treatment.
- **Real-wallet connect.** A mock injected provider proved connect,
  auto-reconnect on reload and new tab with no prompt, disconnect
  persistence, and wallet-side revoke handling. A real wallet (MetaMask /
  Rabby) click-through with real signing is still outstanding.

## UX audit round — 18 Nov 2026 (theme switching + flaw hunt)

Prompted by the question of whether the theme toggle switches all
components at the same time. Method: frame-by-frame computed-style sampling
during the toggle, plus a full code audit of every interactive surface
(navbar, menus, modal, all five vault panels, write flows, focus handling).

Found and fixed:

1. **Uneven theme switching (confirmed by measurement).** Before the fix,
   panels/cards faded over 0.25s, buttons/links over 0.2s, and session rows
   snapped instantly (100% switched at the 50ms sample). Fix: the toggle
   adds a `theme-changing` class to `<html>` for one 300ms window, putting
   every element on the same 0.25s clock for colours, fills, shadows and
   transforms; the class is never present on load, and reduced-motion users
   get an instant switch. Re-measured after the fix: body, cards, FAQ
   items, panels and session rows all track together (45% at 50ms, 88% at
   100ms, 100% by 150ms).
2. **Browser chrome ignored the in-app theme.** The `theme-color` metas
   used media queries, so the address bar followed the OS, not the toggle.
   Fix: a single `theme-color` meta, synced by the blocking init script
   before first paint and by the toggle. Verified: dark `#00081d`, light
   `#ffffff`, including a stored-dark first paint.
3. **Reverted transactions could read as success.** `useWriteFlow` treated
   wagmi's receipt-hook success as transaction success, but that only means
   the receipt arrived. Fix: the receipt `status` decides success, and
   wagmi's revert throw (a bare `Error` after an `eth_call` replay, verified
   in `@wagmi/core` 2.22.1 source) is recognised as a revert, with a
   plain-language message and an explorer link in the error state. A
   receipt-read failure gets its own distinct message.
4. **Silent connect/switch failures.** With no wallet installed, clicking
   Connect returned to idle with no message anywhere (proven in the
   browser). Fix: plain-language errors everywhere a connect or switch can
   fail — a dismissible popover on the navbar button, inline text in the
   mobile menu and the vault connect prompts, and inline text in the
   wrong-network banner. The no-provider case maps wagmi's
   `ProviderNotFoundError` ("Provider not found.") to "No wallet was found
   in this browser…". Verified: message shows, dismiss clears it, retry
   re-arms it. The mobile menu now stays open on a failed connect (so the
   error stays visible) and closes on a successful one.
5. **Menus lacked Escape/scroll-lock.** The mobile menu stayed open on
   Escape and the page scrolled behind it (both proven). Fix: Escape
   closes the mobile menu and the wallet-chip menu; the mobile menu locks
   body scroll while open, mirroring the demo modal.
6. **No branded keyboard focus.** Only inputs had focus styles. Fix: a
   `:focus-visible` ring (2px accent, 2px offset) for links, buttons,
   summaries and role=button. Verified by keyboard Tab: first focused
   button shows the 2px accent outline.
7. **Count-up ignored reduced motion.** `CountUp` is JS-driven, so the CSS
   media query did not stop it. Fix: reduced-motion users get the final
   number immediately. Verified with reduced-motion emulation: stats final
   at 150ms and unchanged at 1450ms.
8. **Small UX nits.** Pay-panel recipient dropdown now shows shortened
   addresses (values stay full addresses); the demo modal focuses its close
   button on open; the wallet-chip tooltip now says "click for options".

Checked and clean, no change: zero horizontal overflow at 360px; session
addresses wrap (`overflow-wrap: anywhere`); grant-form validation (caps,
allowlist, future expiry); deposit two-step approve flow; chain definition
carries everything a wallet needs for the add-chain fallback; FAQ buttons
carry `aria-expanded`.

Still outstanding after this round: the human live click-through of all
wallet write flows with a real testnet wallet, including a genuinely
reverting transaction through the UI.

## Maximum-effort UI round — 18 Nov 2026 (copy, theme, mobile, single connection)

Prompted by a phone screenshot of the live site: em dashes everywhere,
wording that read as AI-written, theme switching that jerked, and a mobile
layout that did not feel built for a phone.

Copy: all user-facing strings rewritten in short, plain sentences. 52
replacements across 10 source files plus the web manifest; zero em dashes
remain in src/ or public text files, verified by grep and by checking the
rendered page text in the browser. The BRANDING.md voice rule that used to
allow em dashes in page copy was corrected to ban them everywhere.

Theme: the fade-based switch was replaced with an atomic instant switch.
The toggle suppresses every transition for two animation frames while the
theme flips, so all components land on the new theme in one paint; the
toggle thumb keeps its slide. Measured: 5ms after the click, body and
every sampled card are already at their final dark values, the
theme-color meta is already dark, and the suppression class is gone by
20ms. No intermediate colour values anywhere. The old fade made the
unevenness visible because gradients and shadows cannot fade like flat
colours, and the repaint staggered on phones.

Single connection: one WagmiProvider, one config, one injected connector.
Proven with a mock wallet holding the owner address: one navbar click (one
eth_requestAccounts call) lights up every panel at once, deposit input,
grant form, agent state, and owner controls, with zero Connect prompts
left. The persistence regression suite still passes in full: reload and
new-tab reconnect with no prompt calls, disconnect stays disconnected,
wallet-side revoke disconnects the UI.

Mobile: a dedicated small-screen layer (640/480/360px). Connect stays
visible in the navbar next to the theme switch and menu; the logo
wordmark hides below 480px so the row fits. Dashboard balance spans the
full width with two-column KPIs below. Activity rows use a kind/amount
line with the detail below. Session rows show shortened addresses.
Panels use full-width actions and 16px inputs. The demo modal becomes a
bottom sheet. Safe-area insets are respected. Verified at 360, 390, and
412px: zero document overflow, zero overflowing elements, zero page
errors, modal docked to the bottom edge, inputs computing to 16px.

## Mobile redesign round — 18 Nov 2026 (from Claude's review + prompt)

Claude's review independently confirmed the theme diagnosis (gradients
cannot fade, transform fought the reveals) and proposed a View Transitions
ripple. The ripple was not adopted: the atomic instant switch already
solves the unevenness with no animation to drop frames on a phone, and
the patch was written against the pre-round code and does not apply.
Adopted from the patch: solid mobile-menu panel, 44px hamburger and
theme toggle. The menu also gained a real backdrop that dims the page
and closes the menu on an outside tap.

The structural mobile redesign follows the prompt Claude wrote for
Muse, with Owner kept as a fifth panel (the prompt listed four and
would have dropped pause/sweep on mobile):

- Persistent bottom action bar (mobile only, safe-area aware): Connect
  when disconnected, Switch to Aevum on the wrong chain, Vault/Grant/Pay
  tabs when connected. Tabs switch the panel and scroll to the vault.
- One vault panel at a time behind a sticky segmented control (Deposit,
  Grant, Pay, Owner, Sessions). One shared connect prompt above the
  panel; per-panel prompts are hidden on mobile. Same forms, same
  validation, same single wagmi connection. Desktop is unchanged.
- Sessions keep their cards and progress bars; the Revoke button is
  full-width and destructive on mobile, inline-confirm unchanged.
- Hero: short subtitle variant on mobile (keeps the on-chain claim),
  36px headline, side-by-side CTAs at 390px and up, stacked below 380px.
- Capabilities is a horizontal scroll-snap carousel with a peek of the
  next card. FAQ stays an accordion. Section padding capped at 48px.
- 44px minimum tap targets (buttons, chips, modal close, segments, bar
  tabs), touch-action manipulation, no page-level horizontal scroll.

Verified at 360, 390, and 430px in light and dark, disconnected and
connected (mock wallet): exactly one panel visible, segment and bottom
tab switching both work, zero per-panel prompts, carousel scrolls with
a peek, menu backdrop closes on an outside tap, zero horizontal
overflow, zero page errors. Page height fell from ~13,400px to
~10,900px (360px), ~10,300px (390px), ~9,800px (430px). Desktop 1440px
regression: segments and bar hidden, all five panels visible, long
subtitle shown, zero overflow. `npm run typecheck` passes.

## Rebrand round (18 Nov 2026, morning WAT)

The first mark (shield holding a stepped key) read as a blob at small
sizes; Muhammed rejected it. The new mark is a white keyhole in a flat
`#0346FF` rounded square: the square is the vault, the keyhole is the
session key. One shape, one flat color, no gradient. The same artwork
lives in `public/brand/logo-mark.svg`, `public/favicon.svg`, and
`src/components/Logo.tsx`; there is no separate simplified variant.

Design loop: the first keyhole draft read as an exclamation mark (stem
too narrow). The shipped geometry widens the stem (9 units at the neck,
16 at the base) and was inspected at 128/64/48/34/32/24/16px on light,
dark, and surface backgrounds: the keyhole holds at every size,
including 16px. Navbar and footer lockups inspected on light and dark.

PNG derivatives were rendered from the SVG artwork at exact sizes with
a headless browser (inline SVG; file-URL image loads are blocked from
scripted pages, which broke the first attempt and was caught by
inspection): `favicon-32.png` (transparent corners, verified pixel by
pixel: `#0346FF` tile, white keyhole), `apple-touch-icon.png` 180px,
`icon-192.png`, `icon-512.png` (opaque `#0346FF` tiles, keyhole at 60%,
512 doubles as maskable). The OG image was rebuilt from the source
layout in `brand/og-image.html` at exactly 1200x630 and inspected: new
lockup, headline, three bound chips, footer line, Inter Tight loaded.

`npm run typecheck` passes. The Pages export was served locally under
the `/Spendguard` base path and screenshotted at 1440px and 390px: the
new mark renders in the navbar and footer (2 instances in the DOM and
in the built HTML), styled hero intact. `BRANDING.md` was rewritten for
the new mark (meaning, files, 16px minimum, flat-tile rule, icon specs).

## Setup guide round (18 Nov 2026, morning WAT)

Added a SetupGuide section (`#start`) between Bento and the vault app: five
numbered steps (install a wallet, add the Aevum testnet with the manual
network values from `src/lib/config.ts`, claim test tokens with faucet and
Discord links, deposit, grant a key) plus a "You are ready" card with an
"Open the vault" button. The hero and CTA banner "Get started" buttons now
link to `#start`; the navbar gained a Setup link. The How it works section
gained an intro stating the positioning: Aevum has no session-key tooling
yet, the official SDK ships in Q1 2027, no published bundler, paymaster, or
factory is usable by builders today, and SpendGuard is that missing piece,
built in plain Solidity, working on the testnet now. README gained the same
positioning sentence and a Try it section with the five steps.

`npx tsc --noEmit` passes; the Pages export builds. Served locally under
`/Spendguard` and screenshotted at 1440px (light and dark) and 390px
(light): zero horizontal overflow at all three passes, zero page errors,
all six cards render, the network values match config exactly, and the How
it works intro renders as written. One mobile element screenshot showed the
first card blank; a viewport re-check with a user-like scroll showed it
rendering at opacity 1 with the reveal class applied, so the blank was a
capture artifact of the stitched element screenshot, not a defect.

## Factory UI round (18 Nov 2026, afternoon WAT)

The vault app moved to the factory model. A vault bar above the panels
lets the viewer pick the demo vault or one of their own vaults (read from
`SpendGuardFactory.vaultsOf`), with a Create vault button that submits
`createVault()` and selects the new vault on confirmation. The demo vault
is badged DEMO with a plain line that its funds belong to the demo, and a
connected user with vaults lands on their first own vault unless a stored
choice says otherwise (selection persists in localStorage). The hero and
stat strip still show the demo vault. All panel writes take the selected
vault address; the data hook takes the vault address and scan start block
(demo: deploy block 3461010; own vaults: factory block 3488645) and carries
a generation guard so a scan started for one vault can never write another
vault's sessions after a switch. Deposit is owner-gated in the UI with a
demo-specific hint for non-owners. The grant form gained a three-item
warning box (lost key, wrong address, grants cannot be edited). The inline
revoke confirm was replaced by a custom pop-up: backdrop, session facts,
three consequences, Keep this key (focused) and Revoke key; it closes on
Escape, backdrop click, or a failed revoke so the error stays visible.

Verified with a Playwright script against the Pages export served locally
under `/Spendguard`, live RPC through a Node fetch proxy, and a mock
injected wallet: 41 checks pass across disconnected desktop, owner,
stranger, and 390px mobile runs. The owner run proved vault switching
(demo 2.65 tUSD8, own vault 0.50 tUSD8 with empty sessions), the modal
contents and Escape close, and the create-vault call (to the factory
address, bare `createVault()` selector `0x5d12928b`, nothing broadcast).
The stranger run proved deposit and grant gating. Zero horizontal overflow
and zero page errors in all four runs. Screenshots in `verification/`:
factory-desktop-disconnected, factory-owner-yourvault, factory-revoke-modal,
factory-mobile-bar, factory-mobile-modal.

Key names, quick amounts, and error wording round (18 Nov 2026, afternoon WAT)

The deposit form gained 20%, 50%, and Max quick amounts computed from the
wallet balance (exact base-unit math, no grouping in the filled value), and
its copy now states top-ups are unlimited. The grant form gained an optional
key-name field; the name appears in the review box, is saved to localStorage
when the grant is submitted (keyed by vault and key address), and shows in
the sessions list, in the revoke pop-up facts, and beside a Rename control
on each session card. Names live only in the browser, and the panel says so.
The sessions list is sorted most-spending first with a totals line (amount
spent across all keys) and a per-key share of all spending. The revoke
pop-up buttons are now equal width on desktop as well as mobile. The
vault-balance error is now concrete everywhere it appears: the pay panel
and the agent script pre-flight name the payment, the vault balance, and
the exact shortfall; the on-chain revert keeps its plain-language mapping.
The agent suite stays 88/88.

Verified with a Playwright script against the Pages export served locally
under `/Spendguard`, live RPC through a Node fetch proxy, and mock injected
wallets (owner and session-key holder): 14 checks pass, including exact
chip values from a 2.75 tUSD8 wallet, the grant review name row, the
0.65 tUSD8 / 3-key breakdown in most-spending order, rename persistence
across a reload, and the professional balance message with the 0.35 tUSD8
shortfall blocking the pay button. The 41-check factory suite was re-run
against this build with no regressions. Known pre-existing console error,
unchanged by this round: React hydration error #418 fires on a reload when
a wallet connection was persisted (wagmi restores the connected state
before hydration); React recovers client-side and every flow works.
Screenshot in `verification/`: factory-labels-sessions.
