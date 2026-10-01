# cashe — Apple HIG alignment (v3.1.0)

**Status:** agreed 2026-09-30 in a grilling session. Nothing is built yet. Implementation waits on approval of the component page (see [Sequence](#sequence)).
**Replaces:** [2026-09-17 production experience polish](2026-09-17-cashe-production-experience-polish.md). Its findings that are still open are carried forward [below](#carried-forward-from-the-polish-plan).
**Rendered directions:** https://claude.ai/artifact/D2HHnzK84ofd72cufCavyB (private). Direction B and the Explore phone renders are the approved references.
**Source guidance:** [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines): Layout, Tab bars, Sidebars, Split views, Lists and tables, Sheets, Materials, Typography, Color, Motion, Accessibility, and the macOS pointer and keyboard conventions.

## Goal

Make cashe feel as clean and smooth as a native iOS/iPadOS/macOS app on phone, tablet and desktop, without giving up the cashe brand. We adopt the HIG's **structure and behaviour**: navigation, lists, sheets, gestures, motion and text scaling. We do **not** imitate its look. No SF font and no Apple system colours. The cashe spectrum remains the brand.

## Scope

Every web surface:
- Home, Activity, Plan (timeline and `/plan/manage`), Explore (dashboard, signals, health, merchants)
- Profile, Settings, Review, Evidence
- Login, SetPassword, Onboarding, WalletCredential
- the **admin panel**, with the full treatment, not only tokens

Telegram, the API and storage are out of scope. The redesign changes no data or API contracts.

This project also absorbs the open findings from the [2026-09-25 mobile critique](../../.impeccable/critique/2026-09-25T16-56-00Z__src-web-frontend-src-pages.md), which scored 25/40. Status as of 2026-09-30, after v3.0.0:

| Critique finding | Status | Resolved here by |
|---|---|---|
| Text below 11px | Done (`text-2xs` = 11px) | The rem/200% text rule below keeps it fixed |
| Explore lenses stack as a feed | Partly done (one dashboard, still stacks on phone) | Explore phone summary list |
| Three slide-in systems (`DrillSheet`, `SlideOver`, `ui/sheet`) | Open. Activity and Plan still use both | Slide-in navigation stack plus one sheet |
| No tap feedback | Mostly open (about 7 `active:` sites) | Pressed state on every tappable element |
| No swipe gestures on rows | Open | Swipe actions plus context menu |
| Tab overlap (Soon 14d vs Plan range, Recent vs Activity, etc.) | Unverified | One time focus per tab |

## Visual direction: B (Wallet)

Direction B is adopted in full.

- **Theme:** follows the device setting. Light and dark get equal polish. Dark stays on the ink background (`#0B0B14` family), not pure black.
- **Spectrum card:** at most one per screen, and only at the top of a tab's main screen.
  - Home: this month's spending against budget.
  - Plan: estimated charges for the month and budget pace.
  - Explore: the health score.
  - Activity, detail pages, Settings, Review, admin: none, only grouped lists.
  - Login keeps its existing full-strength brand wash, as the one brand moment before sign-in.
- **Glow and wash:** the `elev-glow-*` tiers and the B2 app-shell wash become a faint radial wash that shows only through frosted chrome. Content surfaces are flat.
- **Frosted chrome:** the phone tab bar is a floating frosted capsule. The iPad/desktop sidebar is a frosted inset panel. When `backdrop-filter` is unsupported, or `prefers-reduced-transparency: reduce` is set, both fall back to solid `card` fills using `@supports`. No device detection.
- **Type:**
  - Plus Jakarta Sans for large titles, section titles and hero numbers.
  - Inter for body and controls.
  - JetBrains Mono **only for money amounts**. Mono eyebrow labels, IDs and stat labels move to Inter.
- **Section headers:** title-case Plus Jakarta headings above grouped lists, as rendered. They replace the mono uppercase kickers.
- **Selection:** a teal fill with on-brand text, for sidebar items and the selected list row.
- **Geometry:** grouped lists use an 18pt radius and the spectrum hero card 22pt. Rows have hairline separators inset to the text start. Category avatars are circular.
- **Semantics unchanged:** the spectrum still encodes intensity (cool = saved/on track, warm = spending/over). `destructive` stays reserved for delete/stop.

## Structure and behaviour

### Phone (<768px)

- **Tab bar:** Home, Activity, Plan, Explore. Tab labels stay a fixed size at large text settings, matching iOS.
- **Large titles:** each tab's main screen has a large title that collapses into an inline top bar on scroll. This uses CSS scroll-driven animation where supported. Elsewhere the title simply scrolls away.
- **Details slide in:** details (transaction, merchant, subscription, Explore section) open as their own page with a back button, a browser history entry and a slide transition. They replace `DrillSheet`/`SlideOver` detail usage.
- **Tasks open as sheets:** Add, Filters, Edit and confirmations use one sheet component with **medium and large detents**, drag-to-dismiss and a history entry.
- **Edge-swipe back:** when running as a home-screen app (`display-mode: standalone`), we implement our own edge-swipe back, because iOS home-screen apps don't provide one. In the browser we rely on Safari's own gesture.

### iPad (768–1279px, touch)

- A collapsible sidebar with 2–3 side-by-side columns: sidebar, list, detail.
- The toolbar is pinned above the detail column, which satisfies the "Persistent Chrome" rule in AGENTS.md.
- The list/detail split applies wherever a list exists: Activity, Plan management, Explore merchants and signals, Review.

### Desktop (pointer, ≥1024px)

- The iPad layout plus Mac conventions:
  - hover states on rows and controls
  - rows 44pt with touch and 36pt with a fine pointer (`@media (pointer: fine)`)
  - keyboard: ↑/↓ moves the list selection, ↩ opens it, ⌫ deletes with confirmation, Esc closes the detail or sheet, ⌘F focuses search, and ⌘K opens the existing CommandPalette
  - right-click opens the row context menu
  - visible focus rings everywhere

### Rows

For transaction rows first, then subscription and budget rows:
- swipe left → Delete, with confirmation inside the swipe action
- swipe right → Change category
- long-press (touch) or right-click (pointer) → context menu: Edit, Category, Add to trip, Delete

Every swipe action is also available from the context menu and the detail page. This follows the HIG rule that gestures are never the only path. We add the new dependency **`@radix-ui/react-context-menu`**.

### Motion

- A pressed state on every tappable row, button and tab.
- Springy sheet detents and tab indicator movement (existing Framer Motion). Slide transitions for navigation.
- Everything respects `prefers-reduced-motion`: cross-fades replace slides, and there are no springs.
- Motion presets live in `lib/motionPresets.ts`. Retire the unused `--ease-spring`/`--ease-bounce` tokens or wire them up (critique finding).

### Information architecture: one time focus per tab

- **Home = now:** this month so far, what needs a look, the next 7 days. "Coming up" becomes a preview of at most 3 rows that opens Plan at Plan's own range. "Recent" links to Activity and doesn't duplicate it.
- **Activity = the past:** recorded transactions.
- **Plan = the future:** upcoming charges, budgets, goals.
- **Explore = patterns:** on phone, a summary grouped list (Health "Summary" style, as rendered):
  - health score spectrum card
  - AI daily read row, kept separate from the facts
  - "Worth a look": unusual purchases and biggest mover
  - "Patterns": Over time, By category, By merchant, Recurring, each row showing a mini preview (sparkline, category bar, count)

  Each row opens its section page. iPad and desktop keep the full dashboard in the detail column.

### Text size (Dynamic Type equivalent)

- Every font size uses `rem`. No px-locked labels.
- Layouts are verified at 200% browser text size. At large sizes, list rows stack vertically (title over amount), as iOS does at accessibility sizes.
- 44pt minimum touch targets and an 11pt minimum text size remain.

## New components: approval required before implementation

Per the AGENTS.md approval gate, each needs a proposal on the component approval page. The page shows wireframes, states, API, HIG source, consumers and migration impact. The names below are proposals, not approved files.

| Proposal | Replaces / extends | HIG source |
|---|---|---|
| Frosted tab bar (floating capsule) | `BottomTabs` | Tab bars, Materials |
| Frosted sidebar (collapsible, inset) | `Sidebar` | Sidebars |
| Large-title navigation bar (collapse on scroll, back button, trailing actions) | page headers, `PhoneScreen` header | Navigation bars |
| Grouped list + list row (inset groups, separators, chevron, value, pressed/hover/selected) | ad hoc `PageCard` lists, `selectable-row` | Lists and tables |
| Sheet with detents | `DrillSheet` (task use), `ui/sheet`, `SlideOver` | Sheets |
| Navigation stack (slide-in detail pages with history and edge-swipe back) | `DrillSheet` (detail use), `SlideOver`, `useDrill` | Navigation, Split views |
| Split view columns (list/detail with pinned toolbar) | `detail-panel`, `TransactionsPage`/`MerchantsPage` split markup | Split views, Toolbars |
| Swipe actions | none | Lists and tables |
| Context menu (Radix) | none | Context menus |
| Segmented control | reconcile with `segmented-choice` / `Tabs` | Segmented controls |
| Spectrum hero card | `HeroCard`, `HighlightCard`, `HeroAmount` | Brand (ours) |
| Toolbar | ad hoc action bars | Toolbars |

After approval, each component goes into its shared owner. We migrate every consumer, update the `design-language.md` §7.0 registry, and leave no page-local copies.

## Carried forward from the polish plan

The polish plan's audit (70 `.tsx` files, 2026-09-17) remains the baseline census. Several owners now exist in `components/ui/` (`switch`, `choice-chip`, `segmented-choice`, `selectable-row`, `ProgressBar`/`ProgressRing`, `StatusDot`), and `.btn-action` is gone. So U02, U04, U06, U07, U09, U13 and U18 **appear** resolved. Each must be re-verified during the foundation step and closed or reopened with evidence.

Carried forward as work in this project:
- **U01 tokens, U10 radii/elevation, U14 fields, U15 overlays:** absorbed by the Direction B token rewrite and the sheet/navigation-stack work.
- **U03 icon/retry commands, U12 row drift (Evidence → `ActivityRowShell`), U16 confirmations, U17 feedback owners:** migrate during each surface pass.
- **U11 card hierarchy:** re-evaluated, since grouped lists replace most `PageCard` lists.
- **U19 pickers/calendar, U20 preview drift:** migrate previews to the approved owners. Add the inventory check.

The polish plan's completion gate (see its "Completion gate" section) applies to this project in addition to the checks below.

## Delivery

- **Branch:** `feature/hig-redesign` from `develop`, after syncing `develop` with `main` (`origin/main` is one merge commit ahead). **One branch, one release: v3.1.0.** The redesign changes no backend or data. The CHANGELOG describes it as a visual and interaction redesign.
- **Commit order.** Each step ends in commits with the tests passing. Early merge of the foundation steps is an emergency escape hatch only, not the plan.
  1. Tokens, `index.css` and `design-language.md` rewritten for Direction B.
  2. Approved shared components, with tests.
  3. Navigation stack, sheet, tab bar, sidebar and split view in `AppShell`.
  4. Home
  5. Activity (and Evidence)
  6. Plan (timeline and manage)
  7. Explore (summary list, section pages, desktop dashboard)
  8. Profile, Settings and Review
  9. Login, SetPassword, Onboarding and WalletCredential
  10. Admin panel
  11. Release: CHANGELOG, README screenshots, `v3.1.0` tag via `develop` → `main`.
- **AGENTS.md updates:** the Frontend UI Design System, Navigation Pattern and Dashboard Layout Principles sections are rewritten in step 1 or step 3 to describe the new structure. The viewport-grid rules give way to the split-view model.

## Definition of done (per surface, and for the release)

- [ ] Playwright screenshots on iPhone SE, iPhone 15, iPad (portrait and landscape) and a 1440px desktop, in light and dark, attached to the PR.
- [ ] `/impeccable` critique ≥ **32/40**, up from 25/40.
- [ ] Reduce Motion pass: no slides or springs, and all state changes still perceivable.
- [ ] 200% text pass: no clipped text, rows stack, targets ≥ 44pt.
- [ ] Reduced transparency / no-`backdrop-filter` pass: solid chrome, readable contrast.
- [ ] Keyboard pass (desktop): list navigation, open, delete-with-confirm, Esc, ⌘K, visible focus.
- [ ] Gesture pass (phone): swipe actions, context menu, sheet detents, edge-swipe back in standalone mode.
- [ ] `pytest tests/ -v` and the frontend tests/build pass. New tests cover gestures, keyboard shortcuts and navigation history.
- [ ] Money formatting, URLs, `returnTo` state, confirmation semantics and per-user boundaries are unchanged.

## Sequence

1. ~~Agree the design (grilling session, 2026-09-30).~~
2. ~~Write this plan.~~
3. ~~Publish the component approval page~~: https://claude.ai/artifact/TRQ4b4heaFsiNKfu7TPLFd (private), with proposals P1–P12.
4. User decisions (2026-10-01):
   - P1, P3, P5–P12: **approved**.
   - P2: **approved with amendment**. Icons in the collapsed rail are centred.
   - P4: **approved with amendment**. Rows stay square inside the rounded group (iOS inset-grouped standard). On iPad and desktop, the selected row in split-view lists is a rounded inset pill (12pt), as in Mail and Notes.
5. Build with `/impeccable` on `feature/hig-redesign`, following the commit order above. **Nothing is built before step 4.**
