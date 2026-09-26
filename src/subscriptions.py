"""SubscriptionMatcher — daily background job for subscription lifecycle.

Three responsibilities:
1. Generate the next upcoming_transaction for each active/possibly_cancelled
   subscription when none already exists for the next billing period.
2. Scan recent transactions and auto-match pending upcoming transactions.
3. Flag subscriptions as 'possibly_cancelled' when charges are overdue.

Cancelled subscriptions are never processed.
"""

import calendar
import logging
from datetime import datetime, timedelta
from typing import Optional

from src.config import local_now
from src.storage import Storage

logger = logging.getLogger(__name__)

STALE_FACTOR = 1.5  # charge overdue by > 1.5× interval → possibly_cancelled
GENERATION_HORIZON_DAYS = 90  # matches get_upcoming_plan's max `days`
_MAX_GENERATION_STEPS = 200  # defensive bound — even weekly over the horizon is ~13

FREQUENCY_DAYS = {
    "weekly": 7,
    "biweekly": 14,
    "monthly": 30,
    "quarterly": 90,
    "annual": 365,
}


def compute_next_billing_date(
    frequency: str,
    billing_day: Optional[int],
    last_date: Optional[str] = None,
) -> str:
    """Compute the next expected billing date.

    If billing_day provided and frequency is monthly/annual/weekly: pin to that day.
    Otherwise: last_date + frequency_days offset.
    If no last_date: use today.
    """
    today = local_now().date()
    base = datetime.strptime(last_date, "%Y-%m-%d").date() if last_date else today

    if frequency == "weekly":
        if billing_day is not None:
            days_ahead = (billing_day - base.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7
            return (base + timedelta(days=days_ahead)).isoformat()
        return (base + timedelta(weeks=1)).isoformat()

    if frequency == "monthly":
        if billing_day is not None:
            year, month = base.year, base.month
            candidate = _safe_date(year, month, billing_day)
            if candidate <= base:
                month += 1
                if month > 12:
                    year, month = year + 1, 1
                candidate = _safe_date(year, month, billing_day)
            return candidate.isoformat()
        return (base + timedelta(days=30)).isoformat()

    if frequency == "annual":
        if billing_day is not None:
            return _safe_date(base.year + 1, base.month, billing_day).isoformat()
        return (base + timedelta(days=365)).isoformat()

    if frequency == "quarterly":
        return (base + timedelta(days=90)).isoformat()

    # biweekly
    return (base + timedelta(weeks=2)).isoformat()


def _safe_date(year: int, month: int, day: int):
    """Return date clamped to last valid day of month."""
    max_day = calendar.monthrange(year, month)[1]
    return datetime(year, month, min(day, max_day)).date()


class SubscriptionMatcher:
    """Daily background job for subscription lifecycle management."""

    def __init__(self, storage: Storage):
        self.storage = storage

    def run(self) -> None:
        subscriptions = self.storage.list_subscriptions()
        # Paused and cancelled schedules retain history without automatic processing.
        active = [s for s in subscriptions if s["status"] in ("active", "possibly_cancelled")]
        for sub in active:
            try:
                # Re-read under the same lock as pause/cancel writes so a stale
                # worker snapshot cannot generate charges or reactivate a schedule.
                with self.storage.reconciliation_lock():
                    current = self.storage.get_subscription(sub["id"])
                    if current and current["status"] in ("active", "possibly_cancelled"):
                        self._process(current)
            except Exception:
                logger.exception("SubscriptionMatcher error for sub %s", sub["id"])

    def _process(self, sub: dict) -> None:
        sub_id = sub["id"]
        frequency = sub["frequency"]
        interval_days = FREQUENCY_DAYS.get(frequency, 30)

        # 1. Generate every eligible pending cycle through the horizon (R11),
        #    not just the next one.
        self._generate_horizon(sub)

        # 2. Auto-match pending upcoming transactions
        for upcoming in self.storage.list_upcoming_transactions(sub_id):
            if upcoming["status"] != "pending":
                continue
            tx = self.storage.find_subscription_match(
                merchant=sub["merchant"],
                expected_date=upcoming["expected_date"],
                expected_amount=upcoming["expected_amount"],
            )
            if tx:
                self.storage.match_upcoming_transaction(upcoming["id"], tx["id"])
                logger.info("Auto-matched upcoming %s → tx %s", upcoming["id"], tx["id"])

        # 3. Staleness check — re-fetch matched txs after potential new match above
        matched_txs = self.storage.get_subscription_matched_transactions(sub_id, limit=1)
        if matched_txs:
            last_dt = datetime.strptime(matched_txs[0]["transaction_date"][:10], "%Y-%m-%d")
            days_since = (local_now().date() - last_dt.date()).days
            threshold = interval_days * STALE_FACTOR
            if days_since > threshold and sub["status"] == "active":
                self.storage.update_subscription(sub_id, status="possibly_cancelled")
                logger.info(
                    "Marked sub %s (merchant=%s) as possibly_cancelled", sub_id, sub["merchant"]
                )
            elif days_since <= threshold and sub["status"] == "possibly_cancelled":
                self.storage.update_subscription(sub_id, status="active")

    def _generate_horizon(self, sub: dict) -> None:
        """R11: materialize every eligible pending occurrence through
        GENERATION_HORIZON_DAYS, not just the next one.

        Walks the schedule forward from the latest known period (by
        schedule_period_date, the stable identity fixed at creation and
        never touched by a later expected_date correction — so a
        corrected or dismissed period is neither regenerated nor
        duplicated). A period the schedule would place before today (e.g.
        caught up after the subscription was paused or newly reactivated)
        is walked past but never materialized — it was never actually
        billed, so it isn't a real upcoming charge.

        Chains each step from the previous occurrence rather than always
        recomputing from a fixed original anchor — safe because
        compute_next_billing_date's billing_day math (_safe_date) only
        reads the base date's year/month to pick the next candidate, so
        clamping a short month (e.g. billing_day=31 in February) never
        permanently shifts later months down; each step reclamps
        independently. The frequency-without-billing_day fallback
        (fixed +N days) is stable by construction — each step is a fixed
        offset from the previous, nothing to drift relative to.
        """
        sub_id = sub["id"]
        frequency = sub["frequency"]
        billing_day = sub["billing_day"]
        today = local_now().date()
        horizon_end = today + timedelta(days=GENERATION_HORIZON_DAYS)

        upcomings = self.storage.list_upcoming_transactions(sub_id)
        existing_periods = {u["schedule_period_date"] for u in upcomings}
        cursor = max((u["schedule_period_date"] for u in upcomings), default=None)
        expected = None  # (amount, basis_tx_id), inferred on first use

        for _ in range(_MAX_GENERATION_STEPS):
            next_date_str = compute_next_billing_date(frequency, billing_day, last_date=cursor)
            next_date = datetime.strptime(next_date_str, "%Y-%m-%d").date()
            cursor = next_date_str
            if next_date > horizon_end:
                break
            if next_date < today or next_date_str in existing_periods:
                continue
            if expected is None:
                expected = self._infer_expected_amount(sub_id)
            expected_amount, basis_tx_id = expected
            self.storage.create_upcoming_transaction(
                sub_id, next_date_str, expected_amount, amount_basis_transaction_id=basis_tx_id,
            )
            existing_periods.add(next_date_str)
            logger.info(
                "Created upcoming for sub %s (merchant=%s) on %s",
                sub_id, sub["merchant"], next_date_str,
            )

    def _infer_expected_amount(self, sub_id: int) -> tuple[Optional[float], Optional[int]]:
        """R11: upcoming_transactions.expected_amount is SGD-only (no
        currency column of its own), so this must produce a real SGD value,
        never a face-value multiply — the old `amount * exchange_rate` had
        no currency validation and, worse, silently trusted a legacy
        exchange_rate of 1.0 as a real conversion (the same bug class R04
        fixed everywhere else money crosses a currency boundary). An
        unresolved conversion now yields no expected amount rather than a
        wrong one — get_upcoming_plan already treats a missing amount as
        an "unknown" item, not a zero.

        Returns (amount, basis_transaction_id) — the id of the matched
        charge the amount was inferred from, so the caller can record
        charge-level amount provenance (R11 sub-project 2)."""
        from src.money import from_minor_units
        from src.spending_facts import resolve_money
        txs = self.storage.get_subscription_matched_transactions(sub_id, limit=1)
        if txs:
            minor, _status = resolve_money(txs[0])
            if minor is not None:
                return float(from_minor_units(minor, "SGD")), txs[0]["id"]
        return None, None
