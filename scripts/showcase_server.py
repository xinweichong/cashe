"""Local server with invented demo data for landing page screenshots.

Builds the isolated journey server (scripts/journey_server.py) and adds about
ten weeks of made-up spending across capture sources, a budget, a goal and
subscriptions, so the app screens on the public landing page show a lived-in
account without any real data. Merchants and amounts are fictional.

    python3 -m scripts.showcase_server --port 8766 --data-dir /tmp/cashe-showcase
"""
import argparse
import os
import random
from datetime import timedelta

import uvicorn

from scripts import journey_server
from src.config import local_now
from src.db import init_db
from src.storage import Storage
from src.subscriptions import SubscriptionMatcher

# (merchant, category, low, high, sources, visits per week)
EVERYDAY = [
    ("Kopi Corner", "Food", 2.2, 6.5, ("apple_wallet", "dbs_paylah"), 5),
    ("Hawker Centre", "Food", 4.5, 12.0, ("dbs_paylah", "manual"), 6),
    ("Neighbourhood Grocer", "Food", 18.0, 74.0, ("uob_card", "apple_wallet"), 2),
    ("MRT", "Transport", 1.1, 2.4, ("uob_card",), 8),
    ("Ride Hail", "Transport", 9.0, 24.0, ("apple_wallet",), 1),
    ("Bookshop", "Shopping", 14.0, 42.0, ("uob_card",), 0.4),
    ("Cinema", "Entertainment", 13.5, 28.0, ("apple_wallet",), 0.5),
]
SUBSCRIPTIONS = [
    # (merchant, category, amount, billing day)
    ("Streaming Plus", "Entertainment", 15.98, 3),
    ("Cloud Storage", "Bills", 3.98, 9),
    ("Mobile Plan", "Bills", 25.00, 14),
    ("Gym Membership", "Other", 89.00, 21),
]
EXTRA_CATEGORIES = (("Bills", "📄", "needs"), ("Entertainment", "🎬", "wants"), ("Other", "📌", "neutral"), ("Income", "💰", "neutral"))


def seed(storage, days: int = 70) -> None:
    rng = random.Random(2026)
    today = local_now().replace(second=0, microsecond=0)
    for tx in storage.query_transactions(limit=50):
        if tx["source_id"].startswith("manual_journey"):  # the journey server's own rows
            storage.delete_transaction(tx["id"])
    for name, icon, cat_type in EXTRA_CATEGORIES:
        storage.add_category(name, "", icon=icon, cat_type=cat_type)
    for key in ("budgets_enabled", "goals_enabled", "subscriptions_enabled"):
        storage.set_setting(key, "true")
    for merchant, _category, _amount, day in SUBSCRIPTIONS:
        storage.create_subscription(merchant, "monthly", billing_day=day, confirmation_source="user")
    n = 0

    def add(when, merchant, category, amount, source="manual", tx_type="expense"):
        nonlocal n
        n += 1
        return storage.insert_transaction(
            source=source, source_id=f"showcase-{n}", amount=round(amount, 2), merchant=merchant,
            category=category, transaction_date=when.strftime("%Y-%m-%dT%H:%M:%S"), tx_type=tx_type,
        )

    for day in range(days, -1, -1):
        date = today - timedelta(days=day)
        for merchant, category, low, high, sources, per_week in EVERYDAY:
            if rng.random() < per_week / 7:
                when = date.replace(hour=rng.randint(8, 21), minute=rng.randint(0, 59))
                if when <= today:
                    add(when, merchant, category, rng.uniform(low, high), rng.choice(sources))
        for merchant, category, amount, billing_day in SUBSCRIPTIONS:
            if date.day == billing_day:
                add(date.replace(hour=9, minute=0), merchant, category, amount, "uob_card")
        if date.day == 1:
            add(date.replace(hour=10, minute=0), "Salary", "Income", 5200, "uob_paynow", "income")

    storage.create_budget(None, 2200, "monthly")
    storage.create_budget("Food", 650, "monthly")
    goal = storage.create_goal("Japan trip", 3000, (today + timedelta(days=150)).strftime("%Y-%m-%d"))
    for months_ago, amount in ((2, 400), (1, 450), (0, 400)):
        month = (today.replace(day=1) - timedelta(days=28 * months_ago)).strftime("%Y-%m")
        storage.add_contribution(goal, amount, month, source="manual")
    SubscriptionMatcher(storage).run()
    # The matcher learns an amount only from charges it matched itself, so give
    # the generated upcoming charges their plan amounts through the Plan command.
    amounts = {merchant: amount for merchant, _category, amount, _day in SUBSCRIPTIONS}
    for sub in storage.list_subscriptions():
        for upcoming in storage.list_upcoming_transactions(sub["id"]):
            if upcoming["status"] == "pending":
                storage.update_planned_charge(upcoming["id"], {"expected_amount": amounts[sub["merchant"]]})


class _Poller:
    """Stands in for a connected Gmail poller so Home reports a recent check."""
    service = True
    last_auth_error = None

    def __init__(self):
        self.last_poll_at = local_now().isoformat()


class _ShowcaseContext(journey_server._Context):
    def __init__(self, storage):
        super().__init__(storage)
        self.poller = _Poller()


def build(data_dir: str):
    journey_server._Context = _ShowcaseContext
    app = journey_server.build(data_dir)
    # A second connection to the journey database; the app's Storage sees its commits.
    seed(Storage(connection=init_db(os.path.join(data_dir, "expense_tracker.db"))))
    return app


def main():
    os.environ["SECURE_COOKIES"] = "false"
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--data-dir", default="/tmp/cashe-showcase")
    args = parser.parse_args()
    uvicorn.run(build(args.data_dir), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
