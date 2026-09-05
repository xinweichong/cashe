from concurrent.futures import Future, ThreadPoolExecutor
import threading
import sqlite3
from unittest.mock import MagicMock

import pytest

from src.ingestion import IngestionPipeline
from src.main import init_db
from src.parsers.base import ParseResult
from src.storage import Storage


def purchase(source_id="wallet-1", source="apple_wallet"):
    return ParseResult(source=source, source_id=source_id, amount=12.5,
                       merchant="Cafe", transaction_date="2026-09-06T12:00:00", timestamp_precision="second")


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


def test_outbox_insert_failure_rolls_back_transaction(storage):
    storage._conn.execute("""CREATE TRIGGER reject_effect BEFORE INSERT ON ingestion_outbox
                             BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        IngestionPipeline(storage).ingest(purchase())
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 0
    assert storage.pending_ingestion_effects() == []
    assert storage.get_source_event('apple_wallet', 'wallet-1')['status'] == 'failed'


def test_restart_recovers_effect_after_commit_before_source_link(tmp_path, monkeypatch):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    monkeypatch.setattr(storage, 'finish_source_event', MagicMock(side_effect=RuntimeError('crash')))
    with pytest.raises(RuntimeError):
        IngestionPipeline(storage).ingest(purchase())
    conn.close()

    conn = init_db(path)
    recovered = Storage(conn)
    notify = MagicMock()
    pipeline = IngestionPipeline(recovered, on_transaction=notify)
    pipeline.retry_pending()
    assert recovered.list_capture_issues() == []
    assert recovered.list_ingestion_effects() == []
    notify.assert_called_once()
    pipeline.ingest(purchase())
    pipeline.ingest(purchase('email-1', 'uob_card'))
    pipeline.retry_pending()
    notify.assert_called_once()
    assert conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 1
    conn.close()


def test_failed_future_is_retried_until_acknowledged(storage):
    failed = Future()
    failed.set_exception(RuntimeError('private remote error'))
    sent = Future()
    sent.set_result(None)
    notify = MagicMock(side_effect=[failed, sent])
    pipeline = IngestionPipeline(storage, on_transaction=notify)
    tx = pipeline.ingest(purchase())
    assert tx is not None
    job = storage.list_ingestion_effects()[0]
    assert job['status'] == 'failed' and job['attempts'] == 1
    assert job['error_code'] == 'RuntimeError'
    pipeline.retry_pending()
    assert storage.list_ingestion_effects() == []
    assert notify.call_count == 2


def test_recurring_failure_retries_and_suggestion_survives_new_detector(storage):
    detector = MagicMock()
    detector.detect.side_effect = [RuntimeError('analysis failure'), {'frequency': 'monthly', 'avg_amount': 12.5}]
    suggestion = MagicMock(side_effect=RuntimeError('send failed'))
    pipeline = IngestionPipeline(storage, detector=detector, on_transaction=lambda tx: None,
                                 on_recurring_pattern=suggestion)
    pipeline.ingest(purchase())
    assert storage.list_ingestion_effects()[0]['kind'] == 'recurring'
    pipeline.retry_pending()
    assert storage.list_ingestion_effects()[0]['kind'] == 'suggestion'
    assert detector.detect.call_count == 2
    delivered = MagicMock()
    replacement_detector = MagicMock(side_effect=AssertionError('must not recompute'))
    replacement = IngestionPipeline(storage, detector=replacement_detector, on_recurring_pattern=delivered)
    replacement.process_outbox()
    delivered.assert_called_once_with('Cafe', 'monthly', 12.5)
    replacement_detector.detect.assert_not_called()
    assert storage.list_ingestion_effects() == []


def test_trip_retry_uses_original_trip_and_is_idempotent(storage, monkeypatch):
    storage.set_setting('trips_enabled', 'true')
    original_trip = storage.create_trip('Original', '2026-09-01')
    storage.update_trip(original_trip, status='active')
    enlist = storage.enlist_transaction
    monkeypatch.setattr(storage, 'enlist_transaction', MagicMock(side_effect=RuntimeError('temporary')))
    pipeline = IngestionPipeline(storage, on_transaction=lambda tx: None)
    tx = pipeline.ingest(purchase())
    storage.update_trip(original_trip, status='completed')
    new_trip = storage.create_trip('Later', '2026-09-07')
    storage.update_trip(new_trip, status='active')
    monkeypatch.setattr(storage, 'enlist_transaction', enlist)
    # Simulate a trip write committed just before its outbox acknowledgement crashed.
    enlist(original_trip, tx['id'])
    pipeline.retry_pending()
    assert storage.is_in_trip(original_trip, tx['id'])
    assert not storage.is_in_trip(new_trip, tx['id'])
    assert len(storage.get_trip_transactions(original_trip)) == 1
    assert storage.list_ingestion_effects() == []


def test_historical_capture_has_no_outbox_effects(storage):
    storage.set_setting('trips_enabled', 'true')
    trip_id = storage.create_trip('Current', '2026-09-01')
    storage.update_trip(trip_id, status='active')
    callback = MagicMock()
    pipeline = IngestionPipeline(storage, on_transaction=callback, on_recurring_pattern=callback)
    tx = pipeline.ingest(purchase(), historical=True)
    assert storage._conn.execute('SELECT COUNT(*) FROM ingestion_outbox').fetchone()[0] == 0
    assert not storage.is_in_trip(trip_id, tx['id'])
    callback.assert_not_called()


def test_followups_stop_after_five_failures_and_can_be_requeued(storage):
    notify = MagicMock(side_effect=RuntimeError('unavailable'))
    pipeline = IngestionPipeline(storage, on_transaction=notify)
    pipeline.ingest(purchase())
    for _ in range(10):
        pipeline.retry_pending()
    assert notify.call_count == 5
    job = storage.list_ingestion_effects()[0]
    assert job['attempts'] == 5
    assert storage.pending_ingestion_effects() == []
    notify.side_effect = None
    storage.retry_ingestion_effect(job['id'])
    pipeline.retry_pending()
    assert notify.call_count == 6
    assert storage.list_ingestion_effects() == []
    with pytest.raises(ValueError, match='already completed'):
        storage.retry_ingestion_effect(job['id'])


def test_deleted_transaction_cancels_pending_notification(storage):
    pipeline = IngestionPipeline(storage)
    tx = pipeline.ingest(purchase())
    storage.delete_transaction(tx['id'])
    notify = MagicMock()
    pipeline.on_transaction = notify
    pipeline.process_outbox()
    notify.assert_not_called()
    assert storage.list_ingestion_effects() == []


def test_concurrent_workers_wait_for_send_without_holding_db_lock(storage):
    tx = IngestionPipeline(storage).ingest(purchase())
    started = threading.Event()
    sent = Future()

    def notify(transaction):
        assert transaction['id'] == tx['id']
        started.set()
        return sent

    callback = MagicMock(side_effect=notify)
    first = IngestionPipeline(storage, on_transaction=callback)
    second = IngestionPipeline(storage, on_transaction=callback)
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(first.process_outbox)
        assert started.wait(2)
        other = pool.submit(second.process_outbox)
        other.result(timeout=2)
        # Telegram itself reads Storage while constructing its message.
        assert storage.get_transaction(tx['id'])['merchant'] == 'Cafe'
        assert storage.list_ingestion_effects()[0]['status'] == 'pending'
        sent.set_result(None)
        worker.result(timeout=2)
    callback.assert_called_once()
    assert storage.list_ingestion_effects() == []


def test_crash_after_send_replays_at_least_once(storage, monkeypatch):
    class Crash(BaseException):
        pass

    finish = storage.finish_ingestion_effect
    def crash_after_send(effect_id, **kwargs):
        row = storage._conn.execute('SELECT kind FROM ingestion_outbox WHERE id = ?', (effect_id,)).fetchone()
        if row['kind'] == 'notification':
            raise Crash()
        return finish(effect_id, **kwargs)

    sent = MagicMock()
    monkeypatch.setattr(storage, 'finish_ingestion_effect', crash_after_send)
    with pytest.raises(Crash):
        IngestionPipeline(storage, on_transaction=sent).ingest(purchase())
    sent.assert_called_once()
    assert storage.list_ingestion_effects()[0]['status'] == 'pending'
    monkeypatch.setattr(storage, 'finish_ingestion_effect', finish)
    IngestionPipeline(storage, on_transaction=sent).retry_pending()
    assert sent.call_count == 2
    assert storage.list_ingestion_effects() == []
