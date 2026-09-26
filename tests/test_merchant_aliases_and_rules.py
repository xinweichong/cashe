from itertools import count

import pytest

from src.storage import Storage


@pytest.fixture
def ledger(in_memory_db):
    storage = Storage(in_memory_db)
    sequence = count()
    def add(amount, merchant='Cafe', category='Food', tx_type='expense', **changes):
        values = dict(source='manual', source_id=f'test-{next(sequence)}', amount=amount,
                      transaction_date='2026-06-01T12:00:00', merchant=merchant, category=category, tx_type=tx_type)
        values.update(changes)
        return storage.insert_transaction(**values)
    return storage, add


def test_alias_overlays_merchant_list_and_profile_without_touching_raw_merchant(ledger):
    storage, add = ledger
    add(10)
    storage.set_merchant_alias('Cafe', 'The Corner Cafe')

    listed = storage.get_merchant_list()
    assert listed[0]['merchant'] == 'Cafe'
    assert listed[0]['display_name'] == 'The Corner Cafe'

    profile = storage.get_merchant_profile('Cafe')
    assert profile['merchant'] == 'Cafe'
    assert profile['display_name'] == 'The Corner Cafe'


def test_merchant_without_an_alias_falls_back_to_its_own_name(ledger):
    storage, add = ledger
    add(10)
    assert storage.get_merchant_list()[0]['display_name'] == 'Cafe'
    assert storage.get_merchant_profile('Cafe')['display_name'] == 'Cafe'


def test_clearing_an_alias_reverts_display_name_to_the_raw_merchant(ledger):
    storage, add = ledger
    add(10)
    storage.set_merchant_alias('Cafe', 'The Corner Cafe')
    storage.set_merchant_alias('Cafe', '')
    assert storage.get_merchant_list()[0]['display_name'] == 'Cafe'


def test_rule_impact_counts_only_transactions_with_a_different_category(ledger):
    storage, add = ledger
    add(10, category='Food')
    add(10, category='Groceries')
    add(10, category=None)
    add(10, category='Food')  # already matches, not counted
    add(10, category='Groceries', tx_type='transfer')  # transfers never counted

    assert storage.get_category_rule_impact('Cafe', 'Food') == 2


def test_apply_category_rule_updates_only_differing_transactions_and_records_mutations(ledger):
    storage, add = ledger
    matches_already = add(10, category='Food')
    differs = add(10, category='Groceries')
    missing = add(10, category=None)
    other_merchant = add(10, merchant='Other Shop', category='Groceries')

    updated = storage.apply_category_rule_to_existing('Cafe', 'Food')
    assert updated == 2
    assert storage.get_transaction(matches_already)['revision'] == 1  # untouched, no-op
    assert storage.get_transaction(differs)['category'] == 'Food'
    assert storage.get_transaction(differs)['revision'] == 2
    assert storage.get_transaction(missing)['category'] == 'Food'
    assert storage.get_transaction(other_merchant)['category'] == 'Groceries'

    # Reuses the normal correction path, so per-transaction undo still works.
    storage.undo_last_mutation(differs)
    assert storage.get_transaction(differs)['category'] == 'Groceries'


def test_apply_category_rule_is_a_noop_when_nothing_differs(ledger):
    storage, add = ledger
    add(10, category='Food')
    assert storage.apply_category_rule_to_existing('Cafe', 'Food') == 0
