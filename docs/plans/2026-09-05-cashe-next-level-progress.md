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

1. Persist and retry post-commit notifications, recurring suggestions, and trip effects through an outbox. These still use the existing best-effort behavior; a transaction survives a crash but every follow-up is not yet guaranteed.
2. Retain explicit timestamp precision/payment identity for reconciliation. Invalid Wallet observations are now captured before parsing (see continuation below). Ambiguous candidates are preserved rather than merged, but a duplicate-resolution UI is still pending.
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
