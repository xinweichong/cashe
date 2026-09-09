import pytest
from unittest.mock import ANY, MagicMock

from src.ingestion import IngestionPipeline
from src.parsers.base import ParseResult
from src.storage import Storage


@pytest.fixture
def storage(in_memory_db):
    return Storage(connection=in_memory_db)


def _result(**kwargs):
    defaults = dict(
        source="apple_wallet",
        source_id="aw-test-001",
        amount=12.50,
        merchant="Starbucks",
        currency="SGD",
        transaction_date="2026-04-15T09:00:00",
        timestamp_precision="second",
    )
    defaults.update(kwargs)
    return ParseResult(**defaults)


class TestIngestionPipelineIngest:
    def test_returns_dict_on_success(self, storage):
        pipeline = IngestionPipeline(storage)
        result = pipeline.ingest(_result())
        assert isinstance(result, dict)
        assert result["merchant"] == "Starbucks"
        assert result["amount"] == 12.50

    def test_returns_none_for_same_source_duplicate(self, storage):
        pipeline = IngestionPipeline(storage)
        pipeline.ingest(_result())
        # Second call with identical source_id
        result = pipeline.ingest(_result())
        assert result is None

    def test_returns_none_for_cross_source_duplicate(self, storage):
        pipeline = IngestionPipeline(storage)
        # First: apple_wallet
        pipeline.ingest(_result(source="apple_wallet", source_id="aw-1"))
        # Second: same merchant/amount, different source within 10 min
        result = pipeline.ingest(_result(source="dbs_paylah", source_id="dbs-1"))
        assert result is None

    def test_categorizer_is_applied(self, storage):
        categorizer = MagicMock()
        categorizer.categorize.return_value = ("Food", "keyword:coffee")
        categorizer.reload_overrides.return_value = None
        pipeline = IngestionPipeline(storage, categorizer=categorizer)
        result = pipeline.ingest(_result())
        assert result["category"] == "Food"

    def test_exchange_rate_is_applied(self, storage):
        exchange_service = MagicMock()
        exchange_service.get_rate.return_value = 3.5
        pipeline = IngestionPipeline(storage, exchange_service=exchange_service)
        result = pipeline.ingest(_result(currency="PLN"))
        assert result["exchange_rate"] == 3.5

    def test_recurring_detector_is_called(self, storage):
        detector = MagicMock()
        pipeline = IngestionPipeline(storage, detector=detector)
        pipeline.ingest(_result())
        detector.detect.assert_called_once()

    def test_suggestion_callback_fires_when_pattern_detected_and_no_subscription(self, storage, in_memory_db):
        """Suggestion callback is invoked when pattern found and no subscription exists."""
        detector = MagicMock()
        detector.detect.return_value = {"frequency": "monthly", "avg_amount": 12.50}
        callback = MagicMock()
        pipeline = IngestionPipeline(storage, detector=detector, on_recurring_pattern=callback)
        pipeline.ingest(_result(merchant="Spotify"))
        callback.assert_called_once_with("Spotify", "monthly", 12.50, ANY)

    def test_suggestion_suppressed_when_subscription_exists(self, storage, in_memory_db):
        """Suggestion callback is NOT invoked when a subscription already exists for the merchant."""
        storage.create_subscription(merchant="Spotify", frequency="monthly")
        detector = MagicMock()
        detector.detect.return_value = {"frequency": "monthly", "avg_amount": 12.50}
        callback = MagicMock()
        pipeline = IngestionPipeline(storage, detector=detector, on_recurring_pattern=callback)
        pipeline.ingest(_result(merchant="Spotify"))
        callback.assert_not_called()


@pytest.mark.parametrize("changes", [
    {"currency": "USD"},
    {"transaction_date": "2026-04-14T09:00:00"},
    {"transaction_date": "2026-04-15"},
    {"transaction_date": None},
    {"tx_type": "income"},
])
def test_distinct_purchases_are_not_collapsed(storage, changes):
    pipeline = IngestionPipeline(storage)
    pipeline.ingest(_result())
    assert pipeline.ingest(_result(source="uob_card", source_id="email-1", **changes)) is not None


def test_cross_source_replay_retains_both_observations(storage):
    pipeline = IngestionPipeline(storage)
    first = pipeline.ingest(_result())
    email = _result(source="uob_card", source_id="email-1")
    assert pipeline.ingest(email) is None
    assert pipeline.ingest(email) is None
    assert storage.get_source_event("uob_card", "email-1")["transaction_id"] == first["id"]
    assert storage._conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1


def test_ambiguous_match_preserves_purchase(storage):
    pipeline = IngestionPipeline(storage)
    pipeline.ingest(_result(source_id="wallet-1"))
    pipeline.ingest(_result(source_id="wallet-2"))
    assert pipeline.ingest(_result(source="uob_card", source_id="email-1")) is not None


def test_crash_after_transaction_commit_recovers_without_duplicate(storage, monkeypatch):
    pipeline = IngestionPipeline(storage)
    original = storage.finish_source_event
    def crash(*args, **kwargs):
        raise RuntimeError("crash after commit")
    monkeypatch.setattr(storage, "finish_source_event", crash)
    with pytest.raises(RuntimeError):
        pipeline.ingest(_result())
    monkeypatch.setattr(storage, "finish_source_event", original)
    assert pipeline.ingest(_result()) is None
    assert storage.get_source_event("apple_wallet", "aw-test-001")["status"] == "processed"
    assert storage._conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1


def test_concurrent_sources_create_one_transaction(storage):
    from concurrent.futures import ThreadPoolExecutor
    pipeline = IngestionPipeline(storage)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pipeline.ingest, [
            _result(), _result(source="uob_card", source_id="email-1"),
        ]))
    assert sum(result is not None for result in results) == 1


def test_second_email_purchase_does_not_reuse_first_match(storage):
    pipeline = IngestionPipeline(storage)
    pipeline.ingest(_result())
    assert pipeline.ingest(_result(source="uob_card", source_id="email-1")) is None
    assert pipeline.ingest(_result(source="uob_card", source_id="email-2")) is not None


def test_backfill_does_not_join_active_trip_or_notify_suggestions(storage, monkeypatch):
    assign = MagicMock()
    monkeypatch.setattr(storage, "auto_assign_to_active_trip", assign)
    callback = MagicMock()
    detector = MagicMock()
    detector.detect.return_value = {"frequency": "monthly", "avg_amount": 12.5}
    pipeline = IngestionPipeline(storage, detector=detector, on_recurring_pattern=callback)
    assert pipeline.ingest(_result(), historical=True) is not None
    assign.assert_not_called()
    callback.assert_not_called()


def test_wallet_failure_retries_without_gmail(storage, monkeypatch):
    pipeline = IngestionPipeline(storage)
    original = storage.insert_transaction
    monkeypatch.setattr(storage, 'insert_transaction', MagicMock(side_effect=RuntimeError('temporary')))
    with pytest.raises(RuntimeError):
        pipeline.ingest(_result())
    assert storage.get_source_event('apple_wallet', 'aw-test-001')['status'] == 'failed'
    monkeypatch.setattr(storage, 'insert_transaction', original)
    pipeline.retry_pending()
    assert storage.get_source_event('apple_wallet', 'aw-test-001')['status'] == 'processed'
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 1


def test_poison_events_stop_after_five_attempts(storage):
    storage.record_source_event('apple_wallet', 'bad-event', '{}')
    pipeline = IngestionPipeline(storage)
    for _ in range(10):
        pipeline.retry_pending()
    event = storage.get_source_event('apple_wallet', 'bad-event')
    assert event['status'] == 'failed'
    assert event['attempts'] == 5


def test_wallet_request_replays_after_commit_before_link(storage, monkeypatch):
    import base64
    import hashlib
    body = b'{"amount":12.50,"merchant":"Cafe","date":"2026-09-06T12:00:00"}'
    pipeline = IngestionPipeline(storage)
    finish = storage.finish_source_event

    def crash(event_id, status, *args, **kwargs):
        if event_id == 1:
            raise RuntimeError('crash before raw observation link')
        return finish(event_id, status, *args, **kwargs)

    monkeypatch.setattr(storage, 'finish_source_event', crash)
    with pytest.raises(RuntimeError):
        pipeline.ingest_wallet_request(body)
    raw = storage.get_source_event('wallet_request', hashlib.sha256(body).hexdigest())
    assert raw['status'] == 'pending'
    assert base64.b64decode(raw['payload']) == body
    monkeypatch.setattr(storage, 'finish_source_event', finish)
    pipeline.retry_pending()
    raw = storage.get_source_event('wallet_request', hashlib.sha256(body).hexdigest())
    assert raw['status'] == 'processed'
    assert storage.get_transaction(raw['transaction_id'])['merchant'] == 'Cafe'
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 1


def test_wallet_request_replays_before_parsing(storage):
    import base64
    import hashlib
    body = b'{"amount":12.50,"merchant":"Cafe"}'
    storage.record_source_event('wallet_request', hashlib.sha256(body).hexdigest(), base64.b64encode(body).decode())
    IngestionPipeline(storage).retry_pending()
    assert storage.list_capture_issues() == []
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 1


def test_wallet_raw_and_parsed_failures_have_bounded_retries(storage, monkeypatch):
    pipeline = IngestionPipeline(storage)
    calls = []

    def fail(**kwargs):
        calls.append(kwargs)
        raise RuntimeError('storage unavailable')

    monkeypatch.setattr(storage, 'insert_transaction', fail)
    with pytest.raises(RuntimeError):
        pipeline.ingest_wallet_request(b'{"amount":12.50,"merchant":"Cafe"}')
    for _ in range(10):
        pipeline.retry_pending()
    assert len(calls) == 5
    assert all(issue['attempts'] == 5 for issue in storage.list_capture_issues())
