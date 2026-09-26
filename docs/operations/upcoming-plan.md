# Upcoming Plan compatibility slice

Authenticated `GET /api/v2/plan/upcoming?days=30&limit=50&offset=0` returns recorded upcoming subscription charges. The date window starts on the configured local date and includes exactly `days` calendar dates (1–90); response pages contain 1–100 items, with a nonnegative offset.

Only pending, unmatched charges from active or possibly-cancelled subscriptions are selected. Matched, dismissed, cancelled, past, out-of-window, and unreadable-date rows are excluded. Results sort by expected date and ID. The known estimated total and unknown count cover the entire selected window, independently of pagination. Amounts use the retained legacy SGD estimate with per-row Decimal rounding; missing, invalid, or negative values remain unknown. This does not recover the estimate's FX provenance or migrate stored money.

Every displayed charge is an estimate. Existing data does not distinguish a confirmed amount from an inferred one; active subscription status is not proof of a confirmed charge. Possibly-cancelled schedules are labeled for review, without claiming that the provider has cancelled the service. The endpoint exposes labels, dates, frequency, schedule status, identifiers for review, and monetary values; private subscription notes and transaction payloads are excluded.

The new Plan destination opens this timeline, with 14/30/90-day selection, bounded pagination, and distinct loading/error/stale/disabled/empty/partial states. Existing finance tools remain at `/plan/manage`; `?subscription=<id>` opens the existing detail controls. Opt-in legacy Finance links and older Plan management parameters retain their query/fragment. Subscription edits, matching, dismissal, linking, and removal invalidate timeline and Home queries.

The API's `enabled` metadata reflects the UI subscription setting; the flag does not delete or hide records from authenticated API callers. The page explains how to enable subscriptions when disabled.

The timeline does not expand all future billing cycles, include unrecorded commitments, provide a full forecast, or certify completeness. It reuses the scheduler's retained predictions; manual controls continue through the existing subscription UI. Confirmed/inferred charge amounts, richer overdue review, and new reconciliation rules remain separate work.


## Correcting or dismissing a prediction

Authenticated `PUT /api/v2/plan/upcoming/{id}` accepts only `expected_date` (strict YYYY-MM-DD calendar date) and/or `expected_amount` (finite nonnegative SGD value, or null for unknown). All submitted fields validate before one atomic update. Omitted fields retain their exact stored values; the UI omits unchanged amounts so a date-only edit does not write back a rounded display value.

Authenticated `POST /api/v2/plan/upcoming/{id}/dismiss` marks one pending prediction dismissed. Both commands check current status under the Storage lock and reject matched, dismissed, linked, or cancelled-schedule charges with 409; missing charges return 404, invalid corrections 422. Dismissal retains the prediction and does not delete transactions, alter recorded spending, or cancel the subscription/provider. The existing scheduler can generate later periods.

Timeline edits require an explicit save; dismissal requires an explicit confirmation. Successful changes invalidate Plan, Home, subscription summaries, and expected-charge details. Errors retain the form and offer a timeline refresh. Actual-transaction matching remains in the linked subscription controls.

Expected-date corrections may influence subsequent predictions because the existing scheduler anchors future dates on retained expected dates. No independent schedule-exception system, revision conflict handling between simultaneous pending edits, or new matching rules are introduced in this slice.

## Matching actual charges

Existing authenticated subscription match/link controls now serialize eligibility and uniqueness checks under the per-user Storage lock. One actual expense (including legacy NULL expense types) can create only one new link across all predictions and subscriptions. Repeating an accepted match or the same subscription link is harmless; changing an existing match, reusing its transaction elsewhere, or matching a dismissed/cancelled prediction returns 409. The legacy dismissal endpoint uses the same pending-state guard as Plan. Missing records return 404; invalid transaction IDs or non-expense actuals return 422. Errors are displayed in subscription details.

Direct historical links require a valid transaction date and use shared per-row SGD rounding; unresolved foreign conversions retain an unknown estimate. The original transaction date's calendar date is retained. Existing duplicate links are preserved for audit: this is command-level protection for the single-process service, not a new database uniqueness constraint or a repair migration. Automatic candidate selection, ambiguous-match review, and scheduler forecast expansion remain separate work.


## Pausing a schedule in Cashe

Subscription details offer **Pause in Cashe** and **Resume in Cashe** through the authenticated subscription update API (`status: paused` / `status: active`). Pausing hides pending predictions from Plan/Home and next-charge summaries, excludes the schedule from active monthly totals, and stops automatic generation/matching. Transaction history and all prediction rows remain intact. Explicit historical linking remains available. This setting does not pause or cancel provider billing.

Resuming retains original expected dates, including overdue dates, and allows the next scheduler cycle to process the schedule. It does not shift billing dates or synthesize missed cycles. Paused predictions reject manual matching/correction/dismissal until resumed. The scheduler re-reads status under the same Storage lock as updates, preventing a stale worker snapshot from reactivating or generating predictions after a pause. Invalid statuses reject the whole update with 422. No schema migration is required for the existing text status column.


## Schedule confirmation provenance

Migration 8 adds `subscription_confirmations`, leaving legacy schedules without a confirmation record. Subscription reads and the Plan API expose only `confirmation_source`: `unknown`, `user`, or `recurring_suggestion`. New web creation records `user`; accepting a Telegram recurring suggestion records `recurring_suggestion`. Detection alone does not confirm or create a schedule. Confirmation is committed atomically with creation.

Subscription details offer **Confirm this schedule** for unknown records through authenticated `POST /api/subscriptions/{id}/confirm`. Repeating confirmation preserves its original source and timestamp. It does not change status, pending dates/amounts, or recorded spending. Paused/cancelled schedules remain paused/cancelled. Removing the schedule removes its confirmation record.

The label records a user's decision to track a schedule, not proof of a future charge or a frozen version of all schedule fields. Dates and amounts remain estimates after confirmation or subsequent edits. Legacy records are labeled “Schedule confirmation not recorded”, never automatically classified as inferred or confirmed. New Telegram suggestions retain full merchant identity as described below; old button payloads cannot recover truncated names.


## Repeated legacy Telegram suggestion acceptance

Migration 9 stores acceptance receipts keyed by Telegram chat/message identity in each user's database. Accepting a suggestion atomically records its merchant/frequency, the schedule ID, and confirmation. Repeated/concurrent clicks reuse that schedule, including after service restart or subsequent schedule edits. Receipts deliberately survive schedule deletion: replaying the same button reports that the schedule was deleted rather than recreating it.

For a previously unaccepted message, one exact merchant/frequency schedule is reused without changing billing fields, pause/cancel status, or existing confirmation provenance. Several exact matches require review in the app; none creates a new confirmed schedule. Different notification messages have separate receipts. A new message can create a new schedule after deletion; no global merchant suppression is introduced.

Legacy callback payloads still contain truncated merchant text, so these guarantees use the accepted callback fields, not recovered full merchant identity. Legacy pending/dismissed buttons have no durable suggestion record; notification delivery remains at least once. Errors direct users to retry or review existing subscriptions. No legacy receipts are inferred or backfilled.


## Durable recurring suggestions

Migration 10 adds `recurring_suggestions` in each user's database. Cashe commits the complete merchant, frequency, observed average, and pending state before optional notification delivery; a destination chat is bound when delivery is attempted. A short opaque ID replaces merchant text in the accept/dismiss buttons, keeping Unicode and delimiter-containing names intact and callback payloads below 64 bytes. Persistence happens off the bot event loop, and sending holds no Storage lock. The existing notification Future still gates outbox acknowledgement.

Pending suggestions with identical chat, merchant, frequency, and average reuse their record during retries. Both callbacks resolve the ID inside the authenticated user's Storage and check its destination chat. Acceptance atomically resolves the record and creates/reuses a uniquely matching schedule with confirmation. Replay retains the accepted schedule after edits; deletion leaves a retained link so the same button cannot resurrect it. Dismissal is also durable and replayable. Competing accept/dismiss actions cannot overwrite one another.

Dismissal closes that suggestion, not every future pattern from the merchant. Later notifications after resolution, or with changed fields, may create another pending record. Delivery remains at least once; multiple messages can carry the same pending ID. This is not complete outbox-event identity or permanent notification suppression. The observed average retains the existing detector's monetary semantics and is not certified SGD conversion evidence.

Older `sub_suggest_add|...` buttons remain supported through migration 9 receipts; their truncated merchant text cannot be reconstructed. No old pending or dismissed buttons are backfilled. Resolved suggestion records intentionally retain schedule IDs after deletion and must not be cleaned up as orphaned foreign keys.


## Recurring suggestions in web Review

Authenticated `GET /api/v2/recurring/review` lists pending durable suggestions with bounded `limit` (1–100, default 50), nonnegative `offset`, and a full pending count. Only the opaque ID, full merchant, and inferred frequency are exposed. Destination chat IDs, observed averages, timestamps, and internal resolution fields remain outside this response. The average is omitted because the detector does not retain reliable currency context.

Authenticated `POST /api/v2/recurring/suggestions/{id}/accept` or `/dismiss` resolves through the same Storage command as Telegram. Web authentication establishes the owning user; the browser does not supply a chat identity. Responses include only status and the accepted schedule ID (null for dismissal). Missing/other-user IDs return 404, conflicting actions or deleted accepted schedules 409, and invalid actions/paging 422. Same-action replay remains safe across web and Telegram.

Review displays a separate recurring group with pagination, loading/failure/empty states, retryable action errors, refresh, and a billing-details link after acceptance. Successful actions refresh recurring review, subscriptions, expected charges, Plan, and Home. The group lists durable suggestions recorded by successful live ingestion analysis, including accounts without linked Telegram. It does not change inferred money semantics or add a Home suggestion count.


## Suggestions independent of Telegram

Migration 11 makes the suggestion chat binding nullable, preserving every existing record and index. Successful ingestion recurring analysis now commits an unbound Review suggestion, its delivery job carrying the suggestion ID, and analysis acknowledgement in one transaction. Identical pending fields reuse an existing record, including one already bound to a chat. Historical capture still creates no follow-up jobs.

Telegram delivery is optional. A missing callback or unlinked Telegram does not prevent Review visibility, and the delivery job completes without sending; linking later does not bulk-send old completed jobs. Existing pending legacy suggestion jobs acquire a durable ID before optional delivery, without rerunning detection. Already completed legacy jobs are not backfilled.

The callback carries the retained suggestion ID through UserManager to the bot. Sending binds an unbound pending record to the destination chat; a different existing chat binding is never overwritten. It reads fields from the record, not from stale callback arguments. Already resolved records skip delivery and are not recreated by an old job. A race after that check can still deliver a stale button, whose action remains protected by the shared resolution command.

Binding and pending/resolved checks use the Storage lock; sending remains outside that lock. Web resolution works for unbound records, while a Telegram callback must match a recorded chat. Notification delivery remains at least once. Detector heuristics, observed-average currency semantics, and historical-import behavior are unchanged.
