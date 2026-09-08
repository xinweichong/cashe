from datetime import datetime
from unittest.mock import patch

import pytest

from src.storage import Storage


def charge(storage, label, day, amount=10, status='active'):
    sub = storage.create_subscription(label, 'monthly', notes='private notes')
    storage.update_subscription(sub, status=status)
    return storage.create_upcoming_transaction(sub, day, amount)


def test_upcoming_selection_partial_totals_and_pagination(in_memory_db):
    storage = Storage(in_memory_db)
    storage.set_setting('subscriptions_enabled', 'true')
    first = charge(storage, 'First', '2026-09-08', 10.005)
    unknown = charge(storage, 'Unknown', '2026-09-09', None, 'possibly_cancelled')
    charge(storage, 'Cancelled', '2026-09-09', 999, 'cancelled')
    dismissed = charge(storage, 'Dismissed', '2026-09-09', 999)
    storage._conn.execute("UPDATE upcoming_transactions SET status = 'dismissed' WHERE id = ?", (dismissed,))
    matched = charge(storage, 'Matched', '2026-09-09', 999)
    tx = storage.insert_transaction(source='manual', source_id='private-id', amount=999, transaction_date='2026-09-09')
    storage.match_upcoming_transaction(matched, tx)
    charge(storage, 'Past', '2026-09-07', 999)
    charge(storage, 'Outside', '2026-10-08', 999)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8, 8)):
        report = storage.get_upcoming_plan(limit=1, offset=1)
    assert report['total'] == 2
    assert report['items'][0]['id'] == unknown
    assert report['items'][0]['amount'] is None
    assert report['items'][0]['schedule_status'] == 'possibly_cancelled'
    assert report['known_total']['minor_units'] == 1001
    assert report['unknown_count'] == 1
    assert report['status'] == 'partial'
    assert report['end'] == '2026-10-07'
    assert first < unknown


def test_upcoming_date_window_default_timezone_and_home_agree(in_memory_db):
    storage = Storage(in_memory_db)
    storage.set_setting('subscriptions_enabled', 'true')
    charge(storage, 'Last included', '2026-09-21', 12)
    charge(storage, 'First excluded', '2026-09-22', 99)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)) as clock:
        report = storage.get_upcoming_plan(14, 'America/Los_Angeles')
        clock.assert_called_with('America/Los_Angeles')
        home = storage.get_home_briefing('America/Los_Angeles')
    assert report['total'] == 1
    assert report['known_total'] == home['upcoming_total']
    assert [item['id'] for item in report['items']] == [item['id'] for item in home['upcoming']]


@pytest.mark.parametrize('fields', [{'days': 0}, {'days': 91}, {'limit': 0}, {'offset': -1}])
def test_upcoming_rejects_invalid_queries(in_memory_db, fields):
    with pytest.raises(ValueError, match='Invalid upcoming'):
        Storage(in_memory_db).get_upcoming_plan(**fields)


def test_upcoming_disabled_metadata_does_not_delete_or_gate_recorded_schedules(in_memory_db):
    storage = Storage(in_memory_db)
    charge(storage, 'Recorded', '2026-09-08', -1)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        report = storage.get_upcoming_plan()
    assert not report['enabled']
    assert report['total'] == 1
    assert report['items'][0]['amount'] is None
    assert report['unknown_count'] == 1
