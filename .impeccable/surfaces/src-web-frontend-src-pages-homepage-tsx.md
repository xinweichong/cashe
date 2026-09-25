---
version: 1
slug: "src-web-frontend-src-pages-homepage-tsx"
primary_target: "src/web/frontend/src/pages/HomePage.tsx"
related_targets: []
---

## Direction contract

THESIS: Home is a full-width dashboard led by the category mix. It uses Explore's 12-column container, and every row is a band whose cards stretch to equal height, so no column trails empty space. It refuses the centered max-w-6xl column and the tall stacked hero card of the previous build.

OWN-WORLD: The existing Spectrum Instrument system, unchanged: teal→coral spectrum, Plus Jakarta / Inter / JetBrains Mono, flat bordered cards with a single rationed warm (or coral when over target) hero glow. Owners are HeroCard, HeroAmount, StatCard (linked via CardLink), Badge, StatusDot, Button, PageCard, ActivityRowShell, CategoryDonut, TrendLine and CategoryChangeBarRow. There are no new tokens or variants; CategoryDonut gains only a layout option for placing the legend beside the chart.

STORY: The visitor sees the month's total and its shape (donut beside a ranked legend) in one short card, with income, net flow and target as linked tiles to its right. The trend and the biggest change sit in the next band, and the things to act on (upcoming charges, attention items, recent activity) sit in the last band.

FIRST VIEWPORT: Container `p-4 md:p-6 max-w-[1600px]`, header (Home / "Where the dollars go." / Add). Row 1, lg 12 cols, stretched: HeroCard "Where it went" (8 cols) holding the amount, change and target badges, status line, and the comparison line plus its date range, then the donut on the left with the ranked legend on the right. Column of three StatCards (4 cols) stretched to the hero's height: Income, Net flow, Target. Row 2: Daily trend (8) | What changed (4). Row 3: Coming up | Needs attention | Recent activity (4 each).

FORM: "Mix-led, compacted", chosen by the user off the layout decision page (options: mix-compact, pulse-first, main-rail); refines seed 338a3ba6's "Where It Went, led by the mix".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Phone direction contract (< 768px only; md+ keeps the contract above untouched)

THESIS: On a phone, Home is one screen that never scrolls: a fixed glance on top, one swappable lens panel, and lens controls in the thumb band. Detail slides in from the right and slides back. It refuses the stacked desktop band reflowed into a 2,700px column.

OWN-WORLD: The Spectrum Instrument unchanged. The new shared owners are PhoneScreen (a viewport-height flex column), LensBar (Radix Tabs in the thumb band, 44px+ triggers, teal active treatment) and DrillSheet (a full-width right sheet with a back row, edge-drag dismiss and a light haptic on open). Everything else reuses HeroCard, HeroAmount, CategoryDonut (compact size), TrendLine, ActivityRowShell, StatusDot and Badge.

STORY: The visitor sees the month's spend, its change and the category mix at once. Lenses (Month, Trend, Changed, Soon, Recent) swap one panel in place. Any row, category or "more" opens a DrillSheet, and a back swipe returns to the glance.

FIRST VIEWPORT: 390x844 phone. A slim header row (as-of date, attention pill, Add icon). A compact warm HeroCard (amount, badges, 112px donut beside a top-4 legend). The flex-1 lens panel. The LensBar just above BottomTabs. The lens is held in the URL (?lens=). As built: the header row's attention pill and Add icon live in the HeroCard's action slot, and the period goes in the hero title ("1–10 Sept"), so the phone keeps AppShell's own top bar and gains no extra row. The legend shows the top 3 because 4 rows at 44px would outgrow the 112px ring and leave the lens panel under 200px on a 667px phone.

FORM: "Glance + thumb lenses", dealt structure #4 (THE ROLL), seed key 568c139f, locked by the user on the decision page, code-led. Signature interaction: the lens swap is an in-place crossfade and slide, and the DrillSheet uses an edge-drag back.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
