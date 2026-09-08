from concurrent.futures import ThreadPoolExecutor

import pytest

from src.storage import Storage, SubscriptionMatchConflict


@pytest.fixture
def charges(in_memory_db):
    storage = Storage(in_memory_db)
    subscriptions = [storage.create_subscription('Cafe', 'monthly') for _ in range(2)]
    predictions = [storage.create_upcoming_transaction(sub, '2026-09-09', 12) for sub in subscriptions]
    tx = in_memory_db.execute("""INSERT INTO transactions
        (source, source_id, amount, currency, exchange_rate, merchant, transaction_date, type)
        VALUES ('manual', 'charge', 12.005, 'SGD', 1, 'Cafe', '2026-09-09', NULL)""").lastrowid
    in_memory_db.commit()
    return storage, subscriptions, predictions, tx


def test_match_replay_and_conflicts_preserve_original(charges):
    storage, subs, predictions, tx = charges
    original = storage.get_transaction(tx)
    storage.match_upcoming_transaction(predictions[0], tx)
    storage.match_upcoming_transaction(predictions[0], tx)
    storage.link_transaction_to_subscription(subs[0], tx)
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(predictions[1], tx)
    with pytest.raises(SubscriptionMatchConflict):
        storage.link_transaction_to_subscription(subs[1], tx)
    with pytest.raises(SubscriptionMatchConflict):
        storage.dismiss_upcoming_transaction(predictions[0])
    assert storage.get_transaction(tx) == original
    assert storage.get_upcoming_transaction(predictions[0])['matched_transaction_id'] == tx
    assert storage.get_upcoming_transaction(predictions[1])['status'] == 'pending'


def test_direct_link_blocks_match_and_rounds_shared_money(charges):
    storage, subs, predictions, tx = charges
    storage.link_transaction_to_subscription(subs[0], tx)
    storage.link_transaction_to_subscription(subs[0], tx)
    rows = [row for row in storage.list_upcoming_transactions(subs[0]) if row['status'] == 'matched']
    assert len(rows) == 1
    assert rows[0]['expected_amount'] == 12.01
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(predictions[0], tx)


@pytest.mark.parametrize('status', ['dismissed', 'matched', 'cancelled'])
def test_stale_match_rejected(charges, in_memory_db, status):
    storage, subs, predictions, tx = charges
    if status == 'cancelled':
        storage.update_subscription(subs[0], status=status)
    else:
        in_memory_db.execute('UPDATE upcoming_transactions SET status=? WHERE id=?', (status, predictions[0]))
        in_memory_db.commit()
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(predictions[0], tx)


@pytest.mark.parametrize('tx_id', [True, None, '1', 0, -1, 1.5, 999999])
def test_invalid_or_missing_actual(charges, tx_id):
    storage, subs, predictions, _ = charges
    for command, target in [(storage.match_upcoming_transaction, predictions[0]),
                            (storage.link_transaction_to_subscription, subs[0])]:
        with pytest.raises(ValueError):
            command(target, tx_id)
    assert storage.get_upcoming_transaction(predictions[0])['status'] == 'pending'


@pytest.mark.parametrize('kind', ['income', 'transfer', 'refund'])
def test_nonexpense_cannot_clear_prediction(charges, in_memory_db, kind):
    storage, subs, predictions, tx = charges
    in_memory_db.execute('UPDATE transactions SET type=? WHERE id=?', (kind, tx))
    in_memory_db.commit()
    with pytest.raises(ValueError, match='Only expense'):
        storage.match_upcoming_transaction(predictions[0], tx)
    with pytest.raises(ValueError, match='Only expense'):
        storage.link_transaction_to_subscription(subs[0], tx)


@pytest.mark.parametrize('rate', [None, 1])
def test_link_unknown_foreign_amount_remains_unknown(charges, in_memory_db, rate):
    storage, subs, _, tx = charges
    in_memory_db.execute("UPDATE transactions SET currency='USD', exchange_rate=? WHERE id=?", (rate, tx))
    in_memory_db.commit()
    storage.link_transaction_to_subscription(subs[0], tx)
    assert [r for r in storage.list_upcoming_transactions(subs[0]) if r['status'] == 'matched'][0]['expected_amount'] is None


@pytest.mark.parametrize('value', [None, 'invalid'])
def test_link_requires_date(charges, in_memory_db, value):
    storage, subs, _, tx = charges
    in_memory_db.execute('UPDATE transactions SET transaction_date=? WHERE id=?', (value, tx))
    in_memory_db.commit()
    with pytest.raises(ValueError, match='valid date'):
        storage.link_transaction_to_subscription(subs[0], tx)


def test_concurrent_match_and_link_have_one_winner(charges):
    storage, subs, predictions, tx = charges
    def attempt(command, target):
        try:
            command(target, tx)
            return True
        except SubscriptionMatchConflict:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(attempt, storage.match_upcoming_transaction, predictions[0]),
                   pool.submit(attempt, storage.link_transaction_to_subscription, subs[1])]
        assert sorted(f.result() for f in futures) == [False, True]
    assert sum(r['matched_transaction_id'] == tx for sub in subs for r in storage.list_upcoming_transactions(sub)) == 1


def test_legacy_duplicate_links_are_preserved(charges, in_memory_db):
    storage, subs, predictions, tx = charges
    in_memory_db.execute("UPDATE upcoming_transactions SET status='matched', matched_transaction_id=?", (tx,))
    in_memory_db.commit()
    before = [storage.get_upcoming_transaction(p) for p in predictions]
    storage.match_upcoming_transaction(predictions[0], tx)
    storage.link_transaction_to_subscription(subs[1], tx)
    third = storage.create_upcoming_transaction(subs[0], '2026-10-09', 12)
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(third, tx)
    assert [storage.get_upcoming_transaction(p) for p in predictions] == before


def test_existing_match_cannot_be_replaced(charges, in_memory_db):
    storage, _, predictions, tx = charges
    second = in_memory_db.execute("""INSERT INTO transactions
        (source, source_id, amount, currency, merchant, transaction_date, type)
        VALUES ('manual', 'replacement', 12, 'SGD', 'Cafe', '2026-09-09', 'expense')""").lastrowid
    in_memory_db.commit()
    storage.match_upcoming_transaction(predictions[0], tx)
    with pytest.raises(SubscriptionMatchConflict):
        storage.match_upcoming_transaction(predictions[0], second)
    assert storage.get_upcoming_transaction(predictions[0])['matched_transaction_id'] == tx
