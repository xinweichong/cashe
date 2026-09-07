from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage
from src.telegram_bot import TelegramBotService

DRAFT = {'amount': 12, 'currency': 'SGD', 'merchant': 'Cafe', 'category': 'Food', 'date': '2026-09-07'}
TOKEN = 'a' * 32


def callback(action='confirm'):
    return SimpleNamespace(effective_chat=SimpleNamespace(id=100), callback_query=SimpleNamespace(
        data=f'nl_{action}:{TOKEN}', answer=AsyncMock(), edit_message_text=AsyncMock(),
    ))


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['confirm', 'edit', 'cancel'])
async def test_saved_card_survives_restart_without_user_data(tmp_path, action):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    storage.save_telegram_draft(TOKEN, 100, DRAFT)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        storage.set_setting('trips_enabled', 'true')
        trip = storage.create_trip('Active at confirmation', '2026-09-01')
        storage.activate_trip(trip)
        bot = TelegramBotService(storage=storage, bot_token='test-token')
        await bot._handle_nl_callback(callback(action), SimpleNamespace(user_data={}))
        rows = storage.query_transactions(limit=50)
        assert len(rows) == (action == 'confirm')
        if rows:
            assert rows[0]['merchant'] == 'Cafe'
            assert storage.is_in_trip(trip, rows[0]['id'])
        assert storage.get_telegram_draft(TOKEN, 100) is None
        await bot._handle_nl_callback(callback(action), SimpleNamespace(user_data={}))
        assert storage.query_transactions(limit=50) == rows
    finally:
        conn.close()


def test_expiry_is_absolute_and_reads_do_not_extend_it(in_memory_db, monkeypatch):
    import src.storage as module
    current = [datetime(2026, 9, 7, 12, tzinfo=timezone.utc)]
    monkeypatch.setattr(module, 'local_now', lambda: current[0])
    storage = Storage(in_memory_db)
    storage.save_telegram_draft(TOKEN, 100, DRAFT)
    expires = in_memory_db.execute('SELECT expires_at FROM telegram_drafts').fetchone()[0]
    current[0] += timedelta(hours=24, seconds=-1)
    assert storage.get_telegram_draft(TOKEN, 100) is not None
    assert in_memory_db.execute('SELECT expires_at FROM telegram_drafts').fetchone()[0] == expires
    current[0] += timedelta(seconds=1)
    assert storage.get_telegram_draft(TOKEN, 100) is None
    with pytest.raises(ValueError, match='expired or unavailable'):
        storage.confirm_telegram_draft(TOKEN, DRAFT, chat_id=100)
    assert storage.query_transactions(limit=50) == []
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_drafts').fetchone()[0] == 0


@pytest.mark.parametrize('table,operation', [('transaction_requests', 'INSERT'), ('source_events', 'INSERT'),
                                             ('ingestion_outbox', 'INSERT'), ('telegram_drafts', 'DELETE')])
def test_acceptance_failure_keeps_draft_and_rolls_back_capture(in_memory_db, table, operation):
    storage = Storage(in_memory_db)
    storage.set_setting('trips_enabled', 'true')
    storage.activate_trip(storage.create_trip('Original', '2026-09-01'))
    storage.save_telegram_draft(TOKEN, 100, DRAFT)
    in_memory_db.execute(f"CREATE TRIGGER reject_write BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        storage.confirm_telegram_draft(TOKEN, {}, chat_id=100)
    for name in ('transactions', 'source_events', 'transaction_requests', 'ingestion_outbox'):
        assert in_memory_db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0] == 0
    assert storage.get_telegram_draft(TOKEN, 100) is not None
    in_memory_db.execute('DROP TRIGGER reject_write')
    tx_id, replayed = storage.confirm_telegram_draft(TOKEN, {}, chat_id=100)
    assert not replayed
    assert storage.get_transaction(tx_id)['amount'] == 12
    assert storage.get_telegram_draft(TOKEN, 100) is None


def test_wrong_chat_and_stale_token_cannot_consume_active_draft(in_memory_db):
    storage = Storage(in_memory_db)
    storage.save_telegram_draft(TOKEN, 100, DRAFT)
    assert storage.get_telegram_draft(TOKEN, 200) is None
    with pytest.raises(ValueError):
        storage.confirm_telegram_draft(TOKEN, DRAFT, chat_id=200)
    storage.discard_telegram_draft(TOKEN, 200)
    assert storage.get_telegram_draft(TOKEN, 100) is not None
    storage.save_telegram_draft('b' * 32, 100, DRAFT)
    storage.discard_telegram_draft(TOKEN, 100)
    assert storage.get_telegram_draft(TOKEN, 100) is None
    assert storage.get_telegram_draft('b' * 32, 100) is not None


def test_failed_replacement_keeps_previous_draft(in_memory_db):
    storage = Storage(in_memory_db)
    storage.save_telegram_draft(TOKEN, 100, DRAFT)
    storage.save_telegram_draft('b' * 32, 200, DRAFT)
    with pytest.raises(sqlite3.IntegrityError):
        storage.save_telegram_draft(TOKEN, 200, {**DRAFT, 'merchant': 'Changed'})
    assert storage.get_telegram_draft('b' * 32, 200)['merchant'] == 'Cafe'
    assert storage.get_telegram_draft(TOKEN, 100)['merchant'] == 'Cafe'


def test_confirmation_uses_saved_fields_and_does_not_record_extra_metadata(in_memory_db):
    storage = Storage(in_memory_db)
    storage.save_telegram_draft(TOKEN, 100, {**DRAFT, 'raw_text': 'not retained', '_username': 'private'})
    payload = in_memory_db.execute('SELECT payload FROM telegram_drafts').fetchone()[0]
    assert 'raw_text' not in payload
    assert '_username' not in payload
    tx_id, _ = storage.confirm_telegram_draft(TOKEN, {**DRAFT, 'amount': 999}, chat_id=100)
    assert storage.get_transaction(tx_id)['amount'] == 12
    evidence = storage.get_source_event('manual', f'telegram-nl-{TOKEN}')['payload']
    assert 'raw_text' not in evidence
    assert '_username' not in evidence


def test_same_token_and_chat_are_isolated_by_user_database(tmp_path):
    connections = [init_db(str(tmp_path / f'{user}.db')) for user in ('alice', 'bob')]
    try:
        for conn, amount in zip(connections, (12, 20)):
            Storage(conn).save_telegram_draft(TOKEN, 100, {**DRAFT, 'amount': amount})
        Storage(connections[0]).confirm_telegram_draft(TOKEN, {}, chat_id=100)
        assert Storage(connections[1]).get_telegram_draft(TOKEN, 100)['amount'] == 20
        assert Storage(connections[1]).query_transactions(limit=50) == []
    finally:
        for conn in connections:
            conn.close()
