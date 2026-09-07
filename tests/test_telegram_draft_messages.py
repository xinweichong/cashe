from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage, TransactionRequestConflict
from src.telegram_bot import TelegramBotService

DRAFT = {'amount': 12, 'currency': 'SGD', 'merchant': 'Cafe', 'category': 'Food', 'date': '2026-09-07'}
TEXT = 'spent 12 at Cafe'
TOKEN = 'a' * 32


def message(message_id=10, text=TEXT, chat_id=100):
    return SimpleNamespace(message=SimpleNamespace(
        chat_id=chat_id, message_id=message_id, text=text, reply_text=AsyncMock(),
    ))


def bot(storage):
    service = TelegramBotService(storage=storage, bot_token='test-token')
    service.llm_service = Mock(parse_telegram_message=Mock(return_value={**DRAFT, 'category_hint': 'Food', 'confidence': 1}))
    return service


def save(storage, token=TOKEN, message_id=10, chat_id=100, text=TEXT, **changes):
    return storage.save_telegram_draft(token, chat_id, {**DRAFT, **changes}, message_id=message_id, message_text=text)


@pytest.mark.asyncio
async def test_lost_card_reply_restart_reuses_original_draft_without_model(tmp_path):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    service = bot(storage)
    original = message()
    original.message.reply_text.side_effect = RuntimeError('lost reply')
    with pytest.raises(RuntimeError, match='lost reply'):
        await service._handle_nl_message(original, SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_called_once()
    draft = storage.get_telegram_draft_for_message(100, 10, TEXT)
    expiry = conn.execute('SELECT expires_at FROM telegram_drafts').fetchone()[0]
    conn.close()
    conn = init_db(path)
    try:
        storage = Storage(conn)
        service = bot(storage)
        service.llm_service = None
        replay = message()
        await service._handle_nl_message(replay, SimpleNamespace())
        assert storage.get_telegram_draft_for_message(100, 10, TEXT) == draft
        assert conn.execute('SELECT expires_at FROM telegram_drafts').fetchone()[0] == expiry
        buttons = replay.message.reply_text.call_args.kwargs['reply_markup'].inline_keyboard[0]
        assert buttons[0].callback_data == f"nl_confirm:{draft['_id']}"
        assert storage.query_transactions(limit=50) == []
    finally:
        conn.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['confirmed', 'deleted', 'canceled', 'replaced', 'expired'])
async def test_handled_message_never_revives_draft_or_calls_model(in_memory_db, state):
    storage = Storage(in_memory_db)
    save(storage)
    if state in ('confirmed', 'deleted'):
        tx_id, _ = storage.confirm_telegram_draft(TOKEN, {}, chat_id=100)
        if state == 'deleted':
            storage.delete_transaction(tx_id)
    elif state == 'canceled':
        storage.discard_telegram_draft(TOKEN, 100)
    elif state == 'replaced':
        save(storage, token='b' * 32, message_id=11, merchant='Newer')
    else:
        in_memory_db.execute('UPDATE telegram_drafts SET expires_at = 0')
        in_memory_db.commit()
    transactions = storage.query_transactions(limit=50)
    service = bot(storage)
    update = message()
    await service._handle_nl_message(update, SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_not_called()
    assert 'already handled' in update.message.reply_text.call_args.args[0]
    assert storage.query_transactions(limit=50) == transactions
    if state == 'replaced':
        assert storage.get_telegram_draft('b' * 32, 100)['merchant'] == 'Newer'
    else:
        assert storage.get_telegram_draft(TOKEN, 100) is None


@pytest.mark.asyncio
async def test_changed_message_cannot_replace_original_card(in_memory_db):
    storage = Storage(in_memory_db)
    original = save(storage)
    service = bot(storage)
    update = message(text='spent 99 at Elsewhere')
    await service._handle_nl_message(update, SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_not_called()
    assert storage.get_telegram_draft(TOKEN, 100) == original
    assert 'already handled' in update.message.reply_text.call_args.args[0]


@pytest.mark.asyncio
async def test_separate_identical_messages_remain_separate_drafts(in_memory_db):
    storage = Storage(in_memory_db)
    service = bot(storage)
    await service._handle_nl_message(message(), SimpleNamespace())
    first = storage.get_telegram_draft_for_message(100, 10, TEXT)
    await service._handle_nl_message(message(11), SimpleNamespace())
    second = storage.get_telegram_draft_for_message(100, 11, TEXT)
    assert first['_id'] != second['_id']
    assert service.llm_service.parse_telegram_message.call_count == 2
    with pytest.raises(TransactionRequestConflict):
        storage.get_telegram_draft_for_message(100, 10, TEXT)


@pytest.mark.parametrize('table', ['telegram_drafts', 'telegram_draft_messages'])
def test_failed_save_does_not_consume_message_or_erase_previous_draft(in_memory_db, table):
    storage = Storage(in_memory_db)
    storage.save_telegram_draft('b' * 32, 100, DRAFT)
    in_memory_db.execute(f"CREATE TRIGGER reject_write BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        save(storage)
    assert storage.get_telegram_draft_for_message(100, 10, TEXT) is None
    assert storage.get_telegram_draft('b' * 32, 100) is not None
    in_memory_db.execute('DROP TRIGGER reject_write')
    assert save(storage)['_id'] == TOKEN


def test_concurrent_save_reuses_accepted_proposal_and_token(in_memory_db):
    storage = Storage(in_memory_db)
    with ThreadPoolExecutor(max_workers=4) as pool:
        drafts = list(pool.map(lambda i: save(storage, token=f'{i:032x}', merchant=f'Parsed {i}'), range(8)))
    assert all(draft == drafts[0] for draft in drafts)
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_draft_messages').fetchone()[0] == 1
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_drafts').fetchone()[0] == 1


@pytest.mark.asyncio
async def test_unrecognized_message_does_not_reserve_identity(in_memory_db):
    storage = Storage(in_memory_db)
    service = bot(storage)
    parsed = service.llm_service.parse_telegram_message.return_value
    service.llm_service.parse_telegram_message.return_value = None
    await service._handle_nl_message(message(), SimpleNamespace())
    assert storage.get_telegram_draft_for_message(100, 10, TEXT) is None
    service.llm_service.parse_telegram_message.return_value = parsed
    await service._handle_nl_message(message(), SimpleNamespace())
    assert storage.get_telegram_draft_for_message(100, 10, TEXT) is not None


def test_receipts_exclude_raw_text_and_survive_draft_deletion(in_memory_db):
    storage = Storage(in_memory_db)
    save(storage)
    row = dict(in_memory_db.execute('SELECT * FROM telegram_draft_messages').fetchone())
    assert set(row) == {'message_key', 'fingerprint', 'draft_id'}
    assert len(row['message_key']) == len(row['fingerprint']) == 64
    assert TEXT not in str(row)
    storage.discard_telegram_draft(TOKEN, 100)
    assert dict(in_memory_db.execute('SELECT * FROM telegram_draft_messages').fetchone()) == row


def test_user_and_chat_message_id_isolation(tmp_path):
    connections = [init_db(str(tmp_path / f'{user}.db')) for user in ('alice', 'bob')]
    try:
        for conn, amount in zip(connections, (12, 20)):
            storage = Storage(conn)
            save(storage, amount=amount)
            save(storage, token='b' * 32, chat_id=200, amount=30)
            assert storage.get_telegram_draft_for_message(100, 10, TEXT)['amount'] == amount
            assert storage.get_telegram_draft_for_message(200, 10, TEXT)['amount'] == 30
    finally:
        for conn in connections:
            conn.close()
