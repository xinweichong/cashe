import pytest
from datetime import datetime, timedelta
from src.recurring import RecurringDetector
from src.storage import Storage


@pytest.fixture
def storage(in_memory_db):
    return Storage(connection=in_memory_db)


@pytest.fixture
def detector(storage):
    return RecurringDetector(storage)


class TestRecurringDetection:
    def test_no_match_with_fewer_than_2_transactions(self, detector, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
            "VALUES ('m', 'm1', 17.98, 'Netflix', '2026-04-17T12:00:00')"
        )
        in_memory_db.commit()
        result = detector.detect("Netflix", 17.98)
        assert result is None

    def test_detect_monthly_recurring(self, detector, in_memory_db):
        base = datetime.now()
        for i in range(3):
            d = base - timedelta(days=30 * i)
            in_memory_db.execute(
                f"INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
                f"VALUES ('m', 'm{i}', 17.98, 'Netflix', '{d.strftime('%Y-%m-%dT%H:%M:%S')}')"
            )
        in_memory_db.commit()
        result = detector.detect("Netflix", 17.98)
        assert result is not None
        assert result["frequency"] == "monthly"
        assert abs(result["avg_amount"] - 17.98) < 0.01

    def test_no_match_with_inconsistent_amounts(self, detector, in_memory_db):
        base = datetime.now()
        amounts = [17.98, 50.00, 17.98]
        for i, amt in enumerate(amounts):
            d = base - timedelta(days=30 * i)
            in_memory_db.execute(
                f"INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
                f"VALUES ('m', 'm{i}', {amt}, 'Shop', '{d.strftime('%Y-%m-%dT%H:%M:%S')}')"
            )
        in_memory_db.commit()
        result = detector.detect("Shop", 50.00)
        assert result is None

    def test_no_match_with_inconsistent_intervals(self, detector, in_memory_db):
        now = datetime.now()
        dates = [now, now - timedelta(days=7), now - timedelta(days=47)]
        for i, d in enumerate(dates):
            in_memory_db.execute(
                f"INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
                f"VALUES ('m', 'm{i}', 10.0, 'Shop', '{d.strftime('%Y-%m-%dT%H:%M:%S')}')"
            )
        in_memory_db.commit()
        result = detector.detect("Shop", 10.0)
        assert result is None

    def test_detect_weekly_recurring(self, detector, in_memory_db):
        base = datetime.now()
        for i in range(3):
            d = base - timedelta(days=7 * i)
            in_memory_db.execute(
                f"INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
                f"VALUES ('m', 'm{i}', 5.50, 'Kopi', '{d.strftime('%Y-%m-%dT%H:%M:%S')}')"
            )
        in_memory_db.commit()
        result = detector.detect("Kopi", 5.50)
        assert result is not None
        assert result["frequency"] == "weekly"

    def test_averages_in_canonical_sgd_not_foreign_face_value(self, detector, storage):
        # R11: three USD 20 charges at a real (indicative) rate of 0.75 are
        # SGD 15 each — averaging the raw USD amount would report "~$20",
        # the wrong currency's face value.
        base = datetime.now()
        for i in range(3):
            d = base - timedelta(days=30 * i)
            storage.insert_transaction(
                source="manual", source_id=f"fx-{i}", amount=20.0, currency="USD",
                exchange_rate=0.75, merchant="Netflix", transaction_date=d.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        result = detector.detect("Netflix", 20.0)
        assert result is not None
        assert abs(result["avg_amount"] - 15.0) < 0.01

    def test_skips_rows_with_unresolved_currency(self, detector, storage):
        # A legacy exchange_rate of 1.0 on a foreign currency is a silent
        # unresolved fallback, not real conversion evidence (R04's own
        # rule) — those two rows must not enter the average, leaving too
        # few resolved rows to detect a pattern.
        base = datetime.now()
        for i in range(3):
            d = base - timedelta(days=30 * i)
            storage.insert_transaction(
                source="manual", source_id=f"unresolved-{i}", amount=20.0, currency="USD",
                exchange_rate=1.0, merchant="Ghost", transaction_date=d.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        assert detector.detect("Ghost", 20.0) is None

    def test_does_not_treat_mismatched_currencies_as_consistent_at_face_value(self, detector, storage):
        # A SGD 20 charge and a USD 20 charge (really SGD 15 at 0.75) look
        # "consistent" at face value but are not once resolved — the 10%
        # variance check must run on resolved SGD amounts.
        base = datetime.now()
        storage.insert_transaction(
            source="manual", source_id="mix-0", amount=20.0, currency="SGD",
            merchant="Mixed", transaction_date=base.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        storage.insert_transaction(
            source="manual", source_id="mix-1", amount=20.0, currency="USD", exchange_rate=0.75,
            merchant="Mixed", transaction_date=(base - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S"),
        )
        storage.insert_transaction(
            source="manual", source_id="mix-2", amount=20.0, currency="SGD",
            merchant="Mixed", transaction_date=(base - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%S"),
        )
        assert detector.detect("Mixed", 20.0) is None

    def test_detects_biweekly_pattern(self, detector, in_memory_db):
        """Transactions ~14 days apart should be classified as biweekly."""
        now = datetime.now()
        dates = [
            (now - timedelta(days=28)).strftime("%Y-%m-%d"),
            (now - timedelta(days=14)).strftime("%Y-%m-%d"),
            now.strftime("%Y-%m-%d"),
        ]
        for i, d in enumerate(dates):
            in_memory_db.execute(
                f"INSERT INTO transactions (source, source_id, amount, merchant, transaction_date) "
                f"VALUES ('m', 'sp{i}', 29.99, 'Spotify', '{d}')"
            )
        in_memory_db.commit()
        result = detector.detect("Spotify", 29.99)
        assert result is not None
        assert result["frequency"] == "biweekly"
