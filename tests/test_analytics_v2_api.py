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
