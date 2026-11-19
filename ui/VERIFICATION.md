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

## Cap editing round (18 Nov 2026, evening WAT)

`editSession` was added to SpendGuard.sol: the owner re-specifies a live
session's recipients, per-tx limit, cap, and expiry while `spent` is
preserved; the new cap must cover `spent` (`CapBelowSpent`, so
`remainingCap` can never underflow); the old allowlist is cleared before
the new one is set; grant validations are mirrored; an expired-but-active
session can be edited to extend its expiry; a revoked session can never
be edited. Every edit emits `SessionEdited`. THREAT-MODEL.md v2.3 records
the semantics as INV-19. The forge suite is 56/56 (43 unit incl. 13 edit
tests, 12 factory incl. edit isolation, invariant suite with an edit
action: 3,309 edit calls, 0 failures).

The contract change required a redeploy. New factory
0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE (block 3492970), new demo vault
0x048a64225419C11C9Ff0CB39aA925902c5e965Ac (block 3492987). The old demo
vault was swept (0 tUSD8) and retired; the new vault holds 3.00 tUSD8 and
the demo session (cap 1.00, per-tx 0.50, expiry 19 Nov ~13:58 WAT) was
re-granted. Editing was proven live twice on-chain (cap 1.00 to 1.50 and
back, remainingCap read back each time). The agent suite stays 88/88
against the new vault.

The UI gained an Edit bounds button on active sessions (owner only,
including expired-but-active), opening a prefilled modal: max per
payment, cap, recipients, and an expiry selector (keep current, +1 hour,
+24 hours, +7 days, +30 days). Problems are numbered, including the cap
floor at spent; the confirm box shows old to new for changed bounds; Save
is disabled when invalid or unchanged; on success the modal shows the
transaction status with a Done button. The grant warning now says bounds
can be edited later but the cap can never drop below spent, and the
activity feed shows `SessionEdited` entries. The sessions sort is spent
descending with active-first tie-breaking, and the own-vaults list
filters out the demo vault so it never appears as both Demo and Your
vault.

Verified with a Playwright script against the Pages export served locally
under `/Spendguard`, live RPC through a Node fetch proxy, and a mock
injected wallet: all edit checks pass, including the two real on-chain
edit entries in the activity feed, prefill values, the cap-floor and
max-exceeds-cap problems, the review box, exactly one intercepted
`eth_sendTransaction` with the `editSession` selector and the expected
calldata words, Escape close, and reset-on-reopen. The factory (41) and
labels/chips (14) suites were re-run against this build with no
regressions; three failures found during the re-run were diagnosed and
fixed (the demo/own vault duplication, the zero-spend sort tie, and a
test-side localStorage key casing bug).

## Usage indicator + Claude-corrections checklist round (18 Nov 2026, evening WAT)

Muhammed called the sessions usage display clean but lame, and directed
that every new UI feature be kept in check against Claude's corrections
(responsiveness, flow, smoothness, UI, mobile responsiveness). The
sessions usage display was rebuilt as a usage block: a head row (Spent X
of Y tUSD8, with the percentage of cap on the right, or "Cap reached" at
100%), a 10px bar (accent fill, danger at 100%, grey for revoked keys,
width transition kept, progressbar semantics kept), and a slimmer foot
row (Remaining, share of all spending, max per payment, expires). No
gradients; all colors are theme variables.

The checklist pass caught and fixed four real issues in the newest work:
(1) the mobile destructive styling for the Revoke button matched both
session buttons, so Edit bounds would have rendered full-width and red;
the danger styling is now scoped to Revoke only, both buttons stay
full-width 44px targets; (2) the deposit amount chips were ~34px tall,
now 44px; (3) the modal close button was 38px, now 44px; (4) at 360px the
connected Deposit panel overflowed the viewport by 28px: the nowrap
approve-button label forced the single-column grid track wider than its
container. Fixed with `minmax(0, 1fr)` on the mobile grid, `min-width: 0`
on panels, and wrapping full-width button labels on narrow screens.

Verified with a dedicated Playwright checklist script at 360/390/430px
(light) plus a dark pass at 390px, connected with a mock owner wallet:
all checks pass. Zero document overflow and zero overflowing elements
outside the by-design capabilities carousel at every width, exactly one
panel visible behind the segmented control, usage bars render at 10px,
both action buttons are 44px with Revoke destructive and Edit neutral,
the edit modal docks to the bottom edge as a bottom sheet (24px top
radius, square bottom), modal inputs compute to 16px, amount chips are
44px, the dark theme holds with a visible usage fill, and zero page
errors. The filled-bar rendering was checked visually against a temporary
local-only build pointed at the retired demo vault (the only vault with
spending history: 0.30 / 0.25 / 0.10 tUSD8); the temporary build was
discarded and the real build rebuilt. Screenshots in `verification/`:
factory-usage-mobile, factory-edit-modal-mobile, usage-filled-desktop,
usage-filled-mobile.

## Card placement round (18 Nov 2026, evening WAT)

Muhammed's second Claude review (partial response; his Claude usage
limit ran out mid-reply) diagnosed the dashboard from a screenshot:
the owner tile was orphaned with a hole beside it, the owner address
wrapped mid-string, tile footnotes wrapped to different line counts,
every tile had equal weight, and gaps/padding/radii did not follow one
scale. Claude's five fixes were implemented against the real class
names (his snippet guessed them from an earlier version of the code):

1. Orphan: at two-column widths the dashboard is now hero row, pair
   row, owner row. The owner is a compact full-width row (label left,
   address right). A `:last-child:nth-child(odd)` guard spans any lone
   last tile, so adding or removing a tile later can never orphan one.
2. Address: the owner value is 16px, nowrap, ellipsis, at every width.
   The old inline 22px style with `overflow-wrap: anywhere` is gone.
3. Same structure: every tile is label, value, one-line footnote
   (nowrap + ellipsis). The payments footnote was shortened to "All
   within caps" so it fits at 360px without truncating, and tile labels
   drop to 12px at 640px and below so "Payments executed" stays on one
   line.
4. Balance leads: the hero tile is full-width at two-column widths and
   has the larger value (34px desktop, 28px mobile). All tiles are flat
   fills with no border; only the outer card has an outline.
5. One scale: gaps and padding on the dashboard now use 8/12/16/24
   only (the 10px mobile gap, 14px/18px/20px paddings and 6px margins
   are gone). Outer card radius 24, tile radius 16.

Card audit (rest of the app): every card style was listed. The system
was already grouped, so no redesign was needed: outer cards
(panel, cap-card, bento-card, step-card, tab-panel, modal, stat-strip,
dash-card) at radius 24 with border + shadow; rows (tab-btn,
session-row, faq-item, net-banner) at 18; inner tiles (kpi,
empty-state, confirm-box, warn-box, modal-video) at 16; controls at
14; small chips at 12; hero gradient bands (stats-band, cta-banner) at
28 by design. Radii are now CSS variables (--radius-card/row/tile/
control/sm) so they cannot drift apart. The two 20px outliers
(about-stat, vault-bar) joined the 18px row family; the floating menu
keeps its own 20px and the tab-list keeps its 22px responsive override.
Padding drift (22/26/28/30/32px in a few sections) was left alone on
purpose: those sections are verified and liked as they are, and padding
changes would alter their look without a screenshot-driven reason.
Claude's full response, when it arrives, can propose padding changes
with before/after shots. The mobile redesign (bottom bar, segmented
control, one panel at a time) was not touched.

Verified with the dashboard screenshot script at 360/390/430px (light)
plus a dark pass at 390px and a desktop pass at 1440px, all against
live chain data: no orphan at any width, no wrapped address, all foots
on one line, hero leading, dark theme holding. Regression suites all
green: factory-verify, labels-chips-verify, edit-verify, and the
mobile Claude-corrections checklist. Screenshots in `verification/`:
dash-before-360/390/430/390-dark, dash-after-360/390/430/390-dark,
dash-after-1440.

## Step cards + vault bar round (18 Nov 2026, evening WAT)

Muhammed photographed two more card problems from his laptop. (1) In
"From zero to a working session" the cards in a row had different
heights, leaving dead space under the short ones. Cause: the cards sit
inside Reveal wrappers, which are the grid items; the wrappers
stretched to the row height but the cards inside sized to their
content. Fix: `.steps .step-card, .cap-grid .cap-card, .bento-grid
.bento-card { height: 100%; }`, so every card fills its wrapper. The
same fix covers the How-it-works cards and the capability/bento cards.
(2) In the vault bar, the Demo badge sat inside a run-on sentence and
the vault/owner addresses dangled at the end of it, wrapping
mid-address on narrow screens. Fix: the context is now a flex row with
the badge beside a text block (wrapped lines align with the text), the
addresses moved to their own smaller meta line, and each Vault/Owner
pair is nowrap so the line wraps between pairs, never mid-address. The
bar padding and row gap were also brought onto the 8/12/16/24 scale
(16/24px padding, 12px gap).

Verified with section screenshots at 1440/768/390px: step rows are
equal height at every width, the vault bar reads cleanly connected and
disconnected, and the meta line holds on one line at 390px. Regression
suites all green: factory-verify, labels-chips-verify, edit-verify,
and the mobile Claude-corrections checklist. Screenshots in
`verification/`: steps-after-1440/768/390, howitworks-after-1440,
vaultbar-after-1440/390, vaultbar-after-390-disconnected.

## App grid round (18 Nov 2026, evening WAT)

Muhammed reported the vault panels "flying around" after connecting a
wallet and creating a vault. Cause: `.app-grid` used `align-items:
start`, so each panel sized to its own content. Rows were ragged, and
every content change (connecting, forms enabling, warnings appearing,
sessions arriving) resized panels independently, so siblings shifted
on their own. Fix: `align-items: stretch`, so panels in a row share
one height and move together. The single-column mobile layout is
unaffected (stretch is a no-op there) and the load-bearing panel order
for the mobile segments is unchanged. Measured in the browser at
1440px: connected-owner row 1 both panels 1158px, row 2 both 395px;
disconnected rows both 336px. Regression suites all green:
factory-verify, labels-chips-verify, edit-verify, and the mobile
Claude-corrections checklist. Screenshots in `verification/`:
appgrid-after-1440-owner, appgrid-after-1440-disconnected.

## App page split (18 Nov 2026, evening WAT)

Muhammed rejected the stretch fix (empty space inside the short panel
just to match the tall one) and said he had expected users to manage
their vault on a separate page, not on the single landing page. So the
app split in two:

- Landing (`/`): pitch, live demo dashboard, capabilities, setup,
  how-it-works, FAQ, CTA. No vault panels.
- App (`/app/`): VaultApp only, navbar + footer chrome, selected
  vault persisted via the existing localStorage key, so the choice
  survives the page change.

Layout on the app page: two independent columns, no row coupling, no
forced heights. Left column Deposit, Pay, Owner; right column Grant
alone (the tallest form). Connected-owner columns measure 1196px vs
1158px at 1440px. Sessions sits below, full width. The mobile
single-panel view keys off `data-panel` on each slot instead of
nth-child order. The stretch rule is gone.

Static-export notes: without `trailingSlash`, Next exports the route
as `app.html`, which the local server and Pages resolve
unreliably, so the Pages build now sets `trailingSlash: true` and the
route is `/app/` (`out/app/index.html`). Internal links use
`APP_URL` from `lib/site.ts`. The navbar was hero-white (designed over
the dark hero); on the app page it takes `nav-on-light`, flipping
logo, links, wallet chip, theme toggle, and hamburger to theme
variables. Nav section links are pathname-aware: plain hashes on the
landing page, home-prefixed hashes from the app page.

Verification scripts that exercise the vault now point at
`/Spendguard/app/`: factory-verify, labels-chips-verify, edit-verify,
mobile-claude-check, plus the ad-hoc grant-debug, probe360/b,
usage-filled-screenshot, and modal-settled. dash-shots and the hero /
setup scripts stay on the landing page. Screenshots in
`verification/`: split-app-1440-owner-top/panels, split-app-1440-dark-top,
split-app-390-disconnected/menu, split-landing-1440-top.

## Nav overlap + menu theme round (18 Nov 2026, evening WAT)

Muhammed's phone screenshots of the live app page showed two faults.
First, the navbar overlapped the LIVE VAULTS eyebrow: the navbar is
absolute, and the mobile `.section` padding shrink (48px at <=640px)
pulled the first section up under it. The landing page never showed
this because the hero carries its own top clearance. Fix: `.section
.app-section { padding-top: 96px; }`, whose higher specificity
survives the mobile padding rules. Measured at 390/360px: nav bottom
72px, eyebrow top 97px. Second, the mobile menu was hardcoded dark
navy (`#020a1f`, white links) in both themes: a leftover of the
dark-hero design. It now follows the theme (`var(--surface)` panel,
`var(--text)` links, theme-mix hover), light in light mode and dark
in dark mode, still solid with the dimming backdrop. Screenshots in
`verification/`: navfix-app-390-top, navfix-app-390-menu-light/dark,
navfix-app-360-top, navfix-landing-390-menu-light. Mobile
Claude-checklist suite green.

## Feedback round 2 (19 Nov 2026, midday WAT)

Muhammed reviewed the restructured live site on his phone and sent six
items. All six are implemented, typechecked, built, verified with
`tools/pw-verify/round2-verify.mjs`, and pushed.

- Landing spacing: the hero-to-strip gap was an untuned 40px (inline
  `marginTop: 40` on the StatStrip wrapper, hero bottom padding 0).
  Now a `.stat-strip-wrap` class: 80px desktop, 64px mobile (measured
  56px at 390px after the strip's own -8px top margin).
- Dark theme: the old blue-black (`#070b14` bg, navy surfaces) is gone.
  Now premium neutral black: bg `#0a0a0a`, cards translucent white
  (`rgba(255,255,255,0.05/0.08/0.12)`), neutral borders/text, brand
  blue only in the accent. The dashboard card stays solid `#161616`
  in dark mode so no blue bleeds through from the hero gradient.
  Verified: body bg `rgb(10,10,10)`, card blue channel delta 0.
- Green Active badge removed from the vault header. Session status
  badges on key cards remain (per-key state).
- Read-only banner is text-only: its Connect button is gone (navbar
  already has one; the Settings owner panel keeps its own).
- Icons: every hand-drawn inline SVG replaced with Lucide
  (`lucide-react` 1.76.0). Tabs: LayoutDashboard / KeyRound /
  CreditCard / Activity / Settings. Capabilities: KeyRound /
  ShieldCheck / Ban / FileText. Menu/X, Sun/Moon, Play, ChevronDown,
  ArrowUpRight elsewhere. Only the keyhole brand logo stays
  hand-drawn. Verified: all 5 visible tab links render an SVG.
- Keys page grant gating: the grant section, the "+ Grant a key"
  button and the overview Grant link render only when the connected
  wallet owns the vault. A read-only demo-vault visitor sees none of
  them. Verified both ways (hidden disconnected, shown as owner).
- Activity speed: one shared localStorage log cache
  (`lib/vaultCache.ts`, per vault, raw logs + scanned tip) feeding the
  home dashboard, overview and activity page, plus 6-way concurrent
  chunk fetching for cold scans. Cold keys sessions: 3.8s (the old
  sequential scan timed out past 90s). Warm keys 0.9s, warm activity
  1.9s. Live session state is always re-read from the chain, so the
  cache can never show a stale spent amount or balance.

Screenshots in `verification/`: round2-390-landing-gap-light,
round2-390-landing-dark, round2-390-keys-readonly-light,
round2-390-settings-dark, round2-1440-landing-light.

## Green badges removal (19 Nov 2026, early afternoon WAT)

Follow-up to round 2: Muhammed asked for every green badge to go,
including the "Live on Aevum testnet" pill on the hero dashboard.
Removed: the hero Live pill (`Hero.tsx`), and the green "Active"
status badge on session rows (`VaultApp.tsx`) and overview key cards
(`Overview.tsx`). Non-active states (Revoked / Expired / Frozen) keep
their plain neutral badge; an active key now shows no badge. The amber
Paused badge is untouched (not green, and it signals vault state).
Verified: zero `.badge-live` elements on the landing, overview and
keys pages, no page errors. The `.badge-live` CSS rule remains defined
but unused.

## Feedback round 3 (19 Nov 2026, early afternoon WAT)

Two follow-ups from Muhammed, both from his phone screenshots of the
dark overview:

1. **Liquid-glass tab bar.** The bottom nav bar was transparent in dark
   mode because the round-2 dark theme made `--surface` translucent
   (5% white), so page text showed through behind the tab labels. Fix:
   the bar now uses its own theme-aware tint (`--tabbar-bg`: 72% white
   light / 55% near-black dark) with `backdrop-filter: blur(20px)
   saturate(180%)`, so content behind it reads as frosted glass.
   Toggling pages slides a glass pill between tabs: AppShell measures
   the active link's rect and positions an absolutely-placed indicator
   with a 0.45s springy easing (`cubic-bezier(0.22, 1, 0.36, 1)`),
   re-measured on route change, resize and font load, and disabled
   under `prefers-reduced-motion`.
2. **Compact icon action row.** The Deposit button dominated the card
   while being a dead end on the read-only demo vault, and Sweep sat at
   half width under it (the old <=760px two-column grid with Deposit
   spanning both columns). Now all vault controls share one compact
   row on mobile: icon above label, equal widths, 56px tall, whether
   two buttons show (Deposit + Sweep, read-only) or three (Deposit +
   Grant a key + Sweep, connected owner). Desktop keeps the longer
   row layout, now with icons too (ArrowDownToLine / KeyRound /
   ArrowUpFromLine, lucide).

Catch during verification: the desktop `.app-tab[aria-current]` rule
paints a solid accent pill for the desktop nav, and it also matched
the mobile tabs, so the active mobile tab rendered solid blue with a
blue-on-blue invisible label and the glass pill hidden behind it. The
mobile rule now sets `background: transparent` on the active tab, so
the pill shows through and the label reads. DOM checks alone passed
before this fix; the screenshot crop caught it.

Verify suite `~/workspace/tools/pw-verify/round3-verify.mjs`: 20/20
PASS (glass backdrop + tint, pill on Overview, pill glides to Keys,
read-only 2 buttons 154px equal, owner 3 buttons 100px equal, same
row, icons everywhere, desktop long row 138 vs 199 content-sized,
54px, no page errors anywhere).

Screenshots in `verification/`: round3-390-overview-dark-glass,
round3-390-overview-owner, round3-1440-overview (plus
round3-tabbar-crop2, the zoomed bar that confirmed the fix).

## Overview icon swap (19 Nov 2026, early afternoon WAT)

Muhammed still disliked the Overview tab icon (lucide
`LayoutDashboard`, the four-square grid). First tried `Vault` (a safe
with a dial, on-brand), but at 20px the dial's spokes read as an X in
a box, so it was rejected on the screenshot check before shipping.
Shipped `House` instead: a clean house outline, instantly readable at
tab size, consistent with the other four tab pictograms. The change
is one line in `AppShell.tsx` (`TABS`), so it covers both the mobile
tab bar and the desktop pill nav. Verified: typecheck + build clean,
icon SVG renders on the active tab, no page errors.

## Feedback round 4 (19 Nov 2026, early afternoon WAT)

Two more notes from Muhammed's phone, both about dark mode:

1. **Solid modal, no glass.** The Deposit modal sheet used
   `var(--surface)`, which is 5% white in the round-2 dark theme, so
   the sheet was nearly see-through and the blurred page ghosted
   through it; the backdrop also blurred the page behind. His rule:
   liquid glass is for small areas only (the tab bar); a big modal
   must be solid. Fix: new `--modal-bg` (white light, solid #161616
   dark, same solid as the dark dash-card) on `.modal`, and the
   backdrop is now a plain dim with no `backdrop-filter`. Light mode
   is unchanged (its surface was already solid white).
2. **Compact mobile hero.** The hero was tall on phones: 104px top
   padding, 36px headline, wide margins, dash card starting below the
   fold. Fix, all in the late <=640px block (which wins the cascade,
   so it is now the single source of truth for mobile hero type; the
   earlier <=420/<=480/<=360 h1 rules were dead): headline 36px to
   32px, line-height 1.15, h1 margin 28px to 20px, sub margin 22px to
   14px, CTA row margin 36px to 24px, hero top padding 104px to 92px,
   dash-card margin 40px to 32px. Headline now fits in 2 lines at 390
   and 360; the dash card starts 427px from the viewport top at 390.

Verify suite `~/workspace/tools/pw-verify/round4-verify.mjs`: 14/14
PASS (dark modal solid #161616 + no backdrop blur, light modal solid
white, hero 32px / 2 lines / no overflow at 390 and 360, no page
errors). Note: the first probe run failed with
ERR_CONNECTION_REFUSED because the local 4173 server had died after
/tmp was wiped; recreated `/tmp/serve/Spendguard` and restarted it.

Screenshots in `verification/`: round4-390-deposit-modal-dark,
round4-390-deposit-modal-light, round4-390-landing-dark,
round4-360-landing-dark.

## Feedback round 5: collapsible dashboard activity (19 Nov 2026)

Muhammed: the landing vault dashboard card is long; make it
collapsible, showing just one recent activity, expanding to the full
list on tap and collapsing back, with a smooth slide and no jump when
collapsing from the bottom of the list.

Implemented in `Hero.tsx`: the activity list is split into the latest
item (always shown) and the rest (items 2-5) inside a grid-rows
wrapper (`0fr` to `1fr`, 0.45s easing) with a "Show all activity" /
"Show less" toggle button under it (chevron rotates, `aria-expanded`
+ `aria-controls`). Default collapsed. No toggle when there is 0 or 1
activity. Hidden items leave the tab order via delayed `visibility`
so they stay visible during the slide and vanish once closed; the
first wrapped item keeps its top separator.

The no-jump requirement: collapsing while scrolled to the bottom
would let the browser clamp scrollY and jump the page. On collapse
the handler scrolls the window up exactly as much as the card
shrinks, frame by frame (rAF reading the live card height) over the
slide, so the toggle stays under the finger and everything below the
card stays in place. Reduced-motion users get the same compensation
applied instantly.

Verify suite `~/workspace/tools/pw-verify/round5-verify.mjs`: 10/10
PASS. Measured: card 656px collapsed to 1137px expanded; collapsing
from the bottom moved scrollY 1045 to 564 (exactly the 481px shrink)
while the toggle stayed at viewport top 398 before and after. Zero
jump. No page errors.

Screenshots in `verification/`: round5-390-landing-collapsed,
round5-390-landing-expanded.

## Feedback round 6: light-mode card separation + airy mobile hero (19 Nov 2026)

Two related notes from Muhammed's phone:

1. **Light-mode modules look like they touch.** The dashboard card
   and the stat strip below it are properly separated in dark mode
   but read as one slab in light mode. Measured: the gap is identical
   in both themes (56px rendered, 64px wrap margin minus the strip's
   -8px), so it is a contrast illusion, not a spacing bug: both cards
   are white on a white page and the faint #e5e7eb edge vanishes.
   Fix, light mode only (dark is fine as-is): both cards get a
   slightly stronger border (#d5d9df) and the strip a deeper shadow,
   so each reads as its own object on white.
2. **The top hero stack feels packed on mobile.** The eyebrow pill,
   headline, subtitle and CTAs are crammed into the first screen, a
   bad first impression. Fix, mobile only (late <=640px block): the
   headline drops 32px to 30px with looser line-height, the eyebrow
   shrinks to 11px, the mobile subtitle is cut to one sentence
   ("Deposit once, grant a key with a cap and an expiry, take it back
   in one click." — the on-chain line stays on desktop and is repeated
   in the capabilities section), and the gaps between the rows open up
   (h1 margin 20 to 24px, sub margin 14 to 18px, CTA row 24 to 28px).
   The dashboard card still starts on the first screen (406px at 390).

Note: a full overflow audit (`round6-overflow-audit.mjs`) run during
this round found the landing's capabilities carousel extending past
the viewport edge at 360/390 — that is the intended scroll-snap peek,
not a bug (document width stays 360/390, no page-level scroll). App
pages and the Deposit modal were clean at both widths.

Verify suite `~/workspace/tools/pw-verify/round6-verify.mjs`: 18/18
PASS (hero 30px / 2-line headline / 2-line sub / 11px eyebrow in
both themes, light borders #d5d9df + deeper strip shadow, dark
borders untouched, gap unchanged at 56px, no overflow, no errors).

Screenshots in `verification/`: round6-390-landing-light,
round6-390-landing-dark.

## Feedback round 7: theme toggle into the menu + connect styles (19 Nov 2026)

Muhammed: the top still feels packed; move the theme toggle into the
hamburger menu on mobile, and the Connect wallet button is too big,
maybe an icon, but an icon might be too small. Explore styles.

- **Toggle move (shipped):** the navbar toggle is wrapped in
  `.nav-theme` and hidden below 860px; the mobile menu gains an
  "Appearance" row with the same `ThemeToggle`. The toggle is styled
  for the dark hero navbar, so the menu row overrides it to theme
  colours (`--surface-2` background, `--border` border/track,
  `--text` thumb) or it would be white-on-white in light mode, where
  the menu is a white panel. Desktop is unchanged.
- **Connect styles (explored, then picked):** `ConnectButton` takes a
  `variant`: full (current 124px "Connect wallet"), compact (84px
  "Connect"), icon (44px square wallet icon), icon-text (108px wallet
  + "Connect"). All keep the 44px height, so the tap target never
  shrinks, only the width does. Explored on a temporary
  `/preview-nav/` route (deleted after the pick, never pushed).
  **Muhammed picked icon-text**; it is now the `Navbar` default.

Verify suites: `round7-verify.mjs` 24/24 PASS (toggle hidden, menu
row readable and flips the theme both ways, all four widths/heights,
no errors). `round7b-verify.mjs` 12/12 PASS on the shipped default
(icon + "Connect", 108px, 44px, both themes). Note: the first 7b run
timed out on the activity wait (slow cold-cache RPC scan) and the
typecheck showed a stale `.next/types` error from the deleted preview
route; both cleared on a clean rebuild, typecheck passes.

Screenshots in `verification/`: round7-nav-{full,compact,icon,
icon-text}-{dark,light}, round7-390-menu-{dark,light},
round7b-390-navbar-{dark,light}.

## Feedback round 8: solid mobile menu + our own 404 (19 Nov 2026)

1. **Dark-mode menu was see-through.** The mobile menu panel used
   `var(--surface)`, which is 5% white in the round-2 dark theme, so
   the hero bled straight through it. Fix: the panel now uses the
   dedicated `--mobile-menu-bg` (effectively solid both themes,
   rgba(10,10,10,0.97) dark / rgba(0,12,40,0.96) light). That
   variable had been defined since the Claude corrections but never
   wired up. The dimming backdrop behind the menu was already fine.
2. **Custom 404, our own, not GitHub's.** Muhammed was clear the
   GitHub 404 he mentioned was only an example; every site does its
   own. Ours (`app/not-found.tsx`, exported as `404.html`, which
   GitHub Pages serves for unknown paths): the vault door is the 0 in
   a giant 404, a key floats beside it on a slow bob, a dashed dial
   ring turns around the door, sparkles twinkle, and tapping the door
   makes the key shake itself loose with a "Nope, wrong key." bubble.
   Copy: "This key opens nothing." with Take me home / Open the app
   buttons. No wallet, no chain reads. Reduced-motion disables the
   float, spin, twinkle and shake.

Verify suite `~/workspace/tools/pw-verify/round8-verify.mjs`: 21/21
PASS (menu alpha 0.97 dark / 0.96 light, 404.html in the export with
the headline, 4-door-4, floating key, correct home/app links, no
overflow, door tap shows "Nope", no errors).

Screenshots in `verification/`: round8-390-menu-{dark,light},
round8-390-404-{dark,light}, round8-1440-404-dark.

## Feedback round 9: one uniform modal tone (19 Nov 2026)

Muhammed, on the Deposit modal in dark mode: the sheet's edge was
darker while the text area (and the close button) sat lighter, two
different blacks in one modal. Cause: the sheet was #161616 while the
close circle and the dashed connect box sat on translucent
--surface-2, which renders lighter on top of it. Fix: the dark sheet
is now a lighter black (#242424) and the close button and dashed box
inside any modal share the sheet's exact colour, so the whole modal
is one uniform tone; the dashed border still defines the box and the
ring still defines the close button. Scoped to `.modal` so empty
states on the dashboard and activity pages keep their subtle panel.
Light mode is unchanged (white sheet, white inner pieces).

Verify suite `~/workspace/tools/pw-verify/round9-verify.mjs`: 10/10
PASS (sheet, close and dashed box all exactly rgb(36,36,36) dark and
rgb(255,255,255) light; menu still solid both themes; no errors).
Round 8 re-run alongside: 21/21 PASS.

Screenshots in `verification/`: round9-390-deposit-modal-{dark,light}.

## Feedback round 10: the panel was the second gray (19 Nov 2026)

Muhammed was right to push back: round 9 still showed two grays in
the Deposit modal, a lighter rectangle hugging the title and paragraph
with its edge tight on the text. Pixel sampling of the round-9
screenshot proved it: the sheet was rgb(36,36,36) but the area behind
the title and paragraph was rgb(47,47,47). Cause: DepositPanel renders
its content in a `.panel`, whose background is translucent --surface
(5% white in dark mode, which composites to 47 over the #242424
sheet). The round-9 checks only measured .modal, .modal-close and
.empty-state, so they never saw the panel. Lesson: measure the render,
not the DOM. Fix: inside a modal, .panel and .recipient-chip share the
sheet's exact colour, and the panel's border and shadow are removed
(inside a modal the panel IS the content; its border would draw a
rectangle hugging the text). Only one modal exists in the app (Deposit).

Verify suite `~/workspace/tools/pw-verify/round10-verify.mjs`:
10/10 PASS (panel matches the sheet in both themes). Plus a pixel
scan `modal-pixel-scan.py` over the screenshots: dark sheet tone
86.2% of the modal, light sheet 90.6%, no second tone above 1.5%.
The scan caught its own bug first (it threw out the white sheet as
"light text" in light mode) and a false positive (light secondary
text #6b7280); both fixed by theme-aware text exclusion. The
owner-connected Deposit form state could not be verified: the mock
wallet connect timed out in the probe, so the form state is covered
by the same .panel rule only, not by a screenshot.

Screenshots in `verification/`: round10-390-deposit-modal-{dark,light}.

## Feedback round 10b: 404 polish (19 Nov 2026)

Muhammed on the 404: remove the floating sparkles and the glow; space
the 4s further from the vault door; the "not in this vault" copy was
wrong for a site-wide error page; keep the tap-the-vault tip. Done:
sparkles and glow deleted (and their keyframes); the 404 row gap is
6px to 18px; the sub now reads "The page you followed does not exist.
It may have moved, or the link was never quite right."; tapping the
door now rattles the door itself (a small keyhole shake) as well as
the key. The floating key, the spinning dial ring, the "Nope, wrong
key." bubble and the tip line stay.

Re-ran `round8-verify.mjs`: 21/21 PASS.

## Feedback round 10c: no wallet connect on the 404 (19 Nov 2026)

Muhammed: no wallet connection on a non-existent page. The 404 renders
its own Navbar, so a `hideConnect` prop was added to Navbar: it hides
both the desktop Connect button and the mobile menu's Connect wallet
button. The logo, links, hamburger and Appearance toggle stay. Verified
in the round-11 suite (see below).

## Feedback round 11: light-mode mobile menu was a dark slab (19 Nov 2026)

Muhammed's screenshot: switching to light mode left the mobile menu a
dark navy panel with the links unreadable. Cause: the light theme's
`--mobile-menu-bg` was `rgba(0, 12, 40, 0.96)`, a dark navy leftover,
while the links are dark text in light mode. Round 8 only verified the
panel's alpha (0.96), never its colour, so the regression shipped.
Fix: light `--mobile-menu-bg` is now `rgba(255, 255, 255, 0.97)`; dark
stays `rgba(10, 10, 10, 0.97)`.

Verify suite `~/workspace/tools/pw-verify/round11-verify.mjs`:
7/7 PASS. It reproduces the exact bug (dark menu open, flip to light
from the Appearance toggle inside the menu): the panel turns white and
the links read at 19.8:1 contrast. Cold-start light menu also 19.8:1.
Dark menu unchanged (dark panel, light links). 404 checks included: no
Connect button in the navbar and none in the mobile menu.

Screenshots in `verification/`: round11-390-menu-light-after-switch,
round11-390-menu-light, round11-390-404-light-menu.

## Feedback round 12: header redesign, Inline picked, DEMO badge removed (19 Nov 2026)

Muhammed: the top of the Overview page (the orange-boxed header: title +
badge + address line + full-width vault switcher) looked untidy; explore
cleaner options for mobile and desktop. Boundary: change ONLY the header,
nothing below it. Three variants were built in `AppShell.tsx` /
`globals.css` (`HeaderVariant = "current" | "compact" | "minimal" |
"inline"`) and previewed on a temporary `/preview-header/` route (real
Overview page, `?v=` picks the variant; never pushed, deleted after the
pick). First full-page screenshots were too tall to read on a phone, so
the choice was re-shown as viewport shots of the top of the page at full
mobile width.

Muhammed picked Inline and asked to remove the blue DEMO badge. Shipped:
AppShell default is now `inline` (title + address link, description
hidden, vault switcher borderless and transparent), and the `demo-badge`
is no longer rendered anywhere (the title still reads "Demo vault", and
the read-only banner still explains it). The other two variants stay in
the code, unused, in case he wants to compare again.

Verify suite `~/workspace/tools/pw-verify/header-live-check.mjs` on the
real /app/ page: 24/24 PASS (390 + 1440, light + dark: inline variant
present, zero `.demo-badge` elements, title "Demo vault", switcher
border transparent, no horizontal overflow, no page errors). Full audit
`app-audit.mjs` re-run after the change: ALL PASS (6 pages x light/dark
x 390/1440). Two check bugs found along the way, not product bugs: the
first screenshot run failed because the local static server on 4173 was
down (restarted), and the audit's activity wait used the landing page's
`.dash-activity .activity-item` selector, which does not exist on app
pages (the app feed uses `.feed-row`); both scripts are fixed. One
tooling note: `tsc --noEmit` once failed on a stale generated
`.next/types/validator.ts` after the preview route was deleted; a fresh
`next build` regenerates it and typecheck passes clean afterwards. Also
note: piping a command through `tail` masks its exit code, so a failing
typecheck can look like it passed; check the exit code directly.

Screenshots in `verification/`: header-live-{light,dark}-{390,1440}.

## Feedback round 13: Keys layout stacked, wallet waits for unlock, Vercel prepped (19 Nov 2026)

Muhammed: (1) on a fresh vault the Keys page showed two cards side by side,
the grant form about five times longer than the sessions list, with a big
blank area under the list. Measured live at 1440: grant form 1,297px vs an
empty sessions list 282px (4.6x); on the demo vault with 2 sessions it was
1,297px vs 877px. The Settings page has the same two-column pattern but its
cards are close (owner 395px vs 482px), so it was left alone. (2) With a
locked wallet, tapping Connect did nothing until he manually unlocked,
refreshed, and tapped again. (3) Prep the Vercel move.

Fixes. Keys is now a single column at every width: sessions on top, grant
form below capped at 720px, and the "+ Grant a key" jump button (previously
mobile-only) now shows on desktop too, so the form stays one tap away when
the list is long. The tablet media-query rules that restated the stacked
layout were removed as redundant. Wallet connect now goes through a shared
`useWalletConnect` hook (`ui/src/lib/walletConnect.ts`), used by all five
connect buttons (navbar, mobile menu, ConnectPrompt, mobile shared prompt,
mobile action bar): if no provider is present it waits instead of failing,
polling for `window.ethereum` and listening for `ethereum#initialized`, and
connects automatically the moment the wallet appears, no refresh needed.
After 60s with no provider it shows the existing friendly "no wallet
found" message. Still no WalletConnect and no API key. Vercel needs no
config change: `next.config.ts` already serves the default server build
with no base path when `DEPLOY_TARGET` is not `github-pages`; the exact
project settings (Root Directory `ui`, `NEXT_PUBLIC_SITE_URL`, no base
path) are now documented in `ui/README.md`. The demo video stays hosted
on GitHub Pages, so it works from either host.

Verify suite `~/workspace/tools/pw-verify/round13-verify.mjs`: 14/15 PASS
on the first run; the one failure was a probe bug (the 390 check ran
disconnected, where the jump button correctly does not render), re-checked
owner-connected at 390 in `keys390-owner.mjs`: jump button visible, grant
present, no overflow. Keys 1440 owner-connected: single column, grant
below the list, form capped at 720px, jump button visible, no overflow, no
page errors. Wallet wait: no provider, click shows "No wallet detected
yet" + "Waiting for wallet…", injecting the provider mid-session
auto-connects with no refresh. `tsc --noEmit` exit 0; Pages build exit 0;
plain `next build` (the Vercel build) exit 0.

Screenshots in `verification/`: round13-keys-1440, round13-keys-390,
round13-keys-390-owner, round13-wallet-wait-1440, twocard-settings-anon-1440,
twocard-keys-owner-1440, twocard-keys-fresh-1440.

## Round 14 — stress-test flaws fixed + theme default light + deposit success (19 Nov evening, LOCAL, not pushed)

Two real flaws from the 9-case stress test (script `~/workspace/tools/pw-verify/stress-robustness.mjs`), both fixed locally and verified. Everything else in the stress test held: theme toggle x10 on all 6 pages, tab switching x20, deposit modal open/close x10, mobile menu spam, grant form + revoke pop-up, resize 390-1440-390, reload with modal open. Vault switching was not testable (only one vault in the switcher).

**Flaw 1 — "Show all activity" expand shoved the toggle off-screen (390).** Expanding moved the toggle 398 to 878px (+480px, below the fold); collapse was already compensated (round 5) but expand was not. Fix (`Hero.tsx` `toggleActivity`): expand now mirrors the collapse compensation, a rAF loop that scrolls the window down exactly as much as the card grows, so the toggle stays under the finger. Verified (`flaw-fixes-verify.mjs` + `flaw1-rerun.mjs`): expand drift **-1px** (was +480), collapse drift **1px**, no page errors. Note: the first probe measured -545px because Playwright's click scrolled the toggle into view before the baseline was taken; re-measured after `scrollIntoViewIfNeeded`, drift -1px.

**Flaw 2 — dark theme lost on reload with a connected wallet.** Reload with a persisted wallet fired the known React #418 hydration mismatch; the recovery re-render dropped the `data-theme` attribute the init script set, so the page rendered light against a stored dark choice until the user toggled. Fix (`lib/theme.tsx` `ThemeProvider` mount effect): it now re-asserts the theme after mount, stored choice wins, otherwise keeps the element value, and writes `dataset.theme` + `colorScheme` + `theme-color`. Verified: before reload dark / `rgb(10, 10, 10)`; after reload still dark, same background, wallet still connected.

**Theme default light (his call, 19 Nov).** `THEME_INIT_SCRIPT` now defaults to light when nothing is stored (was `prefers-color-scheme: dark`); a stored choice still wins. Verified: fresh visitor with a dark OS gets light; stored dark still wins.

**Deposit success (proposal, awaiting his pick).** Built locally: `DepositSuccess` in `VaultApp.tsx`, `DepositPanel` `onDone` (optional; modal case closes, inline case resets the form), `Overview` passes the close, CSS in `globals.css`, temp preview route `preview-deposit-success` (delete before push). Typecheck exit 0, Pages build exit 0, preview verified 14/14 at 390 light + dark.

**Push status: nothing from this round is pushed yet.** The next push, after his deposit pick, ships: `lib/theme.tsx` (theme default + flaw 2), `components/Hero.tsx` (flaw 1), `components/VaultApp.tsx` + `components/app/Overview.tsx` + `globals.css` (deposit success), with the preview route deleted first.
