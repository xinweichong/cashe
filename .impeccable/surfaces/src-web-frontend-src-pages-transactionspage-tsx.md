---
version: 1
slug: "src-web-frontend-src-pages-transactionspage-tsx"
primary_target: "src/web/frontend/src/pages/TransactionsPage.tsx"
related_targets: []
---

Scope: /activity on phones (< 768px). Mode: Operate. Job: see this week at a glance, then find or fix a purchase without typing much.

## Phone direction contract (< 768px only; md+ unchanged)

THESIS: One screen: a week glance, the purchase list as the single lens panel (it scrolls inside its card; the page never does), type lenses and a search dock in the thumb band.

OWN-WORLD: The Spectrum Instrument, with the shared owners PhoneScreen (with its dock slot), DrillSheet and TransactionList.

STORY: The glance gives this week's spend and a review count that jumps to the Review lens. Lenses (All, Review, Income, Refunds) write the same type and review filters as the desktop chips. Filters open in a DrillSheet, and Add opens the form in a DrillSheet. The transaction detail slides over the tab.

FIRST VIEWPORT: A HeroCard showing "This week" (amount, purchase count, Select and Add icons), then the list panel, the lens bar, and the search input with the Filters button above BottomTabs.

FORM: act-lens (user pick, decision page 2026-09-26), mirroring the Home phone pattern (seed 568c139f).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
