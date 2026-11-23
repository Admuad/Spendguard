# SpendGuard submission readiness — criteria audit (18 Nov 2026)

Audited against the Starter Guide V4 (single source of truth): 7 weighted
criteria totalling 100, plus the §5 technical deliverables and pre-submit
checklist, as recorded in `~/workspace/aevum-prep/BUILD-BRIEF-2026-11-18.md`
§2, §3, §10.1–§10.3. Deadline: Fri 11 Dec 2026, 09:00 WAT. Target submit: 10 Dec.
Refreshed 18 Nov 2026 (afternoon WAT) for the factory model, the agent
script, and the factory UI. Refreshed again the same evening for cap
editing (`editSession`, redeploy), the usage indicator, and the
Claude-corrections mobile checklist.

Verdict scale: MET (evidence in hand) / MOSTLY MET (works, one gap) / GAP.

## Requirements checklist

| Requirement | Status | Evidence |
|---|---|---|
| Public GitHub repo, commits in-window | MET | Admuad/Spendguard, public, created 18 Nov 2026 03:15 UTC (cutoff: 16 Nov 06:00 UTC). All commits 18 Nov. Default branch main, MIT licence. Logged-out page check: HTTP 200, 18 Nov. |
| Aevum integration evidence | MET | Demo vault 0x048a64225419C11C9Ff0CB39aA925902c5e965Ac + factory 0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE on chain 44005 (second deployment: editSession build; the first deployment, vault 0x9a11… + factory 0x54c6…, was swept and retired), deploy tx + E2E + isolation + agent-run + live edit hashes recorded (see research_notes/spendguard-*-2026-11-18.md). Both contracts are verified on the explorer (22 Nov 2026, "Pass - Verified" via forge verify-contract, Blockscout verifier); evidence is repo + addresses + hashes + verified source. |
| Live deployment | MET | https://admuad.github.io/Spendguard/ live, real chain data, factory UI verified 390px + 1440px. |
| Demo video, 2–3 min, login-free link | MET | Video v11 is 1m55s, professional cut, captions, voiceover, factory + agent beats plus a real failure-mode segment (over-cap revert and revoked-key refusal, both with tx hashes), hosted on the project's own Pages site at https://admuad.github.io/Spendguard/spendguard-demo.mp4 and on YouTube (unlisted) at https://youtu.be/ZwRmUPXpKJ8, verified playing live through the Watch Demo button. Shows the current demo vault and says 56 tests. |
| Project documentation | MET | README (problem, architecture, workflows, tech, addresses, env specs, repro steps, Try it, roadmap), ARCHITECTURE.md, THREAT-MODEL.md v2.3, BRANDING.md, ui/VERIFICATION.md, agent/README.md, agent/AGENT-SECURITY.md. |
| No malicious code | MET | Nothing in the repo attacks the platform or other participants. |
| Build-fresh, testnet-only, test tokens only | MET | All code + deploys after the cutoff. Chain 44005 only. No tokens issued or promised (stated on the page and in the README). The 10 Nov ThrowawayCounter deploy predates the window and is NOT submission evidence. |
| No keys in repo/history | MET | Verified 18 Nov: only `.env.example` files with empty keys. Repo has secret scanning + push protection enabled. |

## Criteria

### C1. User Experience & Presentation — 15 — STRONG, two small gaps
- Vellure-style UI, mobile-verified (360/390/430px, light + dark, zero overflow), custom theme toggle, live dashboard, plain-language revert reasons, setup guide section, one-click wallet connection. Factory UI: vault bar with demo/own pills + Create vault, demo badging everywhere, own-vault default for connected users, owner-gated deposit, three grant warnings, custom revoke-confirmation pop-up (no toast). Edit affordance: bounds editable from the sessions list with a prefilled modal, cap floor at spent, and edit entries in the activity feed. Usage indicator: per-key spent-of-cap with percentage, bar, and share of all spending. Deposit quick amounts, browser-local key names. 41/41 factory regression checks (disconnected/owner/stranger/390px) + 14/14 labels/chips checks + all edit-flow checks + the Claude-corrections mobile checklist (360/390/430px + dark, zero overflow, 44px targets, bottom-sheet modals).
- Gap: wallet WRITE flows never click-tested with a real wallet (mock-wallet proof only; needs Muhammed's live click-through). Watch Demo now plays the hosted video.

### C2. Demo, clear and well-structured — 10 — MOSTLY MET
- Video v11: well-paced walkthrough of the core flow with real on-chain proof (3.00 deposited, grant cap 1.00, 0.10 paid by the LLM agent, vault 2.90, activity feed with tx hashes), the factory flow (create + switch vaults), the revoke pop-up, the LLM agent beat (live 0.10 payment, tx 0x96da9c30a0fa510bb57a04f1054e044dd8430b1b8e7c5369a233cb65925b71a4), and a failure-mode segment (over-cap CapExceeded revert and revoked-key SessionNotActive refusal, both with tx hashes); explorer links throughout the UI.
- Gaps: v11 shows the current demo vault, says 56 tests, and includes the over-cap and revoked-key reverts on camera with tx hashes. The non-allowlist revert is proven on-chain but not in the video; a nice-to-have, not a blocker.

### C3. Comprehensive documentation — 10 — STRONG
- README + ARCHITECTURE.md (flows, API examples, constraints, roadmap) + THREAT-MODEL.md v2.3 (19 invariants incl. INV-18 vault isolation and INV-19 edit semantics, 12 fuzz properties, 15 adversarial tests, accepted risks R-1..R-11 incl. pooled deposits within one vault) + BRANDING.md + VERIFICATION.md + agent README + AGENT-SECURITY.md (10 threats, controls, residual risks).
- Gap: ECOSYSTEM-FEEDBACK.md unwritten (C8, absent from the guide; low priority).

### C4. Innovation and originality — 20 (heaviest) — STRONG
- The missing-primitive positioning (no session-key SDK until Q1 2027, no factory/bundler/paymaster; SpendGuard implements it in plain Solidity, working today), the delegation-primitive framing, fork-verified token research that refuted the kit docs' claims, the per-user factory model (each user owns an isolated vault; no shared pool), editable session bounds that never reset spending (the cap can never drop below what a key has already spent), and the autonomous-agent beat: a runnable script holding ONLY a session key paid a merchant 0.10 tUSD8 on-chain while the owner watched, then had its session revoked. Distinct from starter-kit sample flows.

### C5. Technical quality and platform integration — 15 — STRONG
- 56/56 Foundry tests (43 unit/adversarial incl. T-1..T-15 + zero-owner + 13 edit tests + 12 factory isolation tests incl. edit isolation + invariant suite with a new edit action, 3,309 edit calls, 0 failures). OpenZeppelin 5.4.0 primitives, checks-effects-interactions, reentrancy guard, SafeERC20, Shanghai EVM pin, no proxies. Factory deploys full vaults (no clones/proxies). Idempotency via per-session `spent` accounting (a retried payment cannot double-spend past the cap). Agent script: 88/88 tests, narrow ABI (reads + executePayment only), chain guard, pre-flight checks, dry-run, idempotency ledger, env-only key storage (never in repo).
- Gap: no CI (no .github/workflows).

### C6. Real-world utility and market potential — 15 — GOOD
- Real deployed factory + demo vault, usable now with faucet tokens; any user can create their own vault in one click. Agent payments are Aevum's core thesis, and scoped delegation is the missing primitive for it. Roadmap covers multisig owner, timelocked large grants, clone-based factory gas optimisation, ERC-4337 migration when the SDK lands.
- Limit: each vault has a single EOA owner (R-1, accepted). The product is a primitive for builders and agents, not a managed service.

### C7. Safety, trust and controls — 15 — STRONG
- Threat model v2.2 with 18 invariants and 12 fuzz properties, all proven; fork-verified token behaviour (reverts, exact amounts, no fee/hooks/blacklist, EIP-3009 absent); verifiable receipts (explorer tx link per payment in the activity feed); pause freezes spending but never recovery; owner sweep works in every state; R-11 pooled-deposits-within-one-vault documented as an accepted risk with UI gating (deposit is owner-only in the UI). Owner is a single EOA per vault (R-1, accepted; roadmap: multisig).

## Vault model — verified from SpendGuard.sol + SpendGuardFactory.sol (read 18 Nov)

- FACTORY MODEL (Muhammed's call, 18 Nov). `SpendGuardFactory` creates one
  independent full-deployment vault per user; the caller of `createVault()`
  becomes that vault's owner. Vaults share nothing: no shared pool, no
  per-user ledger. The factory holds no funds, has no owner, no pause, no
  upgrade path, and cannot touch a vault after creation. Isolation proven
  by 11 tests and a live two-owner check.
- WITHIN ONE vault the model is single-owner pooled: `deposit()` is
  permissionless at contract level and there is NO per-depositor ledger.
  All deposits join that vault's pool; a stranger's deposit is spendable
  by owner-granted keys (up to their caps) or sweepable by the owner.
  This is accepted risk R-11, mitigated by UI gating (deposit panel is
  owner-only) and documented in THREAT-MODEL.md and the README.
- A session key can NEVER spend more than its remaining cap (cumulative
  check before transfer, `spent` updated in the same tx; INV-1, fuzz-proven).
  Only the vault owner grants, edits, revokes, pauses, unpauses, and sweeps.
  An edit re-specifies bounds while `spent` is preserved, the new cap must
  cover `spent`, and a revoked session can never be edited (INV-19).
- `ownerWithdraw()` sweeps the FULL balance at any time, even while paused
  (INV-4, by design: pause freezes spending, never recovery). The threat
  model states the owner is the trusted root of trust (R-1).
- The demo vault (0x048a…, second deployment) is the project's own vault,
  shown on the homepage and badged as a demo in the UI. The first demo
  vault (0x9a11…, pre-edit bytecode) was swept and retired. Users create
  their own vaults through the factory; the UI defaults connected users to
  their own vault.
- UI gating: Grant, Owner, and Deposit panels are owner-gated with clear
  non-owner messages; the revoke button is owner-only and opens a custom
  confirmation pop-up; the pay panel serves key holders and the contract
  enforces caller == key.

## Hosting — video link for the app + submission

- The Watch Demo modal uses a native `<video>` tag (`DEMO_VIDEO_URL` in
  `ui/src/lib/config.ts`, currently empty). It needs a DIRECT MP4 URL.
  YouTube/Vimeo/Loom watch pages will NOT play in it.
- Recommended: GitHub Release asset on Admuad/Spendguard (free, direct
  MP4, login-free, durable, same repo). Set `DEMO_VIDEO_URL` to the asset
  URL and redeploy the UI. Needs Muhammed's go-ahead for the public
  release (offered 18 Nov; unanswered).
- Also recommended: YouTube unlisted upload from Muhammed's own device
  for the DoraHacks form (the canonical format judges expect) and
  sharing. Do NOT sign his Google account in from the cloud browser
  (account-flag risk; see the Fiverr IP lesson).

## Pre-submit action list

Must-do:
1. Video v11 hosted on the site and on YouTube (unlisted, https://youtu.be/ZwRmUPXpKJ8); DEMO_VIDEO_URL set, modal verified playing. Done 21 Nov 2026.
2. Muhammed's live click-through of the write flows on the real site.
3. Fresh session grant near submission so judges see a live session
   (the demo session expires 19 Nov ~07:03 WAT; the vault balance stays).

Should-do:
4. Repo description + topics on GitHub.
5. CI workflow (forge test + UI build) — small, strengthens C5.

Done since the first audit: agent script + live run + video beat (was #2);
R-11 disclosure (was #3); deposit-panel owner-gate (was #5); factory
model + factory UI (was "out of scope", now shipped).

Dropped / not needed: ECOSYSTEM-FEEDBACK.md (C8 absent from the guide;
only if time remains).
