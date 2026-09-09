from concurrent.futures import Future, ThreadPoolExecutor
import threading
import sqlite3
from unittest.mock import ANY, MagicMock

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
    delivered.assert_called_once_with('Cafe', 'monthly', 12.5, ANY)
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


def test_recurring_capture_is_reviewable_without_notification_callback(storage):
    detector = MagicMock()
    detector.detect.return_value = {'frequency': 'monthly', 'avg_amount': 12.5}
    pipeline = IngestionPipeline(storage, detector=detector, on_transaction=lambda tx: None)
    pipeline.ingest(purchase())
    report = storage.get_recurring_review()
    assert report['total'] == 1
    assert report['items'][0]['merchant'] == 'Cafe'
    assert storage.list_ingestion_effects() == []
    suggestion_id = report['items'][0]['id']
    # Unbound records cannot be acted on by a Telegram chat.
    with pytest.raises(ValueError, match='not found'):
        storage.resolve_recurring_suggestion(suggestion_id, 123, 'accept')
    assert storage.resolve_recurring_review(suggestion_id, 'accept') is not None


def test_legacy_suggestion_job_gets_review_record_without_redetection(storage):
    import json
    tx = IngestionPipeline(storage, on_transaction=lambda tx: None).ingest(purchase())
    storage._conn.execute("INSERT INTO ingestion_outbox(transaction_id, kind, payload) VALUES (?, 'suggestion', ?)",
                          (tx['id'], json.dumps({'merchant': 'Cafe', 'frequency': 'monthly', 'avg_amount': 12.5})))
    storage._conn.commit()
    IngestionPipeline(storage).process_outbox()
    report = storage.get_recurring_review()
    assert report['total'] == 1
    payload = json.loads(storage._conn.execute("SELECT payload FROM ingestion_outbox WHERE kind='suggestion'").fetchone()[0])
    assert payload['suggestion_id'] == report['items'][0]['id']
    assert storage.list_ingestion_effects() == []


def test_failed_delivery_keeps_identity_and_web_dismissal_stops_retry(storage):
    detector = MagicMock()
    detector.detect.return_value = {'frequency': 'monthly', 'avg_amount': 12.5}
    delivery = MagicMock(side_effect=RuntimeError('offline'))
    pipeline = IngestionPipeline(storage, detector=detector, on_transaction=lambda tx: None, on_recurring_pattern=delivery)
    pipeline.ingest(purchase())
    suggestion_id = storage.get_recurring_review()['items'][0]['id']
    assert delivery.call_args.args[3] == suggestion_id
    pipeline.process_outbox()
    assert delivery.call_args.args[3] == suggestion_id
    assert storage.get_recurring_review()['total'] == 1
    storage.resolve_recurring_review(suggestion_id, 'dismiss')
    pipeline.process_outbox()
    assert delivery.call_count == 2
    assert storage.get_recurring_review()['total'] == 0
    assert storage.list_ingestion_effects() == []


def test_review_insert_failure_keeps_analysis_retryable(storage):
    storage._conn.execute("""CREATE TRIGGER reject_review BEFORE INSERT ON recurring_suggestions
        BEGIN SELECT RAISE(ABORT, 'review unavailable'); END""")
    detector = MagicMock()
    detector.detect.return_value = {'frequency': 'monthly', 'avg_amount': 12.5}
    pipeline = IngestionPipeline(storage, detector=detector, on_transaction=lambda tx: None)
    assert pipeline.ingest(purchase()) is not None
    assert storage.get_recurring_review()['total'] == 0
    assert [r['kind'] for r in storage.list_ingestion_effects()] == ['recurring']
    storage._conn.execute('DROP TRIGGER reject_review')
    pipeline.process_outbox()
    assert storage.get_recurring_review()['total'] == 1
    assert storage.list_ingestion_effects() == []


def test_real_detector_creates_review_after_live_capture_without_telegram(storage):
    from dataclasses import replace
    from datetime import timedelta
    from src.config import local_now
    pipeline = IngestionPipeline(storage, on_transaction=lambda tx: None)
    today = local_now().date()
    for days in (14, 7):
        pipeline.ingest(replace(purchase(f'history-{days}'), transaction_date=(today - timedelta(days=days)).isoformat()), historical=True)
    assert storage.get_recurring_review()['total'] == 0
    pipeline.ingest(replace(purchase('live'), transaction_date=today.isoformat()))
    report = storage.get_recurring_review()
    assert report['total'] == 1
    assert report['items'][0]['frequency'] == 'weekly'
    assert storage.list_ingestion_effects() == []
