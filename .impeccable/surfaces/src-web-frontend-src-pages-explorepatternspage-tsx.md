---
version: 1
slug: "src-web-frontend-src-pages-explorepatternspage-tsx"
primary_target: "src/web/frontend/src/pages/ExplorePatternsPage.tsx"
related_targets: []
---

## Direction contract (HIG alignment, Direction B, 2026-10-01; replaces the 2026-09-25 contracts)

THESIS: Explore is patterns. On a phone the index is a Health-app-style summary list. Each section is a row with a small preview that opens its own pushed page (?section=). With room, the full dashboard shows everything at once. It refuses the one-screen phone lenses, drill sheets, the warm-glow spent hero and the teal-glow health card.

OWN-WORLD: Direction B. Owners:
- NavBar (large "Explore" on the index; signals and health are pushed pages back to Explore; Merchants carries its own bar)
- HealthSpectrum (the screen's one spectrum card: health score and grade, linking to /explore/health)
- ListGroup/ListRow (the phone summary: daily read, Worth a look, Patterns with a six-month sparkline and a category-mix bar)
- StatCard pulse tiles (spent, vs last month, income, biggest mover; plain labels)
- PageCard sections, Tabs pattern modes, ListDetail (phone sections; Merchants as a split view with MerchantProfile behind DetailHeader)

LAYOUT md+: health card (5 cols, its own height) beside four pulse tiles (7 cols); the daily read and Worth a look share a flex row (Worth a look takes the row when there's no read); then Patterns in Over time / By category / By merchant / Recurring, and trip impact.

PHONE SECTIONS: read (DailyReadCard); time (spending over time, income vs spending, your usual week); category (where it went, what changed, what drove it); merchant (ranking, most visited, All merchants); recurring; trip.

VERIFIED: Playwright on iPhone 15 (summary and the By category section), a 1440px desktop dashboard, and iPad Merchants with an open profile, against the synthetic journey server (2026-10-01).
