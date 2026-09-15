from datetime import datetime
from unittest.mock import patch

import pytest

from src.main import init_db
from src.storage import Storage


@pytest.fixture
def pending(in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', 12.005)
    return storage, sub, charge


def test_corrections_change_only_prediction_and_recalculate_plan_and_home(pending):
    storage, sub, charge = pending
    original_sub = storage.get_subscription(sub)
    storage.update_planned_charge(charge, {'expected_date': '2026-09-10'})
    assert storage.get_upcoming_transaction(charge)['expected_amount'] == 12.005
    storage.update_planned_charge(charge, {'expected_amount': '20.50'})
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        assert storage.get_upcoming_plan()['known_total']['minor_units'] == 2050
        storage.set_setting('subscriptions_enabled', 'true')
        assert storage.get_home_briefing()['upcoming_total']['minor_units'] == 2050
    storage.update_planned_charge(charge, {'expected_amount': None})
    assert storage.get_upcoming_transaction(charge)['expected_amount'] is None
    assert storage.get_subscription(sub) == original_sub
    assert storage.query_transactions(limit=50) == []


@pytest.mark.parametrize('fields', [
    {'expected_date': '2026-02-30', 'expected_amount': 99},
    {'expected_date': None}, {'expected_date': '20260908'},
    {'expected_date': '2026-09-08T12:00:00'},
    {'expected_date': '2026-09-10', 'expected_amount': -1},
    {'expected_amount': float('nan')}, {'expected_amount': float('inf')},
    {'expected_amount': True}, {'expected_amount': {}},
    {'status': 'matched'}, {},
])
def test_invalid_corrections_write_nothing(pending, fields):
    storage, _, charge = pending
    original = storage.get_upcoming_transaction(charge)
    with pytest.raises(ValueError):
        storage.update_planned_charge(charge, fields)
    assert storage.get_upcoming_transaction(charge) == original


@pytest.mark.parametrize('state', ['matched', 'dismissed', 'cancelled', 'pending_linked'])
def test_stale_actions_do_not_change_completed_charges(pending, state):
    storage, sub, charge = pending
    if state == 'cancelled':
        storage.update_subscription(sub, status='cancelled')
    elif state == 'dismissed':
        storage.dismiss_planned_charge(charge)
    else:
        tx = storage.insert_transaction(source='manual', source_id='actual', amount=12, transaction_date='2026-09-09')
        storage.match_upcoming_transaction(charge, tx)
        if state == 'pending_linked':
            storage._conn.execute("UPDATE upcoming_transactions SET status='pending' WHERE id=?", (charge,))
            storage._conn.commit()
    original = storage.get_upcoming_transaction(charge)
    with pytest.raises(ValueError, match='no longer pending'):
        storage.update_planned_charge(charge, {'expected_amount': 99})
    with pytest.raises(ValueError, match='no longer pending'):
        storage.dismiss_planned_charge(charge)
    assert storage.get_upcoming_transaction(charge) == original


def test_dismiss_retains_prediction_and_subscription_but_removes_total(pending):
    storage, sub, charge = pending
    storage.dismiss_planned_charge(charge)
    assert storage.get_upcoming_transaction(charge)['status'] == 'dismissed'
    assert storage.get_subscription(sub)['status'] == 'active'
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        assert storage.get_upcoming_plan()['total'] == 0
    assert storage.query_transactions(limit=50) == []


def test_provenance_starts_as_schedule_unknown_and_flips_to_user_on_correction(pending):
    storage, _, charge = pending
    fresh = storage.get_upcoming_transaction(charge)
    assert fresh['date_basis'] == 'schedule'
    assert fresh['amount_basis'] == 'unknown'  # created without a matched-charge basis

    storage.update_planned_charge(charge, {'expected_date': '2026-09-10'})
    after_date = storage.get_upcoming_transaction(charge)
    assert after_date['date_basis'] == 'user'
    assert after_date['amount_basis'] == 'unknown'  # untouched by a date-only correction

    storage.update_planned_charge(charge, {'expected_amount': '20.50'})
    after_amount = storage.get_upcoming_transaction(charge)
    assert after_amount['amount_basis'] == 'user'
    assert after_amount['amount_basis_transaction_id'] is None

    storage.update_planned_charge(charge, {'expected_amount': None})
    assert storage.get_upcoming_transaction(charge)['amount_basis'] == 'unknown'


def test_next_upcoming_records_the_matched_charge_it_was_inferred_from(in_memory_db):
    from src.subscriptions import SubscriptionMatcher
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Spotify', 'monthly', billing_day=15)
    charge = storage.create_upcoming_transaction(sub, '2026-05-15', 13.98)
    tx_id = storage.insert_transaction(
        source='manual', source_id='matched-1', amount=13.98, currency='SGD',
        merchant='Spotify', transaction_date='2026-05-15T10:00:00', tx_type='expense',
    )
    storage.match_upcoming_transaction(charge, tx_id)

    SubscriptionMatcher(storage).run()

    pending_charges = [u for u in storage.list_upcoming_transactions(sub) if u['status'] == 'pending']
    assert len(pending_charges) == 1
    assert pending_charges[0]['amount_basis'] == 'matched_charge'
    assert pending_charges[0]['amount_basis_transaction_id'] == tx_id
    assert pending_charges[0]['date_basis'] == 'schedule'


def test_get_upcoming_plan_exposes_provenance(pending):
    storage, _, charge = pending
    storage.update_planned_charge(charge, {'expected_amount': '20.50'})
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        item = storage.get_upcoming_plan()['items'][0]
    assert item['amount_basis'] == 'user'
    assert item['date_basis'] == 'schedule'
    assert item['amount_basis_transaction_id'] is None


def test_missing_and_cross_user_commands_are_isolated(pending):
    storage, _, charge = pending
    conn = init_db(':memory:')
    try:
        other = Storage(conn)
        with pytest.raises(ValueError, match='not found'):
            other.update_planned_charge(charge, {'expected_amount': 99})
        with pytest.raises(ValueError, match='not found'):
            other.dismiss_planned_charge(charge)
        assert storage.get_upcoming_transaction(charge)['expected_amount'] == 12.005
    finally:
        conn.close()
