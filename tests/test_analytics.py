import pytest
from datetime import datetime, timedelta
import sqlite3
from src.storage import Storage
from src.analytics import (
    _get_month_range,
    _get_week_range,
    get_period_comparison,
    get_category_comparison,
    get_top_merchants,
    get_merchant_trend,
    get_spending_velocity,
    get_anomalies,
    check_new_merchants,
    generate_summary,
)


def make_db():
    """Create an in-memory SQLite DB with the full schema."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT UNIQUE,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'SGD',
            exchange_rate REAL DEFAULT 1.0,
            merchant TEXT,
            description TEXT,
            category TEXT,
            transaction_date DATETIME,
            ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            raw_data TEXT,
            type TEXT DEFAULT 'expense',
            original_minor_units INTEGER,
            reporting_minor_units INTEGER,
            conversion_status TEXT,
            conversion_rate TEXT,
            conversion_source TEXT,
            conversion_quoted_at TEXT
        );
    """)
    return conn


@pytest.fixture
def db_with_transactions():
    """Create a DB with transactions across two months."""
    conn = make_db()
    storage = Storage(conn)
    now = datetime.now()
    last_month = now.replace(day=1) - timedelta(days=1)

    # This month: $300 food, $100 transport
    for i in range(3):
        storage.insert_transaction(
            source="manual", source_id=f"food-{i}-this", amount=100.0, merchant=f"Food place {i}",
            category="Food", transaction_date=now.strftime("%Y-%m-%d"),
        )
    storage.insert_transaction(
        source="manual", source_id="transport-this", amount=100.0, merchant="Taxi",
        category="Transport", transaction_date=now.strftime("%Y-%m-%d"),
    )

    # Last month: $200 food, $150 transport
    for i in range(2):
        storage.insert_transaction(
            source="manual", source_id=f"food-{i}-last", amount=100.0, merchant=f"Food place {i}",
            category="Food", transaction_date=last_month.strftime("%Y-%m-%d"),
        )
    storage.insert_transaction(
        source="manual", source_id="transport-last", amount=150.0, merchant="MRT",
        category="Transport", transaction_date=last_month.strftime("%Y-%m-%d"),
    )

    yield conn
    conn.close()


class TestPeriodComparison:
    def test_overall_comparison(self, db_with_transactions):
        result = get_period_comparison(
            db_with_transactions, period="month"
        )
        assert result["current_total"] == 400.0
        assert result["previous_total"] == 350.0
        assert result["change_percent"] == pytest.approx(14.29, abs=0.1)

    def test_category_comparison(self, db_with_transactions):
        result = get_category_comparison(
            db_with_transactions, period="month"
        )
        categories = {r["category"]: r for r in result}
        assert categories["Food"]["current"] == 300.0
        assert categories["Food"]["previous"] == 200.0
        assert categories["Food"]["change"] == 100.0

    def test_no_previous_data(self):
        conn = make_db()
        result = get_period_comparison(conn, period="month")
        assert result["previous_total"] == 0
        conn.close()

    def test_unresolved_foreign_amount_is_excluded_not_face_valued(self):
        """R04: a legacy exchange_rate of 1.0 is a silent unresolved fallback,
        not real conversion evidence (src.canonical_money's rule) — analytics
        must not sum a foreign amount at face value just because the legacy
        column happens to be 1."""
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="known", amount=50.0,
            transaction_date=now,
        )
        storage.insert_transaction(
            source="manual", source_id="unresolved-foreign", amount=500.0,
            currency="THB", exchange_rate=1.0, transaction_date=now,
        )
        result = get_period_comparison(conn, period="month")
        assert result["current_total"] == 50.0
        conn.close()

    def test_refund_nets_against_spending_in_its_own_period(self):
        # R05: a refund must reduce spending in the period the refund itself
        # falls in — not retroactively rewrite the original purchase's
        # period — and must net (not just be excluded like a transfer).
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="purchase", amount=100.0, category="Food",
            transaction_date=now, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="refund", amount=30.0, category="Food",
            transaction_date=now, tx_type="refund",
        )
        result = get_period_comparison(conn, period="month")
        assert result["current_total"] == 70.0

    def test_category_comparison_nets_refund(self):
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="purchase", amount=100.0, category="Food",
            transaction_date=now, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="refund", amount=30.0, category="Food",
            transaction_date=now, tx_type="refund",
        )
        result = get_category_comparison(conn, period="month")
        food = next(r for r in result if r["category"] == "Food")
        assert food["current"] == 70.0

    def test_category_comparison_surfaces_category_with_only_a_refund(self):
        # A category discovered only via an 'expense' row would silently drop
        # a category that has a refund but no expense in this window.
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="only-refund", amount=30.0, category="Returned",
            transaction_date=now, tx_type="refund",
        )
        result = get_category_comparison(conn, period="month")
        categories = {r["category"] for r in result}
        assert "Returned" in categories
        returned = next(r for r in result if r["category"] == "Returned")
        assert returned["current"] == -30.0


class TestMerchantAnalysis:
    def test_top_merchants_by_spend(self, db_with_transactions):
        result = get_top_merchants(db_with_transactions, limit=5)
        assert len(result) > 0
        # First result should be highest spending merchant
        assert result[0]["total"] >= result[-1]["total"]
        assert "merchant" in result[0]
        assert "count" in result[0]
        assert "total" in result[0]

    def test_top_merchants_total_nets_refund_count_and_avg_exclude_it(self):
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="tm-purchase", amount=100.0, merchant="Shop",
            category="Food", transaction_date=now, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="tm-refund", amount=30.0, merchant="Shop",
            category="Food", transaction_date=now, tx_type="refund",
        )
        result = get_top_merchants(conn)
        shop = next(r for r in result if r["merchant"] == "Shop")
        assert shop["total"] == 70.0
        # count/avg describe actual purchases, not net-of-refund arithmetic —
        # a refund isn't itself "a purchase" to average in.
        assert shop["count"] == 1
        assert shop["avg_amount"] == 100.0
        conn.close()

    def test_merchant_trend(self, db_with_transactions):
        result = get_merchant_trend(db_with_transactions, merchant="Food place 0")
        assert "current_month" in result
        assert "previous_month" in result
        assert result["current_month"] == 100.0
        assert result["previous_month"] == 100.0
        assert result["trend"] == "stable"
        assert isinstance(result["months"], list)

    def test_merchant_trend_nets_refund(self):
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now()
        storage.insert_transaction(
            source="manual", source_id="mt-purchase", amount=100.0, merchant="Shop",
            category="Food", transaction_date=now.strftime("%Y-%m-%d"), tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="mt-refund", amount=30.0, merchant="Shop",
            category="Food", transaction_date=now.strftime("%Y-%m-%d"), tx_type="refund",
        )
        result = get_merchant_trend(conn, merchant="Shop", now=now)
        assert result["current_month"] == 70.0
        conn.close()

    def test_merchant_trend_unknown_merchant(self):
        conn = make_db()
        result = get_merchant_trend(conn, merchant="Nonexistent")
        assert result["current_month"] == 0
        assert result["previous_month"] == 0
        assert result["trend"] == "stable"
        assert result["months"] == []
        conn.close()

    def test_top_merchants_limit(self):
        conn = make_db()
        storage = Storage(conn)
        for i in range(10):
            storage.insert_transaction(
                source="manual", source_id=f"shop-{i}",
                amount=float(i + 1),
                merchant=f"Shop {i}", category="Shopping",
                transaction_date=datetime.now().strftime("%Y-%m-%d"),
            )
        result = get_top_merchants(conn, limit=3)
        assert len(result) == 3
        conn.close()


class TestSpendingVelocity:
    def test_velocity_calculation(self, db_with_transactions):
        result = get_spending_velocity(db_with_transactions)
        assert "current_mtd" in result
        assert "projected_total" in result
        assert "last_month_total" in result
        assert "pace_percent" in result
        assert result["current_mtd"] > 0

    def test_velocity_start_of_month(self):
        conn = make_db()
        storage = Storage(conn)
        today = datetime.now()
        first_day = today.replace(day=1).strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="vel-test-1", amount=50.0, merchant="Test",
            category="Food", transaction_date=first_day,
        )
        result = get_spending_velocity(conn)
        assert result["current_mtd"] == 50.0
        conn.close()

    def test_current_mtd_nets_refund(self):
        conn = make_db()
        storage = Storage(conn)
        today = datetime.now()
        first_day = today.replace(day=1).strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="vel-purchase", amount=50.0, merchant="Test",
            category="Food", transaction_date=first_day, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="vel-refund", amount=20.0, merchant="Test",
            category="Food", transaction_date=first_day, tx_type="refund",
        )
        result = get_spending_velocity(conn)
        assert result["current_mtd"] == 30.0
        conn.close()


class TestAnomalies:
    def test_no_anomalies(self, db_with_transactions):
        result = get_anomalies(db_with_transactions)
        assert isinstance(result, list)

    def test_anomaly_detection(self):
        conn = make_db()
        storage = Storage(conn)
        # Normal transactions: $15 each in Food (5 of them, so avg = 15)
        for i in range(5):
            storage.insert_transaction(
                source="manual", source_id=f"normal-{i}",
                amount=15.0, merchant="Normal shop",
                category="Food", transaction_date=datetime.now().strftime("%Y-%m-%d"),
            )
        # Anomalous transaction: $500 in Food (> 2x average)
        storage.insert_transaction(
            source="manual", source_id="anomaly-1",
            amount=500.0, merchant="Fancy restaurant",
            category="Food", transaction_date=datetime.now().strftime("%Y-%m-%d"),
        )
        result = get_anomalies(conn)
        assert len(result) > 0
        assert result[0]["amount"] == 500.0
        conn.close()

    def test_unresolved_foreign_amount_is_never_flagged(self):
        """A legacy exchange_rate of 1.0 is unresolved, not real conversion
        evidence — an unresolved foreign amount must not be comparable to
        (and possibly flagged against) a category average at all."""
        conn = make_db()
        storage = Storage(conn)
        for i in range(5):
            storage.insert_transaction(
                source="manual", source_id=f"normal-{i}",
                amount=15.0, merchant="Normal shop",
                category="Food", transaction_date=datetime.now().strftime("%Y-%m-%d"),
            )
        storage.insert_transaction(
            source="manual", source_id="unresolved-foreign",
            amount=5000.0, currency="THB", exchange_rate=1.0, merchant="Bangkok Cafe",
            category="Food", transaction_date=datetime.now().strftime("%Y-%m-%d"),
        )
        result = get_anomalies(conn)
        assert all(row["merchant"] != "Bangkok Cafe" for row in result)
        conn.close()


class TestNewMerchants:
    def test_detect_new_merchant(self):
        conn = make_db()
        storage = Storage(conn)
        # Old merchant (last month)
        last_month = (datetime.now() - timedelta(days=35)).strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="old-shop", amount=10.0, merchant="Old shop",
            category="Food", transaction_date=last_month,
        )
        # New merchant (this month, first time)
        storage.insert_transaction(
            source="manual", source_id="new-shop", amount=20.0, merchant="New shop",
            category="Food", transaction_date=datetime.now().strftime("%Y-%m-%d"),
        )
        result = check_new_merchants(conn)
        assert any(r["merchant"] == "New shop" for r in result)
        conn.close()

    def test_new_merchant_no_duplicates(self):
        conn = make_db()
        storage = Storage(conn)
        today = datetime.now().strftime("%Y-%m-%d")
        # Two transactions from same new merchant on same day
        storage.insert_transaction(
            source="manual", source_id="dup-1", amount=10.0, merchant="New shop",
            category="Food", transaction_date=today,
        )
        storage.insert_transaction(
            source="manual", source_id="dup-2", amount=20.0, merchant="New shop",
            category="Food", transaction_date=today,
        )
        result = check_new_merchants(conn)
        merchants = [r["merchant"] for r in result]
        assert merchants.count("New shop") == 1  # no duplicate
        conn.close()


class TestSummaryReport:
    def test_generate_monthly_summary(self, db_with_transactions):
        result = generate_summary(db_with_transactions, report_type="monthly")
        assert result["total_spent"] == 400.0
        assert result["transaction_count"] == 4
        assert "top_category" in result
        assert "biggest_transaction" in result
        # Verify all required keys are present
        for key in ["type", "start_date", "end_date", "previous_total", "change", "change_percent", "new_merchant_count", "generated_at"]:
            assert key in result, f"Missing key: {key}"
        assert result["type"] == "monthly"

    def test_top_category_nets_refund(self):
        conn = make_db()
        storage = Storage(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="sum-purchase", amount=100.0, category="Food",
            transaction_date=now, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="sum-refund", amount=30.0, category="Food",
            transaction_date=now, tx_type="refund",
        )
        result = generate_summary(conn, report_type="monthly")
        assert result["top_category"]["category"] == "Food"
        assert result["top_category"]["total"] == 70.0
        assert result["transaction_count"] == 1  # refund isn't counted as an expense transaction
        conn.close()

class TestTimezoneAwareDateRanges:
    def test_get_month_range_accepts_now_param(self):
        """_get_month_range(now=...) should use the provided datetime, not system clock."""
        now = datetime(2026, 4, 23, 1, 0, 0)  # 1am SGT Apr 23
        start, end = _get_month_range(now=now)
        assert start == "2026-04-01"
        assert end == "2026-04-30"

    def test_get_week_range_accepts_now_param(self):
        """_get_week_range(now=...) should use the provided datetime, not system clock."""
        # April 23 2026 is a Thursday (weekday=3), week starts Mon Apr 20
        now = datetime(2026, 4, 23, 1, 0, 0)
        start, end = _get_week_range(now=now)
        assert start == "2026-04-20"
        assert end == "2026-04-26"

    def test_get_spending_velocity_accepts_now_param(self):
        """get_spending_velocity(conn, now=...) should use the provided datetime."""
        conn = make_db()
        storage = Storage(conn)
        storage.insert_transaction(
            source="manual", source_id="vel-tz-1", amount=120.0, merchant="Shop",
            category="Food", transaction_date="2026-04-15",
        )
        now = datetime(2026, 4, 15, 0, 0, 0)
        result = get_spending_velocity(conn, now=now)
        assert result["current_mtd"] == 120.0
        conn.close()


def test_query_total_counts_a_legacy_sgd_row_like_every_other_total(in_memory_db):
    """A pre-canonical-money SGD row (no reporting_minor_units) counts at face
    value here too, as it does in Storage's aggregates and spending_facts —
    it used to be silently dropped from analytics totals only."""
    from src.analytics import _query_total
    in_memory_db.execute(
        "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, merchant, transaction_date, type) "
        "VALUES ('manual', 'legacy-1', 12.5, 'SGD', 1.0, 'Cafe', '2026-04-10', 'expense')"
    )
    in_memory_db.execute(
        "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, merchant, transaction_date, type) "
        "VALUES ('manual', 'legacy-thb', 300.0, 'THB', 1.0, 'Stall', '2026-04-10', 'expense')"
    )
    assert _query_total(in_memory_db, "2026-04-01", "2026-04-30") == 12.5
