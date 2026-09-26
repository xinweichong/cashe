# Baseline audit — increment 1 of the design-language restoration

Status: increment 1 of `2026-09-16-cashe-design-language-restoration.md`. Source-verified findings only; no application code changed by this document.

## Scope and method

This increment was scoped to computed typography/radii audit, a fixture/state matrix, and route capture planning. Route screenshots and performance traces require a running app plus browser automation, which this session does not have access to (no Playwright/screenshot tool configured). Those two items are recorded as remaining work at the end of this document rather than claimed as done.

Everything below was verified by reading the actual CSS/theme source and component code, not inferred from the design-language document alone.

## 1. Typography scale: documented vs. actual computed size

`src/index.css` `@theme` only overrides `--text-2xs` (0.6875rem = 11px). Every other `text-*` size falls through to Tailwind v4's built-in default scale (`node_modules/tailwindcss/theme.css`), which the codebase never overrides.

| Token | Tailwind v4 default (actual) | `docs/design-language.md` §3.2 (documented) | Match? |
|---|---:|---:|:---:|
| `text-2xs` | 11px (custom override) | 11px | ✅ |
| `text-xs` | 12px | 12px | ✅ |
| `text-sm` | 14px | 14px | ✅ |
| `text-base` | 16px | 16px | ✅ |
| `text-lg` | 18px | 20px | ❌ |
| `text-xl` | 20px | 25px | ❌ |
| `text-2xl` | 24px | 31px | ❌ |
| `text-3xl` | 30px | 39px | ❌ |
| `text-4xl` | 36px | 49px | ❌ |
| `text-5xl` | 48px | 61px | ❌ |
| `text-6xl` | 60px | 77px | ❌ |

Every size above `text-base` is wrong. This is worse than the plan's finding #4 implied ("does not establish the documented size by itself") — it isn't a rounding gap, it's every large numeric/heading size rendering 15–22% smaller than the design language specifies, compounding at the top of the scale (hero numerics at `text-6xl` render 60px against a documented 77px). Any component relying on `text-2xl`/`text-3xl` for stat values or hero amounts is currently undersized.

**Fix required in increment 3 (or earlier, as a foundation step):** add the missing `--text-lg` through `--text-6xl` (and matching `--text-*--line-height`) overrides to the `@theme` block in `src/index.css`, mirroring the `--text-2xs` pattern already there.

## 2. Radii: tokens are correct, component usage is not

`--theme` radius tokens match the documented role scale exactly:

| Token | Value | Documented role | Match? |
|---|---:|---|:---:|
| `--radius-xs` | 4px | Small tags | ✅ |
| `--radius-sm` | 6px | Buttons, inputs, segmented controls | ✅ |
| `--radius-md` | 8px | Ordinary cards, menus, popovers | ✅ |
| `--radius-lg` | 14px | Stat cards, grouped content panels | ✅ |
| `--radius-2xl` | 24px | Hero cards, large modal containers | ✅ |
| `--radius-pill` | 9999px | Badges, status pills, bar tracks | ✅ |

The tokens are right; `Card` (`src/components/ui/card.tsx:12`) is wrong. It hard-codes `rounded-lg border border-border bg-card text-card-foreground shadow-sm`. Because `--radius-lg` was redefined to 14px in `@theme`, Tailwind's `rounded-lg` utility now resolves to the **stat-card/grouped-panel radius (14px)**, not the **ordinary-card radius (8px)** the design language specifies for `Card`. Every plain `Card` in the app (which is most cards — Overview, Analytics, Finance, Settings, the new Home/Plan/Explore pages) is rendering at the wrong role's radius.

`shadow-sm` is Tailwind's own default box-shadow utility, not either of the documented `--shadow-elev-xs`/`--shadow-elev-md` tokens defined in `@theme`. `Card` bypasses the documented elevation system entirely.

**Fix required in increment 3:** change `Card`'s base class to `rounded-md` (or a semantic token class) and `shadow-elev-xs` (or equivalent utility) so ordinary cards match the documented 8px/border-only role, without touching `--radius-lg` itself (which is correctly used elsewhere for stat/grouped panels).

## 3. Badge has no `tone` concept at all

`src/components/ui/badge.tsx` defines only `variant`: `default | secondary | destructive | outline`, via a single `cva()` call with `defaultVariants: { variant: "default" }`. There is no `tone` prop, no spectrum tint/border/text mapping (`saved/calm/active/notable/warm`), and nothing resolving the "13% tint, 25% border, theme-resolved text" contract from the plan's shared-primitive table.

This confirms the plan's finding directly: any current "status" styling on badge-like elements is done ad hoc per call site (verified by absence — no `tone` references exist in the component), not through a shared primitive. `StatusDot.tsx` does not exist in `src/components/` at all (confirmed via file search).

**Fix required in increment 3/4:** add a `tone` variant to `badgeVariants` that explicitly suppresses `variant`'s default styling (per the plan's CVA precedence warning), plus the new `StatusDot` primitive.

## 4. Shell wash is conditionally applied, confirmed

`AppShell.tsx:19`:
```tsx
<div className={`min-h-screen flex ${newExperience ? 'experience-next bg-background' : ''}`}
     style={newExperience ? undefined : { background: B2_WASH }}>
```
`B2_WASH` (`src/components/ui/Brand.tsx`) is only applied via inline `style` when `newExperience` is `false`. When `newExperience` is `true` (the flag is `settings?.home_briefing_enabled`, wired in `App.tsx:130`), the shell falls back to flat `bg-background` and an `experience-next` class that does not itself reintroduce the wash. This matches the plan's finding #1 exactly: the new-experience shell has no atmospheric background at all right now, confirmed at the source line rather than assumed.

**Fix required in increment 3:** give `experience-next` (or an equivalent theme-aware treatment) its own wash definition instead of relying on the inline `style` fallback, with light/dark-specific opacity per the plan's geometry section.

## 5. `PageCard` truncates long titles

`PageCard` is used across every page (`Overview`, `Analytics`, `Finance`, `Settings`, `Merchants`, `Evidence`, `Review`, `Plan`, `Home`, `ExplorePatterns`, `Subscriptions`) — 11 call sites confirmed by grep. The plan's finding #7 (title uses `truncate`) affects every one of those pages' card headings, not just Explore; Explore's longer natural-language questions will be the most visibly broken but this is a shared-component fix, not a page-local one.

## 6. Fixture/state matrix (planning artifact for increment 2+)

This is the state matrix increment 2's prototype and increment 8's rendered-matrix review should exercise per page. It restates the plan's §8 rendered-matrix axes as concrete per-page states so fixture data can be built against it directly:

| Page | Populated | Empty | Partial/indicative | Loading | Background-refresh failure | Initial failure |
|---|---|---|---|---|---|---|
| Home | Month with spend, target, comparison | New account, zero transactions | Missing income, unresolved-currency txns | Shape-matched skeleton | Stale data + compact notice | `LoadFailed` |
| Explore (Over time/By category/By merchant/Recurring) | Each mode with data | Mode with no matching records | Trip overlap, missing weekday coverage | Per-mode skeleton | Cached chart + stale notice, other modes unaffected | Mode-local `LoadFailed`, other modes still switchable |
| Plan | Forecast available, agenda populated | No pending charges | Uncertain schedule, unknown charge amount | Skeleton hero + agenda | Stale agenda + notice | Unavailable-projection explanation (not zero) |
| Activity | List + detail | No transactions match filters | Legacy amount-fallback row | List/detail skeleton | n/a (list is source of truth) | `LoadFailed` |
| Evidence | Records for range/category/merchant | No supporting records | Excluded-record count > 0 | Skeleton rows | Stale + notice | `LoadFailed` |
| Review | Pending items across categories | Nothing to review | Mixed duplicate/refund/recurring items | Skeleton rows | n/a | `LoadFailed` |

Cross-cut states every page must also demonstrate per §8: light/dark/system-change-mid-draft, 375–1440px width band including narrow tablet split view, 200% zoom, normal/reduced motion, and cold/delayed/disconnected network.

## 7. Not done in this increment — explicitly deferred

- **Route screenshot captures** (light/dark, all breakpoints, new + legacy reference pages) — needs a running dev server plus browser automation (Playwright or equivalent), not available in this session's toolset. Recommend running this via the project's `run` skill or a Playwright script in the next working session before increment 2's prototype review.
- **Performance baseline** (cold/cached load traces, bundle sizes, layout shift, scroll/edit traces) — same dependency; also needs a representative dataset and device/network profile per §6, which requires a decision on what "representative" means for this app before it's worth capturing.

Both are exit-gate requirements for increment 1 per the plan's table ("Both themes captured for new screens and legacy reference screens; specific gaps recorded"). This document satisfies the "specific gaps recorded" half; the capture half is outstanding and should not be marked done.
