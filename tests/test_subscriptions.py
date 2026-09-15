"""Tests for SubscriptionMatcher — upcoming generation, auto-match, staleness, cancel."""

import pytest
from datetime import datetime, timedelta
from src.storage import Storage
from src.subscriptions import SubscriptionMatcher, compute_next_billing_date


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


@pytest.fixture
def sub_id(storage):
    return storage.create_subscription(
        merchant="Spotify", frequency="monthly", billing_day=15, label="Spotify Premium"
    )


class TestComputeNextBillingDate:
    def test_monthly_billing_day_past(self):
        # From 2026-04-20, billing_day=15 → next 15th is 2026-05-15
        result = compute_next_billing_date("monthly", 15, last_date="2026-04-20")
        assert result == "2026-05-15"

    def test_monthly_billing_day_not_yet_passed(self):
        # From 2026-05-10, billing_day=15 → still 2026-05-15
        result = compute_next_billing_date("monthly", 15, last_date="2026-05-10")
        assert result == "2026-05-15"

    def test_monthly_no_billing_day(self):
        result = compute_next_billing_date("monthly", None, last_date="2026-04-15")
        assert result == "2026-05-15"

    def test_annual_billing_day(self):
        result = compute_next_billing_date("annual", 15, last_date="2025-03-15")
        assert result == "2026-03-15"

    def test_weekly_billing_day(self):
        # billing_day=0 (Monday), from 2026-05-05 (Tuesday) → 2026-05-11 (next Monday)
        result = compute_next_billing_date("weekly", 0, last_date="2026-05-05")
        assert result == "2026-05-11"


class TestUpcomingGeneration:
    def test_generates_upcoming_for_active_subscription(self, storage, sub_id):
        matcher = SubscriptionMatcher(storage)
        matcher.run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        assert len(upcoming) >= 1
        assert upcoming[0]["status"] == "pending"

    def test_does_not_duplicate_upcoming(self, storage, sub_id):
        matcher = SubscriptionMatcher(storage)
        matcher.run()
        matcher.run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        pending = [u for u in upcoming if u["status"] == "pending"]
        assert len(pending) == 1

    def test_does_not_generate_for_cancelled_subscription(self, storage, sub_id):
        storage.update_subscription(sub_id, status="cancelled")
        matcher = SubscriptionMatcher(storage)
        matcher.run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        assert len(upcoming) == 0

    def test_advances_when_charged_before_billing_day(self, storage, sub_id, in_memory_db):
        """Regression: charge on 12th with billing_day=15 must still generate next month's upcoming."""
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('apple_wallet', 'test-spotify-early', 13.98, 'SGD', 1.0,
                       'Spotify', 'Entertainment', '2026-05-12T10:00:00', 'expense')"""
        )
        in_memory_db.commit()
        tx = in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id = 'test-spotify-early'"
        ).fetchone()
        upcoming_id = storage.create_upcoming_transaction(sub_id, "2026-05-15", 13.98)
        storage.match_upcoming_transaction(upcoming_id, tx["id"])

        SubscriptionMatcher(storage).run()
        upcomings = storage.list_upcoming_transactions(sub_id)
        # Should have the matched May upcoming AND a new pending June upcoming
        pending = [u for u in upcomings if u["status"] == "pending"]
        assert len(pending) == 1
        assert pending[0]["expected_date"] == "2026-06-15"


class TestInferExpectedAmount:
    def test_next_upcoming_gets_canonical_sgd_amount_for_foreign_charge(self, storage, sub_id):
        # R11: a USD 15.99 charge at a real (indicative) rate of 0.75 is
        # SGD ~11.99 — the old `amount * exchange_rate` face-value multiply
        # gave the same number here (0.75 was a real rate), but the fix
        # must be exercised against a foreign currency to prove it's
        # actually resolving through canonical money, not coincidentally
        # matching a same-result legacy path.
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="fx-spotify", amount=15.99, currency="USD",
            exchange_rate=0.75, merchant="Spotify", category="Entertainment",
            transaction_date="2026-05-15T10:00:00", tx_type="expense",
        )
        upcoming_id = storage.create_upcoming_transaction(sub_id, "2026-05-15", 15.99)
        storage.match_upcoming_transaction(upcoming_id, tx_id)

        SubscriptionMatcher(storage).run()

        pending = [u for u in storage.list_upcoming_transactions(sub_id) if u["status"] == "pending"]
        assert len(pending) == 1
        assert pending[0]["expected_amount"] == pytest.approx(11.99, abs=0.01)

    def test_next_upcoming_has_no_expected_amount_when_conversion_is_unresolved(self, storage, sub_id):
        # A legacy exchange_rate of 1.0 on a foreign currency is a silent
        # unresolved fallback (R04's own rule), never real conversion
        # evidence — the old code would have returned a wrong SGD-labeled
        # number (raw USD face value); the fix must leave the next
        # upcoming's amount unknown instead.
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="unresolved-spotify", amount=15.99, currency="USD",
            exchange_rate=1.0, merchant="Spotify", category="Entertainment",
            transaction_date="2026-05-15T10:00:00", tx_type="expense",
        )
        upcoming_id = storage.create_upcoming_transaction(sub_id, "2026-05-15", 15.99)
        storage.match_upcoming_transaction(upcoming_id, tx_id)

        SubscriptionMatcher(storage).run()

        pending = [u for u in storage.list_upcoming_transactions(sub_id) if u["status"] == "pending"]
        assert len(pending) == 1
        assert pending[0]["expected_amount"] is None


class TestAutoMatch:
    def test_auto_matches_transaction_in_window(self, storage, sub_id, in_memory_db):
        expected_date = "2026-05-15"
        storage.create_upcoming_transaction(sub_id, expected_date, expected_amount=13.98)
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('apple_wallet', 'test-spotify-01', 13.98, 'SGD', 1.0,
                       'Spotify', 'Entertainment', '2026-05-15T10:00:00', 'expense')"""
        )
        in_memory_db.commit()

        SubscriptionMatcher(storage).run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        assert upcoming[0]["status"] == "matched"
        assert upcoming[0]["matched_transaction_id"] is not None

    def test_does_not_match_outside_window(self, storage, sub_id, in_memory_db):
        expected_date = "2026-05-15"
        storage.create_upcoming_transaction(sub_id, expected_date, expected_amount=13.98)
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('apple_wallet', 'test-spotify-02', 13.98, 'SGD', 1.0,
                       'Spotify', 'Entertainment', '2026-05-05T10:00:00', 'expense')"""
        )
        in_memory_db.commit()

        SubscriptionMatcher(storage).run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        assert upcoming[0]["status"] == "pending"


class TestStalenessDetection:
    def test_marks_possibly_cancelled_when_overdue(self, storage, sub_id, in_memory_db):
        old_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
        upcoming_id = storage.create_upcoming_transaction(sub_id, old_date, 13.98)
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('apple_wallet', 'test-spotify-03', 13.98, 'SGD', 1.0,
                       'Spotify', 'Entertainment', ?, 'expense')""",
            (old_date + "T10:00:00",),
        )
        in_memory_db.commit()
        tx = in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id = 'test-spotify-03'"
        ).fetchone()
        storage.match_upcoming_transaction(upcoming_id, tx["id"])

        SubscriptionMatcher(storage).run()
        sub = storage.get_subscription(sub_id)
        assert sub["status"] == "possibly_cancelled"

    def test_does_not_flag_active_subscription(self, storage, sub_id, in_memory_db):
        recent = (datetime.now() - timedelta(days=10)).strftime("%Y-%m-%d")
        upcoming_id = storage.create_upcoming_transaction(sub_id, recent, 13.98)
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('apple_wallet', 'test-spotify-04', 13.98, 'SGD', 1.0,
                       'Spotify', 'Entertainment', ?, 'expense')""",
            (recent + "T10:00:00",),
        )
        in_memory_db.commit()
        tx = in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id = 'test-spotify-04'"
        ).fetchone()
        storage.match_upcoming_transaction(upcoming_id, tx["id"])

        SubscriptionMatcher(storage).run()
        sub = storage.get_subscription(sub_id)
        assert sub["status"] == "active"

    def test_skips_cancelled_subscription(self, storage, sub_id):
        storage.update_subscription(sub_id, status="cancelled")
        # cancelled subscriptions must not be touched by matcher
        SubscriptionMatcher(storage).run()
        sub = storage.get_subscription(sub_id)
        assert sub["status"] == "cancelled"


class TestSubscriptionSummary:
    def test_monthly_total_for_monthly_subscription(self, storage, in_memory_db):
        sub_id = storage.create_subscription(merchant="Netflix", frequency="monthly")
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('manual', 'manual_netflix01', 15.98, 'SGD', 1.0,
                       'Netflix', 'Entertainment', '2026-05-01T10:00:00', 'expense')"""
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id = 'manual_netflix01'"
        ).fetchone()["id"]
        u_id = storage.create_upcoming_transaction(sub_id, "2026-05-01", 15.98)
        storage.match_upcoming_transaction(u_id, tx_id)
        summary = storage.get_subscription_summary()
        assert abs(summary["total_monthly_sgd"] - 15.98) < 0.01

    def test_monthly_total_for_biweekly_subscription(self, storage, in_memory_db):
        sub_id = storage.create_subscription(merchant="Gym", frequency="biweekly")
        in_memory_db.execute(
            """INSERT INTO transactions
               (source, source_id, amount, currency, exchange_rate, merchant,
                category, transaction_date, type)
               VALUES ('manual', 'manual_gym01', 50.0, 'SGD', 1.0,
                       'Gym', 'Health', '2026-05-01T10:00:00', 'expense')"""
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id = 'manual_gym01'"
        ).fetchone()["id"]
        u_id = storage.create_upcoming_transaction(sub_id, "2026-05-01", 50.0)
        storage.match_upcoming_transaction(u_id, tx_id)
        summary = storage.get_subscription_summary()
        # biweekly × 2.17 = 108.50
        assert abs(summary["total_monthly_sgd"] - 108.50) < 0.01

    def test_cancelled_subscription_excluded_from_total(self, storage, in_memory_db):
        sub_id = storage.create_subscription(merchant="Hulu", frequency="monthly")
        storage.update_subscription(sub_id, status="cancelled")
        summary = storage.get_subscription_summary()
        assert summary["total_monthly_sgd"] == 0.0
        assert summary["active_count"] == 0
