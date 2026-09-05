from datetime import date, datetime
from itertools import count

import pytest

from src.spending_facts import month_periods
from src.storage import Storage


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()
    def add(amount, day='2026-09-05T12:00:00', **changes):
        values = dict(source='manual', source_id=f'test-{next(sequence)}', amount=amount,
                      transaction_date=day, merchant='Cafe', category='Food')
        values.update(changes)
        return storage.insert_transaction(**values)
    return storage, add


def facts(storage, day='2026-09-06'):
    return storage.get_month_spending_facts(date.fromisoformat(day))


@pytest.mark.parametrize(('as_of', 'ends'), [
    ('2026-03-31', ('2026-03-28', '2026-02-28')),
    ('2024-03-31', ('2024-03-29', '2024-02-29')),
    ('2026-01-06', ('2026-01-06', '2025-12-06')),
    ('2026-09-01', ('2026-09-01', '2026-08-01')),
])
def test_month_comparisons_use_equal_elapsed_days(as_of, ends):
    start, current_end, previous_start, previous_end = month_periods(date.fromisoformat(as_of))
    assert (current_end.isoformat(), previous_end.isoformat()) == ends
    assert (current_end - start).days == (previous_end - previous_start).days


def test_native_rounding_null_expenses_and_negative_net_flow(ledger):
    storage, add = ledger
    add(0.105, tx_type=None)
    add(0.105)
    add(0.1, tx_type='income')
    report = facts(storage)
    assert report['current']['spending']['minor_units'] == 22
    assert report['current']['income']['minor_units'] == 10
    assert report['current']['recorded_net_flow']['minor_units'] == -12
    assert report['current']['status'] == 'complete'


def test_no_income_is_absent_and_future_records_are_excluded(ledger):
    storage, add = ledger
    add(12.5)
    add(999, '2026-09-07T00:00:00', tx_type='income')
    report = facts(storage)
    assert report['current']['spending']['minor_units'] == 1250
    assert report['current']['income'] is None
    assert report['current']['recorded_net_flow'] is None


def test_refunds_reduce_spending_when_received_and_transfers_are_excluded(ledger):
    storage, add = ledger
    add(100, '2026-08-05T12:00:00')
    refund_id = add(30, tx_type='refund')
    add(900, tx_type='transfer')
    report = facts(storage)
    assert report['current']['spending']['minor_units'] == -3000
    assert report['previous']['spending']['minor_units'] == 10000
    assert report['change']['minor_units'] == -13000
    evidence = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6))
    assert evidence['total'] == 1
    assert evidence['items'][0]['id'] == refund_id
    assert evidence['items'][0]['amount']['minor_units'] == -3000


@pytest.mark.parametrize('rate', [None, 0, -1, 1, float('inf')])
def test_missing_or_unverified_fx_is_partial_not_a_zero_total(ledger, rate):
    storage, add = ledger
    add(10, currency='USD', exchange_rate=rate)
    report = facts(storage)
    assert report['current']['status'] == 'partial'
    assert report['current']['unresolved_count'] == 1
    assert report['change'] is None
    assert report['category_changes'] == []
    evidence = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6), measure='unresolved')
    assert evidence['items'][0]['amount'] is None
    assert evidence['items'][0]['conversion_status'] == 'unresolved'


def test_stored_foreign_rates_are_indicative_and_native_ignores_bad_rate(ledger):
    storage, add = ledger
    add(10, currency='USD', exchange_rate=1.34)
    add(10, currency='SGD', exchange_rate=99)
    report = facts(storage)
    assert report['current']['spending']['minor_units'] == 2340
    assert report['current']['status'] == 'indicative'
    assert report['current']['indicative_count'] == 1


def test_unknown_classification_and_undated_records_disclose_uncertainty(ledger):
    storage, add = ledger
    add(10, tx_type='unrecognized')
    add(20, day=None)
    report = facts(storage)
    assert report['current']['status'] == 'partial'
    assert report['undated_count'] == 1
    assert report['current']['unresolved_count'] == 1
    assert report['change'] is None
    evidence = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6), measure='unresolved')
    assert evidence['total'] == 2
    assert any(item['date'] is None for item in evidence['items'])


def test_local_timezone_controls_offset_timestamp_membership(ledger):
    storage, add = ledger
    add(10, '2026-08-31T16:30:00+00:00')
    singapore = storage.get_month_spending_facts(date(2026, 9, 1), 'Asia/Singapore')
    utc = storage.get_month_spending_facts(date(2026, 9, 1), 'UTC')
    assert singapore['current']['spending']['minor_units'] == 1000
    assert utc['current']['spending']['minor_units'] == 0


def test_default_calendar_uses_configured_local_now(ledger, monkeypatch):
    import src.spending_facts as module
    storage, _ = ledger
    calls = []
    def now(timezone):
        calls.append(timezone)
        return datetime(2026, 1, 1)
    monkeypatch.setattr(module, 'local_now', now)
    report = storage.get_month_spending_facts(timezone='Pacific/Auckland')
    assert report['as_of'] == '2026-01-01'
    assert calls == ['Pacific/Auckland']


def test_extra_month_days_are_in_total_but_not_shorter_comparison(ledger):
    storage, add = ledger
    add(10, '2026-03-05T12:00:00')
    add(50, '2026-03-31T12:00:00')
    add(5, '2026-02-05T12:00:00')
    report = facts(storage, '2026-03-31')
    assert report['current']['spending']['minor_units'] == 6000
    assert report['comparison_current']['spending']['minor_units'] == 1000
    assert report['change']['minor_units'] == 500


def test_category_drivers_and_paginated_evidence_reconcile(ledger):
    storage, add = ledger
    for _ in range(125):
        add(0.1)
    add(5, category='Transport')
    add(2, '2026-08-05T00:00:00', category='Transport')
    report = facts(storage)
    assert sum(item['change']['minor_units'] for item in report['category_changes']) == report['change']['minor_units']
    items = []
    for offset in (0, 100):
        page = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6), category='Food', limit=100, offset=offset)
        assert page['total'] == 125
        items.extend(page['items'])
    assert len({item['id'] for item in items}) == 125
    assert sum(item['amount']['minor_units'] for item in items) == 1250
