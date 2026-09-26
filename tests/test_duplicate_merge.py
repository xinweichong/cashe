from itertools import count

import pytest

from src.storage import Storage


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()
    def add(amount, day, source='manual', merchant='Cafe', currency='SGD', tx_type='expense',
            precision='second', **changes):
        source_id = f'src-{next(sequence)}'
        tx_id = storage.insert_transaction(
            source=source, source_id=source_id, amount=amount, merchant=merchant,
            category='Food', transaction_date=day, currency=currency, tx_type=tx_type, **changes)
        if precision:
            event = storage.record_source_event(source, source_id, 'payload', timestamp_precision=precision)
            storage.finish_source_event(event['id'], 'processed', transaction_id=tx_id)
        return tx_id
    return storage, add


def test_detects_a_cross_source_same_time_pair(ledger):
    storage, add = ledger
    a = add(10, '2026-06-01T12:00:00', source='gmail')
    b = add(10, '2026-06-01T12:00:30', source='uob_card')

    review = storage.get_duplicate_review()
    assert review['total'] == 1
    item = review['items'][0]
    assert {item['transaction_a']['id'], item['transaction_b']['id']} == {a, b}
    assert item['reason'] == 'same_merchant_amount_time_cross_source'


def test_excludes_same_source_pairs(ledger):
    storage, add = ledger
    add(10, '2026-06-01T12:00:00', source='gmail')
    add(10, '2026-06-01T12:00:30', source='gmail')
    assert storage.get_duplicate_review()['total'] == 0


def test_excludes_different_amount_currency_or_merchant(ledger):
    storage, add = ledger
    add(10, '2026-06-01T12:00:00', source='gmail')
    add(11, '2026-06-01T12:00:00', source='uob_card')  # different amount
    add(10, '2026-06-01T12:00:00', source='dbs_card', currency='USD')  # different currency
    add(10, '2026-06-01T12:00:00', source='ocbc_card', merchant='Other Shop')  # different merchant
    assert storage.get_duplicate_review()['total'] == 0


def test_excludes_date_only_or_unresolved_precision_evidence(ledger):
    storage, add = ledger
    add(10, '2026-06-01', source='gmail', precision=None)  # date-only, no time component
    add(10, '2026-06-01', source='uob_card', precision=None)
    assert storage.get_duplicate_review()['total'] == 0

    add(10, '2026-06-02T12:00:00', source='gmail', precision='date')  # timed string, imprecise evidence
    add(10, '2026-06-02T12:00:00', source='uob_card', precision='date')
    assert storage.get_duplicate_review()['total'] == 0


def test_excludes_pairs_far_apart_in_time(ledger):
    storage, add = ledger
    add(10, '2026-06-01T12:00:00', source='gmail')
    add(10, '2026-06-01T13:00:00', source='uob_card')  # an hour apart
    assert storage.get_duplicate_review()['total'] == 0


def test_excludes_already_merged_or_dismissed_pairs(ledger):
    storage, add = ledger
    a = add(10, '2026-06-01T12:00:00', source='gmail')
    b = add(10, '2026-06-01T12:00:30', source='uob_card')
    storage.dismiss_duplicate(a, b)
    assert storage.get_duplicate_review()['total'] == 0
    # Dismissing is order-independent.
    storage.dismiss_duplicate(b, a)  # no error, already dismissed


def test_merge_moves_evidence_trip_link_and_upcoming_match_then_deletes_loser(ledger):
    storage, add = ledger
    survivor = add(10, '2026-06-01T12:00:00', source='gmail')
    loser = add(10, '2026-06-01T12:00:30', source='uob_card')

    trip_id = storage.create_trip('Bali', '2026-06-01')
    storage.enlist_transaction(trip_id, loser)

    sub_id = storage.create_subscription('Cafe', 'monthly')
    upcoming_id = storage.create_upcoming_transaction(sub_id, '2026-06-01')
    storage.match_upcoming_transaction(upcoming_id, loser)

    storage.record_source_event('gmail', 'extra-evidence', 'payload')
    storage._conn.execute("UPDATE source_events SET transaction_id = ?, status = 'processed' WHERE source_id = 'extra-evidence'", (loser,))
    storage._conn.commit()

    merge_id = storage.merge_transactions(survivor, loser)
    assert merge_id

    assert storage.get_transaction(loser) is None
    assert [r['trip_id'] for r in storage._conn.execute(
        "SELECT trip_id FROM trip_transactions WHERE transaction_id = ?", (survivor,))] == [trip_id]
    upcoming = storage.get_upcoming_transaction(upcoming_id)
    assert upcoming['matched_transaction_id'] == survivor
    assert upcoming['status'] == 'matched'
    events = storage._conn.execute(
        "SELECT COUNT(*) FROM source_events WHERE transaction_id = ?", (survivor,)).fetchone()[0]
    assert events == 3  # the two ingest events plus the extra evidence row, all repointed
    assert storage.get_duplicate_review()['total'] == 0


def test_merge_repoints_refunds_that_pointed_at_the_loser(ledger):
    storage, add = ledger
    survivor = add(10, '2026-06-01T12:00:00', source='gmail')
    loser = add(10, '2026-06-01T12:00:30', source='uob_card')
    refund = add(10, '2026-06-05T12:00:00', source='gmail', tx_type='refund', precision=None)
    storage.update_transaction(refund, refund_of_transaction_id=loser)

    storage.merge_transactions(survivor, loser)
    assert storage.get_transaction(refund)['refund_of_transaction_id'] == survivor


def test_merge_rejects_self_or_missing_transactions(ledger):
    storage, add = ledger
    a = add(10, '2026-06-01T12:00:00', source='gmail')
    with pytest.raises(ValueError):
        storage.merge_transactions(a, a)
    with pytest.raises(ValueError):
        storage.merge_transactions(a, 999999)


def test_undo_merge_restores_the_loser_and_reverses_every_moved_link(ledger):
    storage, add = ledger
    survivor = add(10, '2026-06-01T12:00:00', source='gmail')
    loser = add(10, '2026-06-01T12:00:30', source='uob_card')

    trip_id = storage.create_trip('Bali', '2026-06-01')
    storage.enlist_transaction(trip_id, loser)
    sub_id = storage.create_subscription('Cafe', 'monthly')
    upcoming_id = storage.create_upcoming_transaction(sub_id, '2026-06-01')
    storage.match_upcoming_transaction(upcoming_id, loser)
    refund = add(10, '2026-06-05T12:00:00', source='gmail', tx_type='refund', precision=None)
    storage.update_transaction(refund, refund_of_transaction_id=loser)

    merge_id = storage.merge_transactions(survivor, loser)
    storage.undo_transaction_merge(merge_id)

    restored = storage.get_transaction(loser)
    assert restored is not None
    assert restored['source'] == 'uob_card'
    assert [r['trip_id'] for r in storage._conn.execute(
        "SELECT trip_id FROM trip_transactions WHERE transaction_id = ?", (survivor,))] == []
    assert [r['trip_id'] for r in storage._conn.execute(
        "SELECT trip_id FROM trip_transactions WHERE transaction_id = ?", (loser,))] == [trip_id]
    upcoming = storage.get_upcoming_transaction(upcoming_id)
    assert upcoming['matched_transaction_id'] == loser
    assert storage.get_transaction(refund)['refund_of_transaction_id'] == loser
    events = {r['transaction_id'] for r in storage._conn.execute(
        "SELECT DISTINCT transaction_id FROM source_events WHERE transaction_id IN (?, ?)", (survivor, loser))}
    assert events == {survivor, loser}

    with pytest.raises(ValueError):
        storage.undo_transaction_merge(merge_id)


def test_undo_does_not_clobber_an_upcoming_match_changed_after_the_merge(ledger):
    storage, add = ledger
    survivor = add(10, '2026-06-01T12:00:00', source='gmail')
    loser = add(10, '2026-06-01T12:00:30', source='uob_card')
    sub_id = storage.create_subscription('Cafe', 'monthly')
    upcoming_id = storage.create_upcoming_transaction(sub_id, '2026-06-01')
    storage.match_upcoming_transaction(upcoming_id, loser)

    merge_id = storage.merge_transactions(survivor, loser)
    # Something else re-matches this charge before the merge is undone.
    other = add(10, '2026-07-01T12:00:00', source='dbs_card', precision=None)
    storage._conn.execute(
        "UPDATE upcoming_transactions SET status='pending', matched_transaction_id=NULL WHERE id=?", (upcoming_id,))
    storage.match_upcoming_transaction(upcoming_id, other)

    storage.undo_transaction_merge(merge_id)
    assert storage.get_upcoming_transaction(upcoming_id)['matched_transaction_id'] == other
