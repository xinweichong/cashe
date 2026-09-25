---
target: src/web/frontend/src (whole app)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/xinweichong/personal/cashe/src/web/frontend/src (whole app)"
timestamp: 2026-09-25T04-02-41Z
slug: src-web-frontend-src-whole-app
---
## Critique Report — cashe frontend (whole app)

**Method: dual-agent (A: a20de3282175680a1 · B: aeb12329d7d7faa9b)**

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Home models per-section fetch/error/retry well; classic surfaces mostly use one page-level query flag. |
| 2 | Match Between System and Real World | 4 | Copy is consistently plain and domain-appropriate; no jargon found. |
| 3 | User Control and Freedom | 3 | Dialogs/Cancel exist; no undo after delete anywhere sampled. |
| 4 | Consistency and Standards | 2 | Two parallel navigation/IA systems coexist; classic surfaces bypass the shared currency formatter and spectrum tokens. |
| 5 | Error Prevention | 3 | Client-side validation exists; no confirmation before deleting a budget/goal. |
| 6 | Recognition Rather Than Recall | 3 | Strong category/tint recognition; one page has inconsistent aria-labeling on sibling icon controls. |
| 7 | Flexibility and Efficiency of Use | 2 | A real CommandPalette exists (good), but budget/goal management is strictly one-row-at-a-time with no bulk path. |
| 8 | Aesthetic and Minimalist Design | 3 | The rationed-glow rule is genuinely held app-wide; docked for ad hoc four-branch Card composition on Overview. |
| 9 | Error Recovery | 3 | `LoadFailed` is a real, reused shared component; classic pages show coarser, page-level-only error states. |
| 10 | Help and Documentation | 1 | No contextual help/tooltips/docs entry point found anywhere sampled — defensible for a small-trusted-circle app, but still the honest score. |
| **Total** | | **27/40** | **Acceptable** — solid foundation; classic-surface drift is what's dragging Consistency and Efficiency down. |

### Design Specificity Verdict

**Authored, with an authorship gap between two eras of the codebase.** The spectrum palette, mono eyebrow labels, rationed-glow hero cards, and matter-of-fact voice ("Captured.", "Couldn't refresh. This briefing may be out of date.") are genuinely specific to cashe — no generic dashboard template reads this way. `HomePage.tsx` is a strong, idiomatic execution: every value flows through the currency formatter, every touch target hits 44px, states are handled per-section.

But the app runs two quality bars at once. The newer opt-in surfaces (Home, Plan, Explore, Activity) hold the design system's discipline; the six classic surfaces — still the default experience for anyone who hasn't flipped `home_briefing_enabled` — hardcode non-spectrum hex colors and bypass the shared currency formatter the system explicitly forbids bypassing. This isn't "could be any product's UI" — it's "this product's own design system, only half-applied."

**Deterministic scan**: `impeccable detect` ran clean (exit 2, no crash) against the full 148-file frontend source tree. It found exactly 2 hits, both the same rule (`bounce-easing`), both in `index.css` lines 78 and 80 — the `--ease-spring` and `--ease-bounce` custom-property definitions. Assessment B grepped the whole tree and confirmed neither token is consumed anywhere: these are dead tokens, not a bouncy animation actually visible on screen. Real finding, low real-world severity — worth deleting or wiring up, not worth alarm.

**Visual overlays**: not available this run. No browser automation tool was exposed in Assessment B's session (confirmed via tool search), so no live page was ever reached and no overlay was injected or should be claimed as visible. The dev server was started only to confirm the app is servable (HTTP 200), then stopped and cleaned up. This is a gap in this run's evidence, not a finding about the app.

### Overall Impression

cashe's design system is well-built and, where it's actually followed, produces a genuinely distinctive, restrained fintech interface. The problem isn't the system — it's that half the app doesn't use it. The classic surfaces (Overview, Analytics, Finance, Merchants) are still what most users see by default, and they're the ones breaking the two rules DESIGN.md states most emphatically: spectrum-not-stoplight color, and route-every-amount-through-the-formatter. The single biggest opportunity is closing that gap before the classic/new split calcifies further.

### What's Working

1. **`HomePage.tsx` as a reference implementation** — every money value through `formatMoney`, every retry scoped to what actually failed, every link preserving `returnTo` state. If the rest of the app matched this file, Consistency would score a 4, not a 2.
2. **The rationed-glow rule is actually held app-wide** — `HeroCard`/`HighlightCard` usage stays to one per screen almost everywhere sampled. This is a hard discipline to sustain across a whole app, and cashe sustains it.
3. **Real shared component owners exist and get used** — `ActivityRowShell`/`CategoryAvatar` render transaction rows identically across Home and Activity/Finance, exactly as the One Visual Owner Rule asks for.

### Priority Issues

**[P1] Hardcoded non-spectrum status colors break the Spectrum-Not-Stoplight rule**
- **What**: `OverviewPage.tsx` (lines 114–117, `HealthScoreCard`) and `AnalyticsPage.tsx` (lines 128–131, 194–197) hardcode `#30D158`/`#64D2FF`/`#FFD60A`/`#FF453A` — iOS system green/blue/yellow/red — as a 4-tier health/budget ramp. Three of those four hexes appear nowhere else in the design system.
- **Why it matters**: this is DESIGN.md's most load-bearing rule ("Status is never red/yellow/green... position along the spectrum is the semantic unit"), broken in duplicate on the two pages most responsible for communicating financial status.
- **Fix**: route through the existing `getBudgetTone`/`getGoalTone` spectrum-mapping utilities (`lib/utils.ts`) already used correctly in `FinancePage.tsx`'s `BudgetRow`, instead of a parallel undocumented color scale.
- **Suggested command**: `/impeccable harden` (token-compliance pass), or `/impeccable audit`

**[P1] `toFixed()` + `"$"` string concatenation bypasses the shared currency formatter, concentrated in FinancePage.tsx**
- **What**: 15+ instances in `FinancePage.tsx` (lines 37, 42, 47, 111–112, 116–117, 212, 419, 423–424, 444, 524, 776, 920–921) plus one in `MerchantsPage.tsx:103`, despite `formatCurrency`/`formatMoney` existing and being used correctly elsewhere (Home, `ActivityRowShell`).
- **Why it matters**: DESIGN.md's first named Do-rule, violated hardest on the page showing the most financially consequential numbers (savings, budgets, goals) — these values won't localize and silently drift from every other surface's formatting.
- **Fix**: sweep `FinancePage.tsx` and the one `MerchantsPage.tsx` instance to use `formatCurrency`/`formatMoney`.
- **Suggested command**: `/impeccable harden`

**[P1] Two parallel navigation/IA systems coexist, and the newer one is measurably more polished than the one shown by default**
- **What**: `AppShell.tsx` branches its entire sidebar/tabs/palette on `newExperience` (sourced from `home_briefing_enabled`) — a structurally different nav set, not a theme toggle. The two P1s above both live on the "classic" side, which is direct evidence the two systems have already drifted apart in quality.
- **Why it matters**: for a small-trusted-audience app, sustaining two IA systems doubles the maintenance surface for exactly this kind of token/formatter drift, and undercuts Product Principle #4 ("two front doors, one truth") within the web dashboard itself.
- **Fix**: treat this as a migration in progress — bring classic-surface component quality up to Home's bar (the two P1s above), then set a sunset timeline, or explicitly document why both must persist long-term.
- **Suggested command**: `/impeccable audit` (scope: classic-vs-new parity), then `/impeccable polish`

**[P2] Destructive budget/goal deletion has no confirmation or undo**
- **What**: `FinancePage.tsx`'s `BudgetRow` (line 103) fires `onDelete(b.id)` directly on click — no confirm dialog, no undo toast — despite `Dialog` already being used elsewhere in the same file.
- **Why it matters**: a budget/goal represents real planning effort in a personal finance app; one misclick loses it permanently.
- **Fix**: wrap the delete in a `Dialog` confirm, or a toast with an undo action inside its 3s window.
- **Suggested command**: `/impeccable harden`

**[P2] Inconsistent aria-labeling on sibling icon-only controls within the same page**
- **What**: `OverviewPage.tsx`'s period-navigation chevrons (lines 308, 315) — the page's primary control — have no `aria-label`, while the transaction-pager icons 200 lines down (550–565) correctly carry one.
- **Why it matters**: a screen-reader user gets a labeled secondary control and a silent primary one on the same page — worse than if neither were labeled, since it reads as accidental rather than deliberate.
- **Fix**: add `aria-label="Previous period"`/`"Next period"`, matching the existing pattern already correct further down the same file.
- **Suggested command**: `/impeccable harden`

### Persona Red Flags

**Alex (Power User)**: a real `CommandPalette` exists — genuinely good, most dashboards skip this. But budget/goal editing in `FinancePage.tsx` is strictly one-row-at-a-time with no bulk path or keyboard shortcut; adjusting 8 budgets after a raise means 8 separate round trips. Tolerable today, irritating the first time it's actually needed.

**Sam (Accessibility-Dependent User)**: confirmed red flag — `OverviewPage.tsx`'s unlabeled period-navigation chevrons sit on the page that is still the default landing screen for any user who hasn't opted into the new experience. A VoiceOver user lands there first and can't tell what flanks "Today." Counter-evidence: focus rings and `aria-live` toasts are real, consistently-implemented system rules elsewhere — this isn't a broadly hostile app, just inconsistently finished.

**Jordan (First-Timer)**: Home's empty-state copy ("Your captured purchases will appear here. Add a transaction or connect a source to begin.") is a genuine win. But Overview's Health Score empty state gives no cue at all about what the adjacent unlabeled chevrons do — Jordan gets quietly lost specifically on the classic default screen, not on Home.

### Minor Observations

- `OverviewPage.tsx`'s `HealthScoreCard` renders four structurally different `<Card>` branches instead of one component owning its own state — exactly the ad hoc composition the One Visual Owner Rule exists to prevent from spreading.
- No shared `EmptyState` component exists in `components/ui/` — every empty message is a one-off `<p>`. Fine at current scale; worth naming before tone starts diverging.
- `MerchantsPage.tsx:103` concatenates `$${...toFixed(0)}` while the file elsewhere imports `formatSGD` from `lib/merchants.ts` — the correct formatter was one import away.
- `card.tsx`'s `CardTitle` (`text-2xl`, no `font-display`) is unused outside `StatCard.tsx` — a live foot-gun for the next page that reaches for it directly.
- Two dead CSS tokens (`--ease-spring`, `--ease-bounce` in `index.css` lines 78/80) are defined but never consumed anywhere in the tree — flagged by the detector, confirmed unused by grep. Delete or wire them up.

### Questions to Consider

- If the new experience is where the design-system discipline actually lives now, is `home_briefing_enabled` still meant to be optional — or has the classic IA quietly become the deprecated path nobody's told it's deprecated?
- The same four iOS-style hex values appear copy-pasted into two separate files — is there a mockup reference these came from that a spectrum-token grep would surface more instances of?
- For a product whose entire pitch is "your money, fully owned, no surprises," does silent, irreversible budget/goal deletion match that promise?
