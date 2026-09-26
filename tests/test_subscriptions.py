"""Tests for SubscriptionMatcher — upcoming generation, auto-match, staleness, cancel."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch
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

    def test_generates_every_eligible_cycle_through_the_horizon_without_duplicating(self, storage, sub_id):
        # R11: billing_day=15 monthly from 2026-05-01 generates 05-15,
        # 06-15, and 07-15 within the 90-day horizon (through 2026-07-30);
        # 08-15 falls outside it. Running twice must not duplicate any of
        # them — schedule_period_date is checked, not just count.
        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 1)):
            matcher = SubscriptionMatcher(storage)
            matcher.run()
            matcher.run()
        upcoming = storage.list_upcoming_transactions(sub_id)
        pending = [u for u in upcoming if u["status"] == "pending"]
        assert sorted(u["expected_date"] for u in pending) == ["2026-05-15", "2026-06-15", "2026-07-15"]

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

        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 12)):
            SubscriptionMatcher(storage).run()
        upcomings = storage.list_upcoming_transactions(sub_id)
        # Should have the matched May upcoming AND new pending June/July
        # upcomings (within the 90-day horizon from 2026-05-12).
        pending = [u for u in upcomings if u["status"] == "pending"]
        assert sorted(u["expected_date"] for u in pending) == ["2026-06-15", "2026-07-15"]


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

        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 15)):
            SubscriptionMatcher(storage).run()

        pending = sorted(
            (u for u in storage.list_upcoming_transactions(sub_id) if u["status"] == "pending"),
            key=lambda u: u["expected_date"],
        )
        assert pending[0]["expected_date"] == "2026-06-15"
        assert pending[0]["expected_amount"] == pytest.approx(11.99, abs=0.01)
        assert pending[0]["amount_basis"] == "matched_charge"
        assert pending[0]["amount_basis_transaction_id"] == tx_id

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

        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 15)):
            SubscriptionMatcher(storage).run()

        pending = sorted(
            (u for u in storage.list_upcoming_transactions(sub_id) if u["status"] == "pending"),
            key=lambda u: u["expected_date"],
        )
        assert pending[0]["expected_date"] == "2026-06-15"
        assert pending[0]["expected_amount"] is None
        assert pending[0]["amount_basis"] == "unknown"


class TestHorizonExpansion:
    def test_end_of_month_billing_day_does_not_drift_across_months(self, storage):
        # R11: billing_day=31 clamped through Feb (28-day, non-leap 2027)
        # must not permanently pin later months to 28 — each step
        # reclamps independently from that month's own length.
        sub = storage.create_subscription('Rent', 'monthly', billing_day=31)
        with patch('src.subscriptions.local_now', return_value=datetime(2027, 1, 1)):
            SubscriptionMatcher(storage).run()
        dates = sorted(u["expected_date"] for u in storage.list_upcoming_transactions(sub))
        assert dates == ["2027-01-31", "2027-02-28", "2027-03-31"]

    def test_quarterly_and_weekly_schedules_generate_multiple_occurrences(self, storage):
        weekly = storage.create_subscription('Kopi', 'weekly', billing_day=0)  # Monday
        quarterly = storage.create_subscription('Insurance', 'quarterly')
        with patch('src.subscriptions.local_now', return_value=datetime(2026, 1, 5)):  # a Monday
            SubscriptionMatcher(storage).run()
        weekly_dates = sorted(u["expected_date"] for u in storage.list_upcoming_transactions(weekly))
        quarterly_dates = sorted(u["expected_date"] for u in storage.list_upcoming_transactions(quarterly))
        assert len(weekly_dates) >= 10  # ~90 days / 7
        assert all(datetime.strptime(d, "%Y-%m-%d").weekday() == 0 for d in weekly_dates)
        assert quarterly_dates == ["2026-04-05"]  # +90 days once, none within the horizon a second time

    def test_dismissed_period_is_not_regenerated(self, storage, sub_id):
        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 1)):
            SubscriptionMatcher(storage).run()
        upcomings = storage.list_upcoming_transactions(sub_id)
        june = next(u for u in upcomings if u["expected_date"] == "2026-06-15")
        storage.dismiss_planned_charge(june["id"])

        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 1)):
            SubscriptionMatcher(storage).run()

        upcomings = storage.list_upcoming_transactions(sub_id)
        june_rows = [u for u in upcomings if u["expected_date"] == "2026-06-15"]
        assert len(june_rows) == 1
        assert june_rows[0]["status"] == "dismissed"

    def test_corrected_period_is_not_regenerated_at_its_original_date(self, storage, sub_id):
        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 1)):
            SubscriptionMatcher(storage).run()
        upcomings = storage.list_upcoming_transactions(sub_id)
        june = next(u for u in upcomings if u["expected_date"] == "2026-06-15")
        storage.update_planned_charge(june["id"], {"expected_date": "2026-06-20"})

        with patch('src.subscriptions.local_now', return_value=datetime(2026, 5, 1)):
            SubscriptionMatcher(storage).run()

        upcomings = storage.list_upcoming_transactions(sub_id)
        assert sorted(u["expected_date"] for u in upcomings) == ["2026-05-15", "2026-06-20", "2026-07-15"]
        moved = next(u for u in upcomings if u["expected_date"] == "2026-06-20")
        assert moved["date_basis"] == "user"
        assert moved["schedule_period_date"] == "2026-06-15"


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
