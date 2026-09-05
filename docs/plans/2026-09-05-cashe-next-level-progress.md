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
5. Audit existing foreign-key orphans and validate upgrade/rollback against representative old production databases. Automated migration/recovery tests currently use synthetic data.
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
