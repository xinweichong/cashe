import json
import sqlite3

import pytest

from src.ingestion import IngestionPipeline
from src.main import init_db
from src.parsers.base import ParseResult
from src.storage import Storage


def create(storage, **changes):
    values = dict(source_id='manual-original', amount='12.50', currency='usd',
                  exchange_rate=None, transaction_date='2026-09-07',
                  merchant='Original Cafe', category='Food', description='Original note')
    return storage.create_manual_transaction(**{**values, **changes})


@pytest.mark.parametrize('source', ['manual', 'cash'])
def test_manual_snapshot_preserves_submitted_fields_after_correction(in_memory_db, source):
    storage = Storage(in_memory_db)
    tx_id = create(storage, source=source)
    original = storage.get_source_event(source, 'manual-original')
    assert original['status'] == 'processed'
    assert original['transaction_id'] == tx_id
    assert original['parser_version'] == 'manual:1'
    assert original['timestamp_precision'] == 'unknown'
    assert json.loads(original['payload']) == {
        'kind': 'manual_entry', 'amount': '12.50', 'currency': 'usd', 'exchange_rate': None,
        'transaction_date': '2026-09-07', 'merchant': 'Original Cafe',
        'category': 'Food', 'description': 'Original note', 'type': 'expense',
    }
    storage.update_transaction(tx_id, amount=20, merchant='Corrected', category='Other',
                               transaction_date='2026-09-08', exchange_rate=1.3)
    assert storage.get_source_event(source, 'manual-original') == original
    assert storage.get_transaction_provenance(tx_id) == {
        'transaction_id': tx_id, 'sources': [{'channel': source, 'evidence_recorded': True}],
    }
    assert storage.get_transaction(tx_id)['raw_data'] is None


def test_snapshot_failure_rolls_back_transaction_and_trip_job(in_memory_db):
    storage = Storage(in_memory_db)
    storage.set_setting('trips_enabled', 'true')
    storage.activate_trip(storage.create_trip('Current', '2026-09-01'))
    in_memory_db.execute("CREATE TRIGGER reject_manual_evidence BEFORE INSERT ON source_events BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        create(storage, assign_to_active_trip=True)
    assert storage.query_transactions(limit=50) == []
    assert storage.pending_ingestion_effects() == []
    assert storage.get_source_event('manual', 'manual-original') is None


def test_invalid_manual_fields_do_not_create_capture_observations(in_memory_db):
    storage = Storage(in_memory_db)
    with pytest.raises(ValueError):
        create(storage, amount='NaN')
    assert storage.query_transactions(limit=50) == []
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 0


def test_restart_and_deletion_retain_snapshot_without_reprocessing(tmp_path):
    path = str(tmp_path / 'manual.db')
    conn = init_db(path)
    storage = Storage(conn)
    tx_id = create(storage)
    original = storage.get_source_event('manual', 'manual-original')
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        IngestionPipeline(storage).retry_pending()
        assert storage.get_source_event('manual', 'manual-original') == original
        assert storage.list_capture_issues() == []
        storage.delete_transaction(tx_id)
        assert storage.get_source_event('manual', 'manual-original') == original
        with pytest.raises(ValueError, match='duplicate source_id'):
            create(storage)
        assert storage.query_transactions(limit=50) == []
        assert storage.get_source_event('manual', 'manual-original') == original
    finally:
        conn.close()


@pytest.mark.parametrize('manual_first', [True, False])
def test_manual_evidence_does_not_introduce_automatic_cross_source_matching(in_memory_db, manual_first):
    storage = Storage(in_memory_db)
    def manual():
        create(storage, currency='SGD', transaction_date='2026-09-07T12:00:00')
    def wallet():
        return IngestionPipeline(storage).ingest(ParseResult(
            source='apple_wallet', source_id='wallet', amount=12.5, currency='SGD',
            merchant='Original Cafe', transaction_date='2026-09-07T12:00:00', timestamp_precision='second',
        ))
    if manual_first:
        manual()
        assert wallet() is not None
    else:
        wallet()
        manual()
    assert len(storage.query_transactions(limit=50)) == 2
