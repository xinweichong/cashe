# Cashe completion roadmap — 2026-09-09

Baseline: `f409441`. Read with the [implementation audit](2026-09-09-cashe-next-level-audit.md) and [original product plan](2026-09-05-cashe-next-level-plan.md). This is a proposed execution plan, not a record of completed implementation or an authorization to deploy.

## Delivery decision

Keep the existing monolith, SQLite/WAL, per-user databases, source-event/outbox foundation, and React web client. Finish the web release before native distribution. Keep the new experience opt-in until financial parity, privacy, navigation, and device gates pass.

The next increment should **not** simply be another recurring feature. Fix the audited cache, route, and AI-policy gaps first. Then establish canonical money and command contracts, so imports, splits, forecasts, and offline entry share dependable primitives.

Operational validation starts immediately alongside code work. It cannot be deferred to the final deployment day. AI enrichment can remain disabled throughout core product development; deterministic functionality is the release fallback.

## Ordered work packages and sizing

Estimates below are initial engineering allowances for one engineer familiar with this repository, including tests and documentation. They are not elapsed-time promises. They exclude waiting for accounts/devices/statement samples and exclude native work. Re-estimate after the money audit and first import preset.

| ID | Deliverable | Dependencies | Engineer-days |
|---|---|---|---:|
| R00 | Close privacy/navigation blockers and establish quality baseline | None | 3–5 |
| R01 | Prove deployed recovery and source/job health | Start now; production changes follow reviewed artifacts | 3–6 |
| R02 | Canonical money, FX/settlement provenance, audited migration | R01 isolated snapshot/audit capability | 7–12 |
| R03 | Typed transaction commands, revisions, mutation history | R02 schema/contract decisions | 4–7 |
| R04 | Shared-fact parity across existing consumers | R02; R03 for mutation invalidation | 5–8 |
| R05 | Refund/transfer/split workflows | R02–R04 | 5–8 |
| R06 | Complete Review and merchant correction workflows | R03–R05 | 4–7 |
| R07 | CSV preview, overlap review, import/resume/undo | R02–R06 | 7–12 |
| R08 | Local receipt OCR and confirmed drafts | R03; R07 intake/evidence conventions | 4–7 |
| R09 | Complete Activity and progressive quick entry | R03–R06 | 5–8 |
| R10 | Evidence-backed Home and question-driven Explore | R04, R06; progressively consume R09/R11 | 5–8 |
| R11 | Complete commitment horizon and change explanations | R02–R04; reuse current recurring workflow | 4–7 |
| R12 | Weekday forecast, uncertainty and backtests | R04–R06, R11; capture-health inputs from R01 | 5–9 |
| R13 | Optional targets, dated goals, trip exceptions, scenarios | R03–R04, R12 | 4–6 |
| R14 | Trusted-device cache and offline drafts | R00, R03, R09–R10 | 7–12 |
| R15 | Notification preferences, durable schedules, Web Push | R01, R10, R14 service-worker foundation | 3–5 |
| R16 | Optional verified-free, minimized AI | R00 gate, R04/R10 deterministic facts | 3–6 |
| R17 | Accessibility, performance, rollout and pilot closure | Incremental throughout; all required web packages before closure | 5–8 |
| R18 | Native client | Deferred decision after web release | Separate estimate |

The web packages total approximately **83–141 engineer-days (17–29 engineer-weeks)**, plus a four-week personal pilot that can overlap final hardening. This is a fresh remaining-scope estimate, not the original plan's 10–16-week estimate carried forward. The original scope still contains several large unimplemented systems. More calendar concurrency does not remove their data-model dependencies.

Suggested checkpoints:

1. **Safe baseline:** R00 and the first R01 restore/health evidence.
2. **One financial answer:** R02–R04; no redesigned consumer silently calculates a different amount.
3. **Low-maintenance ledger:** R05–R09; statements and corrections replay/undo safely.
4. **Useful foresight:** R10–R13; evidence explains changes and forecast components reconcile.
5. **Independent mobile web:** R14–R16; offline/privacy/quota behavior works without paid AI.
6. **Web release:** R17 and four-week pilot gates. Native remains deferred.

## R00 — Close the immediate release blockers

Make separate reviewable commits for cache isolation, routing, and AI gating.

**Implementation**

- In `hooks/useAuth.tsx` and `App.tsx`, establish an authenticated-user cache boundary. Cancel in-flight private requests/mutations on logout/expiry, clear private query data, and prevent late responses from populating the next user's cache. Scope private keys by user/session generation or create a fresh user-bound QueryClient. Preserve only explicitly non-sensitive preferences such as appearance.
- Ensure failed logout does not silently restore the old authenticated view. On a later login, refresh the server session identity before mounting private screens. Include cross-tab logout/expiry behavior in the design.
- Render `MerchantsPage` on the new `/explore/merchants` routes. Keep `LegacyRedirect` on old paths only; add a prefix guard if the helper remains generic. Test actual App route composition, not just the string helper.
- Add a fail-closed gate before constructing `LLMService` or calling any cloud method. API-key presence alone is insufficient. Until free-project and minimized-input requirements are met, use deterministic wording and local/direct entry; private NL text must not cross the cloud boundary.
- Record the full lint baseline, fix rules or code intentionally, and ratchet it down. Do not blanket-disable hooks/purity rules to obtain a green build. Separate fast-refresh export convention decisions from genuine lifecycle problems. Add a CI no-new-lint-debt check initially, then require clean full lint before release.
- Reconcile stale “remaining work” statements in operational docs with the audit; keep the historical execution log intact.

**Exit checks**

Two synthetic users in one browser cannot see each other's cached financial values after logout, 401 expiry, slow response completion, or account switch. Both new and old merchant deep links preserve suffix/query/hash and render a merchant view. AI client/call spies show zero calls without the approved gate, including NL, daily jobs, and analytics GET paths.

## R01 — Close the operational trust gate

**Implementation**

- Extend `scripts/db_audit.py`/runbooks to cover new financial relations as they arrive, distinguishing actual foreign-key errors from deliberately retained deleted-transaction/schedule links. Audit isolated restored old snapshots before initialization.
- Prepare versioned operator service/timer or cron artifacts for `scripts.backup`, protected bucket/key configuration, byte-ceiling checks, and single-job execution. Keep encryption keys separately off-host. Check the current 128 MiB archive input cap against actual retained source evidence; change it only with measured memory/storage limits and tests.
- Add persisted per-job run metadata and a private health summary: last started/succeeded, bounded error code, oldest queued item, exhausted retries, capture/source freshness, and verified backup age. Basic public `/health` should remain minimal liveness.
- Configure an external heartbeat/overdue-backup alert through reviewed deployment artifacts. Verify actual OCI/R2 allocation and unrelated account usage; do not assume the original plan's dated free allowances.
- Exercise test Gmail history expiry/backfill and real Wallet credential upgrade. Expose an explicit older-backfill request with a date range, bounded pages, persisted progress/cancellation, and historical follow-up suppression.
- Decide and validate repair of genuine orphaned relationships before consistently enabling foreign keys on user DB connections. Do not delete retained evidence merely to make the audit green.

**Exit checks**

Create an encrypted off-host snapshot, restore it into an isolated directory, boot with external capture/AI/notifications disabled, compare identities/counts/money/source links, then rehearse rollback plus later source-event replay. Demonstrate a failed/overdue backup alert and a missing heartbeat. Complete a real Shortcut credential migration before globally closing legacy unauthenticated intake. Attach evidence; local fake-cloud tests alone do not close this package.

## R02 — Establish canonical money and audited migration

**Implementation**

- Introduce a small `money.py` domain module with currency exponent lookup, integer minor-unit conversion, Decimal arithmetic, and explicit rounding. Unsupported currency precision remains reviewable; never assume every three-letter code has two decimals. Define safe JSON/client numeric bounds.
- Append migrations after version 11. Add canonical original amount/currency precision and reporting/settlement values with conversion status, decimal rate, source, quote/effective date, and settlement evidence link. Exact field names should be settled in a short schema decision before coding.
- Cover transactions, budgets, goal targets/contributions, and subscription predictions; explicitly define SGD-only values versus original-currency values. Do not introduce balances or an account ledger.
- Preserve old columns/source IDs, immutable observations, manual snapshots, and user corrections during transition. Produce a dry-run report for unknown currencies, non-finite/negative values, ambiguous legacy rates, rounding differences, missing dates, and orphaned links. Do not infer refunds from old income.
- Replace `ExchangeRateService.get_rate`'s numeric-only fallback contract with a conversion result carrying status/provenance. Unknown is unresolved, never `1.0`. Indicative quotes remain usable only with their label. Actual statement settlement takes precedence without destroying the indicative/original evidence.
- Shadow-read old and canonical calculations behind a flag, reconcile differences, then switch readers/writers. Keep old-reader compatibility deliberate and temporary; avoid two independently authoritative ledgers.

**Exit checks**

Golden fixtures for zero-, two-, and three-decimal currencies, large values, unknown codes, missing/legacy parity rates, settlement precedence, per-row rounding, and preserved corrections. Upgrade twice without change; compare all financial-table totals on representative restored data. No writer silently creates a resolved foreign conversion from missing data. Rollback uses the validated snapshot/replay procedure.

## R03 — Finish shared transaction commands and v2 Transaction

**Implementation**

- Build on `transaction_validation.py`, `Storage.create_manual_transaction`, existing request receipts, and the ingestion outbox. Extract shared orchestration only where multiple real callers need it; keep parser-specific receipt handling separate.
- Define typed v2 `Transaction` and create/correct/delete results containing classification, canonical Money, conversion/provenance summaries, revision, and optional relation IDs. Exclude raw payloads, credentials, internal source IDs and arbitrary DB columns.
- Generate TypeScript contracts from the v2 API schema and check for contract drift in CI; migrate callers incrementally while keeping v1 compatibility explicit.
- Add revision numbers, retained deletion records, and mutation history sufficient for safe undo. Updates accept an expected revision and return 409 with a safe current-state summary on conflict. A retry key binds to the accepted command fields; replay after deletion must not recreate it.
- Route web, direct Telegram, confirmed NL, later imports/OCR/offline drafts through the same monetary validation and mutation transaction. Preserve existing source identity conventions and capture-time trip behavior.
- Specify invalidation/recomputation for corrections, split/refund changes, trip membership, recurring links, reports and evidence. Capture metadata remains original evidence, not edited transaction truth.

**Exit checks**

Concurrent correction conflict, same-key/different-payload conflict, crash/replay, atomic remember-rule updates, undo after an intervening edit, deletion/replay, and identical accepted values across clients. Add auth/privacy tests for each new route and compatibility tests for callers still using v1.

## R04 — Migrate every financial consumer to shared facts

**Implementation**

- Extend `spending_facts.py` to canonical money and reusable selection/evidence primitives. Preserve equal elapsed periods, weekday alignment, local timezone projection, NULL expenses, absent income, signed refunds and negative net flow.
- Inventory and migrate `analytics.py`, Overview/Analytics/Merchants APIs, budget/trip summaries, goal contexts, remaining Telegram analytics commands and scheduled calculations. Legacy endpoints become adapters over shared results; remove duplicated arithmetic only after parity checks pass.
- Provide shared trend, merchant/category contribution, trip, and forecast-input contracts. Evidence selections must reproduce the corresponding number, including pagination-independent totals and separate comparison windows.
- Remove or qualify legacy financial scores/advice where required observations are absent. Keep recorded-data resolution distinct from capture completeness.

**Exit checks**

The same fixture produces equal money/classification on Home, Explore, Activity day totals, finance views, Telegram, and exports. Test refunds across months, transfers/card repayments, sparse income, timezone offsets, unresolved FX, and end-of-short-month comparisons. Record intentional compatibility changes rather than retaining a wrong legacy total to satisfy parity.

## R05 — Add correct refunds, transfers and splits

**Implementation**

- Add explicit commands to mark an expense/income/refund/transfer and link or unlink refunds. Retain incoming refunds in their receipt period; link to the original purchase as evidence without rewriting that original period. Partial/multiple refunds and incompatible currencies need explicit validation/review.
- Represent category splits as child allocations with integer minor units and one parent economic event. Allocations must sum exactly to the parent; reporting uses allocations once, while capture/source identity remains at the parent.
- Exclude explicitly identified transfers/card repayments from spending without adding an account ledger. Preserve historical unknown classifications until the user or reliable source resolves them.
- Add accessible detail controls, undo, and revision conflicts. Adapt refund linking and split corrections to shared evidence and recurring/CSV overlap behavior.

**Exit checks**

Exact split sums and rounding, split/refund overlap, partial refunds, linked purchase deletion, cross-month refunds, explicit transfer exclusion, legacy NULL expense inclusion, and undo without changing unrelated or original evidence rows.

## R06 — Complete Review and merchant maintenance

**Implementation**

- Retain current capture/spending/recurring groups. Add structured duplicate candidates, unknown-merchant/category issues, and refund-match proposals with stable reason codes, evidence references, and resolution state.
- For duplicates, show why observations might match and why automatic reconciliation stopped. Support keep-separate and merge/link with revision checks, a chosen survivor, preserved source IDs/observations, and a recorded reversible decision. Resolve category/split/trip/recurring conflicts explicitly.
- Avoid arbitrary global dismissal of unresolved money. Derived issue membership should continue to reflect corrected facts; retain decisions only where they represent a user's judgment.
- Add merchant display aliases and rule impact previews without rewriting raw descriptions. Bulk recategorization remains transaction-only unless remembering is explicit; undo must not overwrite later rule edits.
- Expose one safe review summary for Home/Activity, including all-history unresolved spending and recurring suggestions. Distinguish distinct affected transactions from issue counts to avoid misleading double counts.

**Exit checks**

Ambiguous same-amount purchases stay separate until an explicit decision; different currencies/date-only evidence never get loose automatic merges. Merge/unmerge retains links and exact totals. Cross-user access, stale resolution, restored issues, remembered-rule consent, and duplicate issue counts are covered.

## R07 — CSV import as the first new intake channel

**Implementation**

- Add `imports.py`, versioned mappings/presets, and sanitized DBS/UOB fixture formats supplied from actual statements. Bound file size/rows; normalize encoding/date/currency fields without logging contents.
- Add import batches and per-row records with source identity `(batch, row identity)`, parser/mapping version, parse result, proposed match, and applied/reused transaction references. Byte-identical upload replay and overlapping different statements are separate cases.
- Implement typed upload/mapping/preview/overlap-resolution/commit/status/undo endpoints and an Activity import flow. Preview must be side-effect-free with respect to the ledger; transient files have explicit expiry.
- Commit in resumable bounded chunks with row idempotency through R03. Preserve legitimate identical rows within a statement. Use R06 decisions for ambiguous overlaps; date-only imports must not be matched by a fabricated midnight timestamp.
- Import settlement evidence through R02 precedence. Historical batches suppress routine notifications and active-trip assignment.
- Batch undo removes only newly created records and owned links/mutations that are still safe to reverse. Never delete a pre-existing matched transaction or silently erase subsequent user edits; surface revision conflicts and retained results.

**Exit checks**

Repeated upload, overlapping statements, repeated identical purchases, interrupted batches, mapping revisions, foreign settlements, concurrent user corrections, and safe undo. Measure event-loop responsiveness and query behavior during a large synthetic import.

## R08 — Local receipt drafts

**Implementation**

- Add a bounded local upload/camera endpoint, one-at-a-time Tesseract worker, transient file permissions, and persistent job/draft status. Validate decoded image dimensions/size, enforce execution time limits, and avoid cloud OCR.
- Extract candidate merchant/date/currency/total plus uncertainty into an editable draft. Reuse R03 confirmation and idempotency; no OCR output writes a transaction automatically.
- Delete original images after extraction or expiry; retain accepted fields and minimal provenance. Define retry behavior after image deletion and cleanup after a crash. Do not accidentally include transient receipt images in long-retention backups.
- Provide manual completion and clear extraction-failed states. Keep optional information progressively disclosed.

**Exit checks**

Actual sanitized receipt formats, ambiguous totals, unsupported images, oversized/decompression-heavy inputs, worker interruption, image cleanup, repeated confirmation, and account isolation. Record extraction quality rather than promising universal receipt accuracy.

## R09 — Complete Activity and quick entry

**Implementation**

- Migrate to v2 transactions. Group by configured local day with shared-fact daily totals; handle a day spanning pagination boundaries without duplicate/missing totals.
- Search merchant/display alias, description, category, and amount. Add expense/income/refund/transfer, source, trip, and review-state filters. Encode shareable filters in the URL; retain selected row and restore a scroll anchor on detail close/back navigation.
- Add bulk selection/categorization, R05 relation controls, undo and visible revision conflicts. Preserve original descriptions and sanitized multi-source provenance.
- Make amount/merchant the first quick-entry fields; show currency/date/category/notes/trip as needed. Cash is an expense source/payment choice.
- Provide a direct category picker after opening details so selection/save takes at most two taps. Short tasks use bottom sheets; longer edits use a full screen. Keep adaptive desktop/iPad list-detail panels and persistent actions.

**Exit checks**

Real route tests for deep link/back/forward, page-boundary daily totals, large-list selection, filters after edits, two-tap categorization, undo conflicts, keyboard and touch targets, and no stale user cache.

## R10 — Finish Home and Explore as the daily experience

**Implementation**

- Add deterministic driver results to shared facts: merchant/category contribution, frequency versus average-size changes, newly increased commitments, explicit one-offs and trips. Give each driver an evidence selector and disclose when overlapping explanations cannot be added together.
- Add the R06 review summary to Home, including recurring and all-history unresolved records. Keep recent five, absent income, negative recorded flow, uncertainty and capture freshness visible; avoid replacing observable facts with a health score.
- Replace Explore's inherited dashboard-first composition with the five original questions, ranked bars/lines and evidence. Merchant profiles become drill-downs. Complete old-link redirects without new-route loops.
- Keep initial useful Home content independent of chart bundles and unnecessary auxiliary requests. Finish light/dark, typography, state and accessibility work as part of each screen.

**Exit checks**

Every displayed driver/amount opens exactly supporting transactions; top-three ordering is deterministic; unavailable comparisons do not become zero. A user can identify the month's main change and the next required action within 30 seconds in a defined task study. Keep the feature flag until R17 rollout gates pass.

## R11 — Finish commitments before forecasting

**Implementation**

- Keep existing durable suggestions, pause/resume, correction/dismissal and shared matching commands. Add charge-level date/amount/range provenance; distinguish a confirmed schedule from a confirmed bill amount. Correct the detector's observed-average currency semantics using canonical amounts and evidence.
- Generate every eligible pending cycle in a requested horizon with a stable schedule/period identity and explicit exceptions. Monthly end-of-month, weekly, quarterly and annual schedules must not drift. Preserve manually corrected/dismissed periods and paused schedule dates.
- Add overdue review, deterministic price-change comparisons/annualized impact, and annual-renewal surfacing with supporting charges. Existing `explain_subscription_change` text generation is not this feature.
- Audit legacy duplicate matches before adding a DB uniqueness invariant for new links. Preserve decisions/retained history; do not repair duplicates silently during migration. Matched actual charges must replace forecast commitments once.

**Exit checks**

Leap/end-of-month horizon expansion, multiple annual/monthly occurrences, retained overrides/dismissals, pause/resume, price changes in different currencies, actual match/rematch conflicts, and one-purchase-one-commitment accounting.

## R12 — Implement the specified forecast

**Implementation**

- Add a pure `forecast.py` and typed authenticated `/api/v2/forecast`: recorded actuals, unpaid confirmed commitments, remaining variable estimate, lower/upper historical scenarios, assumptions, evidence references, and unavailable reasons.
- Use weekday medians from the previous eight complete weeks; require four eligible complete weeks. Define observed-zero days separately from capture gaps. Remove confirmed recurring actuals and only explicitly exceptional purchases/periods from the variable baseline; actual totals remain unchanged.
- Project remaining weekdays, add unmatched confirmed commitments once, and show inferred commitments separately if included only in scenarios. Refund/transfer treatment must follow R04/R05 semantics.
- Qualify or suppress results for insufficient history, source gaps, unresolved conversion, or unpriced required commitments. Historical scenario bands are not statistical confidence intervals.
- Build rolling-origin backtests against the current straight-line calculation with no future-data leakage. Keep the old forecast behind a compatibility flag until relevant cases improve; never rename it as the new method.

**Exit checks**

All forecast components sum exactly; actual matching removes one unpaid commitment; four/eight-week and weekday boundaries hold; exceptions stay in actuals. Publish backtest methodology/results for sparse histories, trips, one-offs, outages, refunds, and recurring-heavy months. Investigate regressions instead of asserting the median model must always win.

## R13 — Make optional intentions and scenarios honest

**Implementation**

- Offer one overall spending target using existing budget settings and shared facts. Label remaining against target, never safe-to-spend or bank balance.
- Replace `get_goal_progress`'s average-contribution-as-monthly-rate formula with dated contributions over explicit elapsed windows. Separate actually recorded saved amounts from proposed future contributions; sparse histories produce unavailable estimates rather than invented rates.
- Add explicit trip/purchase/period baseline-exclusion flags. Excluding a trip from usual spending never removes it from actual totals or evidence.
- Add read-only scenario requests for one-off exclusion, category reduction, and subscription removal. Return base forecast, labeled hypothetical adjustments and result; reuse R12 components. No scenario writes transaction, goal, or schedule state.

**Exit checks**

Same contribution amounts on different dates produce different rate estimates; target/remaining values preserve unknowns and negative flow. Scenario requests leave DB counts/revisions unchanged and cannot double-remove a matched recurring charge. Trip actual totals remain identical before/after baseline exclusion.

## R14 — Complete private offline mobile web

**Implementation**

- Add a versioned asset service worker. Cache the application shell deliberately; do not cache private API responses by default or OAuth/credential payloads.
- Add explicit trusted-device opt-in and per-user IndexedDB storage for bounded recent briefing/activity. Show saved-on-device and last-updated states. Design expiry, logout, account changes, and encryption/OS-storage limitations explicitly.
- Persist manual-entry drafts with stable idempotency keys before acknowledging local save. Upload on foreground reopening/reconnection after authentication, handle 409/revision conflicts, and retain failed drafts for correction. Never promise upload while the app is closed.
- Coordinate worker activation/version updates with unfinished drafts. R00 private cache cancellation/clearing must also cover persistent stores and cross-tab events. Define how logout protects or discards private drafts without exposing them to a later user.

**Exit checks**

Airplane-mode launch with/without cached assets, authenticated versus expired sessions, repeated reconnect, app update with unfinished drafts, storage eviction, logout/account switch, and two tabs. A retry creates one transaction. Cache/drafts are not described as backups.

## R15 — Notification policy and Web Push

**Implementation**

- Introduce per-user/channel preferences with one weekly briefing as the default and routine transaction notifications opt-in. Daily/monthly digests, useful-change/reconnect alerts and budget notifications must obey explicit settings.
- Persist scheduled run/delivery identities so a restart does not regenerate the same period's briefing or lose scheduled work. Keep at-least-once delivery limits explicit; coalesce appropriate alerts and honor revocation.
- Add authenticated push subscription create/delete endpoints, protected endpoint/key storage, and a server worker. Request browser permission only after an explanatory user action. Remove expired endpoints and honor logout/device revocation.
- Use the R14 worker and real iPhone/iPad Home Screen tests; verify current platform support before writing compatibility claims.

**Exit checks**

No routine messages without opt-in, weekly period identity across restart, timezone scheduling, denied permission, unsubscribed devices, expired push endpoints, and no private push routing across users.

## R16 — Optional free AI, with a deterministic release path

**Implementation**

- Keep R00's gate closed unless the operator verifies the current project's billing is unlinked/free, actual quotas, applicable data terms, and supported model availability. Revalidate the original plan's replacement candidate instead of assuming it remains suitable.
- Replace private cloud NL parsing with local parsing or manual completion. Cloud wording receives only approved generic pattern identifiers/placeholders; insert names, values and personal context locally. If minimization cannot meet the policy, use built-in wording.
- Persist project-wide request/token usage, reservations for concurrent calls, per-user period identities, cache keys tied to facts/template versions, and exhaustion/error states. Prioritize explicit user requests over background prose. No paid fallback, project rotation, or automatic model substitution.
- At most one daily narrative and one per weekly/monthly period if enabled. Remove model calls from ordinary analytics GET loops. Retain deterministic facts as the authority and validate model output against a strict safe schema.

**Exit checks**

Zero calls when verification is absent/expired, quota is exhausted, inputs are personal, or the model is unavailable. Synthetic prompt capture contains no merchant names, personal values, source payloads or user text. Concurrent quota reservations do not exceed configured limits. Invalid output and provider failure leave the complete deterministic product usable.

## R17 — Product acceptance and rollout

Do these checks incrementally, then collect final evidence in one release checklist.

- Complete full lint/CI and regression gates, including actual route composition and cache-account transitions. Re-run synthetic 100k benchmarks after money/relations/import changes on OCI; add indexes or caching only for measured bottlenecks. Compare to the recorded spread-history and dense-period baselines.
- Define the phone/network/device profile and measure mobile LCP ≤2.5 seconds, initial requests, first-useful-briefing/chart-bundle separation, and responsive imports. Backend query benchmarks are not LCP evidence.
- Verify portrait phone, iPad split view, desktop keyboard, 200% text, screen reader, reduced motion, light/dark, contrast/opacity, 44px targets, slow/error/stale/offline states. Fix misleading zeroes and forced desktop scroll rules where they remain.
- Rehearse upgrade and snapshot/replay rollback on representative old data; obtain real capture, heartbeat and backup-age evidence from R01. Stage default navigation changes gradually under the existing flag.
- Run the four-week personal pilot before additional users. Record weekly correction minutes, missed-capture incidents, explanation/evidence openings, and whether the initial briefing answered the task. Keep measurement local/private and avoid storing transaction content as telemetry.
- Close the release only when the user can understand the month in 30 seconds, category correction meets two taps after opening, correction time is under five minutes/week during the pilot, explanations reconcile, capture continues with clients closed, and free-AI/offline/security gates pass.

If a target fails, keep the corresponding flag/gate open and file a concrete follow-up; do not mark it complete because tests or elapsed pilot time look sufficient.

## R18 — Native, explicitly deferred

After the standalone web release and an explicit decision accepting installation/distribution upkeep, reuse R03 contracts, revisions/deletion records, formatting and suitable local logic. Build React Native/TypeScript with Expo and native components, local SQLite, platform secure credentials, revocable device sessions, cursor-based incremental sync, explicit edit conflicts, offline drafts, tablet navigation and camera integration. Keep server capture running independently.

Verify current signing/distribution constraints and free local tooling at that time. Native is a separately estimated milestone, not an implicit requirement to finish the web rollout or a reason to delay it.

## Execution discipline and review artifacts

For each work package, deliver small increments: schema/contract and regression fixture; command/query behavior; UI integration; compatibility adapters; documentation and gate evidence. Commit only coherent verified increments. Append migrations, preserve observations/IDs and corrections, and avoid opportunistic rewrites of `Storage` or the UI.

A package is complete only when its observable behavior, adverse-path tests, compatibility/migration checks, and relevant product/operational evidence are attached. Update the execution log and this roadmap's status rather than advancing by commit count.

Inputs to collect early: representative isolated old snapshots; sanitized DBS/UOB statements and receipts; a test Gmail account and Wallet Shortcut; iPhone/iPad access; protected backup destination/key arrangements; and operator verification of cloud allocation/free-AI status. Missing external inputs can block an acceptance gate while independent local implementation continues. Do not request or commit secrets in repository documents.
