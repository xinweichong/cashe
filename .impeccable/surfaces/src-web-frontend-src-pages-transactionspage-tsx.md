---
version: 1
slug: "src-web-frontend-src-pages-transactionspage-tsx"
primary_target: "src/web/frontend/src/pages/TransactionsPage.tsx"
related_targets: []
---

## Direction contract (HIG alignment, Direction B, 2026-10-01; replaces the 2026-09-25 contracts)

THESIS: Activity is "the past": every recorded transaction, newest first, grouped by day. It's a list with a detail, built on ListDetail. On a phone a transaction is a pushed page; on md+ it sits beside the list. It refuses the one-screen phone lenses, the week glance card and the overlaid SlideOver.

OWN-WORLD: Direction B. Owners:
- NavBar (large "Activity"; trailing Select, Add, and the profile menu on a phone)
- Toolbar/ToolbarAction (multi-select "N selected · Category · Type · Done"; the detail's Edit/Delete on md+)
- SegmentedChoice (All / Review n / Income / Refunds)
- TaskSheet (Filters, Add, Category, Type, Delete confirmation)
- TransactionList (each day is a section header with its shared-fact total, above an inset group)
- ActivityRowShell (the Direction B row)
- SwipeRow (Category leading, Delete trailing with in-row confirmation)
- RowMenu (Open, Change category, Delete)
- ListGroup/ListRow, ListDetail, useStackBack

There's no spectrum card on Activity.

DETAIL: The phone gets a pushed page with the NavBar: "‹ Activity" and Edit. While editing or confirming a delete, Cancel takes the back button's place and Save or Delete sits on the right. Delete is a destructive row at the foot of the page. On md+ a Toolbar shows Edit · Delete. The identity hero is centred: avatar, mono amount, merchant · category · type. ⌫ on the md+ list opens the Delete confirmation, and Esc closes the detail.

PRESERVED: URL-held filters, the scroll anchor, shared-fact day totals withheld while filters narrow the rows, bulk revisions and undo, returnTo-aware closing, and focus return to the opened row.

VERIFIED: Playwright on iPhone 15 (dark and light), iPad landscape and a 1440px desktop, against the synthetic journey server (2026-10-01). The checks covered the list, an open detail and the Filters sheet.
