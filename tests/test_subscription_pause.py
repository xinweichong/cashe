from datetime import datetime
from unittest.mock import patch

import pytest

from src.storage import Storage, SubscriptionMatchConflict
from src.subscriptions import SubscriptionMatcher


@pytest.fixture
def schedule(in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly', billing_day=9)
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', 12)
    return storage, sub, charge


def test_pause_hides_predictions_and_resume_restores_them(schedule):
    storage, sub, charge = schedule
    storage.set_setting('subscriptions_enabled', 'true')
    before = storage.get_upcoming_transaction(charge)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        assert storage.get_upcoming_plan()['total'] == 1
        storage.update_subscription(sub, status='paused')
        assert storage.get_upcoming_plan()['total'] == 0
        assert storage.get_home_briefing()['upcoming_total']['minor_units'] == 0
        assert storage.get_subscription_summary()['active_count'] == 0
        SubscriptionMatcher(storage).run()
        assert storage.get_upcoming_transaction(charge) == before
        with pytest.raises(SubscriptionMatchConflict):
            storage.dismiss_planned_charge(charge)
        storage.update_subscription(sub, status='active')
        assert storage.get_upcoming_plan()['total'] == 1
        assert storage.get_upcoming_transaction(charge) == before


def test_paused_schedule_does_not_generate_and_resume_generates(schedule):
    storage, _, _ = schedule
    sub = storage.create_subscription('Other', 'monthly')
    storage.update_subscription(sub, status='paused')
    SubscriptionMatcher(storage).run()
    assert storage.list_upcoming_transactions(sub) == []
    storage.update_subscription(sub, status='active')
    SubscriptionMatcher(storage).run()
    assert len(storage.list_upcoming_transactions(sub)) == 1


def test_worker_rechecks_stale_snapshot_after_pause(schedule):
    storage, sub, charge = schedule
    snapshot = storage.list_subscriptions()
    storage.update_subscription(sub, status='paused')
    with patch.object(storage, 'list_subscriptions', return_value=snapshot):
        SubscriptionMatcher(storage).run()
    assert storage.get_subscription(sub)['status'] == 'paused'
    assert len(storage.list_upcoming_transactions(sub)) == 1
    assert storage.get_upcoming_transaction(charge)['status'] == 'pending'


@pytest.mark.parametrize('status', [None, 'unknown', True, [], {}])
def test_invalid_status_is_atomic(schedule, status):
    storage, sub, _ = schedule
    before = storage.get_subscription(sub)
    with pytest.raises(ValueError, match='Invalid subscription status'):
        storage.update_subscription(sub, status=status, merchant='Changed')
    assert storage.get_subscription(sub) == before


def test_pause_preserves_actuals_and_blocks_automatic_and_manual_match(schedule, in_memory_db):
    storage, sub, charge = schedule
    tx = in_memory_db.execute("""INSERT INTO transactions
        (source, source_id, amount, currency, exchange_rate, merchant, transaction_date, type)
        VALUES ('manual', 'paused-charge', 12, 'SGD', 1, 'Cafe', '2026-09-09', 'expense')""").lastrowid
    in_memory_db.commit()
    original = storage.get_transaction(tx)
    storage.update_subscription(sub, status='paused')
    SubscriptionMatcher(storage).run()
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(charge, tx)
    assert storage.get_upcoming_transaction(charge)['status'] == 'pending'
    assert storage.get_transaction(tx) == original
    storage.update_subscription(sub, status='active')
    SubscriptionMatcher(storage).run()
    assert storage.get_upcoming_transaction(charge)['matched_transaction_id'] == tx
    storage.update_subscription(sub, status='paused')
    assert storage.get_subscription_matched_transactions(sub, limit=50) == [original]
