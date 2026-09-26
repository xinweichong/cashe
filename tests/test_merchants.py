import pytest
import bcrypt
import sqlite3
from fastapi.testclient import TestClient
from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from src.config import local_now
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


class TestMerchantList:
    def test_empty_list_when_no_transactions(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        result = storage.get_merchant_list()
        assert result == []

    def test_basic_stats_computed_from_transactions(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, 'Grab', "
            "'Transport', ?, 'expense')",
            [("g1", 12.0, today), ("g2", 18.0, today), ("g3", 10.0, today)],
        )
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', 's1', 5.0, 'SGD', 1.0, "
            "'Starbucks', 'Dining', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()
        result = storage.get_merchant_list()
        assert len(result) == 2
        grab = next(r for r in result if r["merchant"] == "Grab")
        assert grab["transaction_count"] == 3
        assert grab["total_sgd"] == 40.0
        assert grab["avg_amount_sgd"] == pytest.approx(40.0 / 3, 0.01)
        assert grab["category"] == "Transport"
        assert grab["first_seen"] == today
        assert grab["last_seen"] == today
        assert grab["tags"] == []
        assert grab["notes"] == ""

    def test_total_nets_refund_count_and_avg_exclude_it(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="ml1", amount=100.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="ml2", amount=30.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="refund",
        )
        result = storage.get_merchant_list()
        shop = next(r for r in result if r["merchant"] == "Shop")
        assert shop["total_sgd"] == 70.0
        assert shop["transaction_count"] == 1
        assert shop["avg_amount_sgd"] == 100.0

    def test_merchant_with_only_a_refund_still_appears(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="ml3", amount=20.0, merchant="Refund Only",
            category="Food", transaction_date=today, tx_type="refund",
        )
        result = storage.get_merchant_list()
        merchant = next(r for r in result if r["merchant"] == "Refund Only")
        assert merchant["total_sgd"] == -20.0
        assert merchant["transaction_count"] == 0

    def test_sorted_by_total_spent_by_default(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, ?, ?, 'expense')",
            [("a1", 100.0, "Alpha", today), ("b1", 50.0, "Beta", today)],
        )
        in_memory_db.commit()
        result = storage.get_merchant_list()
        assert result[0]["merchant"] == "Alpha"
        assert result[1]["merchant"] == "Beta"

    def test_sorted_by_transaction_count(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', ?, 1.0, 'SGD', 1.0, ?, ?, 'expense')",
            [("a1", "Alpha", today), ("b1", "Beta", today), ("b2", "Beta", today)],
        )
        in_memory_db.commit()
        result = storage.get_merchant_list(sort_by="transaction_count")
        assert result[0]["merchant"] == "Beta"

    def test_name_search_filter(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', ?, 10.0, 'SGD', 1.0, ?, ?, 'expense')",
            [("g1", "Grab", today), ("s1", "Starbucks", today)],
        )
        in_memory_db.commit()
        result = storage.get_merchant_list(name_search="grab")
        assert len(result) == 1
        assert result[0]["merchant"] == "Grab"

    def test_income_transactions_excluded(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'i1', 5000, 'Employer', ?, 'income')",
            (today,),
        )
        in_memory_db.commit()
        result = storage.get_merchant_list()
        assert result == []

    def test_pagination(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        for i in range(5):
            in_memory_db.execute(
                "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
                "merchant, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, ?, ?, 'expense')",
                (f"s{i}", float(100 - i * 10), f"Merchant{i}", today),
            )
        in_memory_db.commit()
        page1 = storage.get_merchant_list(limit=3, offset=0)
        page2 = storage.get_merchant_list(limit=3, offset=3)
        assert len(page1) == 3
        assert len(page2) == 2


class TestMerchantTags:
    def test_get_tags_returns_empty_for_unknown_merchant(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        result = storage.get_merchant_tags("Unknown")
        assert result == {"merchant": "Unknown", "tags": [], "notes": ""}

    def test_set_and_get_tags(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.set_merchant_tags("Grab", ["online", "recurring"])
        result = storage.get_merchant_tags("Grab")
        assert result["tags"] == ["online", "recurring"]
        assert result["notes"] == ""

    def test_set_notes(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.set_merchant_notes("Starbucks", "Near office")
        result = storage.get_merchant_tags("Starbucks")
        assert result["notes"] == "Near office"
        assert result["tags"] == []

    def test_set_tags_overwrites_previous(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.set_merchant_tags("Grab", ["online"])
        storage.set_merchant_tags("Grab", ["online", "recurring"])
        result = storage.get_merchant_tags("Grab")
        assert result["tags"] == ["online", "recurring"]

    def test_set_tags_and_notes_independently(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.set_merchant_tags("Grab", ["online"])
        storage.set_merchant_notes("Grab", "My app")
        result = storage.get_merchant_tags("Grab")
        assert result["tags"] == ["online"]
        assert result["notes"] == "My app"


class TestMerchantProfile:
    def test_profile_includes_stats_and_tags(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, "
            "'Grab', 'Transport', ?, 'expense')",
            [("g1", 10.0, today), ("g2", 20.0, today)],
        )
        in_memory_db.commit()
        storage.set_merchant_tags("Grab", ["online", "recurring"])
        storage.set_merchant_notes("Grab", "Ride-hailing")
        profile = storage.get_merchant_profile("Grab")
        assert profile["merchant"] == "Grab"
        assert profile["total_sgd"] == 30.0
        assert profile["transaction_count"] == 2
        assert profile["tags"] == ["online", "recurring"]
        assert profile["notes"] == "Ride-hailing"

    def test_profile_returns_none_for_unknown(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        assert storage.get_merchant_profile("NonExistent") is None

    def test_profile_nets_refund_count_and_avg_exclude_it(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="mp1", amount=100.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="mp2", amount=30.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="refund",
        )
        profile = storage.get_merchant_profile("Shop")
        assert profile["total_sgd"] == 70.0
        assert profile["transaction_count"] == 1
        assert profile["avg_amount_sgd"] == 100.0

    def test_profile_resolves_for_merchant_with_only_a_refund(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="mp3", amount=20.0, merchant="Refund Only",
            category="Food", transaction_date=today, tx_type="refund",
        )
        profile = storage.get_merchant_profile("Refund Only")
        assert profile is not None
        assert profile["total_sgd"] == -20.0
        assert profile["transaction_count"] == 0
        assert "row_count" not in profile


class TestMerchantTrendStorage:
    def test_current_month_nets_refund(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="mt1", amount=100.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="mt2", amount=30.0, merchant="Shop",
            category="Food", transaction_date=today, tx_type="refund",
        )
        result = storage.get_merchant_trend("Shop")
        assert result["current_month"] == 70.0


@pytest.fixture
def client():
    # Use check_same_thread=False so TestClient's worker thread can access the DB
    conn = sqlite3.connect(":memory:", check_same_thread=False)
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
        CREATE TABLE IF NOT EXISTS merchant_tags (
            merchant   TEXT PRIMARY KEY,
            tags       TEXT DEFAULT '',
            notes      TEXT DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS merchant_overrides (
            merchant TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            source TEXT DEFAULT 'manual',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS merchant_aliases (
            merchant TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE categories (
            name TEXT PRIMARY KEY,
            keywords TEXT,
            icon TEXT,
            color TEXT
        );
        CREATE TABLE ingestion_state (
            source TEXT PRIMARY KEY,
            last_processed_id TEXT,
            last_processed_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recurring_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant TEXT NOT NULL,
            avg_amount REAL NOT NULL,
            frequency TEXT NOT NULL,
            category TEXT,
            first_seen DATETIME,
            last_seen DATETIME,
            occurrences INTEGER DEFAULT 2
        );
    """)
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user()
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=conn)
    user_manager = FakeUserManager(storage)
    app = create_dashboard_app(user_manager, admin_storage)
    c = TestClient(app, raise_server_exceptions=True)
    c.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
    return c, conn


class TestMerchantAPI:
    def test_get_merchant_list_empty(self, client):
        c, db = client
        resp = c.get("/api/v2/merchants")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_merchant_list_returns_stats(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', 'g1', 25.0, 'SGD', 1.0, "
            "'Grab', 'Transport', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.get("/api/v2/merchants")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["merchant"] == "Grab"
        assert data[0]["total"] == {"minor_units": 2500, "currency": "SGD"}
        assert data[0]["tags"] == []

    def test_get_merchant_profile(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'g1', 15.0, 'SGD', 1.0, "
            "'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.get("/api/v2/merchants/Grab")
        assert resp.status_code == 200
        assert resp.json()["merchant"] == "Grab"

    def test_get_merchant_profile_404_for_unknown(self, client):
        c, _ = client
        resp = c.get("/api/v2/merchants/Unknown")
        assert resp.status_code == 404

    def test_put_merchant_tags(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.put(
            "/api/merchant-intelligence/Grab/tags",
            json={"tags": ["online", "recurring"]},
        )
        assert resp.status_code == 200
        # Verify stored
        resp2 = c.get("/api/v2/merchants/Grab")
        assert resp2.json()["tags"] == ["online", "recurring"]

    def test_put_merchant_tags_rejects_invalid_tag(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.put(
            "/api/merchant-intelligence/Grab/tags",
            json={"tags": ["invalid-tag"]},
        )
        assert resp.status_code == 422

    def test_put_merchant_notes(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.put(
            "/api/merchant-intelligence/Grab/notes",
            json={"notes": "Ride-hailing app"},
        )
        assert resp.status_code == 200
        resp2 = c.get("/api/v2/merchants/Grab")
        assert resp2.json()["notes"] == "Ride-hailing app"

    def test_put_merchant_alias(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.put("/api/merchant-intelligence/Grab/alias", json={"display_name": "Grab Rides"})
        assert resp.status_code == 200
        assert resp.json() == {"merchant": "Grab", "display_name": "Grab Rides"}
        assert c.get("/api/v2/merchants/Grab").json()["display_name"] == "Grab Rides"
        assert c.get("/api/v2/merchants").json()[0]["display_name"] == "Grab Rides"
        # Blanking the alias reverts display_name to the raw merchant.
        c.put("/api/merchant-intelligence/Grab/alias", json={"display_name": ""})
        assert c.get("/api/v2/merchants/Grab").json()["display_name"] == "Grab"

    def test_merchant_rule_impact_404_without_a_rule(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        assert c.get("/api/merchant-intelligence/Grab/rule-impact").status_code == 404
        assert c.post("/api/merchant-intelligence/Grab/apply-rule").status_code == 404

    def test_get_merchant_trend(self, client):
        c, db = client
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'g1', 10.0, 'Grab', '2026-03-15', 'expense')"
        )
        db.commit()
        resp = c.get("/api/merchant-intelligence/Grab/trend")
        assert resp.status_code == 200
        data = resp.json()
        assert "merchant" in data
        assert "months" in data


class TestMerchantV2API:
    def test_list_v2_returns_typed_money(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', 'g1', 25.0, 'SGD', 1.0, "
            "'Grab', 'Transport', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.get("/api/v2/merchants")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["merchant"] == "Grab"
        assert data[0]["total"] == {"minor_units": 2500, "currency": "SGD"}
        assert data[0]["avg_amount"] == {"minor_units": 2500, "currency": "SGD"}
        assert data[0]["transaction_count"] == 1
        assert data[0]["tags"] == []

    def test_list_v2_unresolved_fx_does_not_crash(self, client):
        # A legacy exchange_rate of 1.0 on a non-SGD currency is the silent
        # unresolved marker (R02) — merchant_list's SUM/AVG CASE excludes it,
        # so the whole group is NULL. Assert this degrades to zero rather
        # than 500ing the route.
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', 'b1', 200.0, 'THB', 1.0, "
            "'Bangkok Air', 'Travel', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.get("/api/v2/merchants")
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["merchant"] == "Bangkok Air"
        assert data[0]["total"] == {"minor_units": 0, "currency": "SGD"}

    def test_profile_v2(self, client):
        c, db = client
        today = local_now().strftime("%Y-%m-%d")
        db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'g1', 15.0, 'SGD', 1.0, "
            "'Grab', ?, 'expense')",
            (today,),
        )
        db.commit()
        resp = c.get("/api/v2/merchants/Grab")
        assert resp.status_code == 200
        data = resp.json()
        assert data["merchant"] == "Grab"
        assert data["total"] == {"minor_units": 1500, "currency": "SGD"}

    def test_profile_v2_404_for_unknown(self, client):
        c, _ = client
        resp = c.get("/api/v2/merchants/Unknown")
        assert resp.status_code == 404
