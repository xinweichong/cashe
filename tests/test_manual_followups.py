import sqlite3

import pytest

from src.ingestion import IngestionPipeline
from src.main import init_db
from src.storage import Storage


def activate(storage, name='Current'):
    storage.set_setting('trips_enabled', 'true')
    trip_id = storage.create_trip(name, '2026-09-01')
    storage.activate_trip(trip_id)
    return trip_id


def create(storage, **changes):
    values = dict(source_id='manual-20260907120000-12', amount=12,
                  transaction_date='2026-09-07', assign_to_active_trip=True)
    return storage.create_manual_transaction(**{**values, **changes})


def test_manual_trip_outbox_is_atomic(in_memory_db):
    storage = Storage(in_memory_db)
    activate(storage)
    in_memory_db.execute("CREATE TRIGGER reject_effect BEFORE INSERT ON ingestion_outbox BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        create(storage)
    assert storage.query_transactions(limit=50) == []
    assert storage.pending_ingestion_effects() == []
    assert storage.get_source_event('manual', 'manual-20260907120000-12') is None


def test_restart_retains_original_trip_and_worker_replays_once(tmp_path):
    path = str(tmp_path / 'manual.db')
    conn = init_db(path)
    storage = Storage(conn)
    original = activate(storage)
    tx_id = create(storage)
    assert not storage.is_in_trip(original, tx_id)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        later = activate(storage, 'Later')
        pipeline = IngestionPipeline(storage)
        pipeline.retry_pending()
        pipeline.retry_pending()
        assert storage.is_in_trip(original, tx_id)
        assert not storage.is_in_trip(later, tx_id)
        assert storage.list_ingestion_effects() == []
        assert conn.execute('SELECT COUNT(*) FROM trip_transactions').fetchone()[0] == 1
        assert [row[0] for row in conn.execute('SELECT kind FROM ingestion_outbox')] == ['trip']
        with pytest.raises(ValueError, match='duplicate source_id'):
            create(storage)
        assert conn.execute('SELECT COUNT(*) FROM ingestion_outbox').fetchone()[0] == 1
    finally:
        conn.close()


@pytest.mark.parametrize('skip', ['disabled', 'inactive', 'not_requested'])
def test_manual_entries_only_queue_requested_enabled_trip_work(in_memory_db, skip):
    storage = Storage(in_memory_db)
    if skip != 'inactive':
        activate(storage)
    if skip == 'disabled':
        storage.set_setting('trips_enabled', 'false')
    create(storage, assign_to_active_trip=skip != 'not_requested')
    assert storage.pending_ingestion_effects() == []


@pytest.mark.parametrize('deleted', ['transaction', 'trip'])
def test_deleted_manual_trip_destinations_finish_without_assignment(in_memory_db, deleted):
    storage = Storage(in_memory_db)
    trip_id = activate(storage)
    tx_id = create(storage)
    if deleted == 'transaction':
        storage.delete_transaction(tx_id)
    else:
        storage.delete_trip(trip_id)
    IngestionPipeline(storage).retry_pending()
    assert storage.list_ingestion_effects() == []
    assert not storage.is_in_trip(trip_id, tx_id)


def test_manual_trip_failure_exhaustion_and_explicit_retry(in_memory_db, monkeypatch):
    storage = Storage(in_memory_db)
    trip_id = activate(storage)
    tx_id = create(storage)
    enlist = storage.enlist_transaction
    def fail(*args, **kwargs):
        raise RuntimeError('private failure')
    monkeypatch.setattr(storage, 'enlist_transaction', fail)
    pipeline = IngestionPipeline(storage)
    for _ in range(6):
        pipeline.retry_pending()
    job = storage.list_ingestion_effects()[0]
    assert job['attempts'] == 5
    assert storage.get_transaction(tx_id) is not None
    monkeypatch.setattr(storage, 'enlist_transaction', enlist)
    storage.retry_ingestion_effect(job['id'])
    pipeline.retry_pending()
    assert storage.is_in_trip(trip_id, tx_id)
    assert storage.list_ingestion_effects() == []
