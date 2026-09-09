import pytest
from datetime import datetime
from src.storage import Storage


@pytest.fixture
def storage(in_memory_db):
    return Storage(connection=in_memory_db)


class TestInsertTransaction:
    def test_insert_manual_transaction(self, storage):
        tx_id = storage.insert_transaction(
            source="manual",
            source_id="manual-20260416-001",
            amount=12.50,
            merchant="Toast Box",
            description="Lunch",
            transaction_date="2026-04-16T12:30:00",
        )
        assert tx_id == 1

    def test_insert_returns_id(self, storage):
        id1 = storage.insert_transaction(
            source="manual", source_id="m1", amount=5.0,
            merchant="Test", transaction_date="2026-04-16T12:00:00",
        )
        id2 = storage.insert_transaction(
            source="manual", source_id="m2", amount=10.0,
            merchant="Test2", transaction_date="2026-04-16T13:00:00",
        )
        assert id1 == 1
        assert id2 == 2

    def test_duplicate_source_id_raises(self, storage):
        storage.insert_transaction(
            source="dbs_paylah", source_id="email-123", amount=5.0,
            merchant="Test", transaction_date="2026-04-16T12:00:00",
        )
        with pytest.raises(ValueError, match="duplicate"):
            storage.insert_transaction(
                source="dbs_paylah", source_id="email-123", amount=5.0,
                merchant="Test", transaction_date="2026-04-16T12:00:00",
            )

    def test_insert_with_category(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", category="Food",
            transaction_date="2026-04-16T12:00:00",
        )
        tx = storage.get_transaction(tx_id)
        assert tx["category"] == "Food"

    def test_insert_with_raw_data(self, storage):
        tx_id = storage.insert_transaction(
            source="dbs_paylah", source_id="e1", amount=5.0,
            merchant="Test", raw_data="original email body here",
            transaction_date="2026-04-16T12:00:00",
        )
        tx = storage.get_transaction(tx_id)
        assert tx["raw_data"] == "original email body here"


class TestGetTransaction:
    def test_get_existing(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        tx = storage.get_transaction(tx_id)
        assert tx["merchant"] == "Toast Box"
        assert tx["amount"] == 12.50

    def test_get_nonexistent_returns_none(self, storage):
        assert storage.get_transaction(999) is None


class TestUpdateTransaction:
    def test_update_merchant(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        storage.update_transaction(tx_id, merchant="Ya Kun")
        tx = storage.get_transaction(tx_id)
        assert tx["merchant"] == "Ya Kun"

    def test_update_category(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", category="Food",
            transaction_date="2026-04-16T12:00:00",
        )
        storage.update_transaction(tx_id, category="Transport")
        tx = storage.get_transaction(tx_id)
        assert tx["category"] == "Transport"

    def test_update_nonexistent_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            storage.update_transaction(999, merchant="Test")


class TestDeleteTransaction:
    def test_delete_existing(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        storage.delete_transaction(tx_id)
        assert storage.get_transaction(tx_id) is None

    def test_delete_nonexistent_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            storage.delete_transaction(999)

    def test_delete_unlinks_a_matched_upcoming_transaction_instead_of_leaving_it_dangling(self, storage):
        """delete_transaction must not leave upcoming_transactions.matched_transaction_id
        pointing at a deleted row — that's an orphan the app previously relied on
        (silently absent) FK enforcement to hide."""
        sub_id = storage.create_subscription(merchant="Netflix", frequency="monthly", billing_day=15)
        tx_id = storage.insert_transaction(
            source="manual", source_id="netflix-may", amount=15.98,
            merchant="Netflix", transaction_date="2026-05-15T10:00:00",
        )
        upcoming_id = storage.create_upcoming_transaction(sub_id, "2026-05-15", 15.98)
        storage.match_upcoming_transaction(upcoming_id, tx_id)

        storage.delete_transaction(tx_id)

        upcoming = storage.get_upcoming_transaction(upcoming_id)
        assert upcoming["status"] == "pending"
        assert upcoming["matched_transaction_id"] is None


class TestQueryTransactions:
    def test_query_by_date_range(self, storage):
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="A", transaction_date="2026-04-15T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="B", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=30.0,
            merchant="C", transaction_date="2026-04-17T12:00:00",
        )
        results = storage.query_transactions(start_date="2026-04-16", end_date="2026-04-16")
        assert len(results) == 1
        assert results[0]["merchant"] == "B"

    def test_query_by_category(self, storage):
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="A", category="Food", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="B", category="Transport", transaction_date="2026-04-16T12:00:00",
        )
        results = storage.query_transactions(category="Food")
        assert len(results) == 1
        assert results[0]["category"] == "Food"

    def test_query_by_merchant_search(self, storage):
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="Toast Box Jurong", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="Ya Kun Clementi", transaction_date="2026-04-16T12:00:00",
        )
        results = storage.query_transactions(merchant_search="Toast")
        assert len(results) == 1
        assert "Toast" in results[0]["merchant"]

    def test_query_by_source(self, storage):
        storage.insert_transaction(
            source="dbs_paylah", source_id="d1", amount=10.0,
            merchant="A", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="uob_paynow", source_id="u1", amount=20.0,
            merchant="B", transaction_date="2026-04-16T12:00:00",
        )
        results = storage.query_transactions(source="dbs_paylah")
        assert len(results) == 1

    def test_query_spending_summary(self, storage):
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="A", category="Food", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="B", category="Food", transaction_date="2026-04-16T13:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=30.0,
            merchant="C", category="Transport", transaction_date="2026-04-16T14:00:00",
        )
        summary = storage.get_spending_summary(
            start_date="2026-04-16", end_date="2026-04-16"
        )
        assert summary["total"] == 60.0
        assert summary["by_category"]["Food"] == 30.0
        assert summary["by_category"]["Transport"] == 30.0


class TestCategories:
    def test_load_categories(self, storage, sample_categories):
        storage.load_categories(sample_categories)
        cats = storage.get_categories()
        assert len(cats) == 6
        assert cats[0]["name"] == "Food"

    def test_load_categories_idempotent(self, storage, sample_categories):
        storage.load_categories(sample_categories)
        storage.load_categories(sample_categories)
        cats = storage.get_categories()
        assert len(cats) == 6


class TestIngestionState:
    def test_get_initial_state(self, storage):
        state = storage.get_ingestion_state("dbs_paylah")
        assert state is None

    def test_update_and_get_state(self, storage):
        storage.update_ingestion_state("dbs_paylah", "msg-123", "2026-04-16T12:00:00")
        state = storage.get_ingestion_state("dbs_paylah")
        assert state["last_processed_id"] == "msg-123"

    def test_update_state_overwrites(self, storage):
        storage.update_ingestion_state("dbs_paylah", "msg-123", "2026-04-16T12:00:00")
        storage.update_ingestion_state("dbs_paylah", "msg-456", "2026-04-16T13:00:00")
        state = storage.get_ingestion_state("dbs_paylah")
        assert state["last_processed_id"] == "msg-456"


class TestDuplicateCheck:
    def test_is_duplicate_false_for_new(self, storage):
        assert storage.is_duplicate("dbs_paylah", "email-123") is False

    def test_is_duplicate_true_after_insert(self, storage):
        storage.insert_transaction(
            source="dbs_paylah", source_id="email-123", amount=5.0,
            merchant="Test", transaction_date="2026-04-16T12:00:00",
        )
        assert storage.is_duplicate("dbs_paylah", "email-123") is True

    def test_recent_transaction_exists(self, storage):
        storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        assert storage.recent_transaction_exists("Toast Box", 12.50, minutes=5) is True

    def test_recent_transaction_not_exists_different_amount(self, storage):
        storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        assert storage.recent_transaction_exists("Toast Box", 99.99, minutes=5) is False


class TestCrossSourceDedup:
    def test_find_cross_source_duplicate_match(self, storage):
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=8.20,
            merchant="Ban Mian", transaction_date="2026-04-16T12:00:00",
        )
        event = storage.record_source_event("apple_wallet", "evidence", "{}", timestamp_precision="second")
        storage.finish_source_event(event["id"], "processed", tx_id)
        result = storage.find_cross_source_duplicate(
            "Ban Mian", 8.20, "dbs_paylah", transaction_date="2026-04-16T12:01:00", timestamp_precision="minute"
        )
        assert result is not None
        assert result["source"] == "apple_wallet"
        assert result["amount"] == 8.20

    def test_find_cross_source_duplicate_case_insensitive(self, storage):
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=8.20,
            merchant="Ban Mian", transaction_date="2026-04-16T12:00:00",
        )
        event = storage.record_source_event("apple_wallet", "evidence", "{}", timestamp_precision="second")
        storage.finish_source_event(event["id"], "processed", tx_id)
        result = storage.find_cross_source_duplicate(
            "BAN MIAN", 8.20, "dbs_paylah", transaction_date="2026-04-16T12:01:00", timestamp_precision="minute"
        )
        assert result is not None

    def test_find_cross_source_no_match_different_source(self, storage):
        tx_id = storage.insert_transaction(
            source="dbs_paylah", source_id="db-1", amount=8.20,
            merchant="Ban Mian", transaction_date="2026-04-16T12:00:00",
        )
        event = storage.record_source_event("apple_wallet", "evidence", "{}", timestamp_precision="second")
        storage.finish_source_event(event["id"], "processed", tx_id)
        result = storage.find_cross_source_duplicate(
            "Ban Mian", 8.20, "dbs_paylah", transaction_date="2026-04-16T12:01:00", timestamp_precision="minute"
        )
        assert result is None

    def test_find_cross_source_no_match_different_amount(self, storage):
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=8.20,
            merchant="Ban Mian", transaction_date="2026-04-16T12:00:00",
        )
        event = storage.record_source_event("apple_wallet", "evidence", "{}", timestamp_precision="second")
        storage.finish_source_event(event["id"], "processed", tx_id)
        result = storage.find_cross_source_duplicate(
            "Ban Mian", 99.99, "dbs_paylah", transaction_date="2026-04-16T12:01:00", timestamp_precision="minute"
        )
        assert result is None

    def test_find_cross_source_matches_delayed_observation(self, storage):
        tx_id = storage.insert_transaction(
            source="apple_wallet", source_id="aw-1", amount=8.20,
            merchant="Ban Mian", transaction_date="2026-04-16T12:00:00",
        )
        # Override ingested_at to an old timestamp
        storage._conn.execute(
            "UPDATE transactions SET ingested_at = '2020-01-01 00:00:00' WHERE id = ?",
            (tx_id,),
        )
        storage._conn.commit()
        event = storage.record_source_event("apple_wallet", "evidence", "{}", timestamp_precision="second")
        storage.finish_source_event(event["id"], "processed", tx_id)
        result = storage.find_cross_source_duplicate(
            "Ban Mian", 8.20, "dbs_paylah", transaction_date="2026-04-16T12:01:00", timestamp_precision="minute"
        )
        assert result is not None


class TestCategoryCRUD:
    def test_add_category(self, storage):
        storage.add_category("Health", "clinic,pharmacy,guardian,watsons", "💊")
        cats = storage.get_categories()
        names = [c["name"] for c in cats]
        assert "Health" in names
        health = next(c for c in cats if c["name"] == "Health")
        assert health["keywords"] == "clinic,pharmacy,guardian,watsons"
        assert health["icon"] == "💊"

    def test_add_duplicate_category_raises(self, storage):
        storage.add_category("Food", "restaurant,cafe", "🍜")
        with pytest.raises(ValueError, match="already exists"):
            storage.add_category("Food", "other", "🍜")

    def test_update_category_keywords(self, storage):
        storage.add_category("Food", "restaurant,cafe", "🍜")
        storage.update_category("Food", "restaurant,cafe,kopitiam")
        cats = storage.get_categories()
        food = next(c for c in cats if c["name"] == "Food")
        assert "kopitiam" in food["keywords"]

    def test_update_nonexistent_category_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            storage.update_category("Nonexistent", "keywords")

    def test_delete_category_reassigns_transactions(self, storage):
        storage.add_category("Food", "restaurant", "🍜")
        storage.add_category("Other", "", "📌")
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="Test", category="Food", transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="Test2", category="Food", transaction_date="2026-04-16T13:00:00",
        )
        count = storage.delete_category("Food")
        assert count == 2
        txs = storage.query_transactions(category="Other")
        assert len(txs) == 2
        cats = storage.get_categories()
        names = [c["name"] for c in cats]
        assert "Food" not in names

    def test_delete_nonexistent_category_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            storage.delete_category("Nonexistent")


class TestIncomeTracking:
    def test_insert_income(self, storage):
        tx_id = storage.insert_transaction(
            source="manual",
            source_id="inc-1",
            amount=5000.0,
            merchant="Salary",
            category="Income",
            transaction_date="2026-04-01T09:00:00",
            tx_type="income",
        )
        tx = storage.get_transaction(tx_id)
        assert tx["type"] == "income"

    def test_get_spending_summary_excludes_income(self, storage):
        storage.insert_transaction(
            source="manual",
            source_id="exp-1",
            amount=50.0,
            merchant="Lunch",
            category="Food",
            transaction_date="2026-04-16T12:00:00",
        )
        storage.insert_transaction(
            source="manual",
            source_id="inc-1",
            amount=5000.0,
            merchant="Salary",
            category="Income",
            transaction_date="2026-04-16T09:00:00",
            tx_type="income",
        )
        summary = storage.get_spending_summary(
            start_date="2026-04-16", end_date="2026-04-16"
        )
        assert summary["total"] == 50.0

    def test_get_income_summary(self, storage):
        storage.insert_transaction(
            source="manual",
            source_id="inc-1",
            amount=5000.0,
            merchant="Salary",
            category="Salary",
            transaction_date="2026-04-01T09:00:00",
            tx_type="income",
        )
        storage.insert_transaction(
            source="manual",
            source_id="inc-2",
            amount=500.0,
            merchant="Freelance",
            category="Freelance",
            transaction_date="2026-04-15T10:00:00",
            tx_type="income",
        )
        summary = storage.get_income_summary(
            start_date="2026-04-01", end_date="2026-04-30"
        )
        assert summary["total"] == 5500.0
        assert summary["by_category"]["Salary"] == 5000.0
        assert summary["by_category"]["Freelance"] == 500.0

    def test_get_balance(self, storage):
        storage.insert_transaction(
            source="manual",
            source_id="exp-1",
            amount=100.0,
            merchant="Groceries",
            category="Food",
            transaction_date="2026-04-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual",
            source_id="inc-1",
            amount=5000.0,
            merchant="Salary",
            category="Salary",
            transaction_date="2026-04-01T09:00:00",
            tx_type="income",
        )
        balance = storage.get_balance(
            start_date="2026-04-01", end_date="2026-04-30"
        )
        assert balance["income"] == 5000.0
        assert balance["expenses"] == 100.0
        assert balance["net"] == 4900.0


class TestMerchantOverrides:
    def test_set_and_get_override(self, storage):
        storage.set_merchant_override("BAN MIAN", "Food")
        overrides = storage.get_merchant_overrides()
        assert "BAN MIAN" in overrides
        assert overrides["BAN MIAN"] == "Food"

    def test_set_override_upserts(self, storage):
        storage.set_merchant_override("BAN MIAN", "Food")
        storage.set_merchant_override("BAN MIAN", "Transport")
        overrides = storage.get_merchant_overrides()
        assert overrides["BAN MIAN"] == "Transport"
        assert len(overrides) == 1

    def test_remove_override(self, storage):
        storage.set_merchant_override("BAN MIAN", "Food")
        storage.remove_merchant_override("BAN MIAN")
        overrides = storage.get_merchant_overrides()
        assert "BAN MIAN" not in overrides

    def test_get_overrides_empty(self, storage):
        overrides = storage.get_merchant_overrides()
        assert overrides == {}


class TestInsights:
    def test_get_merchant_ranking(self, storage):
        # Insert 3 transactions: 2 Toast Box ($10 + $8), 1 Grab ($25)
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="Toast Box", transaction_date="2026-04-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=8.0,
            merchant="Toast Box", transaction_date="2026-04-11T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=25.0,
            merchant="Grab", transaction_date="2026-04-12T12:00:00",
        )
        ranking = storage.get_merchant_ranking("2026-04-01", "2026-04-30")
        assert len(ranking) == 2
        # Grab should be first with highest total
        assert ranking[0]["merchant"] == "Grab"
        assert ranking[0]["total"] == 25.0
        # Toast Box should have visits=2
        toast = next(r for r in ranking if r["merchant"] == "Toast Box")
        assert toast["visits"] == 2
        assert toast["total"] == 18.0

    def test_get_merchant_ranking_with_limit(self, storage):
        # Insert 5 different merchants
        merchants = [("A", 10.0), ("B", 20.0), ("C", 30.0), ("D", 40.0), ("E", 50.0)]
        for i, (name, amount) in enumerate(merchants):
            storage.insert_transaction(
                source="manual", source_id=f"m{i}",
                amount=amount, merchant=name,
                transaction_date=f"2026-04-{10+i:02d}T12:00:00",
            )
        ranking = storage.get_merchant_ranking("2026-04-01", "2026-04-30", limit=3)
        assert len(ranking) == 3
        # Should be top 3 by total: E, D, C
        assert ranking[0]["merchant"] == "E"
        assert ranking[1]["merchant"] == "D"
        assert ranking[2]["merchant"] == "C"

    def test_get_average_daily(self, storage):
        # Insert 5 transactions of $20 on different days over a 30-day range
        for i in range(5):
            storage.insert_transaction(
                source="manual", source_id=f"m{i}",
                amount=20.0, merchant="Test",
                transaction_date=f"2026-04-{1+i*6:02d}T12:00:00",
            )
        # 5 * $20 = $100 total over 30 days
        avg = storage.get_average_daily("2026-04-01", "2026-04-30")
        assert avg == pytest.approx(100.0 / 30)

    def test_get_trend(self, storage):
        # Insert transactions on different dates
        storage.insert_transaction(
            source="manual", source_id="m1", amount=10.0,
            merchant="A", transaction_date="2026-04-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=20.0,
            merchant="B", transaction_date="2026-04-12T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=15.0,
            merchant="C", transaction_date="2026-04-11T12:00:00",
        )
        trend = storage.get_trend("2026-04-01", "2026-04-30")
        assert len(trend) == 3
        # Should be sorted by date
        assert trend[0]["date"] == "2026-04-10"
        assert trend[0]["amount"] == 10.0
        assert trend[1]["date"] == "2026-04-11"
        assert trend[1]["amount"] == 15.0
        assert trend[2]["date"] == "2026-04-12"
        assert trend[2]["amount"] == 20.0

    def test_get_period_comparison(self, storage):
        # Insert transactions in April (current)
        storage.insert_transaction(
            source="manual", source_id="m1", amount=100.0,
            merchant="A", category="Food",
            transaction_date="2026-04-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=50.0,
            merchant="B", category="Transport",
            transaction_date="2026-04-15T12:00:00",
        )
        # Insert transactions in March (previous)
        storage.insert_transaction(
            source="manual", source_id="m3", amount=80.0,
            merchant="C", category="Food",
            transaction_date="2026-03-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m4", amount=120.0,
            merchant="D", category="Shopping",
            transaction_date="2026-03-20T12:00:00",
        )
        comparison = storage.get_period_comparison(
            "2026-04-01", "2026-04-30",
            "2026-03-01", "2026-03-31",
        )
        assert comparison["current"]["total"] == 150.0
        assert comparison["current"]["by_category"]["Food"] == 100.0
        assert comparison["current"]["by_category"]["Transport"] == 50.0
        assert comparison["previous"]["total"] == 200.0
        assert comparison["previous"]["by_category"]["Food"] == 80.0
        assert comparison["previous"]["by_category"]["Shopping"] == 120.0


class TestTrendByCategory:
    def test_trend_by_category_groups_correctly(self, storage):
        # Two Food transactions and one Transport on the same date
        storage.insert_transaction(
            source="manual", source_id="m1", amount=20.0,
            merchant="A", category="Food", transaction_date="2026-04-10T09:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=30.0,
            merchant="B", category="Food", transaction_date="2026-04-10T12:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=12.0,
            merchant="C", category="Transport", transaction_date="2026-04-10T15:00:00",
        )
        result = storage.get_trend_by_category("2026-04-01", "2026-04-30")
        assert len(result) == 1
        row = result[0]
        assert row["date"] == "2026-04-10"
        assert row["Food"] == pytest.approx(50.0)
        assert row["Transport"] == pytest.approx(12.0)

    def test_trend_by_category_excludes_income(self, storage):
        storage.insert_transaction(
            source="manual", source_id="m1", amount=50.0,
            merchant="Salary", category="Income",
            transaction_date="2026-04-01T10:00:00", tx_type="income",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=15.0,
            merchant="Lunch", category="Food",
            transaction_date="2026-04-01T12:00:00",
        )
        result = storage.get_trend_by_category("2026-04-01", "2026-04-30")
        assert len(result) == 1
        assert "Income" not in result[0]
        assert result[0]["Food"] == pytest.approx(15.0)

    def test_trend_by_category_gap_fills_missing_categories(self, storage):
        """Every date must have an explicit None for categories absent that day.
        Without gap-filling, Recharts connectNulls cannot connect lines across
        dates where a category key is simply missing from the data object."""
        storage.insert_transaction(
            source="manual", source_id="m1", amount=20.0,
            merchant="A", category="Food", transaction_date="2026-04-01T09:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m2", amount=12.0,
            merchant="B", category="Transport", transaction_date="2026-04-02T09:00:00",
        )
        storage.insert_transaction(
            source="manual", source_id="m3", amount=35.0,
            merchant="C", category="Food", transaction_date="2026-04-03T09:00:00",
        )
        result = storage.get_trend_by_category("2026-04-01", "2026-04-30")
        by_date = {r["date"]: r for r in result}

        # Apr 1: Food present, Transport absent → must be None
        assert by_date["2026-04-01"]["Food"] == pytest.approx(20.0)
        assert by_date["2026-04-01"]["Transport"] is None

        # Apr 2: Transport present, Food absent → must be None
        assert by_date["2026-04-02"]["Transport"] == pytest.approx(12.0)
        assert by_date["2026-04-02"]["Food"] is None

        # Apr 3: Food present, Transport absent → must be None
        assert by_date["2026-04-03"]["Food"] == pytest.approx(35.0)
        assert by_date["2026-04-03"]["Transport"] is None


class TestAppSettings:
    def test_get_setting_returns_none_when_missing(self, in_memory_db):
        from src.storage import Storage
        storage = Storage(connection=in_memory_db)
        assert storage.get_setting("nonexistent") is None

    def test_get_setting_returns_default_when_missing(self, in_memory_db):
        from src.storage import Storage
        storage = Storage(connection=in_memory_db)
        assert storage.get_setting("nonexistent", default="42") == "42"

    def test_set_and_get_setting(self, in_memory_db):
        from src.storage import Storage
        storage = Storage(connection=in_memory_db)
        storage.set_setting("anomaly_multiplier", "3.5")
        assert storage.get_setting("anomaly_multiplier") == "3.5"

    def test_set_setting_overwrites_existing(self, in_memory_db):
        from src.storage import Storage
        storage = Storage(connection=in_memory_db)
        storage.set_setting("velocity_alert_threshold", "110")
        storage.set_setting("velocity_alert_threshold", "125")
        assert storage.get_setting("velocity_alert_threshold") == "125"


def test_get_budget_progress_includes_null_type_rows(in_memory_db):
    """Pre-migration rows (type IS NULL) must count toward budget spend."""
    from src.storage import Storage
    s = Storage(in_memory_db)

    # Insert a pre-migration row with NULL type
    in_memory_db.execute("""
        INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
            merchant, category, transaction_date, type)
        VALUES ('manual', 'null-type-1', 50.0, 'SGD', 1.0,
            'Old Merchant', 'Food', ?, NULL)
    """, (datetime.now().strftime("%Y-%m-%dT10:00:00"),))
    in_memory_db.execute("""
        INSERT INTO budgets (category, period, amount) VALUES ('Food', 'monthly', 200.0)
    """)
    in_memory_db.commit()

    progress = s.get_budget_progress()
    food_budget = next(b for b in progress if b["category"] == "Food")
    assert food_budget["spent"] == 50.0, (
        f"Expected 50.0 but got {food_budget['spent']} — NULL-type row was excluded"
    )


def test_get_health_score_includes_null_type_in_total_expense(in_memory_db):
    """NULL-type (pre-migration) transactions must be counted as expenses in health score."""
    from src.storage import Storage
    s = Storage(in_memory_db)

    today = datetime.now().strftime("%Y-%m-%dT10:00:00")
    # Seed income so the score can compute
    in_memory_db.execute("""
        INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
            merchant, category, transaction_date, type)
        VALUES ('manual', 'income-1', 1000.0, 'SGD', 1.0,
            'Employer', 'Income', ?, 'income')
    """, (today,))
    # Pre-migration expense row with NULL type
    in_memory_db.execute("""
        INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
            merchant, category, transaction_date, type)
        VALUES ('manual', 'null-exp-1', 800.0, 'SGD', 1.0,
            'Old Shop', 'Shopping', ?, NULL)
    """, (today,))
    in_memory_db.commit()

    result = s.get_health_score(months=1)
    assert result["has_income_data"] is True
    # With income=1000 and expense=800, savings_rate = 0.20 → savings_score = 40
    # But if NULL row excluded, expenses=0, savings_rate=1.0 → savings_score=40 (same max)
    # Distinguish by checking the actual component value
    savings_component = result["components"]["savings_rate"]
    # savings_rate = (1000 - 800) / 1000 = 0.20 when NULL row is included
    assert abs(savings_component["value"] - 0.200) < 0.01, (
        f"Expected savings_rate ≈ 0.20 but got {savings_component['value']} "
        "— NULL-type expense row was excluded from total_expense"
    )


def test_valid_types_constant_exported():
    """_VALID_TYPES should be a module-level constant in storage."""
    import src.storage as storage_module
    assert hasattr(storage_module, "_VALID_TYPES"), "_VALID_TYPES not found at module level"
    assert storage_module._VALID_TYPES == {"needs", "wants", "neutral"}


# ── Task 1: new Storage API methods ──────────────────────────────────────────

class TestGetMerchantHistory:
    def test_returns_transactions_in_window(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', 'rh-1', 30.0, 'SGD', 1.0, 'Netflix', 'Entertainment',
                    date('now', '-10 days') || 'T10:00:00', 'expense')
        """)
        in_memory_db.commit()
        rows = storage.get_merchant_history("Netflix")
        assert len(rows) == 1
        assert rows[0]["amount"] == 30.0

    def test_excludes_income_rows(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', 'rh-income', 30.0, 'SGD', 1.0, 'Netflix', 'Income',
                    date('now', '-10 days') || 'T10:00:00', 'income')
        """)
        in_memory_db.commit()
        rows = storage.get_merchant_history("Netflix")
        assert len(rows) == 0

    def test_excludes_transactions_outside_window(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', 'rh-old', 30.0, 'SGD', 1.0, 'Netflix', 'Entertainment',
                    '2020-01-01T10:00:00', 'expense')
        """)
        in_memory_db.commit()
        rows = storage.get_merchant_history("Netflix")
        assert len(rows) == 0


class TestAppleWalletCards:
    def test_returns_card_descriptions(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, description, category, transaction_date, type)
            VALUES ('apple_wallet', 'aw-1', 5.0, 'SGD', 1.0, 'Starbucks',
                    'Apple Wallet - DBS Card', 'Food', '2026-04-01T09:00:00', 'expense')
        """)
        in_memory_db.commit()
        cards = storage.get_apple_wallet_cards()
        assert "Apple Wallet - DBS Card" in cards

    def test_excludes_non_apple_wallet_sources(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, description, category, transaction_date, type)
            VALUES ('manual', 'mn-1', 5.0, 'SGD', 1.0, 'Starbucks',
                    'Apple Wallet - Fake', 'Food', '2026-04-01T09:00:00', 'expense')
        """)
        in_memory_db.commit()
        cards = storage.get_apple_wallet_cards()
        assert cards == []


class TestGetMerchantsInRange:
    def test_returns_merchants_in_range(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', 'mr-1', 10.0, 'SGD', 1.0, 'Kopitiam', 'Food',
                    '2026-04-15T10:00:00', 'expense')
        """)
        in_memory_db.commit()
        merchants = storage.get_merchants_in_range("2026-04-01", "2026-04-30")
        assert "Kopitiam" in merchants

    def test_excludes_transactions_outside_range(self, in_memory_db, storage):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', 'mr-2', 10.0, 'SGD', 1.0, 'OldShop', 'Food',
                    '2025-01-01T10:00:00', 'expense')
        """)
        in_memory_db.commit()
        merchants = storage.get_merchants_in_range("2026-04-01", "2026-04-30")
        assert "OldShop" not in merchants


class TestGetBudget:
    def test_returns_none_for_missing_id(self, storage):
        assert storage.get_budget(9999) is None

    def test_returns_row_after_create(self, storage):
        budget_id = storage.create_budget(category="Food", amount=300.0, period="monthly")
        row = storage.get_budget(budget_id)
        assert row is not None
        assert row["amount"] == 300.0
        assert row["id"] == budget_id


class TestGetGoal:
    def test_returns_none_for_missing_id(self, storage):
        assert storage.get_goal(9999) is None

    def test_returns_row_after_create(self, storage):
        goal_id = storage.create_goal(
            name="Emergency Fund", target_amount=5000.0,
            target_date="2026-12-31",
        )
        row = storage.get_goal(goal_id)
        assert row is not None
        assert row["name"] == "Emergency Fund"
        assert row["id"] == goal_id


# ── Task 2: analytics wrapper methods ────────────────────────────────────────

class TestAnalyticsWrappers:
    """Thin smoke tests — shape not value, to avoid duplicating analytics tests."""

    def test_comparison_returns_dict(self, storage):
        result = storage.comparison()
        assert isinstance(result, dict)
        assert "overall" in result and "categories" in result

    def test_comparison_accepts_period_and_date(self, storage):
        result = storage.comparison(period="week", date=None)
        assert "overall" in result

    def test_top_merchants_returns_list(self, storage):
        result = storage.top_merchants_by_period()
        assert isinstance(result, list)

    def test_merchant_trend_chart_returns_dict(self, storage):
        result = storage.merchant_trend_chart("Starbucks")
        assert isinstance(result, dict)
        assert "months" in result

    def test_spending_velocity_returns_dict(self, storage):
        result = storage.spending_velocity()
        assert isinstance(result, dict)
        assert "pace_percent" in result

    def test_spending_anomalies_returns_list(self, storage):
        result = storage.spending_anomalies()
        assert isinstance(result, list)

    def test_new_merchants_returns_list(self, storage):
        result = storage.new_merchants()
        assert isinstance(result, list)

    def test_generate_digest_returns_dict(self, storage):
        result = storage.generate_digest()
        assert isinstance(result, dict)



def test_category_and_rule_commit_atomically(storage, in_memory_db):
    import sqlite3
    tx_id = storage.insert_transaction(source='manual', source_id='atomic-rule', amount=12, merchant='Cafe', category='Other')
    in_memory_db.execute("CREATE TRIGGER reject_rule BEFORE INSERT ON merchant_overrides BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        storage.update_transaction(tx_id, category='Food', remember_category=True)
    assert storage.get_transaction(tx_id)['category'] == 'Other'
    assert storage.get_merchant_overrides() == {}
