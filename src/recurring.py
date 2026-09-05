from datetime import datetime
from typing import Optional
from src.storage import Storage


class RecurringDetector:
    def __init__(self, storage: Storage):
        self.storage = storage

    def detect(self, merchant: str, amount: float) -> Optional[dict]:
        rows = self.storage.get_merchant_history(merchant)
        if len(rows) < 2:
            return None
        amounts = [r["amount"] for r in rows]
        avg_amount = sum(amounts) / len(amounts)
        if not all(abs(a - avg_amount) / avg_amount <= 0.10 for a in amounts):
            return None
        dates = []
        for r in rows:
            try:
                dates.append(datetime.strptime(r["transaction_date"][:10], "%Y-%m-%d"))
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
        return {"frequency": frequency, "avg_amount": avg_amount, "occurrences": len(rows)}
