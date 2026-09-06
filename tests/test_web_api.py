import sqlite3
import bcrypt
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
        # Log in to get a session cookie
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac


class TestCreateTransaction:
    @pytest.mark.asyncio
    async def test_create_expense(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 12.50,
            "merchant": "Toast Box",
            "category": "Food",
            "type": "expense",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 12.50
        assert data["merchant"] == "Toast Box"
        assert data["category"] == "Food"
        assert data["type"] == "expense"
        assert data["source"] == "manual"
        assert data["currency"] == "SGD"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_income(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 5000.00,
            "merchant": "Employer",
            "category": "Salary",
            "type": "income",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 5000.00
        assert data["type"] == "income"
        assert data["category"] == "Salary"

    @pytest.mark.asyncio
    async def test_create_cash_transaction(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 5.00,
            "merchant": "Hawker Stall",
            "category": "Food",
            "type": "expense",
            "source": "cash",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "cash"
        assert data["amount"] == 5.00

    @pytest.mark.asyncio
    async def test_create_with_foreign_currency(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 350.00,
            "merchant": "Thai Restaurant BKK",
            "category": "Food",
            "type": "expense",
            "currency": "THB",
            "exchange_rate": 0.039,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["currency"] == "THB"
        assert data["exchange_rate"] == 0.039
        assert data["amount"] == 350.00

    @pytest.mark.asyncio
    async def test_create_missing_amount_returns_400(self, client):
        response = await client.post("/api/transactions", json={
            "merchant": "Test",
            "type": "expense",
        })
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_create_invalid_type_returns_400(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 10.00,
            "type": "transfer",
        })
        assert response.status_code == 400


class TestListTransactions:
    @pytest.mark.asyncio
    async def test_list_transactions_with_limit(self, client):
        # Create 3 transactions
        for i in range(3):
            await client.post("/api/transactions", json={
                "amount": 10.0 + i,
                "merchant": f"Shop {i}",
                "type": "expense",
            })

        response = await client.get("/api/transactions?limit=2")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2


class TestUpdateTransaction:
    @pytest.mark.asyncio
    async def test_update_transaction(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 15.00,
            "merchant": "Old Name",
            "category": "Food",
            "type": "expense",
        })
        assert create_resp.status_code == 200
        tx_id = create_resp.json()["id"]

        update_resp = await client.put(f"/api/transactions/{tx_id}", json={
            "merchant": "New Name",
            "amount": 20.00,
            "category": "Shopping",
        })
        assert update_resp.status_code == 200
        data = update_resp.json()
        assert data["merchant"] == "New Name"
        assert data["amount"] == 20.00
        assert data["category"] == "Shopping"
        assert data["id"] == tx_id

    @pytest.mark.asyncio
    async def test_update_nonexistent_returns_404(self, client):
        response = await client.put("/api/transactions/99999", json={
            "merchant": "Ghost",
        })
        assert response.status_code == 404


class TestDeleteTransaction:
    @pytest.mark.asyncio
    async def test_delete_transaction(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 8.00,
            "merchant": "To Delete",
            "type": "expense",
        })
        assert create_resp.status_code == 200
        tx_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/transactions/{tx_id}")
        assert delete_resp.status_code == 200

        # Verify it's gone
        get_resp = await client.get(f"/api/transactions/{tx_id}")
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_404(self, client):
        response = await client.delete("/api/transactions/99999")
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_settings_returns_defaults(client):
    """GET /api/settings should return the two default threshold values."""
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["anomaly_multiplier"] == 2.0
    assert data["velocity_alert_threshold"] == 110

@pytest.mark.asyncio
async def test_put_settings_updates_values(client):
    """PUT /api/settings should persist new threshold values."""
    resp = await client.put("/api/settings", json={
        "anomaly_multiplier": 3.0,
        "velocity_alert_threshold": 120,
    })
    assert resp.status_code == 200
    # Verify persisted
    resp2 = await client.get("/api/settings")
    assert resp2.json()["anomaly_multiplier"] == 3.0
    assert resp2.json()["velocity_alert_threshold"] == 120

@pytest.mark.asyncio
async def test_put_settings_rejects_out_of_range(client):
    """PUT /api/settings should reject values outside allowed range."""
    resp = await client.put("/api/settings", json={"anomaly_multiplier": 0.5})
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_put_settings_rejects_velocity_out_of_range(client):
    resp = await client.put("/api/settings", json={"velocity_alert_threshold": 30})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_settings_atomic_on_mixed_valid_invalid(client):
    """When one field is invalid, no settings should be written."""
    # Set a known starting state
    await client.put("/api/settings", json={"velocity_alert_threshold": 150})
    # Now send a mixed request: one valid, one invalid
    resp = await client.put("/api/settings", json={
        "anomaly_multiplier": 0.5,      # invalid
        "velocity_alert_threshold": 200, # valid
    })
    assert resp.status_code == 422
    # velocity_alert_threshold should remain 150, not 200
    resp2 = await client.get("/api/settings")
    assert resp2.json()["velocity_alert_threshold"] == 150


@pytest.mark.asyncio
async def test_export_transactions_returns_csv(client, in_memory_db):
    """GET /api/transactions/export should return a CSV file."""
    # Seed a transaction
    in_memory_db.execute(
        "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, merchant, "
        "category, transaction_date, type) VALUES ('manual', 'exp1', 25.50, 'SGD', 1.0, "
        "'Coffee Bean', 'Dining', '2026-04-10', 'expense')"
    )
    in_memory_db.commit()

    resp = await client.get("/api/transactions/export")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers.get("content-disposition", "")
    lines = resp.text.strip().split("\n")
    assert lines[0].startswith("date,merchant,amount")   # header row
    assert len(lines) >= 2                                # at least one data row
    assert "Coffee Bean" in resp.text

@pytest.mark.asyncio
async def test_export_transactions_respects_category_filter(client, in_memory_db):
    for i, cat in enumerate(["Dining", "Transport", "Dining"]):
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, category, "
            "transaction_date, type) VALUES ('manual', ?, 10.0, 'Merchant', ?, '2026-04-10', 'expense')",
            (f"s{i}", cat),
        )
    in_memory_db.commit()

    resp = await client.get("/api/transactions/export?category=Dining")
    lines = resp.text.strip().split("\n")
    assert len(lines) == 3  # 1 header + 2 Dining rows


class TestBudgetAPI:
    @pytest.mark.asyncio
    async def test_create_budget_returns_progress(self, client):
        resp = await client.post("/api/budgets", json={
            "amount": 500.0,
            "period": "monthly",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["period"] == "monthly"
        assert data["amount"] == 500.0

    @pytest.mark.asyncio
    async def test_list_budget_progress(self, client):
        await client.post("/api/budgets", json={"amount": 300.0, "period": "monthly"})
        resp = await client.get("/api/budgets/progress")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # The progress endpoint returns budget_amount, label, period, id
        item = data[0]
        assert "id" in item
        assert "label" in item
        assert "period" in item
        assert "budget_amount" in item

    @pytest.mark.asyncio
    async def test_update_budget(self, client):
        create_resp = await client.post("/api/budgets", json={
            "amount": 400.0,
            "period": "monthly",
        })
        assert create_resp.status_code == 200
        budget_id = create_resp.json()["id"]

        update_resp = await client.put(f"/api/budgets/{budget_id}", json={"amount": 600.0})
        assert update_resp.status_code == 200
        data = update_resp.json()
        assert data["amount"] == 600.0

    @pytest.mark.asyncio
    async def test_delete_budget(self, client):
        create_resp = await client.post("/api/budgets", json={
            "amount": 200.0,
            "period": "weekly",
        })
        assert create_resp.status_code == 200
        budget_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/budgets/{budget_id}")
        assert delete_resp.status_code == 200

        # Confirm removed from progress list
        progress_resp = await client.get("/api/budgets/progress")
        assert progress_resp.status_code == 200
        ids = [b["id"] for b in progress_resp.json()]
        assert budget_id not in ids

    @pytest.mark.asyncio
    async def test_create_budget_missing_amount_returns_400(self, client):
        resp = await client.post("/api/budgets", json={"period": "monthly"})
        assert resp.status_code == 400


class TestGoalAPI:
    @pytest.mark.asyncio
    async def test_create_goal(self, client):
        resp = await client.post("/api/goals", json={
            "name": "Emergency Fund",
            "target_amount": 10000.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Emergency Fund"
        assert data["target_amount"] == 10000.0

    @pytest.mark.asyncio
    async def test_contribute_to_goal(self, client):
        create_resp = await client.post("/api/goals", json={
            "name": "Vacation Fund",
            "target_amount": 5000.0,
        })
        assert create_resp.status_code == 200
        goal_id = create_resp.json()["id"]

        contrib_resp = await client.post(f"/api/goals/{goal_id}/contribute", json={"amount": 500.0})
        assert contrib_resp.status_code == 200
        data = contrib_resp.json()
        assert data["saved_amount"] == 500.0

    @pytest.mark.asyncio
    async def test_delete_goal(self, client):
        create_resp = await client.post("/api/goals", json={
            "name": "Car Fund",
            "target_amount": 20000.0,
        })
        assert create_resp.status_code == 200
        goal_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/goals/{goal_id}")
        assert delete_resp.status_code == 200

    @pytest.mark.asyncio
    async def test_create_goal_missing_name_returns_400(self, client):
        resp = await client.post("/api/goals", json={"target_amount": 1000.0})
        assert resp.status_code == 400


class TestTripAPI:
    @pytest.mark.asyncio
    async def test_create_trip(self, client):
        resp = await client.post("/api/trips", json={
            "name": "Bangkok Trip",
            "start_date": "2026-07-01",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Bangkok Trip"
        assert data["status"] == "inactive"

    @pytest.mark.asyncio
    async def test_activate_trip(self, client):
        create_resp = await client.post("/api/trips", json={
            "name": "Japan Trip",
            "start_date": "2026-08-01",
        })
        assert create_resp.status_code == 200
        trip_id = create_resp.json()["id"]

        activate_resp = await client.post(f"/api/trips/{trip_id}/activate")
        assert activate_resp.status_code == 200
        data = activate_resp.json()
        assert data["status"] == "active"

    @pytest.mark.asyncio
    async def test_delete_trip(self, client):
        create_resp = await client.post("/api/trips", json={
            "name": "Europe Trip",
            "start_date": "2026-09-01",
        })
        assert create_resp.status_code == 200
        trip_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/trips/{trip_id}")
        assert delete_resp.status_code == 200


class TestRecurringAPI:
    @pytest.mark.asyncio
    async def test_recurring_returns_list(self, client):
        resp = await client.get("/api/recurring")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


class TestSettingsFeatureFlags:
    @pytest.mark.asyncio
    async def test_recurring_enabled_in_settings(self, client):
        resp = await client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "recurring_enabled" in data
        assert data["recurring_enabled"] is False

    @pytest.mark.asyncio
    async def test_set_recurring_enabled(self, client):
        put_resp = await client.put("/api/settings", json={"recurring_enabled": True})
        assert put_resp.status_code == 200

        get_resp = await client.get("/api/settings")
        assert get_resp.status_code == 200
        assert get_resp.json()["recurring_enabled"] is True


@pytest.mark.asyncio
async def test_category_edit_only_remembers_when_requested(client, in_memory_db):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='scope-1', amount=12, merchant='Cafe', category='Other')
    storage.set_merchant_override('Cafe', 'Original rule')
    response = await client.put(f'/api/transactions/{tx_id}', json={'category': 'Food'})
    assert response.status_code == 200
    assert response.json()['category'] == 'Food'
    assert storage.get_merchant_overrides() == {'Cafe': 'Original rule'}
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'category': 'Food', 'merchant': 'New Cafe', 'remember_category': True,
    })
    assert response.status_code == 200
    assert storage.get_merchant_overrides() == {'Cafe': 'Original rule', 'New Cafe': 'Food'}


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'category': 'Food', 'remember_category': 'true'},
    {'category': 'Food', 'merchant': '', 'remember_category': True},
    {'description': 'changed', 'remember_category': True},
    {'category': None, 'remember_category': True},
])
async def test_invalid_remember_choice_does_not_partially_edit(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='scope-invalid', amount=12, merchant='Cafe', category='Other')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json=fields)
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}
