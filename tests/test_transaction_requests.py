"""Durable web creation identity, independent of generated source IDs and dates."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage, TransactionRequestConflict


BODY = {'amount': 12.5, 'merchant': 'Cafe'}


def create(storage, key='request-1', body=None, source_id='manual-1'):
    return storage.create_web_transaction(BODY if body is None else body,
                                          source_id=source_id, request_key=key)


def test_replay_after_restart_preserves_evidence_and_corrections(tmp_path):
    path = str(tmp_path / 'requests.db')
    conn = init_db(path)
    storage = Storage(conn)
    original = create(storage)
    evidence = storage.get_source_event('manual', original['source_id'])
    storage.update_transaction(original['id'], amount=20)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        replay = create(storage, source_id='new-generated-id')
        assert replay['id'] == original['id']
        assert replay['amount'] == 20
        assert replay['transaction_date'] == original['transaction_date']
        assert storage.get_source_event('manual', original['source_id']) == evidence
        assert len(storage.query_transactions(limit=50)) == 1
        storage.delete_transaction(original['id'])
        with pytest.raises(TransactionRequestConflict, match='deleted'):
            create(storage)
        assert storage.query_transactions(limit=50) == []
    finally:
        conn.close()


def test_conflicts_and_distinct_identical_purchases(in_memory_db):
    storage = Storage(in_memory_db)
    first = create(storage)
    with pytest.raises(TransactionRequestConflict, match='different fields'):
        create(storage, body={**BODY, 'amount': 13}, source_id='manual-2')
    second = create(storage, key='request-2', source_id='manual-2')
    assert second['id'] != first['id']
    assert len(storage.query_transactions(limit=50)) == 2


@pytest.mark.parametrize('table', ['transaction_requests', 'source_events'])
def test_receipt_and_evidence_failures_roll_back_everything(in_memory_db, table):
    storage = Storage(in_memory_db)
    in_memory_db.execute(f"CREATE TRIGGER reject_write BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        create(storage)
    for name in ('transactions', 'source_events', 'transaction_requests', 'ingestion_outbox'):
        assert in_memory_db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0] == 0
    in_memory_db.execute('DROP TRIGGER reject_write')
    assert create(storage)['amount'] == 12.5


def test_invalid_request_does_not_reserve_key(in_memory_db):
    storage = Storage(in_memory_db)
    with pytest.raises(ValueError):
        create(storage, body={**BODY, 'amount': -1})
    assert create(storage)['amount'] == 12.5


@pytest.mark.parametrize('key', ['', 'a' * 129, 'has space', 'private/value', 123])
def test_invalid_key_is_rejected_before_writes(in_memory_db, key):
    storage = Storage(in_memory_db)
    with pytest.raises(ValueError, match='Invalid Idempotency-Key'):
        create(storage, key=key)
    assert storage.query_transactions(limit=50) == []


def test_concurrent_replay_uses_one_purchase(in_memory_db):
    storage = Storage(in_memory_db)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda i: create(storage, source_id=f'manual-{i}'), range(8)))
    assert len({row['id'] for row in results}) == 1
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 1


def test_request_keys_are_private_to_each_user_database(tmp_path):
    connections = [init_db(str(tmp_path / f'{user}.db')) for user in ('alice', 'bob')]
    try:
        for conn, amount in zip(connections, (12, 25)):
            result = create(Storage(conn), body={**BODY, 'amount': amount})
            assert result['amount'] == amount
    finally:
        for conn in connections:
            conn.close()
