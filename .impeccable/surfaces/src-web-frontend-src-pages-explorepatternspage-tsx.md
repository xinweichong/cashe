---
version: 1
slug: "src-web-frontend-src-pages-explorepatternspage-tsx"
primary_target: "src/web/frontend/src/pages/ExplorePatternsPage.tsx"
related_targets: []
---

# Explore surface brief

Scope: `/explore` (index). Mode: Operate. Audience: the operator and trusted users checking where their money went this month and whether anything needs a look. Job: glance at the month in one viewport, then drill into a pattern and on to evidence. Constraints: shared spending facts only (partial/indicative status visible), existing component owners (StatCard, PageCard, ChartCard, HighlightCard, Tabs, ActivityRowShell, Badge, ChoiceChip), optional LLM degrades to nothing. `/explore/insights` redirects here.

## Direction contract

THESIS: Explore is a dashboard, not a report: a pulse band answers "how is this month going" at a glance, and patterns sit below as full-width chart groups behind mode tabs. It refuses the stacked single-column question list and the sub-tab split between "patterns" and "insights".

OWN-WORLD: cashe's Spectrum Instrument unchanged: near-black ink cards with 1px borders, category colours on every chart/dot/row tint, teal→coral spectrum for tone, one warm-glow hero stat, one teal-glow health highlight, Plus Jakarta titles, mono eyebrows, tabular mono money.

STORY: The visitor sees month-to-date spend, the change against the same days last month, income and net flow, and the biggest mover; reads a short AI note if enabled; spots unusual charges and new merchants; sees a financial health score with its five pillars; then switches modes to explore trends, categories, merchants and recurring charges, each linking to evidence.

FIRST VIEWPORT: Desktop, full content width. Row 1 on 4 cols: a double-width warm-glow hero "Spent this month" (HeroAmount + running-total sparkline), then "vs. last month" and "Income"; every tile is a CardLink to its evidence. Row 2 on 12 cols, both columns equal height: left 7 = AI daily read above a three-row "Worth a look" summary; right 5 = "Biggest mover" tile above a score-only Financial health summary. The summaries open /explore/signals and /explore/health. Row 3: "Patterns" heading and mode tabs, with the active mode's first chart card starting inside a 1440x900 first screen. Phone: hero full width, vs./income 2-up, then everything stacked.

FORM: Pulse band + bento modes, dealt structure #3 of 7 (THE ROLL), seed key 9112bef3. Signature interaction: mode tabs swap full-width bento groups in place (URL-held), and every tile, pattern row, bar and signal links to its evidence (whole-card CardLink approved by the user 2026-09-25).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Phone direction contract (< 768px only; md+ unchanged)

THESIS: One screen that never scrolls. The glance sits on top, one lens panel fills the middle, and the lens bar sits above BottomTabs, following the Home phone contract.

OWN-WORLD: The Spectrum Instrument, with the shared owners PhoneScreen, LensBar and DrillSheet.

STORY: Glance first, lens for depth, and a drill-in for any row, with back returning to the overview.

FIRST VIEWPORT: Glance: ExploreGlance (month-to-date spend, change vs last month, Worth a look and Health as one-tap links to /explore/signals and /explore/health). Lenses: Time, Category, Merchant, Week, one card each (Spending over time with three chips plus More; Where it went; Top merchants; Your usual week), with secondary views (Today's read, Income and spending, What changed, What drove it, Most visited, Trip impact) as LensMore rows opening DrillSheets. Recurring costs moved to Plan's Subs lens (critique 2026-09-26). A desktop ?mode= link lands on its lens. The page header is sr-only on the phone index.

FORM: exp-lens (user pick, decision page 2026-09-26). Mirrors the Home phone pattern (seed 568c139f).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
