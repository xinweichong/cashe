"""Direct-command retries retain one purchase across Telegram redelivery."""
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage, TransactionRequestConflict
from src.telegram_bot import TelegramBotService


def update(message_id=10, chat_id=100):
    return SimpleNamespace(message=SimpleNamespace(
        message_id=message_id, chat_id=chat_id, reply_text=AsyncMock(),
    ))


def request(storage, **changes):
    fields = dict(chat_id=100, message_id=10, command='add', args=['12', 'Cafe'],
                  source='manual', source_id='legacy-generated-id', amount=12,
                  transaction_date='2026-09-07T12:00:00', merchant='Cafe',
                  assign_to_active_trip=True)
    return storage.create_telegram_transaction(**{**fields, **changes})


def active_trip(storage, name):
    storage.set_setting('trips_enabled', 'true')
    trip_id = storage.create_trip(name, '2026-09-01')
    storage.activate_trip(trip_id)
    return trip_id


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['add', 'cash', 'income'])
async def test_lost_reply_and_restart_replay_one_purchase(tmp_path, monkeypatch, command):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    trip_id = active_trip(storage, 'Original')
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    monkeypatch.setattr(bot, '_local_now', lambda: datetime(2026, 9, 7, 12))
    original = update()
    original.message.reply_text.side_effect = RuntimeError('lost reply')
    args = SimpleNamespace(args=['12', 'Cafe'])
    with pytest.raises(RuntimeError, match='lost reply'):
        await getattr(bot, f'_{command}')(original, args)
    tx = storage.query_transactions(limit=50)[0]
    evidence = storage.get_source_event(tx['source'], tx['source_id'])
    storage.update_transaction(tx['id'], merchant='Corrected', amount=20)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        later = active_trip(storage, 'Later')
        bot = TelegramBotService(storage=storage, bot_token='test-token')
        monkeypatch.setattr(bot, '_local_now', lambda: datetime(2026, 9, 8, 13))
        replay = update()
        await getattr(bot, f'_{command}')(replay, args)
        assert replay.message.reply_text.call_args.args[0] == f"Already logged. Transaction {tx['id']}."
        rows = storage.query_transactions(limit=50)
        assert len(rows) == 1
        assert rows[0]['amount'] == 20
        assert rows[0]['merchant'] == 'Corrected'
        assert rows[0]['transaction_date'] == tx['transaction_date']
        assert storage.get_source_event(tx['source'], tx['source_id']) == evidence
        assert storage.is_in_trip(trip_id, tx['id']) == (command != 'income')
        assert not storage.is_in_trip(later, tx['id'])
        assert conn.execute('SELECT COUNT(*) FROM ingestion_outbox').fetchone()[0] == (command != 'income')
        storage.delete_transaction(tx['id'])
        await getattr(bot, f'_{command}')(replay, args)
        assert 'Check Activity' in replay.message.reply_text.call_args.args[0]
        assert storage.query_transactions(limit=50) == []
    finally:
        conn.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['add', 'cash', 'income'])
async def test_distinct_messages_in_same_second_are_distinct_purchases(in_memory_db, monkeypatch, command):
    storage = Storage(in_memory_db)
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    monkeypatch.setattr(bot, '_local_now', lambda: datetime(2026, 9, 7, 12))
    for message_id in (10, 11):
        await getattr(bot, f'_{command}')(update(message_id), SimpleNamespace(args=['12', 'Cafe']))
    rows = storage.query_transactions(limit=50)
    assert len(rows) == 2
    assert len({row['source_id'] for row in rows}) == 2
    assert all(row['source_id'].startswith('telegram-') for row in rows)
    assert all('telegram-100-' not in row['source_id'] for row in rows)


@pytest.mark.asyncio
async def test_replay_ignores_changed_fx_and_categorizer(in_memory_db):
    storage = Storage(in_memory_db)
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    bot.exchange_service = Mock(get_rate=Mock(return_value=1.3))
    bot.categorizer = Mock(categorize=Mock(return_value=('Food', 'default')))
    args = SimpleNamespace(args=['12', 'USD', 'Cafe'])
    await bot._add(update(), args)
    original = storage.query_transactions(limit=50)[0]
    bot.exchange_service.get_rate.return_value = 1.5
    bot.categorizer.categorize.return_value = ('Other', 'default')
    await bot._add(update(), args)
    assert storage.query_transactions(limit=50) == [original]


@pytest.mark.asyncio
@pytest.mark.parametrize('changed', [['20', 'Cafe'], ['12', 'Other']])
async def test_changed_message_is_not_another_creation(in_memory_db, changed):
    storage = Storage(in_memory_db)
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    message = update()
    await bot._add(message, SimpleNamespace(args=['12', 'Cafe']))
    await bot._add(message, SimpleNamespace(args=changed))
    assert 'Check Activity' in message.message.reply_text.call_args.args[0]
    assert len(storage.query_transactions(limit=50)) == 1


def test_command_edits_and_web_namespace_cannot_reuse_identity(in_memory_db):
    storage = Storage(in_memory_db)
    request(storage)
    with pytest.raises(TransactionRequestConflict):
        request(storage, command='income', tx_type='income')
    with pytest.raises(ValueError, match='Invalid Idempotency-Key'):
        storage.create_web_transaction({'amount': 12}, source_id='web', request_key='telegram:100:10')
    web = storage.create_web_transaction({'amount': 12}, source_id='web', request_key='telegram-100-10')
    assert web['id'] != request(storage)[0]


@pytest.mark.parametrize('table', ['transaction_requests', 'source_events', 'ingestion_outbox'])
def test_receipt_purchase_evidence_and_trip_job_commit_together(in_memory_db, table):
    storage = Storage(in_memory_db)
    active_trip(storage, 'Original')
    in_memory_db.execute(f"CREATE TRIGGER reject_write BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        request(storage)
    for table_name in ('transaction_requests', 'source_events', 'ingestion_outbox', 'transactions'):
        assert in_memory_db.execute(f'SELECT COUNT(*) FROM {table_name}').fetchone()[0] == 0
    in_memory_db.execute('DROP TRIGGER reject_write')
    assert request(storage)[1] is False
    assert request(storage)[1] is True


@pytest.mark.asyncio
async def test_failed_validation_can_be_corrected_and_does_not_reserve_message(in_memory_db):
    storage = Storage(in_memory_db)
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    await bot._add(update(), SimpleNamespace(args=['nan', 'Cafe']))
    assert in_memory_db.execute('SELECT COUNT(*) FROM transaction_requests').fetchone()[0] == 0
    await bot._add(update(), SimpleNamespace(args=['12', 'Cafe']))
    assert len(storage.query_transactions(limit=50)) == 1


def test_separate_chats_can_reuse_message_ids(in_memory_db):
    storage = Storage(in_memory_db)
    first, _ = request(storage, chat_id=100)
    second, _ = request(storage, chat_id=-200)
    assert first != second


def test_concurrent_delivery_commits_once(in_memory_db):
    from concurrent.futures import ThreadPoolExecutor
    storage = Storage(in_memory_db)
    active_trip(storage, 'Original')
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: request(storage), range(8)))
    assert len({tx_id for tx_id, _ in results}) == 1
    assert sum(not replayed for _, replayed in results) == 1
    for table in ('transaction_requests', 'source_events', 'ingestion_outbox', 'transactions'):
        assert in_memory_db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 1


@pytest.mark.asyncio
async def test_retry_dispatches_original_failed_trip_job(in_memory_db, monkeypatch):
    storage = Storage(in_memory_db)
    original_trip = active_trip(storage, 'Original')
    bot = TelegramBotService(storage=storage, bot_token='test-token')
    enlist = storage.enlist_transaction
    monkeypatch.setattr(storage, 'enlist_transaction', Mock(side_effect=RuntimeError('failed')))
    await bot._add(update(), SimpleNamespace(args=['12', 'Cafe']))
    tx = storage.query_transactions(limit=50)[0]
    assert storage.list_ingestion_effects()[0]['status'] == 'failed'
    later_trip = active_trip(storage, 'Later')
    monkeypatch.setattr(storage, 'enlist_transaction', enlist)
    await bot._add(update(), SimpleNamespace(args=['12', 'Cafe']))
    assert storage.is_in_trip(original_trip, tx['id'])
    assert not storage.is_in_trip(later_trip, tx['id'])
    assert storage.list_ingestion_effects() == []
    assert in_memory_db.execute('SELECT COUNT(*) FROM ingestion_outbox').fetchone()[0] == 1


@pytest.mark.asyncio
async def test_linked_user_routing_and_unlinked_chat_rejection(tmp_path):
    connections = [init_db(str(tmp_path / f'{user}.db')) for user in ('alice', 'bob')]
    contexts = {chat: SimpleNamespace(storage=Storage(conn), categorizer=None, poller=None)
                for chat, conn in zip((100, 200), connections)}
    bot = TelegramBotService(bot_token='test-token', admin_storage=Mock())
    bot.user_manager = SimpleNamespace(get_by_chat_id=contexts.get)
    try:
        for chat, amount in ((100, '12'), (200, '20')):
            await bot._add(update(chat_id=chat), SimpleNamespace(args=[amount, 'Cafe']))
            await bot._add(update(chat_id=chat), SimpleNamespace(args=[amount, 'Cafe']))
            rows = contexts[chat].storage.query_transactions(limit=50)
            assert len(rows) == 1
            assert rows[0]['amount'] == float(amount)
        unlinked = update(chat_id=300)
        await bot._add(unlinked, SimpleNamespace(args=['30', 'Cafe']))
        assert 'link your account' in unlinked.message.reply_text.call_args.args[0]
        assert all(conn.execute('SELECT COUNT(*) FROM transaction_requests').fetchone()[0] == 1
                   for conn in connections)
    finally:
        for conn in connections:
            conn.close()
