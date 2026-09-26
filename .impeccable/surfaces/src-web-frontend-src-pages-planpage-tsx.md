---
version: 1
slug: "src-web-frontend-src-pages-planpage-tsx"
primary_target: "src/web/frontend/src/pages/PlanPage.tsx"
related_targets: []
---

Scope: `/plan` (merges the former `/plan` timeline and `/plan/manage` Finance page into one route; `/plan/manage` and `/finance` become redirects). Mode: Operate. Audience: the operator and trusted users planning ahead — what's about to be charged, and the standing budgets/goals/subscriptions/trips that shape it. Job: see the whole financial-planning picture in one place and act on any part of it without leaving the page. Constraints: existing component owners (StatCard, PageCard, HeroCard, ProgressBar, Badge, Switch, SelectableRow, CardLink); budgets/goals/subscriptions/trips/recurring each independently toggle off in Settings; subscription/budget/goal/trip mutations keep their existing API contracts; deep links like `/plan/manage?subscription=X` (from Explore's Recurring charges) must keep working.

## Direction contract

THESIS: Plan is a dashboard, not a landing page for a hidden management screen: the whole planning surface — timeline, budgets, goals, subscriptions, trips — sits in one full-width view. It refuses the narrow single-column report with everything but the calendar buried behind a "manage" link one click away.

OWN-WORLD: cashe's Spectrum Instrument unchanged: near-black ink cards with 1px borders, teal→coral spectrum for budget/goal tone, one warm-glow hero, Plus Jakarta titles, mono eyebrows, tabular mono money. Full content width (max-w-[1600px]) matching Explore, not the old max-w-4xl report column.

STORY: the visitor sees this month's projected spend and how it's tracking, then a calendar and the upcoming-charge timeline for the window they pick. Scrolling down, budgets, savings/goals, subscriptions, recurring charges and trips sit as compact live cards side by side — never a click to a separate page. Clicking any item (a budget, a goal, a subscription, a trip) opens a shared right-side detail panel to edit, contribute, pause or dig into history, mirroring the transaction detail panel's interaction.

FIRST VIEWPORT: Desktop, full content width. Row 1, 4-col pulse band: double-width warm-glow hero "This month's projection" (projected total + recorded/scheduled/remaining composition bar), then "Saved this month" (teal), then "Upcoming this week" (mint). Row 2, 12-col: left 4 = month calendar; right 8 = "Upcoming timeline" agenda list with total and pagination. Row 3: "Budgets, goals, subscriptions & trips" heading over a 2-column bento (no tabs — everything visible at once): left column = Budgets, Subscriptions, Recurring; right column = Savings + Goals, Trips, each a PageCard of compact summary rows. Phone: hero 2-up, calendar collapses to week strip + toggle, bento stacks to one column.

FORM: shaped directly from the user's explicit direction (merge Plan + Finance into one Explore-style dashboard, panel-based editing) plus two confirming questions; no concept-seed roll — a precisely specified request extending the just-shipped Explore precedent. Signature interaction: every compact row (budget, goal, subscription, trip) opens the same right-side sliding detail panel in place, its identity held in the URL, consistent across all four domains.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Phone direction contract (< 768px only; md+ unchanged)

THESIS: One screen that never scrolls. The glance sits on top, one lens panel fills the middle, and the lens bar sits above BottomTabs, following the Home phone contract.

OWN-WORLD: The Spectrum Instrument, with the shared owners PhoneScreen, LensBar and DrillSheet.

STORY: Glance first, lens for depth, and a drill-in for any row, with back returning to the overview.

FIRST VIEWPORT: Glance: ProjectionGlance (projected total, composition bar, one-line legend). Lenses: Soon (next charges, rows open a charge DrillSheet with ChargeActions; the footer opens a Timeline DrillSheet holding the week strip, month calendar and paged agenda), then Budgets, Goals (Savings + Goals), Subs (Subscriptions + Recurring) and Trips, each only when enabled, as bare lenses whose own PageCards stretch to fill. Budget/goal/subscription/trip rows open the existing detail panel.

FORM: plan-lens (user pick, decision page 2026-09-26). Mirrors the Home phone pattern (seed 568c139f).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
