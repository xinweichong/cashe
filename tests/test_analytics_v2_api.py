import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
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
