# Cashe next-level audit — 2026-09-09

Audited implementation: `f4094417a51782a94a9a108c58b95ef47649edf6`, branch `feature/cashe-next-level`.

Scope: [original plan](2026-09-05-cashe-next-level-plan.md), checked against repository code, tests, and the [execution log](2026-09-05-cashe-next-level-progress.md). The implementation sequence and remaining work are in the [completion roadmap](2026-09-09-cashe-completion-roadmap.md). This audit does not change application behavior.

## Assessment

Cashe has a substantial trust foundation, an opt-in daily briefing, shared spending facts for several important consumers, and a working recurring-schedule workflow across web and Telegram. It has **not completed the planned web transformation**. Work has progressed into phase 4 while major phase-2 and phase-3 dependencies remain unfinished.

The most important distinctions are:

- Integer amounts in reporting responses are implemented; integer-money **storage, migration, and conversion provenance are not**.
- Home is a real new screen; Activity and Explore largely reuse older implementations. Four navigation labels do not mean four fully redesigned destinations.
- Safe duplicate avoidance is implemented; a workflow to resolve uncertain duplicate candidates is not.
- Schedule confirmation, pause/resume, matching, and recurring suggestion review are implemented; confirmed future charge amounts, horizon expansion, and the planned forecast are not.
- Backup tooling and synthetic restoration tests exist; operational scheduling, a real restore/boot drill, and recovery monitoring are not evidenced.
- Local deterministic reports have improved; the existing optional cloud-AI paths still conflict with the plan's free-only and personal-data restrictions.
- A manifest and icons exist; a service worker, private offline cache, offline entry queue, and Web Push do not.

No original phase should be called release-complete solely from the current test counts. In particular, the 30-second comprehension target, correction-time target, device acceptance, and four-week pilot have not been demonstrated. Assigning a completion percentage would imply comparable weights and acceptance evidence that do not exist.

## Evidence and verification limits

The latest implementation verification at this exact backend revision recorded **1,085 passing backend tests** with four existing datetime deprecation warnings. The latest frontend implementation verification recorded **88 passing tests**, a production build, and focused Review lint. Those suites were not rerun for this documentation-only audit.

Fresh audit checks:

- Reviewed migration versions 1–11, capture/outbox code, shared facts, transaction commands, routes, primary pages, auth/cache handling, subscriptions, AI callers, scheduler, recovery scripts, CI configuration, and operational notes.
- Reproduced financial query retention after the current logout cache operation using an isolated `QueryClient` with synthetic values. This verifies retention, not a live browser cross-user exploit.
- Reproduced the malformed Explore merchant redirect by evaluating the exact route-string expression.
- Ran full frontend ESLint: **45 errors and 2 warnings across 19 files**. Rules: 22 `no-explicit-any`, 14 `only-export-components`, eight `set-state-in-effect`, one `purity`, and two `exhaustive-deps` warnings. This is broader than earlier focused lint results. CI currently runs tests/build, not full lint.
- Inspected the 100,000-row benchmark and its recorded results; did not rerun it on OCI.

No production database/configuration, mailbox, cloud account, model, device, remote CI run, or deployment was inspected. No live financial data was used. Current vendor pricing, quotas, model availability, and platform distribution policies were not revalidated; the original plan's dated external claims must be checked when those work packages are implemented.

## Original phase assessment

| Original phase | Current position | Missing exit evidence or core scope |
|---|---|---|
| 1. Establish trust | Substantial implementation, operationally open | Real restored-data boot/rollback; scheduled off-host backup and monitoring; live Gmail/Wallet migration checks; remaining money and auth/cache issues |
| 2. New daily experience | Partial | Canonical money and all-consumer parity; complete Activity/Explore; richer drivers; default rollout; navigation defect; real accessibility/performance/comprehension checks |
| 3. Reduce maintenance | Partial foundations | Duplicate/merchant/refund review, bulk/undo/splits, CSV import/undo, local receipt drafts |
| 4. Improve foresight | Recurring workflow advanced, forecasting incomplete | Charge amount/date provenance, multi-cycle horizon, price/renewal explanations, weekday model/backtests, dated goal rates, scenarios |
| 5. Mobile web | Install shell and onboarding foundations only | Offline storage/queue/update handling, Web Push/preferences, strict AI controls, mobile acceptance and pilot |
| Later. Native | Deferred as intended | No native client/sync protocol; not a blocker for the web release |

## Requirement-by-requirement inventory

“Implemented” below describes a bounded capability in code/tests, not a passed production or product gate. “Partial” means the requirement has meaningful foundations but is not finished.

| Requirement from original plan | State | Implemented evidence | Remaining work |
|---|---|---|---|
| Durable Gmail/Wallet capture | Implemented core | Source observations, parser versions, precision/payment metadata, retries, history checkpoints, bounded 90-day sync, raw Wallet retention, serialized startup/cycles | Explicit older Gmail backfill controls; real-account/Shortcut checks; global legacy-credential cutover |
| Source and cross-source dedup | Partial | Stable source IDs; time/currency/type/merchant matching; namespace-aware payment identity; ambiguous/date-only rows kept separate | Candidate records, explainable merge/keep-separate decisions, reversible conflict resolution |
| Durable follow-ups | Implemented ingestion core | Capture-time trip jobs, recurring analysis/suggestion jobs, send-Future acknowledgement, five-failure cap/requeue | Scheduled briefing delivery/job receipts; consistent notification preferences; best-effort onboarding greeting |
| One transaction rule path | Partial | Shared creation/correction normalization; web/direct Telegram/NL idempotency; durable manual provenance/trip jobs; expiring persistent NL drafts | Typed v2 command interface, revisions, explicit mutation history, all-source money parity, import/offline callers, consistent downstream recomputation |
| Intake and web security | Partial | Login throttling, revocable Wallet credentials, opaque session-bound OAuth state, per-user authorization/session controls | Browser cache isolation; live credential migration; systematic new-route auth tests and logout/expiry race tests |
| Recovery and persistence | Partial | SQLite/WAL, migrations 1–11, read-only audit, encrypted backup/restore, upload verification, retention/ceiling | Representative old-data audit and orphan decisions; consistent user-DB FK enforcement; operator scheduling/heartbeat/backup-age checks and restore/rollback rehearsal |
| Shared spending interpretation | Partial | Decimal per-row SGD reporting; NULL expenses, explicit refund/transfer interpretation, absent income, negative flow, timezone/equal-window comparisons | Migrate legacy dashboards/analytics/finance consumers and all automated capture money behavior |
| Integer money, FX, settlement | Not implemented as storage model | Compatibility responses use integer minor units; corrections preserve unknown rates | Currency-aware stored precision; decimal FX provenance/date/status; statement settlement precedence; audited conversion across financial tables |
| Home briefing | Partial | Ordered opt-in screen, top-three category changes with evidence, recent five transactions, 14-day recorded charges, freshness and uncertainty | Recurring/all-history Review counts, merchant/frequency/one-off/trip drivers, default rollout, whole-briefing evidence coverage and 30-second trial |
| Activity | Partial | Existing searchable/category/date-filtered list; details; explicit remember choice; source provenance; money/date corrections; return-to-evidence/Review | Day grouping/totals, full-text/amount search, complete filter set, bulk/splits/refund/transfer UX, normalized merchant display, durable view state, undo, progressive entry, two-tap category correction |
| Explore/navigation | Partial | Four opt-in tabs, profile Settings/Review, redirects, Explore wrapper around Analytics/Merchants | Broken new merchant routes; question-driven shared-fact exploration; merchant drill-down design; complete old-link compatibility |
| Themes/accessibility | Partial | System/light/dark preference, theme tokens/charts, improved tested neutral contrast, reduced-motion support, several 44px controls, adaptive shell | Full component contrast/opacity and touch audit, ~16px mobile text, keyboard/screen-reader/enlarged-text checks, actual iPad/phone layouts, animation cleanup |
| Review inbox | Partial | Failed captures/follow-ups, handled NL inputs, all-history unresolved spending, durable recurring suggestions; shared web/Telegram resolution | Uncertain duplicates, unknown merchants, refund matches; unified counts and prioritization; richer evidence and appropriate reversible resolutions |
| Merchant correction rules | Partial | Explicit transaction-only versus remembered categories; existing overrides preserved | Bulk correction and undo, clearer rule management/impact preview, canonical merchant aliases without rewriting source evidence |
| Refunds/transfers/splits | Partial interpretation only | Shared facts interpret explicit refund/transfer types; backend correction validation accepts them | Linked/partial refunds, transfer/card-repayment workflows, splits with exact sums; UI type editor currently offers spending/income only |
| CSV statements | Not implemented | CSV **export** exists | Presets/mapping fixtures, local preview, overlap review, batch/idempotent commit/resume, settlement evidence, safe batch undo |
| Receipt capture | Not implemented | Manual entry and confirmed drafts provide reusable foundations | Bounded local image/OCR job, editable receipt draft, confirmation/idempotency, image cleanup/expiry and real receipt fixtures |
| Recurring lifecycle | Implemented bounded workflow | Durable full-name suggestions independent of Telegram; acceptance provenance; web Review; replay/deletion protection; pause/resume; one-actual-to-one-new-link guards | Source-event identity for notification suppression; observed-average currency semantics; existing duplicate-link audit before DB uniqueness enforcement |
| Upcoming timeline | Partial | 14/30/90-day views of retained pending rows, unknown estimates, correction/dismissal, pause filtering, billing links | Generate all eligible cycles in horizon, charge-level confirmed/inferred amount/date/range provenance, overdue exceptions, price increases and annual renewals |
| Forecasting and explanations | Partial legacy analytics only | Category contributions in new facts; older merchant/anomaly/straight-line calculations remain | Deterministic driver evidence; eight-week weekday baseline/four-week minimum; recurring/exception exclusions; historical scenarios, availability rules, backtests |
| Targets, goals, trips, scenarios | Partial inherited features | Budget/goal/contribution/trip CRUD and management screens, actual trip assignment | Simple overall target, contribution-date-based rates, recorded-versus-suggested goal amounts, trip/one-off baseline exceptions, non-mutating scenarios |
| Typed/private v2 APIs | Partial | Facts, evidence, Home, capture, Plan, recurring Review, provenance response models | Core Transaction/Forecast/import/receipt/command contracts; legacy raw-row response removal from redesigned clients; generated shared client types |
| Free-only/private AI | Not compliant with plan | Optional service disabled when no API key; several scheduled reports now deterministic | Fail-closed free verification; no personal-text cloud parsing; abstract-only prompts; persisted project-wide usage, limits/priorities, caching, quota fallback and lifecycle validation |
| Offline mobile web | Not implemented beyond shell | Manifest/icons, responsive pages, existing source onboarding | Asset service worker; trusted-device per-user data; durable offline drafts/idempotent sync; logout/expiry clearing; update/draft preservation |
| Notification policy/Web Push | Not implemented as planned policy | Existing Telegram sending and daily/weekly/monthly scheduler | Weekly default, per-transaction opt-in, per-user/channel preferences, durable scheduled jobs, opt-in Web Push and revoked-endpoint handling |
| Performance/operations/pilot | Partial tooling only | Synthetic 100k facts benchmark, lazy briefing/chart separation, CI tests/build configuration | OCI measurement, defined mobile LCP profile ≤2.5s, request/bundle budgets, import responsiveness, job/backup health, external heartbeat, four-week pilot |
| Native client | Deferred | React/TypeScript and some v2 contracts reusable | Explicit distribution decision, Expo/native UI, secure credentials, local DB, revisions/tombstones/sync, offline conflict and tablet tests |

## Priority findings

### A1 — Browser cache isolation is incomplete (release blocker)

[useAuth](../../src/web/frontend/src/hooks/useAuth.tsx) removes only `['currentUser']` on logout; unauthorized handling only changes auth state. [App](../../src/web/frontend/src/App.tsx) creates one long-lived QueryClient, and financial keys such as `['home-briefing']` are not user-scoped. The synthetic logout operation left `{owner: 'synthetic-a'}` retrievable under `home-briefing`.

This is a credible stale-data exposure path during account changes, not evidence that production data has leaked. Clear/cancel private queries and mutations across logout/expiry/account switches, guard in-flight responses, and test two users in the same browser before private offline caching or wider rollout. Server-side DB isolation does not solve browser cache isolation.

### A2 — Cloud AI bypasses the plan's policy (release blocker when enabled)

[LLMService](../../src/llm_service.py) enables on an API key alone and defaults to the literal model name `gemini-2.0-flash`. `parse_telegram_message` embeds original personal text; anomaly prompts include merchant and amounts; the daily scheduler submits financial summaries. [analytics alerts](../../src/web/app.py) can invoke anomaly calls during a GET, without the planned persisted quota/cache policy. The class comment saying methods never receive raw transactions does not make these inputs non-personal.

Deployment keys, billing tier, actual calls and model availability are unknown. The finding is about executable capability. Add a fail-closed local policy gate immediately; do not treat replacing a model name or removing weekly narratives as completion. Current external terms/availability must be verified before any optional re-enable.

### A3 — Financial truth still depends on the destination

[spending_facts](../../src/spending_facts.py) correctly treats legacy foreign `1.0` as unresolved. [exchange](../../src/exchange.py) can still return `1.0` for unknown currencies, [ingestion](../../src/ingestion.py) initializes rates to `1.0`, and legacy reports multiply retained floats. [Overview](../../src/web/frontend/src/pages/OverviewPage.tsx) and [Analytics](../../src/web/frontend/src/pages/AnalyticsPage.tsx) still use legacy endpoints/health scores and straight-line projection.

Consequently, the new Home/Telegram corrections do not establish whole-app parity. Fix automated conversion semantics, create the audited canonical money model, and migrate consumers before using these numbers for imports, advice, or new forecasts.

### A4 — New merchant destinations redirect incorrectly

In [App](../../src/web/frontend/src/App.tsx), both nested `/explore/merchants` routes select `LegacyRedirect(from='/merchants', to='/explore/merchants')` when the new experience is enabled. [LegacyRedirect](../../src/web/frontend/src/components/layout/LegacyRedirect.tsx) slices the current path using the old prefix length without checking that prefix.

Evaluating the existing expression maps `/explore/merchants` to `/explore/merchantserchants` and `/explore/merchants/Cafe` to `/explore/merchantserchants/Cafe`. This is a confirmed route-construction defect, not a completed browser navigation test. Render the merchant destination on new routes; apply redirects only to old routes. Existing navigation unit tests exercise the helper against old prefixes, not the real nested route composition.

### A5 — Goal and forecast labels exceed their calculation foundations

`Storage.get_goal_progress` averages the last three contribution **amounts** and calls that a monthly rate; it ignores elapsed contribution dates. `analytics.get_spending_velocity` and Overview still extrapolate elapsed-day averages. [subscriptions](../../src/subscriptions.py) maintains retained predictions but does not expand every cycle across the selected horizon. These should not be accepted as the planned dated goal projections or weekday forecast.

### A6 — Operational and quality gates remain open

[CI](../../.github/workflows/ci.yml) defines tests and build; no remotely executed result was checked. [backup tooling](../../src/backups.py) and its [runbook](../operations/backups.md) are substantive, but deployed scheduling/restore drills are unverified. `/health` is basic liveness, not source/job/backup health. The current backup archive cap is 128 MiB; check real retained evidence size before relying on it.

Full frontend lint fails as quantified above. Neutral-token contrast tests and responsive CSS do not establish full accessibility, LCP, or the product pilot targets.

### A7 — Documentation contains superseded remaining-work statements

The execution log is chronological: its early “remaining” sections are not a current backlog. [spending-facts notes](../operations/spending-facts.md) still contain statements that Home, creation idempotency, or recurring review are future work even though later slices implemented them. Use this audit for the current inventory and the roadmap for sequencing; retain historical logs rather than silently rewriting their past claims.

## Completed foundations to preserve

Preserve source IDs and observations, conservative timestamp/payment namespaces, per-user Storage locking, no live-SQLite file copying, capture-time trip semantics, historical suppression, explicit remembered-category consent, unresolved FX labels, absent income/negative recorded flow, same-period evidence reconciliation, and replay/deletion protection for commands and suggestions.

Do not replace these working paths with a broad rewrite. Complete vertical slices through the same boundaries, append migrations after version 11, preserve compatibility until users move, and keep external acceptance separate from local code/test completion.
