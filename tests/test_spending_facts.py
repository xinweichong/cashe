from datetime import date, datetime
from itertools import count
from unittest.mock import patch

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


def test_review_covers_all_history_and_shares_evidence_selection(ledger):
    storage, add = ledger
    older = add(10, '2020-01-01', currency='USD', exchange_rate=1)
    undated = add(10, None)
    invalid = add(10, tx_type='unknown')
    multiple = add(-1, 'not-a-date', tx_type='unknown')
    add(10, currency='USD', exchange_rate=1.3)  # Indicative, not unresolved.
    add(10, tx_type=None)  # Legacy expense.
    add(10, None, tx_type='transfer')
    review = storage.get_spending_review()
    records = {item['id']: item for item in review['items']}
    assert set(records) == {older, undated, invalid, multiple}
    assert records[older]['reasons'] == ['unresolved_money']
    assert records[undated]['reasons'] == ['missing_date']
    assert records[invalid]['reasons'] == ['unknown_type']
    assert records[multiple]['reasons'] == ['missing_date', 'unresolved_money', 'unknown_type']
    evidence = storage.get_spending_evidence(date.min, date.max, measure='unresolved')
    assert [item['id'] for item in review['items']] == [item['id'] for item in evidence['items']]


def test_review_flags_missing_merchant_or_category_without_calling_it_unresolved_money(ledger):
    # R06: missing merchant/category is a data-completeness issue, not a money
    # resolution one — it must surface in the review list (so the user notices
    # and can fill it in) but must NOT appear in the "unresolved money" evidence
    # measure, since the amount itself is perfectly resolved.
    storage, add = ledger
    no_category = add(10, category=None)
    no_merchant = add(10, merchant=None)
    both_missing = add(10, merchant=None, category=None)
    # A transfer with both fields missing must still be exempt, same as every
    # other review reason.
    add(10, merchant=None, category=None, tx_type='transfer')

    review = storage.get_spending_review()
    records = {item['id']: item for item in review['items']}
    assert set(records) == {no_category, no_merchant, both_missing}
    assert records[no_category]['reasons'] == ['missing_category']
    assert records[no_merchant]['reasons'] == ['missing_merchant']
    assert records[both_missing]['reasons'] == ['missing_merchant', 'missing_category']

    evidence = storage.get_spending_evidence(date.min, date.max, measure='unresolved')
    assert evidence['items'] == []


def test_review_pagination_timezone_and_corrections(ledger):
    storage, add = ledger
    ids = [add(10, '2026-08-31T18:00:00+00:00', currency='USD', exchange_rate=1) for _ in range(3)]
    first = storage.get_spending_review(limit=2)
    second = storage.get_spending_review(limit=2, offset=2)
    assert [item['id'] for item in first['items'] + second['items']] == ids[::-1]
    assert first['total'] == second['total'] == 3
    assert first['items'][0]['date'] == '2026-09-01'
    assert storage.get_spending_review(timezone='UTC')['items'][0]['date'] == '2026-08-31'
    storage.update_transaction(ids[0], exchange_rate=1.3)
    storage.delete_transaction(ids[1])
    assert storage.get_spending_review()['total'] == 1
    assert storage.get_spending_review(offset=50)['items'] == []


@pytest.mark.parametrize('options', [{'limit': 0}, {'limit': 101}, {'offset': -1}])
def test_review_rejects_invalid_pagination(ledger, options):
    with pytest.raises(ValueError):
        ledger[0].get_spending_review(**options)


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


def test_unsupported_currency_is_unresolved_not_a_fabricated_conversion(ledger):
    """R04: spending_facts must read the canonical conversion_status Storage
    already computed at write time, not blindly recompute from raw
    amount/currency/exchange_rate — the raw recompute has no currency
    validation and would treat any three-letter code as convertible."""
    storage, add = ledger
    add(10, currency='AED', exchange_rate=0.27)
    report = facts(storage)
    assert report['current']['status'] == 'partial'
    assert report['current']['unresolved_count'] == 1
    assert report['current']['indicative_count'] == 0
    evidence = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6), measure='unresolved')
    assert evidence['items'][0]['conversion_status'] == 'unresolved'
    review = storage.get_spending_review()
    assert review['items'][0]['reasons'] == ['unresolved_money']


def test_rows_without_canonical_columns_still_resolve_a_known_currency(ledger, in_memory_db):
    """A row that bypassed Storage.insert_transaction (raw SQL — the shape
    of genuinely pre-R02 legacy data) has no canonical columns at all, not
    just an unresolved status. For a currency this codebase actually
    reviews, that must still resolve via the legacy read-time fallback —
    only an unrecognized currency code should be treated as unresolved."""
    storage, add = ledger
    in_memory_db.execute(
        """INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
               merchant, category, transaction_date, type)
           VALUES ('manual', 'raw-1', 10.0, 'SGD', 1.0, 'Cafe', 'Food', '2026-09-05T12:00:00', 'expense')"""
    )
    in_memory_db.commit()
    report = facts(storage)
    assert report['current']['spending']['minor_units'] == 1000
    assert report['current']['status'] == 'complete'


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


def test_top_category_driver_attributes_change_to_the_dominant_merchant(ledger):
    storage, add = ledger
    add(5, category='Transport', merchant='Grab')
    add(100, category='Food', merchant='Fancy Bistro')
    add(10, '2026-08-05T00:00:00', category='Food', merchant='Cafe')
    report = facts(storage)
    driver = report['top_category_driver']
    assert driver['category'] == 'Food'
    assert driver['change']['minor_units'] == 9000
    assert driver['merchant_driver'] == {'merchant': 'Fancy Bistro', 'change': {'minor_units': 10000, 'currency': 'SGD'}}
    assert driver['overlap_note']


def test_frequency_driver_distinguishes_more_purchases_from_bigger_ones(ledger):
    storage, add = ledger
    for _ in range(4):
        add(10, '2026-08-05T00:00:00', category='Food')
    for _ in range(8):
        add(10, category='Food')
    report = facts(storage)
    driver = report['top_category_driver']['frequency_driver']
    assert driver == {
        'classification': 'frequency', 'current_count': 8, 'previous_count': 4,
        'current_avg': {'minor_units': 1000, 'currency': 'SGD'}, 'previous_avg': {'minor_units': 1000, 'currency': 'SGD'},
    }


def test_frequency_driver_flags_size_when_count_is_unchanged(ledger):
    storage, add = ledger
    for _ in range(4):
        add(10, '2026-08-05T00:00:00', category='Food')
    for _ in range(4):
        add(30, category='Food')
    report = facts(storage)
    driver = report['top_category_driver']['frequency_driver']
    assert driver['classification'] == 'size'
    assert driver['current_count'] == driver['previous_count'] == 4


def test_one_off_driver_flags_a_single_dominant_purchase(ledger):
    storage, add = ledger
    add(500, category='Food', merchant='Rare Splurge')
    add(10, '2026-08-05T00:00:00', category='Food')
    report = facts(storage)
    driver = report['top_category_driver']['one_off_driver']
    assert driver is not None
    assert driver['merchant'] == 'Rare Splurge'
    assert driver['amount'] == {'minor_units': 50000, 'currency': 'SGD'}


def test_one_off_driver_absent_when_change_is_spread_across_many_purchases(ledger):
    storage, add = ledger
    for _ in range(10):
        add(20, category='Food')
    add(10, '2026-08-05T00:00:00', category='Food')
    report = facts(storage)
    assert report['top_category_driver']['one_off_driver'] is None


def test_merchant_driver_evidence_opens_exactly_that_merchants_transactions(ledger):
    storage, add = ledger
    add(50, category='Food', merchant='Fancy Bistro')
    add(10, category='Food', merchant='Cafe')
    add(10, '2026-08-05T00:00:00', category='Food', merchant='Cafe')
    evidence = storage.get_spending_evidence(date(2026, 9, 1), date(2026, 9, 6), category='Food', merchant='Fancy Bistro')
    assert evidence['total'] == 1
    assert evidence['items'][0]['merchant'] == 'Fancy Bistro'


def test_trip_driver_reports_trip_attributed_change_without_double_counting(ledger):
    storage, add = ledger
    trip_id = storage.create_trip('Bali', '2026-09-01')
    tx = add(80, category='Food', merchant='Resort')
    storage.enlist_transaction(trip_id, tx)
    add(10, '2026-08-05T00:00:00', category='Food')
    report = facts(storage)
    assert len(report['trip_drivers']) == 1
    trip_driver = report['trip_drivers'][0]
    assert trip_driver['trip_id'] == trip_id
    assert trip_driver['name'] == 'Bali'
    assert trip_driver['current_total'] == {'minor_units': 8000, 'currency': 'SGD'}
    assert trip_driver['previous_total'] == {'minor_units': 0, 'currency': 'SGD'}
    assert trip_driver['overlap_note']


def test_weekday_pattern_averages_over_complete_trailing_weeks(ledger):
    storage, add = ledger
    add(20, '2026-09-08T10:00:00')  # Tuesday, in the trailing complete week
    add(10, '2026-09-13T10:00:00')  # Sunday, in the trailing complete week
    add(999, '2026-09-14T10:00:00')  # Monday of the current (excluded, partial) week
    with patch('src.spending_facts.local_now', return_value=datetime(2026, 9, 14)):
        pattern = storage.get_weekday_pattern(weeks=1)
    assert pattern['start'] == '2026-09-07'
    assert pattern['end'] == '2026-09-13'
    by_weekday = {item['weekday']: item for item in pattern['pattern']}
    assert by_weekday[1]['average'] == {'minor_units': 2000, 'currency': 'SGD'}
    assert by_weekday[1]['transaction_count'] == 1
    assert by_weekday[6]['average'] == {'minor_units': 1000, 'currency': 'SGD'}
    assert by_weekday[0]['average'] == {'minor_units': 0, 'currency': 'SGD'}


def test_weekday_pattern_excludes_transactions_explicitly_flagged_unusual(ledger):
    storage, add = ledger
    normal = add(20, '2026-09-08T10:00:00')  # Tuesday
    splurge = add(500, '2026-09-08T18:00:00')  # same Tuesday — a flagged one-off
    storage.update_transaction(splurge, excluded_from_baseline=True)
    with patch('src.spending_facts.local_now', return_value=datetime(2026, 9, 14)):
        pattern = storage.get_weekday_pattern(weeks=1)
    by_weekday = {item['weekday']: item for item in pattern['pattern']}
    assert by_weekday[1]['average'] == {'minor_units': 2000, 'currency': 'SGD'}
    assert by_weekday[1]['transaction_count'] == 1
    # Still real spending, unaffected in evidence/actual totals.
    evidence = storage.get_spending_evidence(date(2026, 9, 7), date(2026, 9, 13))
    assert {normal, splurge} <= {item['id'] for item in evidence['items']}


def test_weekday_pattern_divides_by_weeks_not_just_occurrences(ledger):
    storage, add = ledger
    add(10, '2026-08-25T10:00:00')  # Tuesday, week 1 of the trailing 2 weeks
    add(30, '2026-09-01T10:00:00')  # Tuesday, week 2 of the trailing 2 weeks
    with patch('src.spending_facts.local_now', return_value=datetime(2026, 9, 7)):
        pattern = storage.get_weekday_pattern(weeks=2)
    by_weekday = {item['weekday']: item for item in pattern['pattern']}
    assert by_weekday[1]['average'] == {'minor_units': 2000, 'currency': 'SGD'}
    assert by_weekday[1]['transaction_count'] == 2


def test_weekday_evidence_opens_exactly_that_weekdays_transactions(ledger):
    storage, add = ledger
    tuesday = add(20, '2026-09-08T10:00:00')
    add(10, '2026-09-13T10:00:00')  # Sunday — must not appear
    evidence = storage.get_spending_evidence(date(2026, 9, 7), date(2026, 9, 13), weekday=1)
    assert [item['id'] for item in evidence['items']] == [tuesday]


def test_merchant_ranking_filters_by_category(ledger):
    storage, add = ledger
    add(50, category='Food', merchant='Fancy Bistro')
    add(20, category='Transport', merchant='Grab')
    ranking = storage.get_merchant_ranking('2026-09-01', '2026-09-30', category='Food')
    assert [r['merchant'] for r in ranking] == ['Fancy Bistro']
    ranking_all = storage.get_merchant_ranking('2026-09-01', '2026-09-30')
    assert {r['merchant'] for r in ranking_all} == {'Fancy Bistro', 'Grab'}


def test_no_top_category_driver_when_no_category_changed(ledger):
    storage, add = ledger
    add(10, category='Food')
    add(10, '2026-08-05T00:00:00', category='Food')
    report = facts(storage)
    assert report['category_changes'] == []
    assert report['top_category_driver'] is None
    assert report['trip_drivers'] == []


@pytest.mark.parametrize(('as_of', 'expected'), [
    ('2026-09-07', ('2026-09-07', '2026-09-07', '2026-08-31', '2026-08-31')),
    ('2026-09-09', ('2026-09-07', '2026-09-09', '2026-08-31', '2026-09-02')),
    ('2026-09-13', ('2026-09-07', '2026-09-13', '2026-08-31', '2026-09-06')),
    ('2026-01-01', ('2025-12-29', '2026-01-01', '2025-12-22', '2025-12-25')),
])
def test_week_periods_align_weekdays(as_of, expected):
    from src.spending_facts import week_periods
    periods = week_periods(date.fromisoformat(as_of))
    assert tuple(day.isoformat() for day in periods) == expected
    assert periods[0].weekday() == periods[2].weekday() == 0
    assert periods[1].weekday() == periods[3].weekday()


def test_week_evidence_includes_equal_weekdays_only(ledger):
    storage, add = ledger
    add(20, '2026-09-07T12:00:00')
    add(5, '2026-09-09T12:00:00')
    add(999, '2026-09-10T12:00:00')
    add(10, '2026-08-31T12:00:00')
    add(999, '2026-09-03T12:00:00')
    report = storage.get_week_spending_facts(date(2026, 9, 9))
    assert report['current']['spending']['minor_units'] == 2500
    assert report['previous']['spending']['minor_units'] == 1000
    assert report['change']['minor_units'] == 1500
    assert report['comparison_current'] == report['current']
    for period in (report['current'], report['previous']):
        evidence = storage.get_spending_evidence(date.fromisoformat(period['start']), date.fromisoformat(period['end']))
        assert sum(item['amount']['minor_units'] for item in evidence['items']) == period['spending']['minor_units']


def test_week_uses_same_partial_currency_semantics(ledger):
    storage, add = ledger
    add(10, '2026-09-07T12:00:00', currency='USD', exchange_rate=1)
    report = storage.get_week_spending_facts(date(2026, 9, 9))
    assert report['current']['status'] == 'partial'
    assert report['change'] is None
    assert report['category_changes'] == []


def test_week_timezone_projects_sunday_utc_into_monday(ledger):
    storage, add = ledger
    add(10, '2026-09-06T16:00:00+00:00')
    report = storage.get_week_spending_facts(date(2026, 9, 7), 'Asia/Singapore')
    assert report['current']['spending']['minor_units'] == 1000
    report = storage.get_week_spending_facts(date(2026, 9, 7), 'UTC')
    assert report['current']['spending']['minor_units'] == 0


def test_home_briefing_exposes_all_history_review_and_recurring_counts(ledger):
    # R06: Home's "Needs attention" summary must surface counts that go beyond
    # the current-month unresolved figure already in `facts` — an all-history
    # spending-review count and a pending-recurring-suggestion count. A
    # transaction with two reasons (missing merchant AND category) must still
    # count once, matching spending_review's own distinct-transaction total.
    storage, add = ledger
    add(10, merchant=None, category=None)
    add(10, '2020-01-01', currency='USD', exchange_rate=1)
    briefing = storage.get_home_briefing()
    assert briefing['review_count'] == storage.get_spending_review()['total'] == 2
    assert briefing['recurring_suggestion_count'] == 0

    storage._conn.execute(
        "INSERT INTO recurring_suggestions(id, chat_id, merchant, frequency, avg_amount) "
        "VALUES ('sugg-1', 1, 'Netflix', 'monthly', 15.0)")
    briefing = storage.get_home_briefing()
    assert briefing['recurring_suggestion_count'] == 1


def test_home_briefing_recent_list_uses_canonical_money_not_legacy_recompute(ledger):
    """R04: get_home_briefing's 'recent' list called convert_legacy_sgd
    directly on rows from query_transactions, bypassing the canonical-money
    resolution used everywhere else. convert_legacy_sgd has no currency
    validation, so an unsupported currency code with a plausible-looking
    rate was silently treated as a resolved/indicative conversion instead
    of unresolved — same bug class as spending_facts._rows before its R04
    fix, just reachable through Home's own recent-transactions list."""
    storage, add = ledger
    add(10, currency='AED', exchange_rate=0.27)
    briefing = storage.get_home_briefing()
    recent = briefing['recent'][0]
    assert recent['amount'] is None
    assert recent['conversion_status'] == 'unresolved'


def test_home_briefing_has_no_spending_target_when_no_overall_budget_exists(ledger):
    storage, add = ledger
    briefing = storage.get_home_briefing()
    assert briefing['spending_target'] is None


def test_home_briefing_computes_spending_target_from_the_overall_budget_and_shared_facts(ledger):
    storage, add = ledger
    storage.create_budget(category=None, amount=1000.0, period='monthly')
    add(300, '2026-09-05T12:00:00')
    briefing = storage.get_home_briefing()
    assert briefing['spending_target'] == {
        'target': {'minor_units': 100000, 'currency': 'SGD'},
        'remaining': {'minor_units': 70000, 'currency': 'SGD'},
    }
    # The remaining figure must come from the same current-period spending
    # Home already displays, not a separately computed total.
    assert briefing['spending_target']['target']['minor_units'] - briefing['spending_target']['remaining']['minor_units'] \
        == briefing['facts']['current']['spending']['minor_units']


def test_home_briefing_spending_target_can_go_negative_when_over_budget(ledger):
    storage, add = ledger
    storage.create_budget(category=None, amount=100.0, period='monthly')
    add(300, '2026-09-05T12:00:00')
    briefing = storage.get_home_briefing()
    assert briefing['spending_target']['remaining'] == {'minor_units': -20000, 'currency': 'SGD'}


def test_home_briefing_spending_target_ignores_per_category_and_weekly_budgets(ledger):
    storage, add = ledger
    storage.create_budget(category='Food', amount=200.0, period='monthly')
    storage.create_budget(category=None, amount=50.0, period='weekly')
    briefing = storage.get_home_briefing()
    assert briefing['spending_target'] is None


def test_home_briefing_surfaces_a_commitment_price_increase_in_the_current_period(ledger):
    # R10: a subscription whose most recent matched charge rose during the
    # current comparison window is surfaced as an "increased commitment" —
    # reusing R11's already-canonical price-change detection rather than a
    # separate computation.
    storage, add = ledger
    storage.set_setting('subscriptions_enabled', 'true')
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=5)
    old_upcoming = storage.create_upcoming_transaction(sub, '2026-08-05', 15.0)
    old_tx = storage.insert_transaction(source='manual', source_id='old', amount=15.0, currency='SGD',
                                        exchange_rate=1.0, merchant='Netflix', transaction_date='2026-08-05T10:00:00', tx_type='expense')
    storage.match_upcoming_transaction(old_upcoming, old_tx)
    new_upcoming = storage.create_upcoming_transaction(sub, '2026-09-05', 20.0)
    new_tx = storage.insert_transaction(source='manual', source_id='new', amount=20.0, currency='SGD',
                                        exchange_rate=1.0, merchant='Netflix', transaction_date='2026-09-05T10:00:00', tx_type='expense')
    storage.match_upcoming_transaction(new_upcoming, new_tx)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 6)):
        briefing = storage.get_home_briefing()
    assert len(briefing['increased_commitments']) == 1
    change = briefing['increased_commitments'][0]
    assert change['subscription_id'] == sub
    assert change['change']['minor_units'] == 500


def test_home_briefing_omits_a_price_decrease_from_increased_commitments(ledger):
    storage, add = ledger
    storage.set_setting('subscriptions_enabled', 'true')
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=5)
    old_upcoming = storage.create_upcoming_transaction(sub, '2026-08-05', 20.0)
    old_tx = storage.insert_transaction(source='manual', source_id='old', amount=20.0, currency='SGD',
                                        exchange_rate=1.0, merchant='Netflix', transaction_date='2026-08-05T10:00:00', tx_type='expense')
    storage.match_upcoming_transaction(old_upcoming, old_tx)
    new_upcoming = storage.create_upcoming_transaction(sub, '2026-09-05', 15.0)
    new_tx = storage.insert_transaction(source='manual', source_id='new', amount=15.0, currency='SGD',
                                        exchange_rate=1.0, merchant='Netflix', transaction_date='2026-09-05T10:00:00', tx_type='expense')
    storage.match_upcoming_transaction(new_upcoming, new_tx)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 6)):
        briefing = storage.get_home_briefing()
    assert briefing['increased_commitments'] == []


def test_daily_totals_nets_refunds_excludes_transfers_per_day(ledger):
    # R09: Activity's day-grouped headers reuse this shared-fact primitive
    # rather than summing whatever subset of a day's rows a pagination
    # cursor happens to have loaded.
    storage, add = ledger
    add(20, '2026-09-01T09:00:00')
    add(5, '2026-09-01T18:00:00', tx_type='refund')
    add(100, '2026-09-01T20:00:00', tx_type='transfer')
    add(30, '2026-09-02T09:00:00')
    totals = storage.get_daily_totals(date(2026, 9, 1), date(2026, 9, 2))
    by_date = {t['date']: t for t in totals}
    assert by_date['2026-09-01']['spending']['minor_units'] == 1500
    assert by_date['2026-09-01']['transaction_count'] == 2  # transfer excluded
    assert by_date['2026-09-02']['spending']['minor_units'] == 3000


def test_daily_totals_is_independent_of_how_rows_would_be_paginated(ledger):
    # Whether a day's transactions are loaded across one page or split
    # across several does not change the day's total — it never comes
    # from summing loaded rows in the first place.
    storage, add = ledger
    for i in range(25):
        add(10, f'2026-09-01T{9 + i % 12:02d}:{i:02d}:00')
    totals = storage.get_daily_totals(date(2026, 9, 1), date(2026, 9, 1))
    assert len(totals) == 1
    assert totals[0]['transaction_count'] == 25
    assert totals[0]['spending']['minor_units'] == 25 * 1000


def test_daily_totals_bounds_to_requested_range(ledger):
    storage, add = ledger
    add(10, '2026-08-31T23:59:00')
    add(10, '2026-09-01T00:01:00')
    add(10, '2026-09-02T00:01:00')
    totals = storage.get_daily_totals(date(2026, 9, 1), date(2026, 9, 1))
    assert [t['date'] for t in totals] == ['2026-09-01']


def test_transactions_v2_pagination_has_a_stable_tiebreak_for_same_timestamp_rows(ledger):
    storage, add = ledger
    ids = [add(10, '2026-09-01T09:00:00') for _ in range(5)]
    page1 = storage.get_transactions_v2(limit=3, offset=0)
    page2 = storage.get_transactions_v2(limit=3, offset=3)
    seen = [r['id'] for r in page1] + [r['id'] for r in page2]
    assert seen == sorted(ids, reverse=True)  # id DESC tiebreak, no dup/skip
    assert len(set(seen)) == 5
