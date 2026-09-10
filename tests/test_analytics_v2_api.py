import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from src.config import local_now
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


@pytest.fixture
def dashboard_app(in_memory_db):
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user(TEST_PASSWORD)
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    yield create_dashboard_app(user_manager, admin_storage)
    _auth._admin_storage = None


@pytest_asyncio.fixture
async def client(dashboard_app):
    transport = ASGITransport(app=dashboard_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac


class TestAnalyticsComparisonV2:
    @pytest.mark.asyncio
    async def test_comparison_v2_returns_typed_money(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        storage.insert_transaction(
            source="manual", source_id="c1", amount=50.0, merchant="Fairprice",
            category="Groceries", transaction_date="2026-09-05", tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/comparison?period=month")
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall"]["current_total"] == {"minor_units": 5000, "currency": "SGD"}
        assert data["overall"]["previous_total"] == {"minor_units": 0, "currency": "SGD"}
        assert data["overall"]["change"] == {"minor_units": 5000, "currency": "SGD"}
        cat = next(c for c in data["categories"] if c["category"] == "Groceries")
        assert cat["current"] == {"minor_units": 5000, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_comparison_v2_handles_decrease(self, client, in_memory_db):
        # A decrease period-over-period must produce a negative `change` Money,
        # not a crash or a silently-clamped positive value.
        storage = Storage(in_memory_db)
        storage.insert_transaction(
            source="manual", source_id="p1", amount=100.0, merchant="Fairprice",
            category="Groceries", transaction_date="2026-08-05", tx_type="expense",
        )
        storage.insert_transaction(
            source="manual", source_id="c1", amount=40.0, merchant="Fairprice",
            category="Groceries", transaction_date="2026-09-05", tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/comparison?period=month&date=2026-09-15")
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall"]["change"] == {"minor_units": -6000, "currency": "SGD"}
        assert data["overall"]["change_percent"] == -60.0

    @pytest.mark.asyncio
    async def test_comparison_v2_empty_period(self, client):
        resp = await client.get("/api/v2/analytics/comparison?period=month")
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall"]["current_total"] == {"minor_units": 0, "currency": "SGD"}
        assert data["overall"]["change_percent"] == 0
        assert data["categories"] == []


class TestAnalyticsVelocityV2:
    @pytest.mark.asyncio
    async def test_velocity_v2_returns_typed_money(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        storage.insert_transaction(
            source="manual", source_id="v1", amount=100.0, merchant="Fairprice",
            category="Groceries", transaction_date="2026-09-10", tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/velocity")
        assert resp.status_code == 200
        data = resp.json()
        assert data["current_mtd"] == {"minor_units": 10000, "currency": "SGD"}
        assert data["status"] in ("ahead", "on_track", "behind")
        assert isinstance(data["days_elapsed"], int)

    @pytest.mark.asyncio
    async def test_velocity_v2_empty(self, client):
        resp = await client.get("/api/v2/analytics/velocity")
        assert resp.status_code == 200
        data = resp.json()
        assert data["current_mtd"] == {"minor_units": 0, "currency": "SGD"}


class TestAnalyticsMerchantsV2:
    @pytest.mark.asyncio
    async def test_top_merchants_v2_returns_typed_money(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        storage.insert_transaction(
            source="manual", source_id="m1", amount=25.0, merchant="Grab",
            category="Transport", transaction_date="2026-09-05", tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/merchants")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trend"] is None
        top = next(m for m in data["top"] if m["merchant"] == "Grab")
        assert top["total"] == {"minor_units": 2500, "currency": "SGD"}
        assert top["avg_amount"] == {"minor_units": 2500, "currency": "SGD"}
        assert top["count"] == 1

    @pytest.mark.asyncio
    async def test_top_merchants_v2_with_trend(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        storage.insert_transaction(
            source="manual", source_id="m1", amount=25.0, merchant="Grab",
            category="Transport", transaction_date="2026-09-05", tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/merchants?merchant=Grab")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trend"]["merchant"] == "Grab"
        assert data["trend"]["current_month"] == {"minor_units": 2500, "currency": "SGD"}
        month = next(m for m in data["trend"]["months"] if m["month"] == "2026-09")
        assert month["total"] == {"minor_units": 2500, "currency": "SGD"}


class TestAnalyticsAlertsV2:
    @pytest.mark.asyncio
    async def test_alerts_v2_anomaly_uses_canonical_money(self, client, in_memory_db):
        # Three baseline Food transactions establish the category average,
        # then one far above it (within the last 30 days) is the anomaly.
        # Give the anomaly a foreign currency to prove the v2 route reads
        # reporting_minor_units rather than the raw original-currency amount
        # (a THB 1000 anomaly must not render as "$1000 SGD").
        storage = Storage(in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        for i in range(3):
            storage.insert_transaction(
                source="manual", source_id=f"base{i}", amount=10.0, merchant="Cafe",
                category="Food", transaction_date=today, tx_type="expense",
            )
        storage.insert_transaction(
            source="manual", source_id="anomaly1", amount=1000.0, currency="THB",
            exchange_rate=0.038, merchant="Fancy Restaurant", category="Food",
            transaction_date=today, tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["anomalies"]) == 1
        anomaly = data["anomalies"][0]
        assert anomaly["merchant"] == "Fancy Restaurant"
        # 1000 THB * 0.038 = 38.00 SGD -> 3800 minor units, not 100000 (raw amount as SGD).
        assert anomaly["amount"] == {"minor_units": 3800, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_alerts_v2_new_merchant_uses_canonical_money(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="n1", amount=15.0, merchant="New Spot",
            category="Food", transaction_date=today, tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/alerts")
        assert resp.status_code == 200
        data = resp.json()
        nm = next(m for m in data["new_merchants"] if m["merchant"] == "New Spot")
        assert nm["amount"] == {"minor_units": 1500, "currency": "SGD"}


class TestHealthScoreV2:
    @pytest.mark.asyncio
    async def test_health_score_v2_no_income_data(self, client):
        resp = await client.get("/api/v2/analytics/health-score")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_income_data"] is False
        assert data["score"] is None
        assert data["components"] == {}

    @pytest.mark.asyncio
    async def test_health_score_v2_with_income(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        today = local_now().strftime("%Y-%m-%d")
        storage.insert_transaction(
            source="manual", source_id="i1", amount=5000.0, merchant="Employer",
            category="Salary", transaction_date=today, tx_type="income",
        )
        storage.insert_transaction(
            source="manual", source_id="e1", amount=1000.0, merchant="Fairprice",
            category="Groceries", transaction_date=today, tx_type="expense",
        )
        resp = await client.get("/api/v2/analytics/health-score?months=1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_income_data"] is True
        assert isinstance(data["score"], int)
        assert data["grade"] is not None
        savings = data["components"]["savings_rate"]
        assert savings["max"] == 40
        assert savings["label"] == "Savings Rate"

    @pytest.mark.asyncio
    async def test_health_score_v2_rejects_invalid_months(self, client):
        resp = await client.get("/api/v2/analytics/health-score?months=13")
        assert resp.status_code == 400
