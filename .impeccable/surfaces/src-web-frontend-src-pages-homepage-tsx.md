---
version: 1
slug: "src-web-frontend-src-pages-homepage-tsx"
primary_target: "src/web/frontend/src/pages/HomePage.tsx"
related_targets: []
---

## Direction contract (HIG alignment, Direction B, 2026-10-01; replaces the 2026-09-25 contracts)

THESIS: Home is "now": this month so far, what needs a look, and the next 7 days, on one naturally scrolling page at every size. It refuses the one-screen phone lenses, drill sheets and glow hero cards of the previous build.

OWN-WORLD: Direction B, as described in docs/design-language.md (Direction B sections) and docs/plans/2026-09-30-hig-alignment.md. Owners: NavBar (large title "Home"; trailing Add, plus the profile menu on a phone), SpectrumCard (the screen's one spectrum card: month spending against budget), ListGroup/ListRow, StatusDot, CategoryAvatar, CategoryDonut, TrendLine, CategoryChangeBarRow, Button, LoadFailed/RetryLink, Skeleton. There are no glow cards, mono eyebrows or gradient text.

STORY: The spectrum card shows the month's spending (with budget progress when an overall budget exists), and a qualifier line underneath gives its status and comparison. The groups are Needs a look (counts to Review or evidence, sources to Settings), This month (income, net flow, target), Where it went (the donut, where a selection shows merchants inline), Coming up (at most 3 charges in the next 7 days, then "See Plan"), Recently increased (when present), Recent (3 rows, then "See all" in Activity), Daily trend, and What changed (the strongest change, with the rest behind More context).

LAYOUT: Phone: one column in priority order (month, Needs a look, This month, Where it went, Coming up, Recent, Daily trend, What changed). The column wrappers use display: contents so each group takes its own order. lg+: a main column (month, Where it went, Daily trend, What changed) and a 22–24rem side column (Needs a look, This month, Coming up, Recent), within max-w-[1200px]. Content padding matches the large title's px-4.

VERIFIED: Playwright on iPhone 15, iPad landscape and a 1440px desktop, in light and dark, against the synthetic journey server (2026-10-01).
