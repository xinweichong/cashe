# Cashe next-level execution log

Working branch: `feature/cashe-next-level`, created from `develop` on 2026-09-05. The original plan remains the product scope. This log records incremental implementation; the five-phase transformation is **not complete**.

## First trust-foundation slice implemented

- Transactional, ordered additive migrations, shared with production-backed test fixtures.
- Durable source observations with status, attempts, parser version, raw evidence, and linked transaction IDs.
- Gmail capture independent of unread labels; bounded 90-day initial/resynchronization; persisted page progress and incremental history checkpoints.
- Captured-message retries, explicit unrecognized events, checkpoint-expiry recovery, and idempotent poller startup.
- No notifications or current-trip assignments for historical Gmail backfills.
- Cross-source reconciliation checks transaction time, currency, classification, amount, and merchant. Date-only, missing-time, and ambiguous observations remain separate. Repeated observations retain provenance, and an existing match cannot absorb a second observation from the same source.
- Serialized ingestion across concurrent Wallet/email requests. Parsed Wallet failures have a scheduled bounded retry path even when Gmail is disconnected.
- Authenticated, typed capture-issue list/retry endpoints, excluding raw payloads and source identifiers.
- Wallet ingestion consistently goes through the pipeline. Wallet credentials can be generated, rotated, and revoked through guided setup. Existing Shortcuts remain compatible until the first authenticated request completes the upgrade.
- Session-bound, opaque, expiring, single-use OAuth state; Telegram reauthorization directs users to authenticated Settings. User login has attempt throttling.
- Legacy NULL-type expense rows included in previously inconsistent reporting queries; budget date boundaries use `local_now()`.
- Encrypted SQLite backup/restore CLI, integrity/checksum verification, R2 upload verification, storage ceiling, and 30-day/12-month snapshot retention. Operator instructions: `docs/operations/backups.md`.
- CI configuration for backend tests, frontend tests, and production build.

## Verification

- Backend: **662 passed**, four existing datetime deprecation warnings.
- Frontend: **35 passed**, production build passed.
- Capture tests include read-independent capture, pagination, interrupted page replay, expired history, unrelated-mail exclusion, commit/crash replay, concurrent sources, poison-event retry limits, and distinct currencies/types/dates.
- Security tests cover OAuth forgery/expiry/session revocation/replay, login throttling, Wallet credential upgrade/rotation/revocation, authenticated capture retries, and exclusion of raw payloads from public issue responses.
- Recovery tests restore committed WAL transactions and protected synthetic credentials, reopen through production migrations, reject tampering/wrong keys/unsafe paths/overwriting existing destinations, and verify remote retention only follows successful upload verification.
- Cloud transport was tested with a fake client. No production mailbox, database, R2 bucket, or OCI service was modified. CI has been configured locally but has not run on GitHub yet.

## Remaining trust work before the phase-1 exit gate

1. The transaction/recurring/trip outbox is implemented in the continuation below. The separate one-time Wallet setup greeting still uses best-effort delivery. Outbox delivery is at least once, with bounded automatic retries and explicit requeue after exhaustion.
2. Explicit timestamp precision/payment identity and invalid Wallet capture are implemented in the continuations below. Legacy evidence remains conservatively unknown. Ambiguous candidates are preserved rather than merged; duplicate review/resolution is still pending.
3. Configure OCI daily backup scheduling, protected R2 credentials, backup-age monitoring, and an external heartbeat; complete a real isolated restore/boot drill. Keep the encryption key off-host separately.
4. Verify the Wallet credential upgrade on a real iPhone Shortcut, and OAuth/capture against a test Gmail account. Complete user migration before globally disabling legacy unauthenticated intake.
5. A read-only database audit CLI is implemented below. Run it against representative old production snapshots and validate upgrade/rollback in isolation; automated migration/recovery/audit tests still use synthetic data.
6. Complete shared monetary semantics, unresolved FX handling, and date/period consistency as the spending-facts interface is introduced. Float storage and indicative FX fallbacks remain in this slice.

## Subsequent phases remain open

- Phase 2: shared spending facts, integer money migration/audit, Home briefing, four destinations, light/dark themes, evidence drill-downs, revised design language, accessibility checks.
- Phase 3: full review inbox, explicit merchant-rule corrections, CSV preview/import/undo, refunds/transfers/splits, local OCR drafts.
- Phase 4: upcoming timeline, recurring confirmation, weekday forecasts/backtests, optional targets/goals, scenarios.
- Phase 5: offline drafts and trusted-device cache, Web Push, onboarding refinements, privacy-preserving/free-only AI controls, real-device checks, four-week personal pilot.
- Native client remains deferred as specified in the original plan.

The first slice was subsequently committed by the user. On resuming on 2026-09-06, the working tree was clean at `19c9dc5` on `feature/cashe-next-level`.

## 2026-09-06 continuation — persist Wallet requests before validation

- Authorized Wallet request bodies now enter `source_events` before JSON/schema validation or bank parsing. The `wallet_request` observation stores exact bytes as base64 text, keyed by a full request-body SHA-256 hash; it does not store request headers. Base64 is an encoding, not encryption.
- Parsed `apple_wallet` events and transaction source IDs retain the existing hash convention. Raw observations link to the same transaction, including differently formatted requests that parse to the same purchase.
- Missing fields, invalid field types, malformed JSON/encoding, blank merchants, and non-finite amounts become `unrecognized` capture issues. Responses and retry logs exclude raw validation inputs. Unauthorized requests are rejected before capture.
- The existing capture retry worker replays pending/failed raw requests through the same validation and ingestion path. Invalid observations require an explicit retry and return to `unrecognized` if still invalid. Raw and parsed events are not retried twice from the same worker snapshot.
- Crash/replay tests cover interruption before parsing and after transaction commit but before linking raw evidence. Persistent storage failures stop after five processing attempts.
- This completes the raw Wallet observation part of remaining item 2 only. The durable follow-up outbox is still the next major trust slice; timestamp/payment metadata, duplicate review, monetary semantics, and operational/device verification remain open.

Verification: **674 backend tests passed**, with the same four existing datetime deprecation warnings; **46 focused Wallet/ingestion tests passed**. `git diff --check` passed. No frontend changes, commit, push, or deployment in this continuation.


## 2026-09-06 continuation — durable ingestion follow-ups

The Wallet capture slice was committed as `53d1dd6` (`feat: persist Wallet requests before validation and replay capture`) before starting this work.

- Additive migration 2 introduces `ingestion_outbox`. New pipeline transactions and their trip, recurring-analysis, and transaction-notification jobs commit atomically; an outbox insertion failure rolls back the transaction. Existing transactions are not retroactively notified.
- Trip jobs retain the capture-time trip ID and enlist idempotently. Deleted transactions or deleted destination trips are skipped. Historical capture creates no follow-ups.
- Recurring analysis errors are retained for retry. Successful analysis and its suggestion job commit together, so retrying a failed suggestion does not require recalculating the pattern. Existing subscriptions suppress suggestions.
- Gmail and Wallet transaction notifications share the pipeline callback. Telegram bridges return their send Futures; jobs complete only after the Future succeeds (30-second wait limit). Users with no linked Telegram remain silent; unavailable handlers leave jobs pending.
- A per-user Storage dispatch lock serializes workers without holding the SQLite/reconciliation lock during delivery. The existing 120-second capture retry job also processes the outbox. Five recorded failures stop automatic processing; a crash before acknowledgement leaves the job eligible for replay.
- Authenticated typed `GET /api/v2/capture/followups` and `POST /api/v2/capture/followups/{id}/retry` expose status and explicit recovery, excluding job payloads. The review UI remains a later slice.
- Delivery is **at least once**, not exactly once: a crash after Telegram accepts a message but before SQLite acknowledges it can repeat the message. Tests explicitly verify this boundary. This worker assumes the existing one-process deployment and one Storage instance per user.
- The separate first-Wallet onboarding greeting remains best-effort. Manual/Telegram transaction commands still need the planned shared command interface; this slice covers the existing Gmail/Wallet ingestion pipeline.

Verification: **688 backend tests passed**, with the same four existing datetime deprecation warnings. Coverage includes transaction/outbox rollback, disk reopen after commit, deduplicated replay, failed Telegram Futures, recurring-analysis/suggestion recovery, capture-time trip assignment, bounded/manual retries, historical suppression, deletion, concurrent workers, post-send crash replay, and authenticated payload-free APIs. `git diff --check` passed. No frontend changes or production services touched. The outbox continuation was committed together with reconciliation metadata on the next resume.


## 2026-09-06 continuation — explicit reconciliation evidence

- Additive migration 3 stores `timestamp_precision`, `payment_identity_kind`, and `payment_identity` on source observations. Existing rows keep their payloads/IDs and receive `unknown` precision; historical evidence is not guessed from midnight timestamps.
- Parsed observations use evidence format/parser version 2 and retain metadata across pending-event replay. Defaults keep old serialized ParseResults readable.
- UOB card purchases and accumulated transit declare date-only precision while retaining their existing midnight transaction strings. Timed UOB alerts declare minute precision; malformed times remain unknown. DBS PayLah declares minute precision when time is supplied and uses `local_now()` for its inferred year; the omitted-year limitation remains.
- Wallet records second/minute/date/unknown precision according to the supplied timestamp and preserves normalized card labels as `wallet_card_label`. UOB card suffixes and incoming PayNow account suffixes use separate namespaces. Wallet source hashing remains unchanged, including its empty card slot.
- Cross-source matching requires explicit minute/second evidence on both sides. Genuine midnight purchases still match; date-only, malformed, and legacy unknown observations remain separate in either arrival order. Conflicting identifiers within the same namespace exclude candidates; incomparable or missing identifiers do not override the existing time/merchant/amount/currency/type checks.
- Source metadata remains excluded from public capture-issue responses. No existing transactions are rewritten or merged automatically. A duplicate-resolution interface is still required for preserved uncertain observations.

Verification: **713 backend tests passed**, with the same four existing datetime deprecation warnings. Added 25 cases covering date-only arrival order, true midnight matches, legacy unknown evidence, comparable/conflicting payment identities, metadata replay, Wallet timestamp formats/hash compatibility, malformed UOB times, and migration preservation. `git diff --check` passed. The outbox and reconciliation continuations are committed together as a verified trust-foundation change; no production services or frontend files changed.


## 2026-09-06 continuation — read-only pre-upgrade database audit

The prior outbox and reconciliation work was committed as `7f35c18` (`feat: make ingestion follow-ups durable and reconciliation evidence explicit`). Subsequent verified slices are committed as they are completed.

- Added `python -m scripts.db_audit DATABASE`, using only the standard library. It opens an existing user/admin database with `mode=ro`, enables query-only access, and checks a consistent read transaction without running application initialization.
- Reports SQLite integrity and foreign-key violations, known missing relationship constraints (with orphan counts), absent feature tables, and applied/pending/unknown migration versions. Missing paths are rejected without creating a database.
- Source observations and outbox links intentionally retained after transaction deletion are counted separately as informational evidence. No rows are repaired, deleted, or migrated.
- JSON contains schema identifiers and counts, excluding row IDs, stored financial values, raw payloads, and credentials. Exit statuses distinguish passed checks (0), reviewable issues (1), and unreadable/unrecognized databases (2).
- Added the pre-initialization audit procedure to `docs/operations/backups.md`. Production snapshot audits and real OCI/R2 restore/boot validation remain outstanding; this utility does not claim those operational checks are complete.

Verification: **15 focused audit/backup tests passed**, including committed WAL orphans, byte-preserving closed-database reads, admin session references, undeclared constraints, implicit primary-key references, retained evidence, migration reporting, safe error output, and audit of an encrypted/restored synthetic snapshot before initialization. The preceding full backend baseline was 713 passing tests. `git diff --check` passed. This standalone operator slice changes no application runtime or frontend behavior and is committed on completion.


## 2026-09-06 continuation — shared monthly spending facts and evidence

- Added `src/spending_facts.py` and per-user locked Storage wrappers, with typed authenticated `/api/v2/spending/month` and paginated `/api/v2/spending/evidence` endpoints. Production passes the configured timezone; legacy report consumers remain unchanged.
- Month-to-date totals are separate from equal-elapsed comparison windows. Category contributions sum to the reported spending change, and evidence uses the same classification/conversion functions.
- Native SGD calculations use Decimal and per-transaction half-up rounding into integer minor units. The explicit legacy money basis distinguishes this compatibility interface from the still-pending audited integer-storage migration.
- Includes NULL-type expenses, subtracts explicitly classified refunds when received, and excludes explicit transfers. Existing income is not reinterpreted. Missing income is absent; negative recorded net flow remains visible when resolved.
- Legacy stored foreign rates are indicative. Missing/invalid/non-positive or foreign `1.0` rates remain unresolved, with partial known subtotals and suppressed comparisons. Undated records are disclosed separately and available through unresolved evidence. Offset timestamps are projected into the configured calendar.
- Public evidence excludes raw payloads and source IDs. `docs/operations/spending-facts.md` documents response semantics and limits, including source freshness, settlement precedence, splits/refund links, weekly reporting, FX provenance, and migration work that remain open.

Verification: **745 backend tests passed**, with the same four existing datetime deprecation warnings. Added coverage for rounding, legacy NULL types, refunds/transfers, missing income, negative net flow, unresolved/indicative FX, leap/month/year boundaries, Singapore date projection, evidence pagination/reconciliation, input validation, privacy, and cross-user isolation. `git diff --check` passed. This additive API slice is committed before the planned 100,000-transaction benchmark; no production data or frontend files were changed.


## 2026-09-06 continuation — 100,000-transaction reporting benchmark

The shared monthly facts/evidence API was committed as `53b8704`.

- Added `python -m scripts.benchmark_spending_facts`: a reproducible temporary disk SQLite/WAL fixture with no real database input. It reports repeated query timings and bounded JSON payload sizes.
- At 100,000 synthetic rows over 240 days, median monthly facts were **61.8 ms**, with evidence pages **9.7 ms** (five runs). Concentrating the same rows into six days produced **466.2 ms** for facts and approximately **393–395 ms** for evidence pages (three runs).
- Facts payloads were about 1.6 KB and 50-row evidence payloads under 9.7 KB. These local macOS arm64/Python 3.12.1/SQLite 3.43.1 results exclude HTTP/auth/network costs and do not establish OCI/mobile performance.
- No caching or additional indexes were added. Period-wide evidence materialization remains a measured dense-period cost to revisit when deployment workload measurements warrant it. Commands, methodology, and both profiles are recorded in `docs/operations/spending-facts.md`.

Verification: both full-size benchmark profiles completed; CLI help and `git diff --check` passed. The benchmark has no application-runtime effect and is committed as a separate performance baseline.


## 2026-09-06 continuation — weekday-aligned weekly facts

The reproducible performance baseline was committed as `4691690`.

- Added `Storage.get_week_spending_facts()` and authenticated typed `GET /api/v2/spending/week`, using the same response contract, monetary calculations, category contributions, and paginated evidence as monthly facts.
- Week-to-date runs from Monday through `as_of`; comparison dates cover the same weekdays seven days earlier. This works across month/year boundaries and uses the configured local timezone.
- Extracted the common period calculation so currency uncertainty, undated observations, legacy NULL expenses, refunds/transfers, and missing-income behavior cannot drift between month/week implementations.
- Updated the spending-facts contract notes and agent instructions. Existing web/Telegram report consumers still need migration to the shared interface; the Home briefing, money-storage migration, and remaining production trust checks remain open.

Verification: **56 focused spending-facts/API-security tests passed**, including existing monthly/evidence behavior and eight new weekly boundary, timezone, partial-FX, and authenticated-route cases. The preceding full backend suite passed 745 tests. `git diff --check` passed. No production services were touched. This verified weekly slice is committed separately.


## 2026-09-06 continuation — opt-in Home briefing and capture review

- Added typed authenticated `GET /api/v2/home`, composing shared monthly facts, five recent transactions, pending estimated subscription charges over 14 days, full capture/follow-up counts, and sanitized Gmail freshness. Matched/dismissed/cancelled/out-of-window charges are excluded; unknown amounts are explicit.
- Added lazy-loaded `/home`, `/evidence`, and `/review` screens. Home has no Recharts import, presents partial/indicative subtotals and missing income correctly, and links category changes to each exact comparison period.
- Evidence pagination preserves dates/category/measure in URLs. Transaction detail can return to the evidence URL; transaction mutations invalidate Home/evidence caches. Capture/follow-up review supports paginated listing and deliberate retry, with clear queue/error states.
- Added `home_briefing_enabled` as an opt-in Settings flag, default off and validated atomically. `/home` is directly accessible for trial; enabling the flag uses Home as the start page. Existing navigation and report pages remain available pending the four-destination/theme slice.
- Existing OCI architecture and deployment remain unchanged. The browser skill was read and discovery attempted, but no browser was connected (`[]`). Visual, keyboard, phone/tablet, and real-device acceptance remain unverified; a browser connection was requested while implementation continues.

Verification: **757 backend tests passed** with four existing deprecation warnings; **39 frontend tests passed**; production frontend build and `git diff --check` passed. The Home chunk is about 6.4 KB uncompressed and separate from the charts bundle. Tests cover response privacy/authentication, upcoming bounds/cancellation, atomic opt-in settings, review pagination/retry, failed/partial briefing states, and comparison evidence URLs. The slice is committed; it does not complete the full product plan or its external acceptance gates.


## 2026-09-06 continuation — four-destination navigation

- Extended the opt-in flag to Home, Activity, Plan, and Explore in desktop/tablet navigation, phone tabs, and command search. Classic mode remains the default and can be restored in Settings.
- Added Profile menu access to Settings and capture review, with Review also reachable from Activity. Primary touch targets are at least 44px.
- Legacy URLs redirect without losing detail suffixes, encoded merchant names, query strings, or fragments. Activity and merchant detail navigation stays on the selected route family. List/detail route transitions retain parent state, avoiding filter/draft resets.
- Explore groups existing analytics and merchant drill-downs and permits natural scrolling. Plan currently hosts existing finance tools; shared-facts conversion of legacy reports and richer question-led exploration/planning are still pending.
- Updated design and agent instructions to document the deliberate natural-scroll exception. Themes are the next separate slice.

Verification: **44 frontend tests passed**; production build passed. Added navigation destination/active-parent and legacy deep-link preservation coverage. Backend behavior is unchanged (previous full baseline 757 passing). Browser connection remains unavailable, so visual/device acceptance is still pending.


## 2026-09-06 continuation — system/light/dark appearance

The four-destination navigation slice was committed as `a55788c`.

- Added system-default appearance with explicit light/dark choices in Profile, available in classic and new navigation. The local preference contains no financial data; storage denial does not prevent switching. System preference updates are observed live.
- Added light semantic surfaces, readable interactive colors, stronger dark muted text, themed native select chevrons, and stable dark text on brand-gradient buttons. Corrected fixed dark surfaces in shared cards, branding, and transaction filters.
- Chart axes, tooltips, legends, cursors, ring tracks, and neutral text now obtain centralized per-theme hex values through context. Theme switches update charts without remounting drafts.
- Added global reduced-motion configuration and CSS handling, visible focus outlines, and matching browser theme-color metadata. Design and agent instructions document the new conventions.

Verification: **49 frontend tests passed**, including system changes, preference restoration/override, unavailable storage, draft preservation, chart color updates, and normal-text AA contrast for primary/muted text on neutral surfaces. Production build and focused lint are checked before commit. Visual, category-color/opacity contrast, screen-reader, enlarged-text, and real-device acceptance remain pending; these unit checks do not certify the full design. Previous backend baseline remains 757 passing tests; this slice changes no backend behavior.


## 2026-09-06 continuation — explicit category correction scope

Appearance was committed as `399a62d`.

- Web transaction editing now defaults to “This transaction only” and offers an explicit “Remember for future matching transactions” radio choice. The choice resets between edit sessions. Existing rules survive transaction-only corrections.
- `PUT /api/transactions/{id}` accepts a strictly boolean `remember_category`; it no longer silently learns overrides. Storage commits the correction and optional rule atomically, using the corrected merchant. Invalid remembering requests and failed rule writes leave the transaction unchanged.
- Telegram category pickers, `/edit`, and `/recategorize` also default to transaction-only corrections. `/recategorize <id> [category] --remember` explicitly records a future rule and reloads the categorizer. Multi-word category names work; omitting the category with `--remember` uses the current category. Messages explain the scope and command.
- Transaction detail edit/delete/close controls now have accessible names and 44px touch targets. Updated user and agent documentation for the intentionally changed learning behavior. Bulk corrections, rule-management redesign, and undo remain pending.

Verification: **765 backend tests passed** (four existing deprecation warnings), **50 frontend tests passed**, and production build passed. Added atomic rollback, invalid scope, existing rule preservation, corrected-merchant scope, explicit Telegram remembering, and UI choice/reset coverage. A final focused Telegram run verifies removal of the unused helper argument. No production deployment or real data migration occurred.


## 2026-09-06 continuation — transaction capture provenance

Explicit category correction scope was committed as `b18fb2e`; this continuation started with a clean working tree.

- Added typed authenticated `GET /api/v2/transactions/{id}/provenance`, using the session's per-user Storage. The response contains only the transaction ID and grouped input channels with a retained-evidence flag. Missing/deleted transactions return 404.
- Raw and parsed Wallet observations collapse into one Wallet channel; Gmail observations and bank parser observations collapse into one Gmail channel. Only processed observations linked to that transaction establish retained evidence. Date-only purchases that reconciliation kept separate retain separate provenance.
- Activity/classic transaction details show capture sources, explain when linked sources count as one transaction, and distinguish legacy/manual recorded sources from retained evidence. Loading, failure, retry, and selection changes have explicit states. Removed internal source IDs from the rendered detail view; legacy API response migration remains open.
- No schema or transaction mutations are introduced. This is provenance display, not duplicate resolution: ambiguous duplicate review, shared transaction commands, bulk/undo, imports, and the money-storage migration remain pending.
- Browser setup and troubleshooting found no connected browser (`[]`), so rendered/device acceptance remains unverified. No production data or services were touched.

Verification: **774 backend tests passed** (four existing datetime deprecation warnings), **54 frontend tests passed**, production build and `git diff --check` passed. New tests cover cross-source capture, raw/parsed grouping, date-only separation, legacy/manual evidence absence, deleted transactions, authenticated response privacy, overlapping IDs across user databases, and UI loading/retry/selection states. Focused lint reports 12 pre-existing errors (11 `no-explicit-any` in `api/client.ts`, one `set-state-in-effect` in `TransactionDetail.tsx`); the same findings were reproduced against committed HEAD. The verified provenance slice is committed separately.


## 2026-09-06 continuation — unresolved spending review

Transaction provenance was committed as `8519f11`; this continuation started with a clean working tree.

- Added typed authenticated `GET /api/v2/spending/review`, exposing paginated unresolved records across all history through the existing per-user, locked spending-facts interface. Responses exclude raw payloads, source IDs, and payment metadata.
- Review and unresolved evidence share selection rules. Independent reasons distinguish missing/unreadable dates, unresolved monetary values/conversions, and unknown classification. Transfers and usable indicative conversions stay out of this list; legacy NULL types remain expenses. Date uncertainty alone is not labeled as missing conversion.
- Review now includes spending records alongside capture/follow-up processing issues. The groups load independently, with explicit loading/error/retry/empty states. Spending pagination is retained in the URL and the transaction close path; transaction mutations invalidate the review query.
- Existing rate corrections automatically remove resolved conversion records; no dismissal state or database migration is added. New date/classification correction controls still require the shared transaction-command slice. Ambiguous duplicates, unknown merchants, refund matches, and recurring confirmation remain open.
- All-history review scans the legacy ledger with bounded response pages; it is not an indexed queue or proof of capture completeness. Browser discovery again returned no connected browser (`[]`), so rendered and device acceptance remain pending. No production data or services were modified.

Verification: **780 backend tests passed** (four existing datetime deprecation warnings), **57 frontend tests passed**, production build and `git diff --check` passed. Added all-history/evidence reconciliation, independent reason, timezone, pagination, correction/deletion, privacy/authentication, cross-user isolation, retry, and return-link coverage. Focused frontend lint passes except the existing `set-state-in-effect` finding in `TransactionsPage.tsx`, reproduced against committed HEAD. This verified review slice is committed separately.


## 2026-09-06 continuation — date and classification corrections

Unresolved spending review was committed as `8268f4f`; this continuation started with a clean working tree.

- Transaction details now support explicit date/timestamp corrections and reclassification to spending or income. Existing refund/transfer labels are retained; this slice does not introduce their linking/workflows. Unknown classifications are visibly identified instead of displayed as expenses.
- The date field accepts an extended ISO date or timestamp, preserving the full original value in the editor. Unchanged date/type fields are omitted from updates, including legacy NULL expense types. Cancel resets drafts; save failures keep them editable.
- `Storage.update_transaction` validates explicit date/type changes before any write, so web and Telegram corrections share the check. Invalid calendar dates, times, offsets, null values, and classifications cannot partially update other fields or remembered category rules. The API returns 422 for invalid corrections/non-object request bodies.
- Date-only corrections use the existing midnight ledger format. Supplied offsets and fractional seconds survive normalization; original payloads, source IDs, and observation timestamp precision stay untouched. Shared facts and Review reflect corrected dates/types through the existing cache invalidation path.
- This is an incremental correction slice, not the full shared idempotent transaction-command interface or the money migration. Refund linking, transfer workflows, bulk correction/undo, and creation-path validation remain open. Browser discovery returned no connected browser (`[]`); rendered/device checks remain pending. No production services or data were modified.

Verification: **798 backend tests passed** (four existing datetime deprecation warnings), **60 frontend tests passed**, production build and `git diff --check` passed. Tests cover atomic rejection, leap/calendar/time/offset validation, retained fractional seconds, review-to-facts correction, untouched source evidence, unchanged-field omission, cancel/reset, and failed-save draft retention. Focused lint reports only the previously documented `set-state-in-effect` finding in `TransactionDetail.tsx`; its test file passes lint. The verified correction slice is committed separately.


## 2026-09-07 continuation — monetary corrections and unresolved rates

Date/classification corrections were committed as `32cdd79`; this continuation started with a clean working tree.

- Added original amount and currency fields to transaction details. Monetary fields are submitted only when changed, and cancel restores them. Blank rates now remain explicitly unknown instead of silently becoming 1. Currency changes clear the stale rate in the editor.
- `Storage.update_transaction` validates finite non-negative amounts, finite positive rates (or explicit NULL), and three-letter currency format before any writes. Currency codes normalize to uppercase. Changing foreign currency clears the previous rate unless a replacement accompanies the correction; changing to SGD sets 1. Invalid fields cannot partially change a transaction or remembered rule.
- Transaction details label foreign conversions as indicative or unresolved, including legacy rate 1. Invalid/missing currency labels no longer prevent opening the editor. The client type now reflects nullable exchange rates; four subscription displays avoid treating NULL conversions as zero, using labels or a chart gap.
- Shared facts and Review update after corrections through existing invalidation. Stored source evidence is untouched. Float storage, audited migration, FX provenance/settlement precedence, remaining legacy reporting consumers, and creation-path validation remain open; this does not claim the full monetary migration or shared command interface is complete.
- Browser discovery returned no connected browser (`[]`), so rendered/device checks remain pending. No production data or services were modified.

Verification: **814 backend tests passed** (four existing datetime deprecation warnings), **64 frontend tests passed**, production build and `git diff --check` passed. Coverage includes invalid/boolean/non-finite monetary corrections, atomic rollback, zero amounts, currency normalization, stale-rate clearing, explicit replacement/NULL rates, review/facts reconciliation and rounding, unchanged-field preservation, editor reset, and unresolved display. Focused lint matches the committed baseline: 11 findings in `api/client.ts`, one each in `TransactionDetail.tsx` and `SubscriptionDetail.tsx`; the correction test file passes lint. The verified monetary correction slice is committed separately.


## 2026-09-07 continuation — shared manual-entry validation

Monetary corrections were committed as `4ba0996`; this continuation started with a clean working tree.

- Extracted the existing correction rules to `src/transaction_validation.py` and added `Storage.create_manual_transaction`. Web manual creation and Telegram `/add`, `/cash`, `/income`, and confirmed NL drafts use this shared validation boundary. Automated ingestion and legacy/synthetic low-level inserts remain unchanged.
- Manual entries accept only manual/cash sources and expense/income classification, validate textual metadata, normalize currency/date input, and reject invalid/non-finite monetary values before writing. Missing foreign rates stay NULL; native SGD uses 1. Web validation errors return 400; duplicate generated IDs return 409.
- Existing source IDs remain unchanged, including actual `/cash` IDs with their `cash-` prefix. Telegram duplicate/validation failures send sanitized replies and skip success/trip follow-ups. Currency parsing in `/add` works even without an exchange service; unknown conversions are explicit in acknowledgements.
- Confirmed NL drafts preserve their supplied date/timestamp instead of attaching the current time to a date-only record. Invalid confirmation drafts retain Edit/Cancel actions and pending fields. No AI service calls were made during validation.
- Removed the now-unused API date helper. Manual source-event capture, durable follow-ups, request idempotency, and the full shared command interface remain open. No schema changes, frontend changes, or production data/service modifications occurred.

Verification: **838 backend tests passed** (four existing datetime deprecation warnings). The final NL error-action/confirmation formatting refinement was verified with **74 Telegram tests passed**. New tests cover invalid manual bodies/fields, non-finite command amounts, absent exchange services, unresolved FX, source-ID duplicate handling, date-only confirmation, and retained failed-draft actions. `git diff --check` passed. Frontend files are unchanged; the preceding baseline remains 64 passing tests and a successful production build. This verified manual-validation slice is committed separately.


## 2026-09-07 continuation — durable manual trip assignment

Shared manual-entry validation was committed as `5e61ae1`; this continuation started with a clean working tree.

- Added internal `assign_to_active_trip` support to validated manual creation. When requested and trips are enabled/active, the transaction and a trip job containing the capture-time trip ID commit atomically. An outbox insertion failure rolls back the transaction.
- Telegram `/add`, `/cash`, and confirmed NL entry request this job instead of calling trip assignment directly after insertion. Dispatch reuses the user's pipeline when available, runs after releasing the Storage lock, and leaves failed/busy work to the existing two-minute worker. Successful capture still receives its command confirmation after a failed or deferred assignment.
- Existing behavior is preserved for web entry and `/income` (no automatic trip assignment), command source IDs, and backdated manual entries. No recurring/notification jobs are added to manual creation; direct Telegram confirmation replies remain best-effort.
- Restart replay retains the original trip even when another becomes active. Duplicate command IDs create no extra jobs, deleted transactions/trips are skipped, and existing bounded retries/manual requeue apply through capture review.
- Manual source-event capture, request idempotency, and full ingestion/command unification remain open. No schema changes, frontend changes, or production data/services were touched.

Verification: **849 backend tests passed** (four existing datetime deprecation warnings). Coverage includes manual transaction/outbox rollback, disk reopen, capture-time trip retention, duplicate IDs, disabled/inactive/not-requested behavior, deletion, bounded/manual retries, successful command confirmation after assignment failure, and a busy dispatcher. `git diff --check` passed. No frontend changes; the preceding frontend baseline remains 64 passing tests and a successful production build. This verified manual trip-outbox slice is committed separately.
