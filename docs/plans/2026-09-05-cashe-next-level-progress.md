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


## 2026-09-07 continuation — retained manual-entry provenance

Durable manual trip assignment was committed as `f7d3768`; this continuation started with a clean working tree.

- Accepted manual/cash creation now writes a `source_events` snapshot in the same transaction as the ledger row and any trip job. Failure to write the snapshot rolls all three back. No schema change is required.
- Versioned `manual:1` snapshots preserve accepted command fields after caller parsing/categorization: original amount/rate representations, currency, date/timestamp, merchant, description, category, and classification. Numeric values are represented as strings. Raw Telegram text, HTTP headers, and rejected requests are not captured by this slice.
- Snapshots are processed-only and keep unknown timestamp precision because manual entry can supply generated capture times. They never enter generic ParseResult replay, and adding provenance does not silently make manual purchases eligible for automatic Wallet/email matching.
- The existing authenticated provenance API now reports retained manual/cash evidence for new entries without exposing snapshots. Corrections and deletion retain original evidence. Reusing a retained source identity after deletion is rejected without rewriting evidence or creating a replacement transaction. Legacy manual records are not backfilled.
- Request idempotency, manual/automated command unification, and the wider product plan remain open. No frontend changes or production data/services were touched.

Verification: **857 backend tests passed** (four existing datetime deprecation warnings). Coverage includes snapshot/transaction/outbox rollback, submitted-field retention, correction/deletion preservation, disk reopen, identity reuse rejection, processed-snapshot exclusion from retries, both cross-source arrival orders, and payload-free API provenance. `git diff --check` passed. No frontend files changed; the preceding baseline remains 64 passing tests and a successful production build. This verified manual-provenance slice is committed separately.


## 2026-09-07 continuation — retry-safe web manual entry

Retained manual-entry provenance was committed as `b3edf85`; this continuation started with a clean working tree.

- Added optional `Idempotency-Key` support to authenticated web manual creation. Migration 4 retains per-user request fingerprints and transaction links, committed atomically with the purchase and manual source evidence. Existing source-ID formats and callers without keys remain compatible.
- The locked Storage command compares submitted JSON fields before generating date/source defaults. Property order is ignored; other representation/field changes conservatively conflict. Replaying the same accepted request returns the current transaction, preserving subsequent corrections and original evidence. Changed requests and replay after deletion return 409; deleted purchases are never recreated by replay.
- Keys accept 1–128 ASCII letters/digits/underscore/hyphen. Rejected validation and failed writes do not consume a key. Distinct keys permit legitimate identical purchases. Retained request links survive deletion and are informational in the read-only database audit; keys/fingerprints stay outside ordinary responses and audit output.
- The web entry form keeps a key across failed saves, submits it as a header, preserves editable fields, and explains uncertain saves/conflicts. Changed fields keep the key so an accepted request cannot silently become another purchase. Closing/reopening generates a new key; reload/offline persistence remains a later slice.
- Telegram request identity, broader ingestion/command unification, and the wider plan remain open. Concurrency protection follows the existing single-process, one-Storage-per-user service. Real-browser/device acceptance was not performed. No production databases or services were modified. This verified slice is committed separately.

Verification: full backend run completed with **870 passed and one audit-test expectation failure** (four existing datetime deprecation warnings). The expectation incorrectly treated installed migration 4 as pending; after correcting it and extending retained-link/privacy coverage, **all 12 audit tests passed**. The focused command/API/migration run passed **105 tests**. **66 frontend tests passed**, production build passed, and focused lint for the form, its tests, and transaction hooks passed. `git diff --check` passed. Tests cover restart/replay, concurrent retries, changed payloads, deletion, atomic receipt/evidence rollback, invalid keys, validation recovery, separate user databases, authentication, compatibility, and form retry/conflict behavior.


## 2026-09-07 continuation — retry-safe direct Telegram entry

Web request idempotency is committed as `a248593`; this continuation builds on it.

- Direct `/add`, `/cash`, and `/income` commands now identify accepted requests by Telegram chat/message IDs in the per-user database. Command name and submitted argument tokens define the fingerprint; generated timestamps, category matches, and fetched rates do not change replay identity. The shared receipt lookup also serves web creation.
- The transaction, manual evidence, requested capture-time trip job, and request receipt commit atomically. Replay after restart or a lost confirmation reports the existing transaction ID, preserves later corrections, and can dispatch the original pending trip job. It creates no replacement evidence or follow-up jobs. `/income` retains its no-auto-trip behavior.
- Changed arguments/commands on an accepted message and replay after deletion produce a clear correction message. Validation and write failures do not reserve the identity. Separate Telegram messages with identical amounts in the same second remain separate purchases.
- Telegram request keys occupy a namespace unavailable to web keys. New identified commands use `telegram-` plus a full SHA-256 of that identity for source IDs, keeping chat/message identifiers out of legacy transaction responses. Existing source IDs are unchanged. User routing continues through the linked chat's UserContext.
- Natural-language confirmation draft identity, durable receipt of raw Telegram updates, offline/reload draft persistence, and wider ingestion/command unification remain pending. Legacy/in-process callers without Telegram message IDs and NL drafts retain their previous creation behavior. This slice supports replay of accepted commands; it does not guarantee Telegram transport redelivery or confirmation delivery.
- Reuses migration 4 from the web retry slice; no additional schema change or frontend change. No production services/data were modified. This verified slice is committed separately.

Verification: **889 backend tests passed** (four existing datetime deprecation warnings), including all preceding web idempotency/audit changes. The **18 new Telegram tests** cover lost replies and disk reopen for all three commands, changed arguments/commands, post-correction/deletion replay, distinct same-second messages, changed FX/category defaults, request/evidence/trip rollback, concurrent delivery, original failed-trip dispatch, cross-channel namespace separation, linked-user routing, and unlinked-chat rejection. `git diff --check` passed. No frontend files changed in this continuation; the preceding baseline remains **66 passing frontend tests** and a successful production build. No real Telegram messages were sent.


## 2026-09-07 continuation — bound, retry-safe NL confirmation cards

Web retry protection is committed as `a248593`; direct Telegram command retries are committed as `b93a7ce`. This continuation builds on both.

- Every new natural-language draft gets a random confirmation token, carried by its Add/Edit/Cancel buttons and bound in pending state to the initiating username/chat. Older cards, bare legacy callbacks, wrong-owner callbacks, and expired drafts cannot save or clear the current draft. Callback payloads remain within Telegram's 64-byte limit.
- Confirmed drafts use the shared per-user request receipts, atomically committing transaction, accepted manual evidence, and capture-time trip work. Submitted draft fields define replay identity; fetched FX does not. Replay retains the original transaction and subsequent corrections; changed accepted fields or deletion cannot create a replacement.
- Accepted drafts are cleared before follow-up delivery or Telegram success replies. Lost replies and repeated taps cannot recreate them. Cancel/manual Edit also clear only the matching draft before awaiting a reply, so a newer draft arriving during delivery remains intact. Failed validation keeps matching Edit/Cancel actions and consumes no receipt.
- New confirmed source IDs use `telegram-nl-<draft token>`; existing IDs and source snapshots remain untouched. No new schema change is needed beyond migration 4 from the web retry slice. No frontend changes or live Telegram/LLM calls occurred.
- Unconfirmed drafts remain in memory and expire on restart; expired cards tell the user to check Activity or send another entry. Durable raw NL-message receipt/redelivery, persistence of unconfirmed drafts, and full command unification remain pending. A separately parsed message creates a separate draft requiring explicit confirmation. No production services/data were modified. This verified slice is committed separately.

Verification: **906 backend tests passed** (four existing datetime deprecation warnings). The **17 new draft tests** cover distinct bounded callback tokens, stale Add/Edit/Cancel cards, username/chat binding, legacy/expired cards, lost success replies, newer drafts arriving during replies, restart replay with corrections and original trip assignment, changed/deleted accepted drafts, atomic receipt/evidence/trip rollback, and retained validation-error actions. Existing direct Telegram and web idempotency tests also pass. `git diff --check` passed. Frontend files are unchanged in this continuation; the preceding baseline remains **66 passing frontend tests** and a successful production build.

Commit verification: the three increments were staged separately and checked for whitespace errors. An isolated export of the web commit passed **27 request-storage/migration/audit tests**; an isolated export of the direct Telegram commit passed **95 Telegram tests**. The final confirmation-card increment passed **112 focused Telegram tests**. The resulting implementation matches the previously verified **906-test backend suite** and **66-test frontend/build** baseline; no production deployment or push was performed.


## 2026-09-07 continuation — persistent expiring Telegram drafts

Bound confirmation cards were committed as `da00897`; this continuation started with a clean working tree.

- Migration 5 stores one active NL draft per chat in each user's database, before the confirmation card is sent. The stored proposal contains only amount, currency, merchant, category, and date; raw message text and extra metadata are excluded. The card tells the user to confirm within 24 hours.
- Cards survive server restart without Telegram `user_data`. The absolute expiry does not extend on reads. Expired drafts cannot be confirmed; payloads are lazily removed on the user's next draft read/save. This is not a background deletion scheduler.
- Callbacks resolve the linked user's Storage and originating chat, then load the specific card's draft. Replacement/cancel/manual Edit invalidates the old token, preserves other chats, and cannot clear a newer card during reply delivery.
- Production confirmation re-reads saved proposal fields and atomically consumes the draft alongside the purchase, source evidence, request receipt, and trip job. Validation or write failure leaves the draft available for retry. Trip assignment uses the trip active at confirmation, not when the proposal was created. Expiry is checked again at the Storage command boundary.
- The existing internal accepted-draft receipt interface remains compatible; web and direct Telegram entry are unchanged. Durable raw NL-message receipt/redelivery and broader command unification remain pending. No frontend changes, real Telegram/model calls, or production data/service modifications occurred.

Verification: **918 backend tests passed** (four existing datetime deprecation warnings). The **12 new persistence tests** cover restart with empty Telegram context for Confirm/Edit/Cancel, absolute expiry, transaction/evidence/receipt/trip/draft-delete rollback, stale/wrong-chat consumption, failed replacement rollback, saved-field authority, metadata exclusion, and per-user isolation. Existing confirmation-card tests now use durable drafts and continue to verify stale cards and reply races. Migration/audit expectations include additive version 5. `git diff --check` passed. No frontend files changed; the preceding baseline remains **66 passing frontend tests** and a successful production build. This verified slice is committed separately.


## 2026-09-07 continuation — NL message redelivery identity

Persistent expiring drafts were committed as `56d1e0d`; this continuation started with a clean working tree.

- Migration 6 retains an opaque hash of Telegram chat/message identity, a fingerprint of trimmed text, and its original draft token. This message link commits atomically with draft creation/replacement. It contains no raw message text or model output and intentionally survives draft deletion.
- NL message handling checks retained identity before invoking the model. Redelivery of an active proposal resends the original fields/card token without extending expiry, including after restart or while the model service is disabled. Changed message text and confirmed/canceled/replaced/expired proposals produce an already-handled reply without calling the model or overwriting a newer draft.
- Save rechecks identity under the Storage lock: concurrent parsing results cannot replace the first accepted proposal. Distinct messages with identical text remain distinct inputs. Failure writing either the draft or its message link rolls both back and preserves the previous draft.
- Card wording now describes expiry relative to draft creation, so a resent card does not imply a fresh 24-hour window. Existing user/chat isolation, confirmation receipts, source evidence, and trip behavior remain unchanged.
- Unrecognized input and failures before draft persistence create no message link. Durable raw Telegram update persistence before parsing and broader command unification remain pending. Retained message links are intentionally not foreign keys to expiring drafts. No frontend changes, live model/Telegram calls, or production data/service changes occurred.

Verification: **932 backend tests passed** (four existing datetime deprecation warnings). The **14 new redelivery tests** cover lost card replies/restart with the model disabled, unchanged expiry/token, confirmed/deleted/canceled/replaced/expired drafts, changed text, distinct identical messages, atomic replacement rollback, concurrent proposal saves, unrecognized-message retry, raw-text exclusion, and per-user/chat isolation. Migration/audit expectations include additive version 6. `git diff --check` passed. No frontend files changed; the preceding baseline remains **66 passing frontend tests** and a successful production build. This verified slice is committed separately.


## 2026-09-07 continuation — persist NL input before parsing

NL message redelivery identity was committed as `e53c8e2`; this continuation started with a clean working tree.

- Identified natural-language input now commits its original message text to a versioned, per-user source observation before parsing. New input is recorded only after linked-user resolution and when the optional model service is present. No transaction or follow-up is created at receipt time.
- Processing attempts are recorded before work begins and stop after five starts for the same message identity, including crashes. Telegram redelivery can retry failed/unrecognized input. Fixed error codes retain failure state without exception text; edited text cannot overwrite the original observation.
- Draft creation/message-link persistence and raw-observation processing acknowledgement commit together. Confirmation links the raw input to the transaction atomically with the accepted snapshot, receipt, trip job, and draft consumption. Corrections/deletion retain original evidence. Raw Telegram observations group with manual provenance and retain unknown time precision.
- Generic bank/Wallet replay explicitly excludes raw Telegram observations. Capture retry endpoints reject automatic requeue for them, and Review explains Telegram recovery without offering a retry button. Ordinary capture/provenance responses exclude raw text and source identifiers.
- This slice adds no automatic cloud/model retries and requires no migration. Operator-triggered raw-input replay, manual issue resolution, full command unification, and free-AI operating controls remain pending. Sending a new entry does not automatically resolve the older failed observation. No production services/data or real model/Telegram calls were used; visual/device acceptance remains unverified.

Verification: **945 backend tests passed** (four existing datetime deprecation warnings), **67 frontend tests passed**, production build and focused Review-page lint passed. New coverage verifies receipt before parsing, crash/restart redelivery, bounded starts, unrecognized/failed inputs, raw-write gating of model calls, acknowledgement rollback, confirmation-link/draft-consumption rollback, disabled/unlinked intake, original-text retention, exclusion from bank retries, API privacy/requeue rejection, and Review's manual-recovery guidance. `git diff --check` passed. This verified slice is committed separately.


## 2026-09-08 continuation — manual resolution of Telegram capture issues

Raw NL input persistence was committed as `dfefb65`; this continuation started with a clean working tree.

- Migration 7 stores a separate handled marker for unfinished Telegram observations. Marking handled and returning to Review are idempotent; neither changes the retained input, processing status, attempts, errors, or transaction links.
- Authenticated, per-user resolve/reopen endpoints reject bank/Wallet and processed observations. Default capture lists and Home attention counts exclude handled input. An explicit include-handled filter exposes the sanitized entry and its handled flag, with filtering applied before pagination.
- Review offers “Mark handled,” “Return to Review,” and “Show handled Telegram entries,” with explicit mutation failures and refreshed Review/Home queries. Handling an input does not create a transaction or claim successful parsing. Spending review remains based on unresolved facts and cannot be dismissed this way.
- Handled messages cannot start parsing on redelivery. Draft persistence rechecks the marker under the Storage lock, preventing an in-flight parse from replacing an existing card or creating a new draft after resolution. Returning an entry to Review does not queue parsing or reset the five-start limit.
- Raw-input replay tooling, broader command unification, and free-AI operating controls remain pending. No production services/data or real model/Telegram calls were used; visual/device acceptance remains unverified.

Verification: **950 backend tests passed** in the full suite (four existing datetime deprecation warnings). The subsequently added Telegram handler race/redelivery regression passed in a **14-test focused run**, bringing verified backend coverage to **951 tests**. **69 frontend tests passed**, production build and focused Review lint passed. Coverage includes restart, evidence preservation, pagination/counts, source restrictions, isolation, authentication/privacy, exhausted attempts, in-flight draft rejection, reversible Review actions, and explicit mutation errors. An initial focused API setup overlapped the frontend build's replacement of static assets; that test passed on rerun and in the full suite after the build finished. Whitespace checks passed. This slice is committed separately; no push or deployment was performed.


## 2026-09-08 continuation — shared facts in Telegram period commands

Manual Telegram capture resolution was committed as `cbe9501`; this continuation started with a clean working tree.

- Telegram `/week` and `/month` now consume the same locked spending-facts interface as Home and the v2 API, using the linked user's Storage and the bot's configured timezone. Week means Monday through today; month means the first through today.
- Reports preserve per-transaction minor-unit rounding, legacy NULL expenses, signed refunds, excluded transfers, absent income, and negative recorded net flow. Partial known subtotals are distinguished from complete zero spending; undated observations and indicative FX remain explicit.
- Comparisons display their actual current/previous date windows, including short-month truncation separately from the full month-to-date total. Unavailable comparisons stay unavailable. The three largest category contributions use the shared calculation.
- Supporting spending and income evidence uses the same period and timezone, with signed SGD amounts, projected dates, transaction IDs, and unresolved/indicative labels. Each measure shows up to 50 records with explicit shown/total counts; the report total remains untruncated. Facts and evidence are read under one Storage lock, released before Telegram delivery.
- These commands no longer append legacy budget-pace advice. The now-unused weekly pace helper and seven tests for that removed behavior were deleted. Daily/balance commands and scheduled weekly/monthly summaries (including optional AI narratives) remain legacy consumers and are still pending migration.
- Updated user, operator, and agent documentation. No schema or frontend changes, live Telegram/model calls, production data changes, push, or deployment. The integer-storage migration and real-device acceptance remain open.

Verification: **955 backend tests passed** on the final tree (four existing datetime deprecation warnings): the prior 951-test baseline plus 11 new shared-report tests minus seven obsolete weekly-pace helper tests. Coverage verifies Decimal rounding, NULL expenses, refunds/transfers, negative net flow, absent income, unresolved foreign rates, undated observations, indicative comparisons, short-month comparison windows, timezone-projected evidence, explicit evidence limits without truncated totals, and resolved-user command dispatch without legacy budget queries. The initial 88-test focused Telegram run also passed. Whitespace checks passed. No frontend files changed; the prior baseline remains **69 frontend tests** and a successful build/lint check. This verified increment is committed separately.


## 2026-09-08 continuation — shared facts in scheduled Telegram reports

Interactive period commands were committed as `17982e8`; this continuation started with a clean working tree.

- Scheduled Sunday summaries now use the shared Monday-through-send-date facts and comparison windows, in the bot's configured timezone. The existing Sunday 08:00 schedule stays in place; it summarizes what has been recorded so far that Sunday.
- The first-of-month summary now reports the completed previous calendar month, including leap-year and December/January boundaries. Interactive `/month` continues to report the current month to date.
- Both scheduled reports reuse the command formatter, retaining partial/indicative status, known subtotals, absent income, negative recorded net flow, and exact comparable periods. Compact mode skips evidence queries/lists and bounds category labels to 80 characters for notification delivery.
- Removed the unused legacy weekly/monthly formatters and narrative-generation helpers. These jobs no longer call the model or append old cached AI narratives. Daily optional AI generation remains separate. Existing weekly/monthly cache rows and their legacy read endpoints are retained, with dashboard text identifying the narratives as archived and no longer refreshed.
- Per-user job routing and notification transport remain in place. Durable scheduled delivery, daily/balance and remaining dashboard report migrations, free-only AI controls, integer-money storage, and device verification remain pending. No live Telegram/model calls or production data/service changes were used.

Verification: **963 backend tests passed** (four existing datetime deprecation warnings), **69 frontend tests passed**, and the production build passed. Eight new scheduled-report cases cover weekday selection, completed-month/leap-year/year boundaries, interactive versus scheduled month semantics, timezone projection, compact partial/indicative output and category bounds, skipped evidence queries, per-user registered-job dispatch, and exclusion of model calls and cached narratives. The 33-test focused report/registry suite and whitespace checks passed. This verified increment is committed separately; no push or deployment was performed.
