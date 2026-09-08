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


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'transaction_date': None}, {'transaction_date': 123}, {'transaction_date': ''},
    {'transaction_date': '2026-02-30'}, {'transaction_date': '2026-09-06T25:00:00'},
    {'transaction_date': '2026-W36-7'}, {'transaction_date': '20260906'},
    {'transaction_date': '2026-09-06T12:00:00+99:00'},
    {'transaction_date': '2026-09-06T12:00:00+08:90'},
    {'type': None}, {'type': 'cash'}, {'type': []},
])
async def test_invalid_date_or_type_correction_is_atomic(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='invalid-correction', amount=12, merchant='Cafe', category='Other')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'merchant': 'Changed', 'category': 'Food', 'remember_category': True, **fields,
    })
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('date_value,stored', [
    ('2024-02-29', '2024-02-29T00:00:00'),
    ('2026-09-06 12:30', '2026-09-06T12:30:00'),
    ('2026-09-06T12:30:01+08:00', '2026-09-06T12:30:01+08:00'),
    ('2026-09-06T12:30:01.123Z', '2026-09-06T12:30:01.123000+00:00'),
])
async def test_date_corrections_preserve_precision_and_offset(client, in_memory_db, date_value, stored):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='date-correction', amount=12)
    response = await client.put(f'/api/transactions/{tx_id}', json={'transaction_date': date_value})
    assert response.status_code == 200
    assert response.json()['transaction_date'] == stored


@pytest.mark.asyncio
async def test_correcting_review_date_and_type_updates_facts_without_changing_evidence(client, in_memory_db):
    from datetime import date
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='review-correction', amount=12,
                                       tx_type='unknown', transaction_date=None, raw_data='original payload')
    event = storage.record_source_event('manual', 'original-id', 'original evidence')
    storage.finish_source_event(event['id'], 'processed', tx_id)
    original_event = storage.get_source_event('manual', 'original-id')
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'transaction_date': '2026-08-31T18:00:00+00:00', 'type': 'income',
    })
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 0
    facts = storage.get_month_spending_facts(date(2026, 9, 6))
    assert facts['current']['income']['minor_units'] == 1200
    assert facts['current']['spending']['minor_units'] == 0
    assert storage.get_source_event('manual', 'original-id') == original_event
    assert storage.get_transaction(tx_id)['raw_data'] == 'original payload'
    assert storage.get_transaction(tx_id)['source_id'] == 'review-correction'


@pytest.mark.asyncio
async def test_correction_rejects_non_object_body(client, in_memory_db):
    tx_id = Storage(in_memory_db).insert_transaction(source='manual', source_id='body', amount=12)
    response = await client.put(f'/api/transactions/{tx_id}', json=['transaction_date'])
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'amount': None}, {'amount': True}, {'amount': -1}, {'amount': 'NaN'}, {'amount': '1e309'},
    {'amount': []}, {'exchange_rate': 0}, {'exchange_rate': -1}, {'exchange_rate': True},
    {'exchange_rate': 'Infinity'}, {'exchange_rate': ''}, {'currency': None}, {'currency': 'US'},
    {'currency': 'U$D'},
])
async def test_invalid_monetary_correction_is_atomic(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='money-invalid', amount=12, merchant='Cafe')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'merchant': 'Changed', 'category': 'Food', 'remember_category': True, **fields,
    })
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}


@pytest.mark.asyncio
async def test_currency_correction_clears_old_rate_and_refreshes_facts(client, in_memory_db):
    from datetime import date
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='currency-change', amount=12, currency='USD', exchange_rate=1.3, transaction_date='2026-09-01')
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'eur', 'amount': '20.25'})
    assert response.status_code == 200
    assert response.json()['currency'] == 'EUR'
    assert response.json()['exchange_rate'] is None
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={'exchange_rate': '1.5'})
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 0
    facts = storage.get_month_spending_facts(date(2026, 9, 6))
    assert facts['current']['spending']['minor_units'] == 3038
    assert facts['current']['status'] == 'indicative'
    response = await client.put(f'/api/transactions/{tx_id}', json={'exchange_rate': None})
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'SGD', 'amount': 0})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1
    assert storage.get_spending_review()['total'] == 0


@pytest.mark.asyncio
async def test_currency_correction_with_explicit_rate_and_unrelated_edit_preservation(client, in_memory_db):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='rate-preserve', amount=12, currency='USD', exchange_rate=None)
    response = await client.put(f'/api/transactions/{tx_id}', json={'category': 'Food'})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] is None
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'EUR', 'exchange_rate': 1.5})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1.5
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'EUR'})
    assert response.json()['exchange_rate'] == 1.5


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'amount': True}, {'amount': -1}, {'amount': 'NaN'}, {'amount': 'Infinity'},
    {'amount': []}, {'currency': 'US'}, {'currency': None}, {'exchange_rate': 0},
    {'exchange_rate': 'NaN'}, {'transaction_date': None}, {'transaction_date': ''},
    {'transaction_date': '2026-02-30'}, {'source': 'apple_wallet'}, {'merchant': {}},
])
async def test_manual_creation_validation_leaves_no_rows(client, in_memory_db, fields):
    response = await client.post('/api/transactions', json={'amount': 12, 'merchant': 'Cafe', **fields})
    assert response.status_code == 400
    assert Storage(in_memory_db).query_transactions(limit=50) == []


@pytest.mark.asyncio
async def test_manual_creation_unknown_fx_date_normalization_and_native_rate(client):
    response = await client.post('/api/transactions', json={
        'amount': '12.50', 'currency': 'usd', 'transaction_date': '2026-09-01',
    })
    assert response.status_code == 200
    tx = response.json()
    assert tx['currency'] == 'USD'
    assert tx['amount'] == 12.5
    assert tx['exchange_rate'] is None
    assert tx['transaction_date'] == '2026-09-01T00:00:00'
    assert tx['source_id'].startswith('manual_')
    assert (await client.get('/api/v2/spending/review')).json()['total'] == 1
    response = await client.post('/api/transactions', json={'amount': 0, 'source': 'cash'})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1
    assert response.json()['source'] == 'cash'
    assert (await client.post('/api/transactions', json=[])).status_code == 400


@pytest.mark.asyncio
async def test_manual_creation_exposes_provenance_without_snapshot_payload(client, in_memory_db):
    response = await client.post('/api/transactions', json={
        'amount': '12.50', 'merchant': 'Original Cafe', 'description': 'Private note',
        'transaction_date': '2026-09-07',
    })
    tx = response.json()
    assert response.status_code == 200
    provenance = await client.get(f'/api/v2/transactions/{tx["id"]}/provenance')
    assert provenance.json() == {
        'transaction_id': tx['id'], 'sources': [{'channel': 'manual', 'evidence_recorded': True}],
    }
    assert 'Private note' not in provenance.text
    assert tx['source_id'] not in provenance.text
    assert 'manual_entry' not in response.text
    assert Storage(in_memory_db).get_source_event('manual', tx['source_id']) is not None


@pytest.mark.asyncio
async def test_web_creation_idempotency_replay_conflict_and_deletion(client, in_memory_db):
    body = {'amount': 12.5, 'merchant': 'Cafe'}
    headers = {'Idempotency-Key': 'web-request-1'}
    first = await client.post('/api/transactions', json=body, headers=headers)
    assert first.status_code == 200
    # JSON property ordering does not alter request identity.
    replay = await client.post('/api/transactions', json=dict(reversed(list(body.items()))), headers=headers)
    assert replay.json() == first.json()
    assert 'request_key' not in replay.json()
    assert 'fingerprint' not in replay.json()
    conflict = await client.post('/api/transactions', json={**body, 'amount': 20}, headers=headers)
    assert conflict.status_code == 409
    assert len(Storage(in_memory_db).query_transactions(limit=50)) == 1
    await client.delete(f"/api/transactions/{first.json()['id']}")
    deleted = await client.post('/api/transactions', json=body, headers=headers)
    assert deleted.status_code == 409
    assert Storage(in_memory_db).query_transactions(limit=50) == []


@pytest.mark.asyncio
async def test_web_creation_invalid_key_and_legacy_requests(client, in_memory_db):
    body = {'amount': 12}
    invalid = await client.post('/api/transactions', json=body, headers={'Idempotency-Key': 'bad key'})
    assert invalid.status_code == 400
    assert Storage(in_memory_db).query_transactions(limit=50) == []
    first = await client.post('/api/transactions', json=body)
    second = await client.post('/api/transactions', json=body)
    assert first.json()['id'] != second.json()['id']
    await client.post('/api/logout')
    denied = await client.post('/api/transactions', json=body, headers={'Idempotency-Key': 'key'})
    assert denied.status_code == 401


@pytest.mark.asyncio
async def test_telegram_input_review_excludes_raw_payload_and_rejects_bank_retry(client, in_memory_db):
    storage = Storage(in_memory_db)
    event = storage.begin_telegram_nl_input(100, 10, 'private raw financial text')
    storage.fail_telegram_nl_input(event['id'])
    response = await client.get('/api/v2/capture/issues')
    assert response.status_code == 200
    item = next(item for item in response.json() if item['id'] == event['id'])
    assert item['source'] == 'telegram_nl'
    assert 'payload' not in item
    assert 'source_id' not in item
    assert 'private raw financial text' not in response.text
    retry = await client.post(f"/api/v2/capture/issues/{event['id']}/retry")
    assert retry.status_code == 409
    assert storage.get_source_event('telegram_nl', event['source_id'])['status'] == 'failed'


@pytest.mark.asyncio
async def test_capture_resolution_api_auth_privacy_and_reopen(client, in_memory_db):
    storage = Storage(in_memory_db)
    event = storage.begin_telegram_nl_input(100, 10, 'private raw financial text')
    route = f"/api/v2/capture/issues/{event['id']}"
    response = await client.post(route + '/resolve')
    assert response.status_code == 200
    assert response.json() == {'id': event['id'], 'handled': True}
    assert (await client.get('/api/v2/capture/issues')).json() == []
    response = await client.get('/api/v2/capture/issues?include_handled=true')
    assert response.json()[0]['handled'] is True
    assert 'private raw' not in response.text
    assert 'source_id' not in response.json()[0]
    assert (await client.post(route + '/reopen')).json()['handled'] is False
    assert (await client.get('/api/v2/capture/issues')).json()[0]['handled'] is False
    bank = storage.record_source_event('gmail', 'bank', '{}', '1')
    assert (await client.post(f"/api/v2/capture/issues/{bank['id']}/resolve")).status_code == 409
    assert (await client.post('/api/v2/capture/issues/99999/resolve')).status_code == 404
    await client.post('/api/logout')
    for action in ('resolve', 'reopen'):
        assert (await client.post(route + '/' + action)).status_code == 401
    assert (await client.get('/api/v2/capture/issues?include_handled=true')).status_code == 401


@pytest.mark.asyncio
async def test_daily_spending_api_contract_dates_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    storage.insert_transaction(source='manual', source_id='private-daily-source', amount=12.005,
                               transaction_date='2026-09-07T18:00:00+00:00', raw_data='private-daily-payload')
    response = await client.get('/api/v2/spending/day?as_of=2026-09-08')
    assert response.status_code == 200
    facts = response.json()
    assert facts['current']['spending']['minor_units'] == 1201
    assert facts['current']['start'] == facts['current']['end'] == '2026-09-08'
    assert facts['previous']['start'] == facts['previous']['end'] == '2026-09-01'
    assert 'private-daily' not in response.text
    assert (await client.get('/api/v2/spending/day?as_of=0001-01-01')).status_code == 422
    assert (await client.get('/api/v2/spending/day?as_of=invalid')).status_code == 422
    await client.post('/api/logout')
    assert (await client.get('/api/v2/spending/day')).status_code == 401


@pytest.mark.asyncio
async def test_upcoming_plan_api_is_sanitized_bounded_and_authenticated(client, in_memory_db):
    from unittest.mock import patch
    from datetime import datetime
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'annual', notes='PRIVATE NOTES')
    storage.create_upcoming_transaction(sub, '2026-09-08', 12.005)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        response = await client.get('/api/v2/plan/upcoming?days=14')
    assert response.status_code == 200
    report = response.json()
    assert report['items'][0]['frequency'] == 'annual'
    assert report['known_total']['minor_units'] == 1201
    assert 'PRIVATE NOTES' not in response.text
    assert 'notes' not in report['items'][0]
    assert (await client.get('/api/v2/plan/upcoming?days=91')).status_code == 422
    assert (await client.get('/api/v2/plan/upcoming?offset=-1')).status_code == 422
    await client.post('/api/logout')
    assert (await client.get('/api/v2/plan/upcoming')).status_code == 401


@pytest.mark.asyncio
async def test_planned_charge_commands_validation_conflicts_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', 12.005)
    path = f'/api/v2/plan/upcoming/{charge}'
    invalid = await client.put(path, json={'expected_date': '2026-02-30', 'expected_amount': 99})
    assert invalid.status_code == 422
    assert storage.get_upcoming_transaction(charge)['expected_amount'] == 12.005
    response = await client.put(path, json={'expected_date': '2026-09-10', 'expected_amount': None})
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    assert storage.get_upcoming_transaction(charge)['expected_amount'] is None
    assert (await client.post(path + '/dismiss')).status_code == 200
    assert (await client.put(path, json={'expected_amount': 5})).status_code == 409
    assert (await client.post(path + '/dismiss')).status_code == 409
    assert (await client.post('/api/v2/plan/upcoming/999999/dismiss')).status_code == 404
    await client.post('/api/logout')
    assert (await client.put(path, json={'expected_amount': 5})).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401


@pytest.mark.asyncio
async def test_subscription_matching_conflicts_validation_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    other = storage.create_subscription('Cafe', 'monthly')
    first = storage.create_upcoming_transaction(sub, '2026-09-09', 12)
    second = storage.create_upcoming_transaction(other, '2026-09-09', 12)
    tx = (await client.post('/api/transactions', json={'amount': 12, 'merchant': 'Cafe'})).json()['id']
    path = f'/api/subscriptions/{sub}/upcoming/{first}'
    other_path = f'/api/subscriptions/{other}/upcoming/{second}'
    link = f'/api/subscriptions/{other}/link-transaction'
    for invalid in [True, None, '1', 0, -1]:
        assert (await client.post(path + '/match', json={'transaction_id': invalid})).status_code == 422
        assert (await client.post(link, json={'transaction_id': invalid})).status_code == 422
    assert (await client.post(path + '/match', json={'transaction_id': 999999})).status_code == 404
    assert (await client.post(f'/api/subscriptions/{other}/upcoming/{first}/match', json={'transaction_id': tx})).status_code == 404
    for _ in range(2):
        assert (await client.post(path + '/match', json={'transaction_id': tx})).status_code == 200
    assert (await client.post(other_path + '/match', json={'transaction_id': tx})).status_code == 409
    assert (await client.post(link, json={'transaction_id': tx})).status_code == 409
    assert (await client.post(path + '/dismiss')).status_code == 409
    await client.post('/api/logout')
    assert (await client.post(path + '/match', json={'transaction_id': tx})).status_code == 401
    assert (await client.post(link, json={'transaction_id': tx})).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401
