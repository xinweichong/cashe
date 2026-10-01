---
version: 1
slug: "src-web-frontend-src-pages-planpage-tsx"
primary_target: "src/web/frontend/src/pages/PlanPage.tsx"
related_targets: []
---

## Direction contract (HIG alignment, Direction B, 2026-10-01; replaces the 2026-09-25 contracts)

THESIS: Plan is "the future": this month's projection, upcoming estimated charges, and the budgets, goals, subscriptions and trips that shape them, on one naturally scrolling page at every size. It refuses the one-screen phone lenses, the drill sheets and the overlaid SlideOver.

OWN-WORLD: Direction B. Owners:
- NavBar (large "Plan"; the profile menu on a phone)
- SpectrumCard (the screen's one spectrum card: the month's projection with pace against the target; recorded-so-far when history is short)
- ListGroup/ListRow ("This month": saved and upcoming this week; savings)
- SegmentedChoice (the 14/30/90-day window)
- PageCard and SelectableRow in their grouped-list forms (budgets, goals, subscriptions, trips, recurring)
- The month calendar, or a week strip on smaller screens (teal selected day)
- ListDetail variant="inspector" with DetailHeader

DETAIL: Subscription, budget, goal, trip and charge details are pushed pages on a phone ("‹ Plan") and an inspector column on md+ (Toolbar with Done). With room, charges show their meta, estimate edit and dismissal inline. On a phone each charge is a row that opens its own page.

PRESERVED: URL-held window, page, date and calendar state; pagination; day inspection across page boundaries; estimate edit, dismiss and focus return; every projection qualification (insufficient history, likely range, unpriced commitments, unresolved conversions, calculation notes).

VERIFIED: Playwright on iPhone 15, iPad landscape and a 1440px desktop, against the synthetic journey server with an overall budget, a goal and a subscription seeded (2026-10-01).
