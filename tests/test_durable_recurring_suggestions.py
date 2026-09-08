from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage, SubscriptionMatchConflict


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


def test_full_merchant_pending_reuse_and_replay(storage):
    merchant = '店铺|long name:' * 15
    first = storage.prepare_recurring_suggestion(123, merchant, 'monthly', 12.5)
    assert storage.prepare_recurring_suggestion(123, merchant, 'monthly', 12.5) == first
    assert first['merchant'] == merchant
    sub = storage.resolve_recurring_suggestion(first['id'], 123, 'accept')
    storage.update_subscription(sub, status='paused', merchant='Edited')
    assert storage.resolve_recurring_suggestion(first['id'], 123, 'accept') == sub
    assert len(storage.list_subscriptions()) == 1
    assert storage.get_subscription(sub)['merchant'] == 'Edited'
    assert storage.get_subscription(sub)['confirmation_source'] == 'recurring_suggestion'
    storage.delete_subscription(sub)
    with pytest.raises(SubscriptionMatchConflict, match='deleted'):
        storage.resolve_recurring_suggestion(first['id'], 123, 'accept')


def test_dismissal_is_durable_but_does_not_suppress_later_patterns(tmp_path):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    suggestion = storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)
    storage.resolve_recurring_suggestion(suggestion['id'], 123, 'dismiss')
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    assert storage.resolve_recurring_suggestion(suggestion['id'], 123, 'dismiss') is None
    with pytest.raises(SubscriptionMatchConflict):
        storage.resolve_recurring_suggestion(suggestion['id'], 123, 'accept')
    assert storage.list_subscriptions() == []
    assert storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)['id'] != suggestion['id']
    conn.close()


def test_pending_suggestion_survives_restart_with_original_fields(tmp_path):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    suggestion = Storage(conn).prepare_recurring_suggestion(123, 'Full merchant', 'weekly', 12)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    assert storage.prepare_recurring_suggestion(123, 'Full merchant', 'weekly', 12) == suggestion
    sub = storage.resolve_recurring_suggestion(suggestion['id'], 123, 'accept')
    assert storage.get_subscription(sub)['merchant'] == 'Full merchant'
    conn.close()


def test_simultaneous_accept_and_dismiss_have_one_winner(storage):
    suggestion = storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)
    def attempt(action):
        try:
            storage.resolve_recurring_suggestion(suggestion['id'], 123, action)
            return True
        except SubscriptionMatchConflict:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, ['accept', 'dismiss'])) == [False, True]
    assert len(storage.list_subscriptions()) <= 1


def test_chat_and_user_isolation(storage, tmp_path):
    suggestion = storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)
    with pytest.raises(ValueError, match='not found'):
        storage.resolve_recurring_suggestion(suggestion['id'], 999, 'accept')
    conn = init_db(str(tmp_path / 'other.db'))
    other = Storage(conn)
    with pytest.raises(ValueError, match='not found'):
        other.resolve_recurring_suggestion(suggestion['id'], 123, 'accept')
    assert storage.list_subscriptions() == other.list_subscriptions() == []
    conn.close()


@pytest.mark.parametrize('status', ['paused', 'cancelled'])
def test_existing_schedule_reused_without_reactivation(storage, status):
    sub = storage.create_subscription('Cafe', 'monthly', confirmation_source='user')
    storage.update_subscription(sub, status=status)
    original = storage.get_subscription(sub)
    suggestion = storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)
    assert storage.resolve_recurring_suggestion(suggestion['id'], 123, 'accept') == sub
    assert storage.get_subscription(sub) == original


def test_failed_resolution_rolls_back_schedule_and_confirmation(storage, in_memory_db):
    suggestion = storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)
    in_memory_db.execute("""CREATE TRIGGER fail_resolution BEFORE UPDATE ON recurring_suggestions
        BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        storage.resolve_recurring_suggestion(suggestion['id'], 123, 'accept')
    assert storage.list_subscriptions() == []
    assert in_memory_db.execute('SELECT COUNT(*) FROM subscription_confirmations').fetchone()[0] == 0
    assert storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', 12)['id'] == suggestion['id']


@pytest.mark.parametrize('amount', [float('nan'), float('inf'), -1])
def test_invalid_average_does_not_create_pending_record(storage, in_memory_db, amount):
    with pytest.raises(ValueError):
        storage.prepare_recurring_suggestion(123, 'Cafe', 'monthly', amount)
    assert in_memory_db.execute('SELECT COUNT(*) FROM recurring_suggestions').fetchone()[0] == 0
