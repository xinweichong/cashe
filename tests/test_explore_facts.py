"""Shared-facts health score, spending signals and monthly flows behind the
merged Explore dashboard."""
from datetime import date
from itertools import count

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.spending_facts import health_score, monthly_flows, spending_signals
from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD

AS_OF = date(2026, 9, 20)


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()

    def add(amount, day='2026-09-05T12:00:00', **changes):
        values = dict(source='manual', source_id=f'test-{next(sequence)}', amount=amount,
                      transaction_date=day, merchant='Cafe', category='Food')
        values.update(changes)
        return storage.insert_transaction(**values)
    return storage, add


def test_unusual_needs_two_prior_purchases_at_the_merchant(ledger, in_memory_db):
    storage, add = ledger
    add(10, '2026-08-01', merchant='Cafe')
    add(90, '2026-09-10', merchant='Cafe')          # one prior visit: not a baseline
    add(10, '2026-08-01', merchant='Grocer')
    add(12, '2026-08-08', merchant='Grocer')
    big = add(50, '2026-09-11', merchant='Grocer')  # 50 > 2 x 11
    add(20, '2026-09-12', merchant='Grocer')        # 20 < 22: usual
    signals = spending_signals(in_memory_db, AS_OF)
    assert [item['transaction_id'] for item in signals['unusual']] == [big]
    item = signals['unusual'][0]
    assert item['amount'] == {'minor_units': 5000, 'currency': 'SGD'}
    assert item['typical'] == {'minor_units': 1100, 'currency': 'SGD'}
    assert item['ratio'] == 4.5


def test_unusual_skips_unresolved_money_and_excluded_baselines(ledger, in_memory_db):
    storage, add = ledger
    add(10, '2026-08-01', merchant='Grocer')
    add(10, '2026-08-02', merchant='Grocer')
    add(500, '2026-09-10', merchant='Grocer', currency='THB', exchange_rate=1)  # unresolved
    assert spending_signals(in_memory_db, AS_OF)['unusual'] == []

    excluded = add(1000, '2026-08-03', merchant='Grocer')
    storage.update_transaction(excluded, excluded_from_baseline=True)
    flagged = add(30, '2026-09-11', merchant='Grocer')  # 30 > 2 x 10 once the outlier is excluded
    assert [item['transaction_id'] for item in spending_signals(in_memory_db, AS_OF)['unusual']] == [flagged]


def test_new_merchants_are_first_seen_this_month(ledger, in_memory_db):
    storage, add = ledger
    add(10, '2026-07-01', merchant='Cafe')
    add(10, '2026-09-02', merchant='Cafe')
    first = add(25, '2026-09-03', merchant='Bookshop', category='Shopping')
    add(5, '2026-09-04', merchant='Bookshop', category='Shopping')
    add(5, '2026-09-21', merchant='Later')  # after as_of
    signals = spending_signals(in_memory_db, AS_OF)
    assert signals['new_merchants'] == [{
        'merchant': 'Bookshop', 'first_date': '2026-09-03', 'category': 'Shopping',
        'amount': {'minor_units': 2500, 'currency': 'SGD'}, 'transaction_id': first,
    }]
    assert (signals['start'], signals['end']) == ('2026-09-01', '2026-09-20')


def test_monthly_flows_keep_absent_income_and_clip_current_month(ledger, in_memory_db):
    storage, add = ledger
    add(40, '2026-07-10')
    add(3000, '2026-08-01', tx_type='income', merchant='Employer', category='Income')
    add(60, '2026-08-15')
    add(15, '2026-08-20', tx_type='refund')
    add(20, '2026-09-10')
    add(99, '2026-09-25')  # after as_of
    flows = monthly_flows(in_memory_db, 3, AS_OF)
    assert [flow['month'] for flow in flows] == ['2026-07', '2026-08', '2026-09']
    assert flows[0]['income'] is None
    assert flows[1]['income'] == {'minor_units': 300000, 'currency': 'SGD'}
    assert flows[1]['spending'] == {'minor_units': 4500, 'currency': 'SGD'}
    assert (flows[2]['start'], flows[2]['end']) == ('2026-09-01', '2026-09-20')
    assert flows[2]['spending'] == {'minor_units': 2000, 'currency': 'SGD'}
    with pytest.raises(ValueError):
        monthly_flows(in_memory_db, 0, AS_OF)


def test_monthly_flows_mark_unresolved_months_partial(ledger, in_memory_db):
    storage, add = ledger
    add(20, '2026-09-10')
    add(50, '2026-09-11', currency='THB', exchange_rate=1)
    flow = monthly_flows(in_memory_db, 1, AS_OF)[0]
    assert flow['status'] == 'partial'
    assert flow['unresolved_count'] == 1
    assert flow['spending'] == {'minor_units': 2000, 'currency': 'SGD'}


def test_health_score_reports_partial_status_and_totals(ledger, in_memory_db):
    storage, add = ledger
    add(1000, '2026-09-01', tx_type='income', merchant='Employer', category='Income')
    add(200, '2026-09-02')
    add(80, '2026-09-03', currency='THB', exchange_rate=1)  # left out, never guessed
    result = health_score(in_memory_db, 1, AS_OF)
    assert result['has_income_data'] is True
    assert result['status'] == 'partial'
    assert result['unresolved_count'] == 1
    assert result['income'] == {'minor_units': 100000, 'currency': 'SGD'}
    assert result['spending'] == {'minor_units': 20000, 'currency': 'SGD'}
    assert result['components']['savings_rate']['value'] == 0.8
    assert (result['start'], result['end']) == ('2026-09-01', '2026-09-20')


def test_health_score_budget_adherence_uses_shared_spending(ledger, in_memory_db):
    storage, add = ledger
    in_memory_db.execute("INSERT INTO budgets (category, period, amount) VALUES ('Food', 'monthly', 100)")
    in_memory_db.execute("INSERT INTO budgets (category, period, amount) VALUES (NULL, 'monthly', 50)")
    in_memory_db.commit()
    add(1000, '2026-09-01', tx_type='income', merchant='Employer', category='Income')
    add(120, '2026-09-02')
    add(40, '2026-09-03', tx_type='refund')  # Food nets to 80: within 100; overall 80 > 50
    budget = health_score(in_memory_db, 1, AS_OF)['components']['budget_adherence']
    assert budget['value'] == 0.5
    assert budget['score'] == 5.0


def test_health_score_spans_whole_calendar_months(ledger, in_memory_db):
    storage, add = ledger
    add(500, '2026-07-01', tx_type='income', merchant='Employer', category='Income')
    add(100, '2026-06-30', tx_type='income', merchant='Employer', category='Income')  # before window
    result = health_score(in_memory_db, 3, AS_OF)
    assert result['start'] == '2026-07-01'
    assert result['income'] == {'minor_units': 50000, 'currency': 'SGD'}


@pytest.fixture
def dashboard_app(in_memory_db):
    from src.web import auth as _auth
    admin_storage = AdminStorage(make_admin_db_with_user(TEST_PASSWORD))
    _auth.init_auth(admin_storage)
    yield create_dashboard_app(FakeUserManager(Storage(connection=in_memory_db)), admin_storage)
    _auth._admin_storage = None


@pytest_asyncio.fixture
async def client(dashboard_app):
    async with AsyncClient(transport=ASGITransport(app=dashboard_app), base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac


@pytest.mark.asyncio
async def test_signals_and_monthly_endpoints(client):
    signals = await client.get("/api/v2/spending/signals?as_of=2026-09-20")
    assert signals.status_code == 200
    assert signals.json() == {'start': '2026-09-01', 'end': '2026-09-20', 'multiplier': 2.0,
                              'unusual': [], 'new_merchants': []}
    monthly = await client.get("/api/v2/spending/monthly?months=2")
    assert monthly.status_code == 200
    assert len(monthly.json()) == 2
    assert (await client.get("/api/v2/spending/monthly?months=37")).status_code == 422


@pytest.mark.asyncio
async def test_new_endpoints_require_auth(dashboard_app):
    async with AsyncClient(transport=ASGITransport(app=dashboard_app), base_url="http://test") as anon:
        assert (await anon.get("/api/v2/spending/signals")).status_code == 401
        assert (await anon.get("/api/v2/spending/monthly")).status_code == 401
