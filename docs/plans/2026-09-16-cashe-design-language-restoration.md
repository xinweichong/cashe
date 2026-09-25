# Restore the cashe experience

Status: implementation plan; no application changes made by this document.

## 1. Outcome and boundaries

The redesigned experience should feel unmistakably like cashe: warm spending numerics, quiet teal atmosphere, category colour that connects related information, deliberate display typography, precise mono labels, and responsive interactions. The four-destination product structure remains Home, Activity, Plan, and Explore.

This is a complete experience pass, including loading, failure, navigation, editing, and return journeys. Adding colour to three loaded screens is only its first visible result.

### The next-level result: see the answer, then explore it

The requested result restores the visual information that made the original dashboard useful, then makes it more connected and easier to understand. It changes page composition and interaction, not only component styling.

The interface follows three levels:

1. **Glance:** a number, a visual pattern, and the qualification needed to interpret it.
2. **Understand:** select a category, day, or comparison to see exact values and a short explanation.
3. **Act:** open the matching transactions or schedule, make a correction, and return to an updated view with context intact.

These are required outcomes of this implementation, not a later wishlist:

| Question | Visible answer | Next action |
|---|---|---|
| How much have I spent? | Home's warm hero amount, comparison delta and compact target meter when a target exists | Open this period's evidence |
| Where did it go? | Category donut with a ranked, directly labelled legend | Select a category and view its records |
| When did spending pick up? | Daily spending chart, with an optional comparable-period overlay | Select a day and open its evidence |
| What changed? | Signed category-change bars centred on zero | Compare current and previous evidence |
| Was it more purchases or bigger purchases? | Two paired comparisons: purchase count and average size | Open the supported category/merchant driver |
| What might the month end at? | Plan's projection amount, recorded/remaining composition and clearly labelled range | Inspect assumptions or upcoming charges |
| What do I need to do? | A compact attention summary and specific actions | Resolve the item without losing context |

The improvement over the original dashboard is the connection between its visuals: the same category colour, selected period, evidence context, and corrected values persist across the journey. Charts become useful entry points rather than isolated pictures. Returning from an edit updates the chart and its explanation together.

### One application, four purposeful layouts

| Destination | Spatial direction | Primary task |
|---|---|---|
| Home | Editorial money briefing: oversized headline, integrated trend, open sections and varied visual scale | Understand the month at a glance |
| Explore | Interactive spending workspace: one main visual with contextual breakdown and evidence | Follow a pattern from day to category to merchant to transaction |
| Plan | Visual calendar of commitments: projection composition, agenda and calendar share a selection | Understand what is approaching and when |
| Activity | Dependable list/detail workspace with persistent controls | Find, verify and correct a record |

Use shared type, spectrum, geometry, controls and selection behaviour to connect these layouts. Do not force every destination into the same stack of rectangular cards. Reserve enclosed surfaces for a real grouping, independent interaction, raised detail or the single hero. Open sections use alignment, whitespace and light dividers to establish hierarchy. Do not give every chart a separate border, shadow and title bar.

The signature composition combines Plus Jakarta display numerics, precise mono captions, the quiet diagonal shell wash, a warm hero gradient and restrained hairlines. Category colour follows the information: selecting Dining emphasises its chart marks, its category readout and its record avatars. Other marks can recede without dropping required contrast or becoming unavailable. Warm financial emphasis, category identity, and status semantics remain distinct.

### Three responsive compositions

Responsive behaviour adapts to available content width, input and task, rather than assuming every tablet is a small desktop. Use shared components and state with container-aware placement; do not maintain three separate page implementations.

| Concern | Phone | Tablet | Desktop |
|---|---|---|---|
| Reading | One deliberate vertical sequence, full-width chart sections | Portrait uses an editorial flow; wider landscape pairs the overview with context | Broad overview and a contextual inspection column where useful |
| Home | Integrated hero/trend, category distribution, selected observation, upcoming/activity | Hero remains prominent; distribution and selected breakdown can sit together when legible | Asymmetric composition, with the main visual given more width than supporting information |
| Explore | Main chart then inline selection details; sheet only for short inspection | Chart and contextual breakdown side by side when each fits | Main chart plus a stable inspection panel; supporting records immediately accessible |
| Plan | Compact week strip and agenda; optional month view expands explicitly | Month and selected-day agenda can pair in landscape | Month calendar beside the selected-day agenda |
| Activity/editing | Preserve list; short detail in a sheet, longer edit full screen | Detail pane when both list and form remain usable, otherwise sheet/full screen | Persistent list/detail with keyboard navigation |
| Controls | Thumb-accessible actions above safe areas, at least 44px targets | Touch-sized controls even with a pointer attached | Efficient toolbars and existing keyboard/command-palette access |
| Charts | Fewer tick labels and relocated legends, never silently fewer records | Legends beside plots where useful | Richer labels and comparisons within bounded reading widths |

Define layout transitions by minimum usable chart/form width during the prototype. A tablet in split view follows the narrow composition; a large landscape tablet can use the wide one. Preserve selection, draft, focus and scroll through rotation, resizing and theme changes. Switching placement must not duplicate mounted forms or fire duplicate queries.

Home, Explore and Plan retain natural page scrolling. An Explore inspection column can remain in view only where its content and viewport allow it; do not reintroduce nested scrolling for the page. Activity retains its intentional independently scrolling list/detail regions. Mobile sheets must not compete with chart gestures, the software keyboard or the bottom tabs. Long forms have visible actions with the keyboard open.

Use the same chart selection and evidence actions across pointer, keyboard and touch. A phone layout must not depend on hover. Keep the shell stable; indicate location with a restrained moving nav indicator and static selected-state fallback for reduced motion. No auto-hiding navigation or ornamental floating controls that obstruct content.

### Reading budget and disclosure

- A normal analytical card shows a short title, its visual, at most one short explanatory sentence, and a primary action. Values, axes and essential uncertainty labels are additional structured information, not paragraphs.
- Use short titles such as “Where it went”, “Spending over time”, “What changed”, and “Your usual week”. A question can remain as accessible explanatory context where useful.
- Replace paragraphs describing amounts with directly labelled figures. Example structure, using real API values: **Dining +$120** beside a change bar; “More visits, similar purchase size” below it. Illustrative figures must never enter production fallback data.
- Keep “Known subtotal”, “Indicative conversion”, “Estimated”, and excluded-record/unknown-charge counts visible next to affected values. Move calculation methodology and longer overlap explanations into a labelled disclosure; retain a short visible overlap warning when necessary.
- Avoid repeating the same month total in the hero, donut centre, chart headline and prose. Let the donut centre identify the selected category/share, with exact amounts in its legend; use a neutral “Spending mix” centre when unselected.
- Put freshness in one compact location with expandable connection details. Keep reconnection failures actionable and visible. Do not repeat normal source-status paragraphs throughout Home.
- Never hide safety-critical confirmation copy, field errors, or an unavailable comparison behind a tooltip.
- Desktop can place related charts side by side; phone layouts stack them. Do not hide essential charts behind a carousel or default-collapsed section to achieve a short page.

### Concrete Home composition

Desktop reading order; the lower rows are open editorial sections, not a mandatory grid of bordered cards:

```text
Heading · through date                               Add
┌──────────────────────────────────────────────────────┐
│ MONTH SPENDING       comparison     optional target  │
│ Warm hero amount     short, visible qualification    │
│ Integrated daily spending chart + comparison        │
└──────────────────────────────────────────────────────┘
Where it went                    Selected category
Donut + ranked legend            Main merchants · evidence

What changed                     Coming up
One supported observation        Compact dated charge rows
Signed category bars             Dates · estimated amounts
Attention summary · concrete next action
Recent activity · category avatars and exact amounts
```

On phones: hero with its integrated daily trend → category mix and inline selected breakdown → strongest supported change → coming up → recent activity. The chart remains large enough to inspect rather than becoming an unreadable decorative sparkline. On wide layouts, give the distribution more room than the supporting readout rather than forcing equal columns.

Show one strongest supported observation first, with its visual evidence; offer further explanations through an explicit expansion. Choose only from supported comparable facts, retain overlap qualifications, and do not generate a confident insight when the facts are unavailable. A real actionable issue gets a compact callout near the top; normal status remains below. Do not duplicate the attention section or move the charts below several blocks of explanatory prose. Allow natural vertical scrolling and keep tap targets comfortable.

The target meter uses the actual target and recorded spend, with explicit over-target text; a visually capped track must not hide overspending. Do not imply “on pace” from a target alone.

### Restore and improve the chart inventory

| Existing visual / capability | Destination and implementation |
|---|---|
| `CategoryDonut` | Restore on Home. Reuse its Recharts/theme foundation; add a labelled selectable legend and evidence action. Show the largest five categories plus a presentation-only “Remaining categories” group, distinguishable from a real category named Other. Expanding this group reveals its members; it must not link to a fictitious category. |
| `TrendLine` | Integrate into Home's hero rather than adding a second chart card. Add optional current/prior comparison after period semantics are verified. Start with daily values, clear currency/date axes and a stable selected-day readout. Do not change to a cumulative series without a label. |
| `CategoryTrendLine` | Restore in Explore's spending-over-time section. Default to at most three selectable categories, offer the complete category selector, and retain consistent colours. Missing points retain their meaning rather than becoming invented zeroes. |
| `ComparisonBarChart` | Reuse the presentation for Explore's current/prior category totals where the necessary totals are available. Keep exact comparable windows visible. Existing Insights remains available. |
| Ranked category changes | Upgrade to diverging bars around a labelled zero baseline. Category hue supplies identity; left/right position and signs supply decrease/increase. Never rely on red/green alone. |
| Merchant ranking | Horizontal category-coloured bars with exact totals and distinct evidence/profile actions. Selection is retained when returning from a merchant profile. |
| Weekday pattern | Seven chronological columns, not seven repeated prose rows. Show the averaging window and selected weekday amount. Tap/keyboard selection exposes all relevant values. |
| Recurring price changes | Paired old/new amounts on a common scale, explicit delta and existing annualised impact. Unknown values remain unknown. Overdue/renewal items remain concise status rows. |
| Purchase frequency/size | Two compact paired-bar comparisons from the existing driver fields: count and average transaction value on separate labelled scales. No invented causal percentage or multiplying overlapping drivers. |
| Trip impact | Paired recorded period totals or available daily trip spending, with explicit period/overlap context. Do not draw a part-of-whole chart until the trip and month share the same membership/window. |
| `IncomeExpenseBar`, velocity and goal/budget visuals | Preserve access through Insights and Plan management. Do not silently remove them or replace them with paragraphs. New uses of financial-health/velocity assessments require verified shared semantics; appearance alone does not justify importing legacy scores. |

### A genuinely visual Plan

Add a compact projection composition chart within the single hero: recorded spending, remaining scheduled commitments, and estimated remaining variable spending. Use existing `MonthForecast` fields only after confirming these components are disjoint and reconcile to the projected total. Label remaining components as estimates even if the API field is named `confirmed_commitments`.

Below it, show the projected total and low/high range on a labelled horizontal scale. Call this the range based on recorded weekday history, not a confidence interval. Distinguish recorded versus estimated using solid versus patterned/outlined treatment as well as colour. Retain the existing actual and range amounts as accessible text.

Do not fabricate a smooth future daily curve: the current response does not supply a daily forecast series. If components cannot safely be stacked, show adjacent directly labelled comparison bars with the same factual fields instead.

Provide two views of the same recorded pending charges: **Agenda** (default) and **Calendar**. Group agenda rows under date headings while preserving ordering, estimates, editing and pagination. Calendar makes clusters of upcoming commitments visible, rather than promising a complete billing calendar. Do not add drag-to-reschedule or infer new future occurrences.

On phones, place a compact week strip above the agenda; selecting a day brings its readable entries into focus. An explicit Calendar view shows the month with markers, not tiny merchant names and amounts in every cell. On wider tablet/desktop layouts, show the month beside the selected-day agenda. Date selection highlights the corresponding agenda heading and charge selection highlights its date. Preserve date/view in the URL and return focus to the initiating control after detail closes.

Calendar completeness requires a bounded read of the visible date window. The current timeline response is paginated: never present the first 50 charges as the complete month's markers, daily counts or totals. Reuse a verified complete window or add an authenticated per-day summary with known amount, unknown count and recorded-charge count, plus paginated selected-day detail, under the same pending-schedule rules. Mark loading/failed coverage rather than showing apparently empty days. Keep the existing 14/30/90-day agenda window separate from the calendar's displayed month, with explicit dates and no misleading shared subtotal.

Keep dates in the response's timezone and retain pending/matched/dismissed/paused semantics. Label empty dates as having no recorded pending charges; do not imply there will be no spending. Calendar is a new presentation of existing records, not schedule expansion or forecasting.

### Chart interaction and accessibility contract

- Selecting a chart item updates its local readout and reveals an explicit “View transactions” action; selecting does not unexpectedly navigate. Legend/list equivalents expose the same action to keyboard and assistive-technology users.
- Share a small chart frame for controls, period/status, selected-item readout and evidence link where these repeat. Reuse existing chart components or extract their pure rendering layer; do not copy whole charts into each page.
- Use consistent tooltip formatting, selection highlights and dimming. Keep selected bars/points legible in both themes. A tap can pin a readout; tapping outside or Escape clears it without trapping page scrolling.
- Keep labels/axes stable during selection. Animate the local emphasis briefly; do not replay initial chart drawing on focus, polling, route return or theme change.
- Provide an accessible data list/table through “View data”. Exact values are never tooltip-only. Signed changes and patterned estimates remain understandable without colour.
- Store shareable analysis state in URL parameters where appropriate (period, category, comparison mode); preserve detail-return URLs and scroll. Keep transient tooltip hover out of the URL.

### Chart data is part of the delivery, not an assumption

Existing hooks `useSummaryV2`, `useTrendV2` and `useTrendByCategoryV2` provide reusable starting points. However, a v2 name and integer money shape do not prove equivalence with Home's spending facts: the overview summary/trend routes currently call legacy Storage aggregates, and their response shapes lack shared-facts quality metadata.

Before connecting these charts to Home, verify identical timezone, period boundaries, classification, refund treatment, conversion and rounding rules against the hero. Do not display conflicting totals and explain them away in copy.

If equivalence is absent, add a bounded authenticated shared-facts chart read model through locked Storage wrappers, supplying category totals, daily points, comparison windows and quality metadata from the same selection rules. It must aggregate the full matching population server-side, not sum a 50-row evidence page in the browser. Define zero versus unknown/missing days explicitly. Include an as-of/version marker where needed to avoid rendering mixed refresh snapshots as one consistent report.

This is an explicit extension of the initial frontend-only scope, limited to the read contracts needed by these charts, contextual breakdowns and complete calendar coverage. It does not reopen the amount fallback investigation or introduce a money migration. Chart totals, daily totals and the hero must reconcile for identical scopes, with explanatory excluded-record metadata when partial. A category-change delta cannot substitute for a category total in a donut.

### Prototype milestone: prove the composition before broad migration

Build one working **Home → select category → inspect transactions → edit → return** journey using shared components and isolated fixture data. Demonstrate the integrated hero/trend, linked category colour, short readout, contextual detail and locally updated chart. The prototype is an implementation milestone, not something already delivered by this plan.

Render this journey at phone, portrait tablet, landscape tablet and desktop widths, in both themes. Include tablet split view, rotation/resizing while editing, reduced motion, delayed data and an unresolved amount. Produce screenshots and a short interaction recording. Also create layout studies for Explore's chart/inspection composition and Plan's month/agenda composition so their different spatial needs are reviewed before full migration.

The exit gate is demonstrated clarity, readable charts, preserved context and smooth transitions at every composition—not approval of colours alone. Reuse the prototype's successful components in production; isolate fixture wiring rather than building a throwaway parallel UI framework. Check the intended result with the user through these concrete artifacts before spreading the composition across all pages; continue independent data-contract and regression work during review.

### Acceptance: demonstrate the next-level result

The Home implementation review must contain working category and trend charts; colourful typography alone does not pass. The Explore review must demonstrate visual comparisons and a chart-to-evidence journey. The Plan review must demonstrate recorded/estimated composition or its honest comparison-bar fallback.

In a short task walkthrough, a user should be able to identify month spending and its qualification within approximately five seconds, find the biggest category and when spending rose within fifteen seconds, and open supporting records within thirty seconds. These are evaluation targets, not claimed measured results. Record hesitation and revise hierarchy before adding more decoration.

The review deliverable includes populated/partial/empty phone, portrait/landscape tablet and desktop screens, both themes, and a recording of chart selection → evidence → edit → return with the visual updated. Compare against the original chart-rich Overview, not only the flat R10 implementation. The new Home must show the category mix and spending trend before long-form explanations, without requiring users to discover legacy routes. Explore must demonstrate a connected day → category → merchant/evidence investigation; Plan must demonstrate synchronised calendar/agenda selection with complete visible-window coverage.

Assumptions:

- `docs/design-language.md` governs brand and component roles. The September 5 product plan governs information architecture and financial truth. “Simplify” means clearer hierarchy and fewer competing accents; it does not remove the spectrum, typography, or atmosphere.
- Keep Home/Explore natural scrolling and Activity's independent list/detail scrolling, preserved drafts, and deep links. Plan keeps its scrolling timeline.
- Preserve the existing `src/transaction_commands.py` amount fallback and unrelated working-tree changes. Do not investigate or migrate additional backend money paths in this visual project.
- Legacy Overview, Analytics, and Finance layouts remain reference screens. Shared primitive changes can affect their rendering and must receive regression review; they are not exempt from testing.
- Keep system/light/dark preference and the existing new-experience flag. No new UI framework, animation library, chart library, offline financial-data store, or general-purpose design-system rewrite.

## 2. Findings from the current source

| Finding | Evidence | Consequence |
|---|---|---|
| New shell omits the atmospheric background | `AppShell.tsx` applies `B2_WASH` only outside the new experience | Restoring cards alone leaves the surrounding application visually disconnected |
| Main new pages use plain content cards and text amounts | `HomePage.tsx`, `ExplorePatternsPage.tsx`, `PlanPage.tsx` | No clear brand moment or consistent numeric hierarchy |
| Headers do not fully implement the type system | Home has display family but semibold/no explicit tracking; Plan/Explore/Evidence omit display family | Page identity differs between destinations |
| Documented type sizes are not fully mapped | `index.css` defines only `--text-2xs` explicitly | `text-2xl` does not establish the documented 31px size by itself; verify computed styles |
| Existing cards differ from their documented roles | `Card` uses `rounded-lg shadow-sm`; the document specifies 8px/border-only ordinary cards | Radius/elevation consistency needs a component-level decision |
| Status dots and spectrum Badge tones are absent | `components/ui/badge.tsx`; no `StatusDot.tsx` | Repeated labels become either bare text or improvised styling |
| Long card headings are truncated | `PageCard` title uses `truncate`, including long Explore questions | Core questions may be unreadable on phones |
| Loading patterns diverge | Bare loading text across Home, Plan, Explore, Evidence, Review | Content arrival changes the page shape and feels unfinished |
| Cached-data failure handling differs | Home preserves stale data; several Review/Evidence branches replace data on `isError`; Explore often retains data without a stale notice | Users lose context or cannot tell whether data refreshed |
| Motion helpers need an explicit contract | `AnimatedCurrency` animates from zero and on updates; hero CSS has an infinite glow pulse | Copying legacy usage imports motion that conflicts with the documented rules |
| Colours need rendered light-theme checks | Semantic spectrum tokens change with theme; raw category hex colours and legacy gradient stops do not | Bright labels/gradients may be illegible on white surfaces |
| Query invalidation needs journey review | Transaction hooks invalidate Home/evidence, but do not list the Explore or month-forecast keys | A fast cached destination may still show pre-edit answers |

The legacy Overview excerpt is a visual reference, not a compliance template: it contains multiple `AnimatedCurrency` instances. Do not reproduce its count-up pattern on the new pages.

## 3. Experience contract

### Visual hierarchy

- One warm hero on Home and one on Plan. Explore derives character from question hierarchy, coloured comparisons, and consistent chart styling; it needs no manufactured financial hero.
- At most one warm and one teal glow in a viewport. A teal highlight requires a supported positive outcome; “no review items” does not prove complete capture or financial health.
- Use the existing subtle diagonal shell wash in both themes, with theme-specific opacity and canvas tokens. Never place the fixed dark B2 canvas behind light-mode content.
- Keep glow static. Gradients, colour, and typography carry character even when reduced motion is enabled.
- Separate colour meanings: category hue identifies a category; spectrum status tones communicate attention; warning/destructive colours retain their established financial/action meanings. A teal analytical bar alone must not claim “good”.
- Display family for page/section names and hero amounts; Inter for reading and controls; mono for compact data labels, dates, and non-hero amounts. Maintain cents and existing signed-money semantics.
- Create rhythm through varied visual scale and open editorial sections. A shared chart renderer can sit inside the hero or an open section without owning a second card; keep `ChartCard` for genuinely independent chart surfaces. Share header/spacing primitives rather than duplicating markup when the enclosing surface changes.

### Geometry

Use the documented role-based scale rather than making every element equally round:

| Element | Radius |
|---|---:|
| Small tags | 4px |
| Buttons, inputs, segmented controls | 6px |
| Ordinary cards, menus, popovers | 8px |
| Stat cards, grouped content panels | 14px |
| Hero cards and large modal containers | 24px |
| Badges, status pills, bar tracks | Pill |

Use tokens instead of repeated pixel literals. Implement changes through the shared primitives, with reference captures for existing consumers. Keep roughly 16px reading text on phones and at least 44px effective touch targets. Allow headers/actions to wrap without squeezing or truncating the question.

### Money and uncertainty

- Components format the API-provided money; they never recompute totals, comparisons, projection ranges, or currency conversion.
- Keep original row currency versus reporting SGD explicit. Reusing an avatar must not force Home's reporting-money records through Activity's legacy transaction shape.
- Preserve unknown versus zero, absent versus zero income, partial/indicative status, negative net flow, estimated amounts, and the exact comparison windows.
- Unavailable projections display an explanation in the reserved card area, never a zero or invented number. Important qualifications stay adjacent to their amount; only secondary method details can be disclosed on demand.

### Motion

The default recommendation refines the original proposal: show the final financial value on first render, with a short reveal of its surface. “At most one count-up” is a ceiling, not a requirement. Do not add count-ups to Plan, list rows, or secondary Home stats.

If a Home count-up is retained during implementation, it is the sole instance, explicitly opt-in, limited to first fresh-data presentation, and disabled for cached returns, refetches, theme changes, and reduced motion. Screen readers receive the final formatted amount, never intermediate values. Do not make animation completion a prerequisite for reading or interacting with the page.

| Interaction | Behaviour |
|---|---|
| Hover, press, focus | Shared 150ms feedback; neutral hover, small press response; no hover-only actions |
| Route arrival | Existing gentle preset with a small offset; keep shell stationary and content usable immediately |
| Route exit | Short fade, approximately 100–150ms; do not introduce additional wait stages |
| Desktop detail / phone sheet | Existing snappy spatial presets; stable parent list and returned focus |
| Form expansion | Small, local reveal; retain inputs on failure and avoid whole-page animation |
| Ranked bars | Brief `scaleX` transition with left origin; labels and final values available immediately |
| List changes | Stable record keys; at most ten staggered items at 40ms; never replay the whole list during polling |
| Linked chart/detail selection | Emphasise selected marks and reveal the local breakdown without moving the main chart or erasing its selection |
| Navigation/calendar selection | Move a restrained active indicator; synchronise the date/readout without page-wide re-entrance |
| Reduced motion | Immediate final states; no translation, scaling, count-up, shimmer, or continuous glow |

Prefer opacity/transform. Avoid animating blur, shadow, page height, or every financial figure. Review route-key/`AnimatePresence` behaviour before altering transitions: preserving a draft is more important than a crossfade.

## 4. Shared implementation surface

Reuse `PageCard`, `ChartCard`, `HeroCard`, `HighlightCard`, `Button`, `Skeleton`, `LoadFailed`, existing dialogs/sheets, chart theme, and motion presets. Add only small components with demonstrated callers:

| Primitive | Responsibility | Consumers |
|---|---|---|
| `StatusDot` | Decorative 6px dot plus readable label; accept category colour or semantic tone without ambiguous precedence | Home, Explore, Plan, Review |
| Badge `tone` | saved/calm/active/notable/warm; 13% tint, 25% border, theme-resolved text | Schedule/review/quality labels |
| `HeroAmount` | One gradient, display-size, cents, and accessibility treatment; consumes the existing formatted-money contract | Home, Plan |
| `CategoryAvatar` | Existing 20% tint plus category initial/income glyph, with legible foreground | Activity, Home, Evidence |
| `PageHeading` | Display title, optional context and action; wrapping/mobile spacing | New full-page screens |
| `RankedBar` | Accessible label/value, optional category identity, bounded visual magnitude and signed text | Explore questions |

Keep layout-specific skeleton compositions beside their pages. Add a shared stale-data notice or empty-state wrapper only where the same pattern is actually repeated; do not build a configurable page renderer.

Badge compatibility requires care: CVA treats an undefined variant as the default. A tone must explicitly suppress the default variant styling, rather than simply passing `undefined`. Preserve every no-tone caller. Define and test tone precedence if a caller supplies both tone and variant.

Use the existing category lookup as the source of identity. Verify category colours update after asynchronous category loading and edits, without mutating saved colours as a side effect of this work. Keep labels neutral where raw category foreground would fail contrast; use the colour on the dot/bar and an accessible avatar glyph.

Do not change all Buttons to a new primary style in this pass. The current default is already a spectrum gradient despite the older document's teal-default description. Use existing outline/ghost/link treatment for secondary actions; audit actual calls so default-button glow does not consume the page's limited brand emphasis. Record the observed default explicitly in the targeted design-language update. Additional variants and sizes remain deferred unless a concrete migrated interaction requires them.

## 5. Page and journey specification

### Home

1. Display heading, compact as-of/timezone context, and a clear Add action.
2. Warm `HeroCard`: month spending in `HeroAmount`, with the daily spending chart integrated below; immediately adjacent partial/indicative qualification; comparison with its exact periods; static mono-labelled income/net-flow facts when present. Do not insert missing income as zero to fill a three-column layout.
3. Retain target/comparison warning rules. Avoid an additional glowing target card.
4. “Where it went”: an open distribution/legend section with a linked merchant readout. “What changed”: one strongest supported observation and signed category bars, with further explanations available on demand. Keep comparison evidence links and necessary overlap qualifications visible.
5. “Coming up” uses compact dated rows; attention is a concise actionable summary, positioned near the top only when needed. Use alignment and dividers rather than a separate card for every group. Do not colour all attention links teal as though they were positive status.
6. Recent activity uses the extracted category avatar and common spacing, amount alignment, focus and hover treatment. Keep its existing amount and conversion labels.
7. Shape-matched skeleton for the entire briefing. Background errors retain the briefing with a compact stale notice and Retry.

Acceptance: the month, its qualification, and supporting-evidence action are obvious on a phone without scanning a wall of equivalent text. No repeating numerics; no extra glow added for a zero attention count.

### Explore: one visual workspace with connected questions

- Align the wrapper heading, tabs, and question content to the same gutters and content width. Active navigation gets a restrained themed accent and `aria-current`; links remain links rather than simulated buttons.
- Replace the stack of five question cards with a main visual workspace: **Over time · By category · By merchant · Recurring**. Default to Over time. Preserve access to Insights as a separate existing destination; distinguish its navigation from these analysis modes.
- Map the existing questions into these modes: weekday/category trends under Over time; category change and purchase frequency/size under By category; category-filtered merchant ranking under By merchant; price changes/renewals/overdue schedules under Recurring. Trip remains a contextual filter or explicit breakdown where the data supports it, not a hidden discarded capability.
- Show one main chart, its relevant controls, a short supported explanation, and contextual evidence. On wide screens place inspection alongside the visual; on phones use inline details or a short sheet. Maintain natural scrolling, without five equally weighted report panels or forced equal heights.
- Support day → category → merchant → transaction investigation where verified filtered read models exist. Expose period, selected day/category and a clear step-back/reset control; never show a whole-month breakdown as if it described a selected day. Extend the bounded shared read contract where required. Fetch the active mode and selected breakdown, not every analysis at boot.
- Preserve meaningful mode/period/filter state in the URL. Use real navigation semantics when the mode is routed; otherwise use accessible tabs. Selection must be reversible, keyboard-operable and stable through browser Back, edits and viewport changes.
- Let question titles wrap. Use a clear sequence: question → chart/answer → explanation → evidence.
- Category changes use `getCategoryColor(category)` for dot/bar identity, signed amounts and a visible explanation of increase/decrease. Bar magnitude is absolute, never an unsigned implication of direction.
- Merchant ranking uses the selected category's colour consistently. Preserve the distinct transaction-evidence and merchant-profile destinations.
- Recurring-cost and weekday bars remain neutral analytical teal. Overdue/possibly stopped labels get attention semantics independent of their chart colour.
- Trip question preserves its existing period and overlap qualifications. Do not redesign the visual to imply that overlapping amounts are additive.
- Handle failures in dependent queries as well as the final chart query: category/trip selection must not sit in permanent “Loading” after an upstream failure.
- Keep useful cached charts on background failures, with a local stale notice. A failed contextual breakdown must not replace the valid main chart. A failed mode does not prevent switching to another one.
- Use responsive two-column chart/inspection placement only where controls and values remain readable; use the narrow composition otherwise. No forced equal-height cards or nested scrolling.
- Keep Analytics/Insights internals and merchant profile structure; apply only shared chrome/control/state fixes needed for coherent transitions into them.

Acceptance: category colour matches Home and Activity; a chart can be understood without colour alone; changing a selector never shows old-category bars under a new-category heading.

### Plan

- Warm projection hero with shared gradient amount and static actual/range figures. Clearly identify projected versus recorded amounts. Preserve the explanation of the range and missing-conversion/unknown-charge exclusions.
- Keep the timeline total visually secondary to the projection. Timeline remains dense and functional; no additional hero/glow.
- Implement the Agenda/Calendar selection and responsive week-strip/month-plus-agenda compositions specified above. Keep calendar coverage complete and preserve the selected day/view through detail editing and browser Back.
- Standardise dates, amount alignment, controls, dividers and schedule-confirmation labels. Use a `notable` status treatment for “Schedule needs review”: it indicates uncertainty, not a confirmed cancelled subscription or over-budget outcome. Reserve `warm` for stronger supported states.
- Keep 14/30/90-day selection, pagination, and links to management. Retain pending form values, unchanged-field omission, and explicit dismissal confirmation that explains provider cancellation separately.
- Animate local edit/confirm disclosure, not every timeline item on refresh. Return focus to the initiating action when an editor closes.
- Validate that successful prediction changes update both timeline and forecast/Home views through the appropriate invalidation paths.

Acceptance: users can distinguish actual spending, projection, and pending estimates at a glance; failed saves preserve edits; dismissal never masquerades as provider cancellation.

### Activity and transaction details

- Preserve category tinting, list density, filters, bulk selection, list/detail layout and money-fallback behaviour.
- Extract avatar styling without duplicating transaction formatting logic or changing transaction data contracts.
- Limit touch-ups to accessible activation/focus, reduced-motion hover behaviour, shared controls/radii and sheet/detail continuity. The current clickable row is a `div`; verify keyboard activation without creating nested interactive controls.
- Keep edit/delete affordances persistent and labelled. Preserve list scroll and active filters through detail open/close, browser Back, and theme switches.

Acceptance: original amounts remain correct; keyboard/touch users can open a record and return to the same place without lost draft state.

### Evidence, Review, and connected settings

- Evidence gets the same display heading and lightweight activity-row visual treatment, with range/category/merchant context, supporting count and existing return URL intact.
- Review sections share title/spacing, issue states, selection/confirmation controls and structured loading. Keep capture, spending, duplicate, refund and recurring distinctions; never colour a handled item as proof it was processed successfully.
- Preserve existing retry/resolve/undo rules. Animate only the affected item's confirmed change, retain failed forms, and move focus predictably after removal.
- Profile, appearance controls, connection/settings forms, transaction forms, sheets and toasts receive a consistency audit: shared radii, focus, pending state, meaningful button hierarchy and correct theme colours. No unrelated settings redesign.
- Empty states use concise cashe copy and at most one obvious next action. Do not decorate empty evidence or missing forecasts with celebratory highlights.

Acceptance: Home → evidence → transaction → Back and Home → Review → resolve → Home retain context and refresh the relevant facts.

## 6. Loading and performance work

Measure first, then change the causes visible in traces. No claim of faster loading from CSS alone.

1. Record cold and cached route loads, bundle/chunk sizes, request timing, layout shifts and representative scrolling/edit traces using a repeatable dataset and device/network profile.
2. Replace known-shape loading text with dimensionally similar skeletons. A fast cached return shows cached content immediately, without an artificial minimum skeleton delay.
3. Distinguish initial failure, cached stale failure, true empty, partial, unavailable and offline. Offline wording requires an observed connectivity signal; a generic HTTP failure is not proof of being offline. Never persist private financial responses to a new browser store.
4. Preserve the current query cache policy until measurements justify specific changes. Share keys/options only for requests with identical date/timezone/filter semantics. Audit mutation invalidation for month forecast, Explore questions, merchant rankings, trip summaries, Home and evidence.
5. Keep previous results only with their original visible context while replacement data is pending. Disable actions tied to obsolete selection/pagination data where necessary.
6. Preserve lazy loading. Add targeted route-module preloading on link intent where it measurably removes a navigation gap; avoid fetching every destination's data on boot. Check touch navigation as well as hover/focus.
7. Check fonts and charts in the loading waterfall. Fonts already use preconnect and `display=swap`; optimise only if measured, keeping all three families. Do not add a second font-loading path or a new dependency by default.
8. Keep expensive visuals off scrolling hot paths. Do not add list virtualisation until a trace establishes that the existing bounded lists need it.

Proposed acceptance targets, measured after implementation rather than claimed now:

- Cached navigation begins responding within 100ms on the recorded test device; animations never delay data requests or button availability.
- LCP at or below 2.5s and CLS at or below 0.1 on the agreed mobile profile; investigate backend/network limits separately if they dominate.
- Representative interactions target 200ms or less; use local interaction traces for lab verification, and actual INP only when field measurement is available.
- Smooth sustained scroll and detail transitions at the device's target refresh rate; investigate reproducible main-thread stalls over 50ms attributable to new work.
- No unexplained initial-JavaScript growth or duplicate equivalent requests. Record baseline and final sizes/timings in the delivery notes.

## 7. Delivery sequence

Each increment should remain reviewable and testable. Use the project's feature-branch workflow; no commits or deployment are part of writing this plan.

| Increment | Concrete work | Exit gate |
|---|---|---|
| 1. Baseline | Fixture/state matrix, route captures, computed typography/radii audit, performance baseline | Both themes captured for new screens and legacy reference screens; specific gaps recorded |
| 2. Responsive prototype | Shared foundations, editorial Home/category/detail journey with fixtures, Explore/Plan layout studies | Phone, portrait/landscape tablet and desktop artifacts demonstrate composition, continuity and reduced motion before broad migration |
| 3. Production Home | Theme-aware wash, shared primitives, verified chart read contracts, integrated hero/trend, distribution/merchant context and one supported observation | Chart-rich editorial Home in all responsive compositions and data states; chart and hero totals reconcile |
| 4. Explore | Main visual workspace, four analysis modes, preserved question capabilities, contextual inspection and filtered evidence | Day/category/merchant investigation is accurate and reversible on phone/tablet/desktop; no lost legacy chart access |
| 5. Plan | Projection composition/range, agenda/calendar with complete window coverage, responsive selection, edit motion/focus and forecast invalidation | Dates/estimates readable at a glance; synchronised month/agenda and available/unavailable/partial/save/dismiss/failure journeys pass |
| 6. Supporting journeys | Evidence, Review, Activity touch-ups, connected controls | Back/scroll/drafts/keyboard preserved; no disconnected bare-text screens in primary journeys |
| 7. Motion + performance | Complete reduced-motion audit, request/cache consistency, measured navigation optimisation | Repeatable before/after traces and targets; no replayed counts or idle glow on new screens |
| 8. Release verification | Full automated suite, rendered/device review, targeted docs update, release notes | Acceptance matrix complete; unresolved limits explicitly listed |

### Implementation status (2026-09-25)

Commit labels are not acceptance. This records what current code, tests and captures show. "Mocked" means Playwright against the Vite app with the API mocked. "Real API" means `npm run test:journey`: the real dashboard API and production bundle on an isolated synthetic database (`scripts/journey_server.py`, with no config.yaml, bot or poller). No Safari, real-device or production check has been run.

| Increment | Implemented and verified | Still open |
|---|---|---|
| 1. Baseline | Source audit. Phone/tablet/desktop × light/dark captures in `e2e/screenshots/` (gitignored; regenerate with `npm run test:visual`). Perf baseline in the Increment 7 commits. | Legacy reference-screen captures |
| 2. Prototype | Studies render through the shared owners; mocked visual specs | Reduced-motion recordings; tablet split view |
| 3. Home | Shape-matched initial skeleton. Cached charts survive refresh failure with a stale notice. "Updating…" appears while separately fetched sections settle. No empty selection card. The daily trend runs chronologically across the whole period. "What changed" leads with one observation, with the rest behind "More context". `category`/`day` live in the URL and survive evidence → correction → Back (real API: the category correction is reflected in Evidence and Home, and the selection is kept). | Side-by-side selection detail at desktop (it stacks beneath by design, keeping the chart stable); a single consistent read model if measurement shows it is needed |
| 4. Explore | Full-width modes with no reserved column. Day → category → merchant investigation with day-scoped evidence, held in the URL and reversible (mocked browser plus unit tests). The trip share compares only spending dated inside the same month period. | Per-mode upstream-failure copy review |
| 5. Plan | Complete selected-day detail when a date straddles agenda pages. Window, page and phone calendar view held in the URL. Focus is managed through edit and dismiss. Calendar and agenda stay in sync (mocked). | Range-scale visual review on device |
| 6. Supporting | Activity returns focus to the originating row with filters intact. Evidence and Activity honour a safe `returnTo`, including Home. An in-progress edit survives resize and a theme switch with no duplicate form (mocked). Edit fields are labelled. | Safari/device keyboard and safe-area checks |
| 7. Motion/performance | `npm run test:perf` (production bundle, mocked API, 4× CPU throttle, 5 cold runs, 390px). Recharts no longer loads on every route, and route chunks load alongside auth. Content-ready baseline → now: Home 937 → 585ms, Activity 942 → 447ms, Explore 939 → 582ms, Plan 929 → 415ms. Home regressed from its best measurement of 495ms after the later Home work, so it is worth profiling. Overlays follow §14 timings. | Real-device traces; navigation-intent preloading; gesture profiling; Home TBT (87ms) investigation |
| 8. Release | Automated suites green | Safari/real-device review, release notes, production smoke check after authorised deployment |

Shared-UI consolidation (production-polish audit U01–U20) is complete for all items. The seven previously approval-gated owners (U04, U06, U07, U09, U13, U18, U19) were approved on 2026-09-25 and are implemented; see design-language §7.0. The remaining native buttons are the retained calendar day cells and one chip-remove control. `src/__tests__/uiInventory.test.ts` guards against regressions in src and dev, and the DevPreviewPage contact sheet shows every owner in both themes.

Checks at this point: frontend build and lint clean, 222 unit tests, 73 mocked Playwright checks, 1 real-API journey, 53 backend transaction API tests.

Foundations should first appear in the working Home prototype, then carry into the production slice. Motion/loading are part of every slice; increment 7 completes cross-route verification rather than postponing polish until the end.

Legacy visual preservation: use additive options or scoped styling for changes that intentionally differ in the new experience, such as static hero glow. Do not introduce forked copies of cards/buttons. Where a shared change is intended to apply everywhere (for example accessible tone text), check and record its impact on the reference screens.

## 8. Verification and release gate

### Automated behaviour

Run after implementation:

```sh
cd src/web/frontend
npm run build
npm run test
```

From repository root:

```sh
python3 -m pytest tests/test_web_api.py -k transaction
```

Run existing lint checks on the touched frontend surface, distinguishing pre-existing failures from new ones. Add focused behavioural coverage where absent:

- Badge tone precedence/no-tone compatibility; zero/unknown/negative money rendering; reduced-motion final values.
- Background refresh failures retain cached data and expose staleness; upstream failures do not strand dependent cards in loading.
- Successful edits invalidate affected Home/Plan/Explore/evidence views, and failed mutations retain editable values.
- Category changes do not relabel stale bars; navigation/Back/theme changes preserve filters, drafts and detail context.
- Chart totals reconcile with the hero for identical scopes, including timezone boundary, refunds, indicative/unresolved currency, missing dates and genuine zero cases. Server-side chart results must not depend on evidence pagination. Test any new read contracts for authentication and per-user isolation, and regenerate v2 schemas/types if their contracts change.
- Donut remainder expansion, signed change bars, comparison windows, keyboard/touch selection and chart-to-evidence filters agree with visible labels. Unknown chart values never pass through a tooltip formatter as zero.
- Explore mode/day/category/merchant selection filters the actual data, survives Back and does not reuse stale data under a different scope. Resize/rotation changes layout without resetting drafts, selection or triggering duplicate requests.
- Calendar day summaries and selected-day pagination cover all recorded pending charges in the visible window, including more than 50 entries, unknown amounts and matched/dismissed/paused exclusions. Unloaded or failed dates cannot render as confirmed empty days. Agenda and calendar retain their distinct window/subtotal labels.
- The existing serialization fallback covers a legacy nonzero amount with NULL canonical columns and does not overwrite present canonical values; include a foreign/unresolved case if the transaction suite lacks it. Do not extend the backend fix beyond regression coverage.

Avoid tests that merely assert a collection of Tailwind class strings. Component tests establish behaviour; browser captures establish the visible design.

### Rendered matrix

Use local or isolated preview data, not production mutation, to capture and interact with:

| Axis | Cases |
|---|---|
| Theme | Light, dark, system change during an open draft |
| Width/input | 375–390px phone, tablet portrait (approximately 768–834px), landscape (approximately 1024–1194px), narrow tablet split view and 1440px desktop; keyboard, touch and pointer |
| Adaptation | Resize/rotate during chart selection and an open edit; software keyboard and safe areas; no duplicated forms, lost state or horizontal page overflow |
| Text | 200% zoom/enlarged text, long merchants/categories, large amounts |
| Motion | Normal and reduced; cached return, refetch, theme switch |
| Data | Populated, empty, recorded zero, missing income, negative flow, partial/indicative, unknown dates/amounts |
| Network | Cold load, delayed response, initial failure, background failure, disconnect/reconnect |
| Plan | Available/unavailable forecast, uncertain schedule, unknown charge, failed edit, dismissal, agenda/calendar/date selection and partial-window loading |
| Review | Pending/handled input, duplicates/refunds/suggestions, successful and failed resolution |

Check gradient text across its full fill, badge text against its actual tinted surface, category glyphs, focus rings, charts/tooltips and controls in both themes. Existing `themeContrast.test.ts` is necessary but does not establish rendered gradient/category contrast. Target 4.5:1 for normal text and 3:1 for large text and meaningful non-text controls; colour never carries the only explanation.

Capture screenshots and short recordings of Home → evidence → detail → Back, Explore filter → merchant/evidence, and Plan edit → refresh. Verify focus order/return, accessible names, meaningful heading hierarchy, touch targets and page scrolling on an actual iPhone/Safari and tablet where available. Record unavailable device checks as remaining verification, not as passed.

### Documentation and rollout

Update only the design-language sections affected by actual decisions: new-experience brand treatment, component/radius/type mapping, static glow and amount-motion rules, state patterns, accessible theme colours and actual primary-button behaviour. Add a compact page/component usage matrix so the next page author can follow existing code. Preserve the already-completed scrolling and AGENTS reconciliation work; do not rewrite it broadly.

Keep the existing new-experience flag as the rollout boundary. Complete the local/preview build, tests and rendered review before deployment. Prepare deployment through the existing OCI process when implementation is ready and deployment is authorised. A production refresh/comparison is the final smoke check, not the first visual review. Keep the amount fallback intact in either navigation mode.

Done means all primary journeys share cashe's visual language, restore the category/trend/comparison information, replace unnecessary explanatory prose with readable visuals, preserve trustworthy money/state semantics, pass the automated checks, have reviewed light/dark captures and motion recordings, and include measured performance and comprehension results. A successful build or three colourful hero screenshots alone does not complete this work.
