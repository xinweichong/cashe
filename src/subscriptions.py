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
        billing_day = sub["billing_day"]
        interval_days = FREQUENCY_DAYS.get(frequency, 30)

        # Anchor next-period math on the latest known upcoming.expected_date
        # (matched or pending — both are pinned to billing_day). Using the actual
        # tx.transaction_date would mis-anchor when a charge lands a day or two
        # before billing_day and stall the subscription.
        upcomings = self.storage.list_upcoming_transactions(sub_id)
        latest_upcoming = upcomings[-1] if upcomings else None
        last_date = latest_upcoming["expected_date"] if latest_upcoming else None
        has_pending = any(u["status"] == "pending" for u in upcomings)

        # 1. Generate upcoming if none exists for next billing period.
        #    Skip when a pending upcoming is already in flight — it represents
        #    the next period and we shouldn't get ahead of it.
        next_date = compute_next_billing_date(frequency, billing_day, last_date=last_date)
        if not has_pending and not self.storage.upcoming_exists_for_period(sub_id, next_date):
            expected_amount = self._infer_expected_amount(sub_id)
            self.storage.create_upcoming_transaction(sub_id, next_date, expected_amount)
            logger.info(
                "Created upcoming for sub %s (merchant=%s) on %s",
                sub_id, sub["merchant"], next_date,
            )

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

    def _infer_expected_amount(self, sub_id: int) -> Optional[float]:
        txs = self.storage.get_subscription_matched_transactions(sub_id, limit=1)
        if txs:
            return txs[0]["amount"] * txs[0]["exchange_rate"]
        return None
