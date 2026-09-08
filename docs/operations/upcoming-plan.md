# Upcoming Plan compatibility slice

Authenticated `GET /api/v2/plan/upcoming?days=30&limit=50&offset=0` returns recorded upcoming subscription charges. The date window starts on the configured local date and includes exactly `days` calendar dates (1–90); response pages contain 1–100 items, with a nonnegative offset.

Only pending, unmatched charges from active or possibly-cancelled subscriptions are selected. Matched, dismissed, cancelled, past, out-of-window, and unreadable-date rows are excluded. Results sort by expected date and ID. The known estimated total and unknown count cover the entire selected window, independently of pagination. Amounts use the retained legacy SGD estimate with per-row Decimal rounding; missing, invalid, or negative values remain unknown. This does not recover the estimate's FX provenance or migrate stored money.

Every displayed charge is an estimate. Existing data does not distinguish a confirmed amount from an inferred one; active subscription status is not proof of a confirmed charge. Possibly-cancelled schedules are labeled for review, without claiming that the provider has cancelled the service. The endpoint exposes labels, dates, frequency, schedule status, identifiers for review, and monetary values; private subscription notes and transaction payloads are excluded.

The new Plan destination opens this timeline, with 14/30/90-day selection, bounded pagination, and distinct loading/error/stale/disabled/empty/partial states. Existing finance tools remain at `/plan/manage`; `?subscription=<id>` opens the existing detail controls. Opt-in legacy Finance links and older Plan management parameters retain their query/fragment. Subscription edits, matching, dismissal, linking, and removal invalidate timeline and Home queries.

The API's `enabled` metadata reflects the UI subscription setting; the flag does not delete or hide records from authenticated API callers. The page explains how to enable subscriptions when disabled.

The timeline does not expand all future billing cycles, include unrecorded commitments, provide a full forecast, or certify completeness. It reuses the scheduler's retained predictions; manual controls continue through the existing subscription UI. Confirmed/inferred provenance, pause controls, richer overdue review, and new reconciliation rules remain separate work.
