"""Confirmation cards bind one user's one draft to one accepted purchase."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import sqlite3

import pytest

from src.main import init_db
from src.storage import Storage, TransactionRequestConflict
from src.telegram_bot import TelegramBotService


DRAFT = {'amount': 12, 'currency': 'USD', 'merchant': 'Cafe', 'category': 'Food', 'date': '2026-09-07'}
TOKEN = 'a' * 32


def callback(action='confirm', token=TOKEN, chat_id=100):
    return SimpleNamespace(effective_chat=SimpleNamespace(id=chat_id), callback_query=SimpleNamespace(
        data=f'nl_{action}:{token}', answer=AsyncMock(), edit_message_text=AsyncMock(),
    ))


def pending(token=TOKEN):
    return {**DRAFT, '_id': token, '_chat_id': 100, '_username': None}


@pytest.fixture
def bot(in_memory_db):
    return TelegramBotService(storage=Storage(in_memory_db), bot_token='test-token')


@pytest.mark.asyncio
async def test_generated_cards_have_distinct_bound_tokens(bot):
    bot.llm_service = Mock(parse_telegram_message=Mock(return_value={**DRAFT, 'confidence': 1}))
    context = SimpleNamespace(user_data={})
    update = SimpleNamespace(message=SimpleNamespace(chat_id=100, text='12 Cafe', reply_text=AsyncMock()))
    await bot._handle_nl_message(update, context)
    first = context.user_data['nl_pending']
    first_buttons = update.message.reply_text.call_args.kwargs['reply_markup'].inline_keyboard[0]
    assert [b.callback_data for b in first_buttons] == [f'nl_{action}:{first["_id"]}' for action in ('confirm', 'edit', 'cancel')]
    assert all(len(b.callback_data.encode()) <= 64 for b in first_buttons)
    assert first['_chat_id'] == 100
    await bot._handle_nl_message(update, context)
    assert context.user_data['nl_pending']['_id'] != first['_id']


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['confirm', 'edit', 'cancel'])
async def test_old_card_cannot_save_or_clear_new_draft(bot, action):
    current = pending('b' * 32)
    context = SimpleNamespace(user_data={'nl_pending': current})
    update = callback(action)
    await bot._handle_nl_callback(update, context)
    assert context.user_data['nl_pending'] is current
    assert bot.storage.query_transactions(limit=50) == []
    assert 'no longer available' in update.callback_query.edit_message_text.call_args.args[0]


@pytest.mark.asyncio
@pytest.mark.parametrize('mismatch', ['chat', 'user', 'legacy', 'expired'])
async def test_wrong_owner_and_unbound_or_expired_cards_cannot_create(bot, mismatch):
    draft = pending()
    if mismatch == 'user':
        draft['_username'] = 'another-user'
    context = SimpleNamespace(user_data={} if mismatch == 'expired' else {'nl_pending': draft})
    update = callback(chat_id=200 if mismatch == 'chat' else 100)
    if mismatch == 'legacy':
        update.callback_query.data = 'nl_confirm'
    await bot._handle_nl_callback(update, context)
    assert bot.storage.query_transactions(limit=50) == []
    if mismatch != 'expired':
        assert context.user_data['nl_pending'] is draft


@pytest.mark.asyncio
async def test_lost_success_reply_and_repeated_taps_do_not_recreate(bot):
    context = SimpleNamespace(user_data={'nl_pending': pending()})
    update = callback()
    update.callback_query.edit_message_text.side_effect = RuntimeError('lost reply')
    with pytest.raises(RuntimeError, match='lost reply'):
        await bot._handle_nl_callback(update, context)
    original = bot.storage.query_transactions(limit=50)
    assert len(original) == 1
    assert context.user_data == {}
    replay = callback()
    await bot._handle_nl_callback(replay, context)
    assert 'Check Activity' in replay.callback_query.edit_message_text.call_args.args[0]
    assert bot.storage.query_transactions(limit=50) == original


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['confirm', 'edit', 'cancel'])
async def test_reply_completion_does_not_clear_newer_draft(bot, action):
    context = SimpleNamespace(user_data={'nl_pending': pending()})
    next_draft = pending('b' * 32)
    update = callback(action)
    async def replace_draft(*args, **kwargs):
        context.user_data['nl_pending'] = next_draft
    update.callback_query.edit_message_text.side_effect = replace_draft
    await bot._handle_nl_callback(update, context)
    assert context.user_data['nl_pending'] is next_draft
    assert len(bot.storage.query_transactions(limit=50)) == (action == 'confirm')


def test_restart_replay_preserves_corrections_evidence_and_original_trip(tmp_path):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    storage.set_setting('trips_enabled', 'true')
    original_trip = storage.create_trip('Original', '2026-09-01')
    storage.activate_trip(original_trip)
    tx_id, replayed = storage.confirm_telegram_draft(TOKEN, DRAFT, 1.3)
    assert not replayed
    original = storage.get_source_event('manual', f'telegram-nl-{TOKEN}')
    storage.update_transaction(tx_id, merchant='Corrected', amount=20)
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        later = storage.create_trip('Later', '2026-09-08')
        storage.activate_trip(later)
        assert storage.confirm_telegram_draft(TOKEN, DRAFT, 1.5) == (tx_id, True)
        from src.ingestion import IngestionPipeline
        IngestionPipeline(storage).retry_pending()
        assert storage.is_in_trip(original_trip, tx_id)
        assert not storage.is_in_trip(later, tx_id)
        assert storage.get_transaction(tx_id)['amount'] == 20
        assert storage.get_transaction(tx_id)['exchange_rate'] == 1.3
        assert storage.get_source_event('manual', f'telegram-nl-{TOKEN}') == original
        with pytest.raises(TransactionRequestConflict):
            storage.confirm_telegram_draft(TOKEN, {**DRAFT, 'amount': 15})
        storage.delete_transaction(tx_id)
        with pytest.raises(TransactionRequestConflict, match='deleted'):
            storage.confirm_telegram_draft(TOKEN, DRAFT)
        assert storage.query_transactions(limit=50) == []
    finally:
        conn.close()


@pytest.mark.parametrize('table', ['transaction_requests', 'source_events', 'ingestion_outbox'])
def test_draft_acceptance_is_atomic(in_memory_db, table):
    storage = Storage(in_memory_db)
    storage.set_setting('trips_enabled', 'true')
    storage.activate_trip(storage.create_trip('Original', '2026-09-01'))
    in_memory_db.execute(f"CREATE TRIGGER reject_write BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        storage.confirm_telegram_draft(TOKEN, DRAFT)
    for name in ('transactions', 'source_events', 'transaction_requests', 'ingestion_outbox'):
        assert in_memory_db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0] == 0
    in_memory_db.execute('DROP TRIGGER reject_write')
    assert storage.confirm_telegram_draft(TOKEN, DRAFT)[1] is False


@pytest.mark.asyncio
async def test_validation_failure_retains_only_matching_edit_cancel_actions(bot):
    context = SimpleNamespace(user_data={'nl_pending': {**pending(), 'amount': -1}})
    update = callback()
    await bot._handle_nl_callback(update, context)
    assert context.user_data['nl_pending']['_id'] == TOKEN
    markup = update.callback_query.edit_message_text.call_args.kwargs['reply_markup']
    assert [b.callback_data for b in markup.inline_keyboard[0]] == [f'nl_edit:{TOKEN}', f'nl_cancel:{TOKEN}']
    assert bot.storage.query_transactions(limit=50) == []
    assert bot.storage._conn.execute('SELECT COUNT(*) FROM transaction_requests').fetchone()[0] == 0
