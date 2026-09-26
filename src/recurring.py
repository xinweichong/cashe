from datetime import datetime
from typing import Optional
from src.money import from_minor_units
from src.spending_facts import resolve_money
from src.storage import Storage


class RecurringDetector:
    def __init__(self, storage: Storage):
        self.storage = storage

    def detect(self, merchant: str, amount: float) -> Optional[dict]:
        rows = self.storage.get_merchant_history(merchant)
        if len(rows) < 2:
            return None
        # R11: average and compare in resolved canonical SGD minor units,
        # not raw face-value amounts — averaging amounts across different
        # currencies (or trusting a legacy exchange_rate of 1.0 as real
        # conversion evidence) produced a meaningless number. A row whose
        # money can't be resolved is dropped rather than guessed at.
        resolved = []
        for r in rows:
            minor, _status = resolve_money(r)
            if minor is not None:
                resolved.append((minor, r["transaction_date"]))
        if len(resolved) < 2:
            return None
        minors = [m for m, _ in resolved]
        avg_minor = sum(minors) / len(minors)
        if not all(abs(m - avg_minor) / avg_minor <= 0.10 for m in minors):
            return None
        dates = []
        for _, date_str in resolved:
            try:
                dates.append(datetime.strptime(date_str[:10], "%Y-%m-%d"))
            except (ValueError, TypeError):
                continue
        dates.sort(reverse=True)
        if len(dates) < 2:
            return None
        intervals = [(dates[i] - dates[i + 1]).days for i in range(len(dates) - 1)]
        if not intervals:
            return None
        avg_interval = sum(intervals) / len(intervals)
        frequency = None
        if 25 <= avg_interval <= 35:
            frequency = "monthly"
        elif 13 <= avg_interval <= 17:
            frequency = "biweekly"
        elif 6 <= avg_interval <= 8:
            frequency = "weekly"
        if not frequency:
            return None
        avg_amount = float(from_minor_units(round(avg_minor), "SGD"))
        return {"frequency": frequency, "avg_amount": avg_amount, "occurrences": len(rows)}
