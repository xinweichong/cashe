from datetime import datetime
from unittest.mock import patch

import pytest

from src.storage import Storage


@pytest.mark.parametrize('source', ['unknown', 'user', 'recurring_suggestion'])
def test_schedule_provenance_does_not_certify_charge(source, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly', confirmation_source=source)
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', None)
    assert storage.get_subscription(sub)['confirmation_source'] == source
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        report = storage.get_upcoming_plan()
    assert report['items'][0]['confirmation_source'] == source
    assert report['items'][0]['amount'] is None
    assert report['status'] == 'partial'
    before = storage.get_upcoming_transaction(charge)
    storage.confirm_subscription(sub)
    first = list(in_memory_db.execute('SELECT * FROM subscription_confirmations').fetchone())
    storage.confirm_subscription(sub)
    assert list(in_memory_db.execute('SELECT * FROM subscription_confirmations').fetchone()) == first
    assert storage.get_subscription(sub)['confirmation_source'] == (source if source != 'unknown' else 'user')
    assert storage.get_upcoming_transaction(charge) == before


@pytest.mark.parametrize('status', ['paused', 'cancelled'])
def test_confirmation_does_not_reactivate_schedule(status, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    storage.update_subscription(sub, status=status)
    storage.confirm_subscription(sub)
    assert storage.get_subscription(sub)['status'] == status
    assert storage.list_upcoming_transactions(sub) == []
    storage.delete_subscription(sub)
    assert in_memory_db.execute('SELECT COUNT(*) FROM subscription_confirmations').fetchone()[0] == 0


def test_invalid_confirmation_is_atomic_and_missing_schedule_fails(in_memory_db):
    storage = Storage(in_memory_db)
    with pytest.raises(ValueError):
        storage.create_subscription('Cafe', 'monthly', confirmation_source='inferred')
    assert storage.list_subscriptions() == []
    with pytest.raises(ValueError, match='not found'):
        storage.confirm_subscription(999)
    assert in_memory_db.execute('SELECT COUNT(*) FROM subscription_confirmations').fetchone()[0] == 0
