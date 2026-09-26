# Archived: classic Overview page (2026-09-26)

`/overview` was the last page left over from the classic navigation (see
`../legacy-classic-navigation-2026-09-25/`). Nothing in the app linked to it any
more, so it was removed from `src/web/frontend/src` and `/overview` now
redirects to Home (`/`).

## What's here

Paths mirror `src/web/frontend/src/`:

- `pages/OverviewPage.tsx` — the page itself (period chips, summary/balance
  cards, trend and by-category charts, its own health-score card).
- `hooks/usePeriod.ts` — the day/week/month period state only this page used.
- `hooks/useCategories.ts` — the file **as it was before** the page's summary,
  trend and balance hooks (`useSummaryV2`, `useTrendV2`,
  `useTrendByCategoryV2`, `useBalanceV2`, plus the unused v1 `useSummary`,
  `useTrend`, `useTrendByCategory`, `useBalance`, `useInsights`) were removed.
- `lib/animations.tsx` — the file **as it was before** `AnimatedCurrency`
  (used only by this page) was removed.

The e2e check `classic Overview trend view switch is a labelled tab set`
(`e2e/visual/tabs-production.spec.ts`) was removed with it.

To restore: copy the files back, re-add the `lazyRoute` import and the
`<Route path="overview">` element in `App.tsx`, and restore the API client
methods the hooks call (`getSummaryV2`, `getTrendV2`, `getTrendByCategoryV2`,
`getBalanceV2`) and their backend routes if they have since been removed.
