"""Tests for Storage.get_capture_health — bounded operational signals, no financial values."""
import pytest

from src.storage import Storage


@pytest.fixture
def storage(in_memory_db):
    return Storage(connection=in_memory_db)


def test_empty_database_reports_no_queue_and_no_exhausted_retries(storage):
    health = storage.get_capture_health()
    assert health["oldest_queued_at"] is None
    assert health["exhausted_retry_count"] == 0
    assert health["last_capture_processed_at"] is None


def test_pending_source_event_is_the_oldest_queued_item(storage):
    storage.record_source_event("apple_wallet", "evidence-1", "{}", timestamp_precision="second")
    health = storage.get_capture_health()
    assert health["oldest_queued_at"] is not None


def test_processed_events_are_not_counted_as_queued(storage):
    event = storage.record_source_event("apple_wallet", "evidence-1", "{}", timestamp_precision="second")
    storage.finish_source_event(event["id"], "processed", transaction_id=None)
    health = storage.get_capture_health()
    assert health["oldest_queued_at"] is None
    assert health["last_capture_processed_at"] is not None


def test_exhausted_retries_are_counted_once_attempts_reach_five(storage):
    event = storage.record_source_event("apple_wallet", "evidence-1", "{}", timestamp_precision="second")
    for _ in range(5):
        storage.finish_source_event(event["id"], "failed", error_code="ParseError")
    health = storage.get_capture_health()
    assert health["exhausted_retry_count"] == 1
    # No longer queued — pending_source_events already excludes attempts >= 5
    assert health["oldest_queued_at"] is None


def test_capture_health_never_exposes_payloads_or_identifiers(storage):
    storage.record_source_event("apple_wallet", "secret-source-id", "private-payload-detail", timestamp_precision="second")
    health = storage.get_capture_health()
    encoded = str(health)
    assert "secret-source-id" not in encoded
    assert "private-payload-detail" not in encoded
