"""Tests for Storage.get_subscription_review — overdue, price-change, and
annual-renewal surfacing (R11 sub-project 4)."""

from datetime import datetime
from unittest.mock import patch

import pytest

from src.storage import Storage


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


def _match(storage, sub_id, date, amount, currency="SGD", exchange_rate=1.0):
    upcoming_id = storage.create_upcoming_transaction(sub_id, date, amount)
    tx_id = storage.insert_transaction(
        source="manual", source_id=f"tx-{date}-{amount}", amount=amount, currency=currency,
        exchange_rate=exchange_rate, merchant="Merchant", transaction_date=f"{date}T10:00:00", tx_type="expense",
    )
    storage.match_upcoming_transaction(upcoming_id, tx_id)
    return tx_id


class TestOverdue:
    def test_overdue_includes_possibly_cancelled_with_evidence(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        storage.update_subscription(sub, status="possibly_cancelled")

        with patch("src.storage.local_now", return_value=datetime(2026, 5, 1)):
            review = storage.get_subscription_review()

        assert len(review["overdue"]) == 1
        item = review["overdue"][0]
        assert item["subscription_id"] == sub
        assert item["last_charge_date"] == "2026-03-15"
        assert item["days_since_last_charge"] == 47
        assert item["expected_interval_days"] == 30

    def test_active_subscription_is_not_overdue(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-04-15", 17.98)

        review = storage.get_subscription_review()

        assert review["overdue"] == []

    def test_cancelled_subscriptions_are_excluded_entirely(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        _match(storage, sub, "2026-04-15", 25.98)
        storage.update_subscription(sub, status="cancelled")

        review = storage.get_subscription_review()

        assert review["overdue"] == []
        assert review["price_changes"] == []


class TestPriceChanges:
    def test_detects_a_price_increase_between_the_last_two_charges(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        _match(storage, sub, "2026-04-15", 22.98)

        review = storage.get_subscription_review()

        assert len(review["price_changes"]) == 1
        change = review["price_changes"][0]
        assert change["old_amount"]["minor_units"] == 1798
        assert change["new_amount"]["minor_units"] == 2298
        assert change["change"]["minor_units"] == 500
        assert change["annualized_impact"]["minor_units"] == 6000  # $5/mo * 12

    def test_no_price_change_reported_when_last_two_charges_are_equal(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        _match(storage, sub, "2026-04-15", 17.98)

        review = storage.get_subscription_review()

        assert review["price_changes"] == []

    def test_uses_canonical_money_not_face_value_for_a_foreign_currency_charge(self, storage):
        # USD 20 at a real rate of 0.75 is SGD 15 — comparing raw face
        # value against a SGD 17.98 charge would report a decrease; the
        # canonical comparison correctly reports one too, but at the right
        # magnitude ($2.98, not $2.02).
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        _match(storage, sub, "2026-04-15", 20.0, currency="USD", exchange_rate=0.75)

        review = storage.get_subscription_review()

        change = review["price_changes"][0]
        assert change["new_amount"]["minor_units"] == 1500
        assert change["change"]["minor_units"] == -298

    def test_no_price_change_when_a_charge_is_unresolved(self, storage):
        # A legacy exchange_rate of 1.0 on a foreign currency is unresolved
        # (R04's rule) — must not be compared as if it were a real amount.
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        _match(storage, sub, "2026-03-15", 17.98)
        _match(storage, sub, "2026-04-15", 20.0, currency="USD", exchange_rate=1.0)

        review = storage.get_subscription_review()

        assert review["price_changes"] == []


class TestAnnualRenewals:
    def test_annual_renewal_surfaced_within_60_days_with_supporting_charges(self, storage):
        sub = storage.create_subscription("iCloud+", "annual", billing_day=1)
        _match(storage, sub, "2025-06-01", 29.99)
        storage.create_upcoming_transaction(sub, "2026-06-01", 29.99)

        with patch("src.storage.local_now", return_value=datetime(2026, 5, 1)):
            review = storage.get_subscription_review()

        assert len(review["annual_renewals"]) == 1
        renewal = review["annual_renewals"][0]
        assert renewal["subscription_id"] == sub
        assert renewal["renewal_date"] == "2026-06-01"
        assert renewal["days_until_renewal"] == 31
        assert len(renewal["supporting_charges"]) == 1
        assert renewal["supporting_charges"][0]["amount"]["minor_units"] == 2999

    def test_annual_renewal_not_surfaced_outside_the_60_day_window(self, storage):
        sub = storage.create_subscription("iCloud+", "annual", billing_day=1)
        storage.create_upcoming_transaction(sub, "2026-06-01", 29.99)

        with patch("src.storage.local_now", return_value=datetime(2026, 1, 1)):
            review = storage.get_subscription_review()

        assert review["annual_renewals"] == []

    def test_monthly_subscriptions_are_never_annual_renewals(self, storage):
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        storage.create_upcoming_transaction(sub, "2026-05-15", 17.98)

        with patch("src.storage.local_now", return_value=datetime(2026, 5, 1)):
            review = storage.get_subscription_review()

        assert review["annual_renewals"] == []
