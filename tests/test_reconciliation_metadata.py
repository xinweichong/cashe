import json
from dataclasses import asdict

import pytest

from src.ingestion import IngestionPipeline
from src.parsers.apple_wallet import AppleWalletParser
from src.parsers.base import ParseResult
from src.parsers.uob import UobParser
from src.storage import Storage


def timed(source='apple_wallet', source_id='wallet-1', **changes):
    fields = dict(source=source, source_id=source_id, amount=12.5, merchant='Cafe',
                  transaction_date='2026-09-06T00:00:00', timestamp_precision='second')
    fields.update(changes)
    return ParseResult(**fields)


@pytest.fixture
def storage(in_memory_db):
    return Storage(in_memory_db)


@pytest.mark.parametrize('wallet_first', [True, False])
def test_date_only_uob_alert_does_not_merge_with_midnight_wallet(storage, wallet_first):
    email = UobParser().parse('A transaction of SGD 12.50 was made with your UOB Card ending 1234 '
                             'on 06/09/26 at Cafe. If unauthorised, contact us.')
    email.source_id = 'email-1'
    assert email.transaction_date == '2026-09-06T00:00:00'
    assert email.timestamp_precision == 'date'
    wallet = AppleWalletParser().parse({'amount': '12.50', 'merchant': 'Cafe', 'date': '2026-09-06T00:00:00'})
    assert wallet.timestamp_precision == 'second'
    pipeline = IngestionPipeline(storage)
    for result in ([wallet, email] if wallet_first else [email, wallet]):
        assert pipeline.ingest(result) is not None
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 2


@pytest.mark.parametrize('precision', ['date', 'unknown'])
@pytest.mark.parametrize('imprecise_first', [True, False])
def test_imprecise_observation_cannot_match_timed_purchase(storage, precision, imprecise_first):
    imprecise = timed('uob_card', 'email-1', timestamp_precision=precision)
    results = [imprecise, timed()] if imprecise_first else [timed(), imprecise]
    pipeline = IngestionPipeline(storage)
    assert all(pipeline.ingest(result) is not None for result in results)


def test_genuine_midnight_times_still_reconcile(storage):
    pipeline = IngestionPipeline(storage)
    first = pipeline.ingest(timed())
    assert pipeline.ingest(timed('dbs_paylah', 'email-1', timestamp_precision='minute')) is None
    assert storage.get_source_event('dbs_paylah', 'email-1')['transaction_id'] == first['id']


def test_legacy_transaction_without_timing_evidence_stays_separate(storage):
    tx_id = storage.insert_transaction(source='apple_wallet', source_id='legacy', amount=12.5,
                                      merchant='Cafe', transaction_date='2026-09-06T00:00:00')
    event = storage.record_source_event('apple_wallet', 'legacy', '{}')
    storage.finish_source_event(event['id'], 'processed', tx_id)
    result = IngestionPipeline(storage).ingest(timed('dbs_paylah', 'new-email'))
    assert result is not None and result['id'] != tx_id


@pytest.mark.parametrize(('kind', 'identity', 'merges'), [
    ('wallet_card_label', 'personal visa', True),
    ('wallet_card_label', 'work visa', False),
    ('uob_card_last4', '1234', True),
    (None, None, True),
])
def test_payment_identity_conflicts_only_within_same_namespace(storage, kind, identity, merges):
    pipeline = IngestionPipeline(storage)
    pipeline.ingest(timed(payment_identity_kind='wallet_card_label', payment_identity='personal visa'))
    result = pipeline.ingest(timed('dbs_paylah', 'email-1', payment_identity_kind=kind, payment_identity=identity))
    assert (result is None) == merges


def test_identifier_can_disambiguate_otherwise_identical_candidates(storage):
    pipeline = IngestionPipeline(storage)
    first = pipeline.ingest(timed(payment_identity_kind='wallet_card_label', payment_identity='personal visa'))
    pipeline.ingest(timed(source_id='wallet-2', payment_identity_kind='wallet_card_label', payment_identity='work visa'))
    assert pipeline.ingest(timed('dbs_paylah', 'email-1', payment_identity_kind='wallet_card_label', payment_identity='personal visa')) is None
    assert storage.get_source_event('dbs_paylah', 'email-1')['transaction_id'] == first['id']


def test_pending_metadata_survives_replay(storage):
    result = timed(payment_identity_kind='wallet_card_label', payment_identity='personal visa')
    storage.record_source_event(result.source, result.source_id, json.dumps(asdict(result)),
                                timestamp_precision=result.timestamp_precision,
                                payment_identity_kind=result.payment_identity_kind,
                                payment_identity=result.payment_identity)
    IngestionPipeline(storage).retry_pending()
    event = storage.get_source_event(result.source, result.source_id)
    assert event['status'] == 'processed'
    assert event['timestamp_precision'] == 'second'
    assert event['payment_identity_kind'] == 'wallet_card_label'
    assert event['payment_identity'] == 'personal visa'


@pytest.mark.parametrize(('date', 'precision'), [
    ('06/09/2026 00:00:00', 'second'),
    ('2026-09-06T00:00:00', 'second'),
    ('2026-09-06T12:34', 'minute'),
    ('2026-09-06T12:34:56+08:00', 'second'),
    ('2026-09-06', 'date'),
    ('2026-99-99T00:00:00', 'unknown'),
    ('not a date', 'unknown'),
    (None, 'unknown'),
])
def test_wallet_precision_and_label_preserve_legacy_hash(date, precision):
    import hashlib
    result = AppleWalletParser().parse({'amount': '12.50', 'merchant': 'Cafe', 'date': date,
                                       'card': '  PERSONAL   Visa  '})
    assert result.timestamp_precision == precision
    assert result.payment_identity_kind == 'wallet_card_label'
    assert result.payment_identity == 'personal visa'
    assert result.source_id == hashlib.sha256(f'Cafe:12.5::{date}'.encode()).hexdigest()[:16]


def test_uob_reversal_has_minute_precision_and_physical_card_suffix():
    result = UobParser().parse('A transaction of 12.50 SGD made with your UOB card ending 1234 '
                             'on 6 Sep 26, 12:00AM at Cafe has been reversed')
    assert result.timestamp_precision == 'minute'
    assert result.payment_identity_kind == 'uob_card_last4'
    assert result.payment_identity == '1234'
    assert result.transaction_date == '2026-09-06T00:00:00'


def test_invalid_uob_time_is_not_promoted_to_precise_midnight():
    result = UobParser().parse('A transaction of 12.50 SGD made with your UOB card ending 1234 '
                             'on 6 Sep 26, 99:99AM at Cafe has been reversed')
    assert result.timestamp_precision == 'unknown'
