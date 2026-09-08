from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest

from src.storage import Storage, SubscriptionMatchConflict


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


def test_repeated_and_concurrent_acceptance_creates_one_confirmed_schedule(storage):
    def accept():
        return storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept(), range(2)))
    assert results[0] == results[1] == accept()
    subs = storage.list_subscriptions()
    assert len(subs) == 1
    assert subs[0]['confirmation_source'] == 'recurring_suggestion'
    # A second notification for the same exact pattern reuses the unique schedule.
    assert storage.accept_subscription_suggestion(123, 457, 'Cafe', 'monthly') == results[0]


@pytest.mark.parametrize('status', ['active', 'paused', 'cancelled', 'possibly_cancelled'])
def test_existing_schedule_details_status_and_confirmation_are_preserved(storage, status):
    sub = storage.create_subscription('Cafe', 'monthly', billing_day=12, label='My plan',
                                      notes='Keep', confirmation_source='user')
    storage.update_subscription(sub, status=status)
    before = storage.get_subscription(sub)
    assert storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly') == sub
    assert storage.get_subscription(sub) == before
    storage.update_subscription(sub, merchant='Renamed', frequency='annual')
    edited = storage.get_subscription(sub)
    assert storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly') == sub
    assert storage.get_subscription(sub) == edited


def test_receipt_survives_reopen_and_deletion(tmp_path):
    from src.main import init_db
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    sub = storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    conn.close()
    conn = init_db(path)
    reopened = Storage(conn)
    assert reopened.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly') == sub
    reopened.delete_subscription(sub)
    with pytest.raises(SubscriptionMatchConflict, match='deleted'):
        reopened.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    assert reopened.list_subscriptions() == []
    conn.close()


def test_changed_callback_and_ambiguous_existing_schedules_reject(storage):
    storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    with pytest.raises(SubscriptionMatchConflict, match='different fields'):
        storage.accept_subscription_suggestion(123, 456, 'Cafe', 'weekly')
    storage.create_subscription('Other', 'monthly')
    storage.create_subscription('Other', 'monthly')
    before = storage.list_subscriptions()
    with pytest.raises(SubscriptionMatchConflict, match='Several schedules'):
        storage.accept_subscription_suggestion(123, 457, 'Other', 'monthly')
    assert storage.list_subscriptions() == before


@pytest.mark.parametrize('args', [
    (True, 1, 'Cafe', 'monthly'), (1, 0, 'Cafe', 'monthly'), (1, None, 'Cafe', 'monthly'),
    (0, 1, 'Cafe', 'monthly'), (1, 1, '', 'monthly'), (1, 1, 'Cafe', 'annual'),
])
def test_invalid_input_writes_nothing(storage, args):
    with pytest.raises(ValueError):
        storage.accept_subscription_suggestion(*args)
    assert storage.list_subscriptions() == []


def test_receipt_failure_rolls_back_schedule_and_confirmation(storage, in_memory_db):
    in_memory_db.execute("""CREATE TRIGGER fail_acceptance BEFORE INSERT ON subscription_suggestion_acceptances
        BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        storage.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    assert storage.list_subscriptions() == []
    assert in_memory_db.execute('SELECT COUNT(*) FROM subscription_confirmations').fetchone()[0] == 0


def test_acceptance_receipts_are_isolated_per_user(tmp_path):
    from src.main import init_db
    first_conn = init_db(str(tmp_path / 'first.db'))
    second_conn = init_db(str(tmp_path / 'second.db'))
    first, second = Storage(first_conn), Storage(second_conn)
    first.accept_subscription_suggestion(123, 456, 'Cafe', 'monthly')
    assert second.list_subscriptions() == []
    second.accept_subscription_suggestion(123, 456, 'Other', 'weekly')
    assert first.list_subscriptions()[0]['merchant'] == 'Cafe'
    assert second.list_subscriptions()[0]['merchant'] == 'Other'
    first_conn.close()
    second_conn.close()
