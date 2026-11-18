# SpendGuard brand rules

The brand in one line: **a key that can only spend a little.** Everything
visual serves that idea: protection, bounds, and one-click control. No
decoration that does not earn its place.

## The mark

A shield holding a session key. The key's teeth are three ascending steps,
the three bounds every session carries: per-transaction cap, total spend
cap, expiry. The shield is the vault; the steps are the limits.

Files:

| File | Use |
| --- | --- |
| `ui/public/brand/logo-mark.svg` | The mark, all sizes 24px and up |
| `ui/public/favicon.svg` | Simplified mark (solid staircase block) for 16–32px |
| `ui/src/components/Logo.tsx` | The same artwork as a React component (`LogoMark`, `LogoLockup`) |

The SVG file and the React component are the same artwork. Change one,
change the other, and re-render the PNG derivatives.

**Clear space.** Keep at least one quarter of the mark's height empty on all
sides. Nothing enters that space: no text, no rules, no other logos.

**Minimum sizes.** Mark: 24px on screens. Lockup: 120px wide. Below 24px,
use the simplified favicon artwork only, never the full mark.

**Lockup.** Mark + the wordmark "SpendGuard" in Inter Tight 600, tracking
−0.02em, one word, capital S and G. The wordmark is always live text in the
brand font, never baked into an image, so it stays crisp at every size.

**Don't:** recolor the shield, rotate the mark, stretch it, add a drop
shadow to the mark itself, put it on a busy image, outline it, or pair it
with another typeface in the lockup. The gradient always runs light
top-left to deep bottom-right.

## Color

| Role | Hex | Use |
| --- | --- | --- |
| Accent | `#0346FF` | Primary buttons, links, focus rings |
| Accent deep | `#0046C3` | Hover states, secondary blue |
| Electric | `#2384FF` | Gradient start, dark-theme accents |
| Navy 900 | `#00081D` | Hero top, dark surfaces, app-icon base |
| Navy 800 | `#000A23` | Hero gradient, dark backgrounds |
| Navy 700 | `#002C90` | Hero gradient mid, mark gradient end |
| Page | `#FFFFFF` | Light background |
| Surface soft | `#F5F6F8` | Cards, dashboard sub-cards |
| Pill | `#F2F2F2` | Eyebrow pills, chips |
| Border | `#E5E7EB` | 1px card borders |
| Text | `#0A0A0A` | Primary text (light) |
| Text 2 | `#6B7280` | Secondary text (light) |
| Success | `#15803D` | Live/verified states (light) |
| Danger | `#DC2626` | Destructive actions, errors (light) |
| Warning | `#B45309` | Cautions (light) |

**Dark theme.** Background `#070B14`, surfaces `#0E1526` / `#131C31` /
`#1A2540`, text `#F1F5F9`, secondary `#94A3B8`, borders `#1E2A44`. The
accent stays `#0346FF`; success/danger/warning lighten (`#4ADE80`,
`#F87171`) so they hold contrast on dark.

**Hero gradient.** `#00081D` → `#00133F` → `#002C90` → `#0346FF`, ending in
pale `#FAFAFA` where the dashboard card overlaps. The mark gradient is the
short form: `#2384FF` → `#0346FF` → `#002C90`, top-left to bottom-right.

**Don't:** introduce new hues. Green means live/verified, red means
destructive/error, amber means caution — never decorative. Never use the
accent for body text.

## Typography

**Inter Tight**, self-hosted variable font (SIL OFL 1.1, `ui/src/app/fonts/`,
weights 100–900 in one file). Vellure's typeface is Neue Montreal, a
commercial font; Inter Tight was picked by rendering four free candidates
side by side against the Vellure hero and choosing the closest match. The
app loads no font from any outside service.

| Use | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Hero headline | 72px (40px ≤768px, 34px ≤420px) | 500 | −0.02em |
| Section titles | 44px | 500 | −0.02em |
| Card titles | 20px | 600 | normal |
| Body | 16–18px | 400 | normal |
| Buttons | 16px | 500 | normal |
| Eyebrows | 12.5px, uppercase | 500 | +0.08em |
| KPI numbers | 30–34px | 600 | −0.02em |
| Addresses / hashes | 15px, monospace stack | 400 | normal |

Headlines are medium weight, never bold. The premium feel comes from the
500 weight plus tight tracking at large sizes, not from heavier strokes.
Body copy stays at 400. Never set headlines in 700.

**Fallback stack** (if the font file ever fails): `"Inter", system-ui,
-apple-system, "Segoe UI", Roboto, sans-serif`. Monospace stack for
addresses and hashes: `ui-monospace, "SF Mono", Menlo, monospace`.

## Voice

Plain, direct, human. Say what the contract enforces, not what the
interface hopes. Every number on the page is a real number from the
contract, the tests, or the repo — never a placeholder, never rounded into
a claim. No em dashes in X/social copy; em dashes are fine in page copy.

## Components

- Buttons are full pills (999px radius), 54px tall, 16px medium text.
- Cards: 20–24px radius, 1px `#E5E7EB` border, soft shadow, 28–32px padding.
- The dashboard card overlaps the hero gradient and carries the live state.
- Theme toggle is custom, labeled Light/Dark, and persists the choice.
- Motion: scroll-reveal fade/slide-up, staggered cards, count-up stats,
  smooth-scroll anchors. Motion never blocks content; reduced-motion
  disables it.

## Link previews and icons

- OG image: `ui/public/og-image.png`, 1200×630, brand gradient, mark,
  headline, three bound chips. Re-render from the source layout if the
  headline or brand changes.
- Favicon: SVG (simplified mark) + 32px PNG fallback, both transparent.
- Apple touch icon: 180×180, opaque gradient tile, mark at 60%.
- App icons: 192×192 and 512×512, same tile; 512 doubles as the maskable
  icon. Manifest uses relative paths so it works under any base path.
- `theme-color`: `#FFFFFF` light, `#00081D` dark.
- `robots.txt` and `sitemap.xml` live in `ui/public/` and name the
  canonical GitHub Pages URL.

## Files index

- `ui/public/brand/logo-mark.svg` — mark
- `ui/public/favicon.svg`, `ui/public/favicon-32.png` — favicons
- `ui/public/apple-touch-icon.png`, `ui/public/icon-192.png`,
  `ui/public/icon-512.png` — app icons
- `ui/public/og-image.png` — link preview
- `ui/public/manifest.webmanifest`, `ui/public/robots.txt`,
  `ui/public/sitemap.xml` — discoverability
- `ui/src/app/fonts/inter-tight-latin.woff2` + `OFL.txt` — brand font
- `ui/src/components/Logo.tsx` — mark and lockup components
