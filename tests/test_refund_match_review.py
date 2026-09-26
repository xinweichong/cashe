from itertools import count

import pytest

from src.storage import Storage


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()
    def add(amount, day, tx_type='expense', **changes):
        values = dict(source='manual', source_id=f'test-{next(sequence)}', amount=amount,
                      transaction_date=day, merchant='Cafe', category='Food', tx_type=tx_type)
        values.update(changes)
        return storage.insert_transaction(**values)
    return storage, add


def test_proposes_closest_preceding_purchase_within_window(ledger):
    storage, add = ledger
    older = add(20, '2026-01-01T12:00:00')
    closer = add(20, '2026-06-01T12:00:00')
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')

    review = storage.get_refund_match_review()
    assert review['total'] == 1
    item = review['items'][0]
    assert item['refund_transaction_id'] == refund
    assert item['candidate_purchase']['transaction_id'] == closer
    assert item['candidate_purchase']['transaction_id'] != older
    assert item['reason'] == 'same_merchant_amount_window'
    assert item['refund']['merchant'] == 'Cafe'
    assert item['candidate_purchase']['amount']['minor_units'] == 2000


def test_no_proposal_across_merchants_currencies_or_amount_shortfall(ledger):
    storage, add = ledger
    add(20, '2026-06-01T12:00:00', merchant='Other Shop')
    add(20, '2026-06-01T12:00:00', currency='USD', exchange_rate=1.3)
    add(5, '2026-06-01T12:00:00')  # too small to cover the refund
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')

    review = storage.get_refund_match_review()
    assert review['items'] == []
    assert review['total'] == 0
    assert refund  # sanity: refund row exists but has no match


def test_no_proposal_outside_180_day_window_or_when_purchase_is_after_refund(ledger):
    storage, add = ledger
    add(20, '2025-01-01T12:00:00')  # more than 180 days before the refund
    add(20, '2026-07-01T12:00:00')  # after the refund
    add(20, '2026-06-15T12:00:00', tx_type='refund')  # the refund itself precedes this later purchase

    review = storage.get_refund_match_review()
    assert review['items'] == []


def test_accept_links_the_proposed_purchase_and_removes_it_from_review(ledger):
    storage, add = ledger
    purchase = add(20, '2026-06-01T12:00:00')
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')

    storage.resolve_refund_match(refund, 'accept')
    assert storage.get_transaction(refund)['refund_of_transaction_id'] == purchase
    assert storage.get_refund_match_review()['items'] == []


def test_dismiss_suppresses_without_linking_and_survives_repeated_listing(ledger):
    storage, add = ledger
    add(20, '2026-06-01T12:00:00')
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')

    storage.resolve_refund_match(refund, 'dismiss')
    assert storage.get_transaction(refund)['refund_of_transaction_id'] is None
    assert storage.get_refund_match_review()['items'] == []
    assert storage.get_refund_match_review()['items'] == []  # idempotent, no crash on repeat listing


def test_already_linked_refunds_and_non_expense_candidates_are_excluded(ledger):
    storage, add = ledger
    purchase = add(20, '2026-06-01T12:00:00')
    already_linked = add(20, '2026-06-10T12:00:00', tx_type='refund')
    storage.update_transaction(already_linked, refund_of_transaction_id=purchase)
    # A transfer under the same merchant/amount/window must never be proposed
    # as a candidate purchase — only type='expense' (or legacy NULL) qualifies,
    # matching update_transaction's own linking validation.
    add(20, '2026-06-11T12:00:00', tx_type='transfer', merchant='Transfer Only Cafe')
    no_valid_candidate = add(20, '2026-06-12T12:00:00', tx_type='refund', merchant='Transfer Only Cafe')

    review = storage.get_refund_match_review()
    ids = {item['refund_transaction_id'] for item in review['items']}
    assert already_linked not in ids
    assert no_valid_candidate not in ids


def test_accept_without_a_current_proposal_raises(ledger):
    storage, add = ledger
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')
    with pytest.raises(ValueError):
        storage.resolve_refund_match(refund, 'accept')


def test_invalid_action_raises(ledger):
    storage, add = ledger
    refund = add(20, '2026-06-10T12:00:00', tx_type='refund')
    with pytest.raises(ValueError):
        storage.resolve_refund_match(refund, 'bogus')
