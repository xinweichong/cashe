from datetime import date
from itertools import count

import pytest

from src.storage import Storage

AS_OF = date(2026, 9, 28)  # Monday; remaining days are Sep 29 (Tue) and Sep 30 (Wed)


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()
    def add(amount, day, **changes):
        values = dict(source='manual', source_id=f'test-{next(sequence)}', amount=amount,
                      transaction_date=day, merchant='Cafe', category='Food', tx_type='expense')
        values.update(changes)
        return storage.insert_transaction(**values)
    return storage, add


def test_recorded_actual_nets_refunds_and_matches_month_to_date(ledger):
    storage, add = ledger
    add(50, '2026-09-05T12:00:00')
    add(10, '2026-09-06T12:00:00', tx_type='refund')
    add(999, '2026-09-29T12:00:00')  # after as_of — must not count as actual
    report = storage.get_month_forecast(as_of=AS_OF)
    assert report['recorded_actual'] == {'minor_units': 4000, 'currency': 'SGD'}
    assert report['period_start'] == '2026-09-01' and report['period_end'] == '2026-09-30'


def test_no_history_is_unavailable_not_a_confident_zero(ledger):
    storage, add = ledger
    add(50, '2026-09-05T12:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    assert report['status'] == 'unavailable'
    assert 'insufficient_history' in report['reasons']
    assert report['remaining_variable_estimate'] is None
    assert report['projected_total'] is None


def test_weekday_median_from_eight_complete_weeks_requires_four_eligible(ledger):
    storage, add = ledger
    add(50, '2026-09-05T12:00:00')
    # Tuesdays at $10, $10, $20, $30 across 4 of the 8 lookback weeks (Aug 3 - Sep 27).
    for day, amount in [('2026-08-04', 10), ('2026-08-11', 10), ('2026-08-18', 20), ('2026-08-25', 30)]:
        add(amount, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    tuesday = next(item for item in report['weekday_medians'] if item['weekday'] == 1)
    assert tuesday['eligible_weeks'] == 8  # every week in the window is eligible once history exists
    # 8 Tuesdays in the window: 4 real ($10,$10,$20,$30) and 4 with no transaction (observed $0).
    # Sorted minor units: [0,0,0,0,1000,1000,2000,3000] -> median of the middle two = 500.
    assert tuesday['median'] == {'minor_units': 500, 'currency': 'SGD'}


def test_a_day_before_the_accounts_earliest_transaction_is_a_gap_not_an_observed_zero(ledger):
    storage, add = ledger
    # History starts mid-lookback-window: only the last 3 Tuesdays are real account history.
    add(50, '2026-09-05T12:00:00')
    for day in ['2026-09-08', '2026-09-15', '2026-09-22']:
        add(10, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    tuesday = next(item for item in report['weekday_medians'] if item['weekday'] == 1)
    assert tuesday['eligible_weeks'] == 3  # not 8 — weeks before the account's history are gaps, not zeros
    assert tuesday['median'] is None  # below MIN_ELIGIBLE_WEEKS
    assert report['status'] == 'unavailable'


def test_recurring_matched_charge_excluded_from_baseline_and_counted_once_as_a_commitment(ledger):
    storage, add = ledger
    add(50, '2026-09-05T12:00:00')
    sub = storage.create_subscription('Rent', 'monthly', billing_day=1)
    # A large recurring charge lands on a Tuesday inside the lookback window —
    # if it leaked into the weekday baseline it would massively overstate a
    # normal Tuesday's variable spend.
    upcoming = storage.create_upcoming_transaction(sub, '2026-08-04', 2000.0)
    rent_tx = storage.insert_transaction(source='manual', source_id='rent-aug', amount=2000.0,
                                         merchant='Landlord', transaction_date='2026-08-04T09:00:00', tx_type='expense')
    storage.match_upcoming_transaction(upcoming, rent_tx)
    for day in ['2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01']:
        add(10, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    tuesday = next(item for item in report['weekday_medians'] if item['weekday'] == 1)
    # 8 Tuesdays: the rent charge is excluded (0), 4 are real $10 spends, 3 more have no spend.
    # Sorted minor units: [0,0,0,0,1000,1000,1000,1000] -> median 500 — nowhere near the $2000 rent charge.
    assert tuesday['median'] == {'minor_units': 500, 'currency': 'SGD'}


def test_explicit_baseline_exclusion_removes_a_purchase_from_the_median_but_not_from_actual_totals(ledger):
    storage, add = ledger
    # A one-off $900 splurge on a Tuesday in the lookback window, explicitly
    # flagged unusual — must not skew the "typical Tuesday" median, but must
    # still count in the account's actual historical totals.
    splurge_id = add(900, '2026-08-04T09:00:00')
    storage.update_transaction(splurge_id, excluded_from_baseline=True)
    for day in ['2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01']:
        add(10, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    tuesday = next(item for item in report['weekday_medians'] if item['weekday'] == 1)
    assert tuesday['median'] == {'minor_units': 500, 'currency': 'SGD'}  # same shape as the recurring-exclusion test
    # Excluded from the baseline, but still real spending — evidence/actual totals are untouched.
    evidence = storage.get_spending_evidence(date(2026, 8, 1), date(2026, 8, 31))
    assert splurge_id in [item['id'] for item in evidence['items']]


def test_trip_baseline_exclusion_applies_to_every_enlisted_transaction(ledger):
    storage, add = ledger
    trip_id = storage.create_trip('Bali', '2026-08-04')
    tx1 = add(900, '2026-08-04T09:00:00')
    tx2 = add(100, '2026-08-04T18:00:00')
    storage.enlist_transaction(trip_id, tx1)
    storage.enlist_transaction(trip_id, tx2)
    unrelated = add(10, '2026-08-05T09:00:00')
    updated = storage.set_trip_baseline_exclusion(trip_id, True)
    assert updated == 2
    assert storage.get_transaction(tx1)['excluded_from_baseline'] == 1
    assert storage.get_transaction(tx2)['excluded_from_baseline'] == 1
    assert storage.get_transaction(unrelated)['excluded_from_baseline'] == 0


def test_period_baseline_exclusion_applies_within_the_date_range_only(ledger):
    storage, add = ledger
    inside = add(50, '2026-08-10T09:00:00')
    outside = add(50, '2026-08-20T09:00:00')
    updated = storage.set_period_baseline_exclusion('2026-08-01', '2026-08-15', True)
    assert updated == 1
    assert storage.get_transaction(inside)['excluded_from_baseline'] == 1
    assert storage.get_transaction(outside)['excluded_from_baseline'] == 0


def test_matching_a_pending_commitment_removes_it_and_folds_it_into_the_actual(ledger):
    storage, add = ledger
    for day in ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']:
        add(10, f'{day}T09:00:00')
    for day in ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']:
        add(10, f'{day}T09:00:00')  # give Wednesday history too
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=29)
    upcoming = storage.create_upcoming_transaction(sub, '2026-09-29', 20.0)

    before = storage.get_month_forecast(as_of=AS_OF)
    assert before['confirmed_commitments'] == {'minor_units': 2000, 'currency': 'SGD'}

    # The charge actually posts on its expected date — advance as_of to when
    # it happened, the same way a real forecast is recomputed day by day.
    tx = storage.insert_transaction(source='manual', source_id='netflix-sep', amount=20.0,
                                    merchant='Netflix', transaction_date='2026-09-29T09:00:00', tx_type='expense')
    storage.match_upcoming_transaction(upcoming, tx)
    after = storage.get_month_forecast(as_of=date(2026, 9, 29))

    assert after['confirmed_commitments'] == {'minor_units': 0, 'currency': 'SGD'}
    # The known $20 moved buckets from "confirmed commitment" to "recorded
    # actual" without being counted twice or silently dropped — the combined
    # known total is unchanged even though the separate forward-looking
    # variable estimate for the day is naturally revised now that it's known.
    assert (before['recorded_actual']['minor_units'] + before['confirmed_commitments']['minor_units']) == \
           (after['recorded_actual']['minor_units'] + after['confirmed_commitments']['minor_units']) == 2000


def test_unpriced_commitment_is_flagged_and_excluded_from_the_confirmed_total(ledger):
    storage, add = ledger
    for day in ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']:
        add(10, f'{day}T09:00:00')
    for day in ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']:
        add(10, f'{day}T09:00:00')
    sub = storage.create_subscription('Mystery Charge', 'monthly', billing_day=29)
    storage.create_upcoming_transaction(sub, '2026-09-29', None)
    report = storage.get_month_forecast(as_of=AS_OF)
    assert report['unpriced_commitment_count'] == 1
    assert report['confirmed_commitments'] == {'minor_units': 0, 'currency': 'SGD'}
    assert 'unpriced_commitment' in report['reasons']
    assert report['status'] == 'partial'


def test_unresolved_conversion_in_the_actual_period_is_flagged(ledger):
    storage, add = ledger
    for day in ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']:
        add(10, f'{day}T09:00:00')
    for day in ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']:
        add(10, f'{day}T09:00:00')
    add(50, '2026-09-05T12:00:00', currency='USD', exchange_rate=1)  # legacy 1.0 — unresolved, not a real rate
    report = storage.get_month_forecast(as_of=AS_OF)
    assert 'unresolved_conversion' in report['reasons']
    assert report['status'] == 'partial'


def test_historical_low_high_bands_are_the_actual_recorded_extremes_not_a_statistical_interval(ledger):
    storage, add = ledger
    # Tuesdays: $10, $10, $20, $30 across 4 of the 8 lookback weeks; 4 weeks with none (observed $0).
    for day, amount in [('2026-08-04', 10), ('2026-08-11', 10), ('2026-08-18', 20), ('2026-08-25', 30)]:
        add(amount, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    tuesday = next(item for item in report['weekday_medians'] if item['weekday'] == 1)
    assert tuesday['low'] == {'minor_units': 0, 'currency': 'SGD'}
    assert tuesday['high'] == {'minor_units': 3000, 'currency': 'SGD'}


def test_projected_total_bands_bracket_the_point_estimate(ledger):
    storage, add = ledger
    for day, amount in [('2026-08-04', 10), ('2026-08-11', 10), ('2026-08-18', 20), ('2026-08-25', 30)]:
        add(amount, f'{day}T09:00:00')
    for day in ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']:
        add(10, f'{day}T09:00:00')
    report = storage.get_month_forecast(as_of=AS_OF)
    assert report['status'] == 'complete'
    low = report['projected_total_low']['minor_units']
    mid = report['projected_total']['minor_units']
    high = report['projected_total_high']['minor_units']
    assert low <= mid <= high
    assert low < high  # bands must carry real information, not collapse to a point


def test_no_remaining_days_needs_no_history(ledger):
    storage, add = ledger
    add(50, '2026-09-30T12:00:00')
    report = storage.get_month_forecast(as_of=date(2026, 9, 30))
    assert report['remaining_variable_estimate'] == {'minor_units': 0, 'currency': 'SGD'}
    assert report['remaining_variable_low'] == report['remaining_variable_high'] == {'minor_units': 0, 'currency': 'SGD'}
    assert report['status'] == 'complete'
    assert report['projected_total'] == report['projected_total_low'] == report['projected_total_high'] == report['recorded_actual']


def _seed_available_history(add):
    """4 Tuesdays + 4 Wednesdays of $10 Food spend — enough lookback history
    (median $5/weekday) for a 'complete' forecast at AS_OF (2026-09-28)."""
    for day in ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']:
        add(10, f'{day}T09:00:00')
    for day in ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']:
        add(10, f'{day}T09:00:00')


def test_scenario_one_off_exclusion_removes_a_real_purchase_from_the_projection(ledger):
    storage, add = ledger
    _seed_available_history(add)
    splurge_id = add(300, '2026-09-05T12:00:00')
    base = storage.get_month_forecast(as_of=AS_OF)
    result = storage.get_forecast_scenario(
        [{"kind": "one_off_exclusion", "transaction_id": splurge_id}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] == {'minor_units': -30000, 'currency': 'SGD'}
    assert result['adjustments'][0]['note'] is None
    assert result['result']['projected_total']['minor_units'] == \
        base['projected_total']['minor_units'] - 30000
    # Read-only: the real transaction and forecast are untouched.
    assert storage.get_transaction(splurge_id) is not None
    assert storage.get_month_forecast(as_of=AS_OF) == base


def test_scenario_one_off_exclusion_outside_the_current_period_is_explained_not_guessed(ledger):
    storage, add = ledger
    _seed_available_history(add)
    old_tx = add(300, '2026-07-01T12:00:00')
    result = storage.get_forecast_scenario(
        [{"kind": "one_off_exclusion", "transaction_id": old_tx}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] is None
    assert 'current recorded period' in result['adjustments'][0]['note']
    assert result['result']['projected_total'] == result['base']['projected_total']


def test_scenario_category_reduction_scales_the_remaining_estimate(ledger):
    storage, add = ledger
    _seed_available_history(add)  # all Food, median $5/weekday x 2 remaining days = $10 total
    base = storage.get_month_forecast(as_of=AS_OF)
    result = storage.get_forecast_scenario(
        [{"kind": "category_reduction", "category": "Food", "reduce_by_percent": 50}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] == {'minor_units': -500, 'currency': 'SGD'}
    assert result['result']['projected_total']['minor_units'] == base['projected_total']['minor_units'] - 500


def test_scenario_category_reduction_for_a_never_purchased_category_is_a_confirmed_zero(ledger):
    # Not "insufficient history" — the account has 8 full weeks of history
    # (from _seed_available_history) and Transport genuinely never appears in
    # any of them, so a confirmed $0 effect is the honest answer, not a
    # fabricated unavailability.
    storage, add = ledger
    _seed_available_history(add)
    result = storage.get_forecast_scenario(
        [{"kind": "category_reduction", "category": "Transport", "reduce_by_percent": 50}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] == {'minor_units': 0, 'currency': 'SGD'}
    assert result['adjustments'][0]['note'] is None


def test_scenario_category_reduction_with_insufficient_account_history_is_explained(ledger):
    storage, add = ledger
    add(50, '2026-09-05T12:00:00')  # only 1 transaction ever — no lookback history at all
    result = storage.get_forecast_scenario(
        [{"kind": "category_reduction", "category": "Food", "reduce_by_percent": 50}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] is None
    assert 'Not enough history' in result['adjustments'][0]['note']


def test_scenario_subscription_removal_excludes_its_pending_commitment(ledger):
    storage, add = ledger
    _seed_available_history(add)
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=29)
    storage.create_upcoming_transaction(sub, '2026-09-29', 20.0)
    base = storage.get_month_forecast(as_of=AS_OF)
    result = storage.get_forecast_scenario(
        [{"kind": "subscription_removal", "subscription_id": sub}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] == {'minor_units': -2000, 'currency': 'SGD'}
    assert result['result']['projected_total']['minor_units'] == base['projected_total']['minor_units'] - 2000


def test_scenario_subscription_removal_with_no_pending_charge_is_explained(ledger):
    storage, add = ledger
    _seed_available_history(add)
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=29)
    result = storage.get_forecast_scenario(
        [{"kind": "subscription_removal", "subscription_id": sub}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] is None
    assert 'No pending charge' in result['adjustments'][0]['note']


def test_scenario_unknown_subscription_is_explained_not_a_crash(ledger):
    storage, add = ledger
    _seed_available_history(add)
    result = storage.get_forecast_scenario(
        [{"kind": "subscription_removal", "subscription_id": 999}], as_of=AS_OF)
    assert result['adjustments'][0]['amount_delta'] is None
    assert result['adjustments'][0]['note'] == 'Subscription not found.'


def test_scenario_result_is_unavailable_when_the_base_forecast_is(ledger):
    storage, add = ledger  # no history seeded — base forecast is unavailable
    tx = add(50, '2026-09-05T12:00:00')
    result = storage.get_forecast_scenario(
        [{"kind": "one_off_exclusion", "transaction_id": tx}], as_of=AS_OF)
    assert result['base']['status'] == 'unavailable'
    assert result['result'] is None


def test_scenario_combines_multiple_adjustments(ledger):
    storage, add = ledger
    _seed_available_history(add)
    splurge_id = add(300, '2026-09-05T12:00:00')
    sub = storage.create_subscription('Netflix', 'monthly', billing_day=29)
    storage.create_upcoming_transaction(sub, '2026-09-29', 20.0)
    base = storage.get_month_forecast(as_of=AS_OF)
    result = storage.get_forecast_scenario([
        {"kind": "one_off_exclusion", "transaction_id": splurge_id},
        {"kind": "subscription_removal", "subscription_id": sub},
    ], as_of=AS_OF)
    assert result['result']['projected_total']['minor_units'] == \
        base['projected_total']['minor_units'] - 30000 - 2000
