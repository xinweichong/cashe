# Archived: classic navigation fork (2026-09-25)

`home_briefing_enabled` used to be a runtime toggle (Settings → Feature Toggles → "New experience")
that switched the whole app between two navigation systems:

- **Classic**: Overview / Transactions / Analytics / Merchants / Finance / Settings in the sidebar,
  bare `/transactions`, `/analytics`, `/merchants`, `/finance` URLs rendering their pages directly.
- **New experience**: Home / Activity / Plan / Explore, with those same bare URLs redirecting to
  their new-experience equivalents via `LegacyRedirect`.

As of this archive, the new experience is the only supported navigation. The toggle and its
branching were removed from `src/web/frontend/src`, and this folder preserves the **original,
both-branches version** of every file that contained that branching, for reference or rollback.

## What's here

Exact copies of the six files that mixed classic and new-experience logic, as they were
immediately before this change (path mirrors `src/web/frontend/src/`):

- `App.tsx` — route table; classic routes rendered pages directly, new-experience routes redirected via `LegacyRedirect`.
- `components/layout/AppShell.tsx` — took a `newExperience` prop, switched shell background/class and passed the prop down.
- `components/layout/Sidebar.tsx` — showed a 4-item classic list (Overview/Transactions/Analytics/Merchants) + separate Finance/Settings links, or the 4-item `MAIN_DESTINATIONS` list, based on the prop.
- `components/layout/BottomTabs.tsx` — same idea, 6-item classic `TABS` vs `MAIN_DESTINATIONS`.
- `components/CommandPalette.tsx` — 6-item classic `PAGES` vs `MAIN_DESTINATIONS` + Settings, and branched the "Add transaction"/merchant navigation targets.
- `pages/SettingsPage.tsx` — included the "New experience" toggle row in Feature Toggles that drove all of the above.

**Note:** `AnalyticsPage.tsx`, `FinancePage.tsx`, `MerchantsPage.tsx`, `TransactionsPage.tsx`, and
`OverviewPage.tsx` are **not archived** — they were never classic-only. Each one is still rendered
directly by the current app (`AnalyticsPage` at `/explore/insights`, `FinancePage` at `/plan/manage`,
`MerchantsPage` at `/explore/merchants`, `TransactionsPage` at `/activity`, `OverviewPage` at the
permanent `/overview` comparison route) — only the *classic bare-URL* rendering of them was removed,
via the `LegacyRedirect` changes in `App.tsx`.

## To restore classic navigation

The full history of how these files evolved from this point is still in git (`git log`), which is
the more precise way to restore a later state. To restore *this exact snapshot* instead: copy each
file here back over its counterpart in `src/web/frontend/src/`, re-add the `home_briefing_enabled`
toggle row to `SettingsPage.tsx`'s Feature Toggles list, and re-add the `newExperience`
branch-on-settings logic in `App.tsx` (index route, `AppShell` prop, and the four bare-URL routes).
The backend setting itself (`src/web/app.py`, `app_settings` table key `home_briefing_enabled`) was
left in place and untouched, so no backend change is needed to restore.
