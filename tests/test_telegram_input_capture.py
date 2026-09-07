import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from src.ingestion import IngestionPipeline
from src.main import init_db
from src.storage import Storage, TransactionRequestConflict
from src.telegram_bot import TelegramBotService

TEXT = '  spent 12 at Private Cafe\n'
PARSED = {'amount': 12, 'currency': 'SGD', 'merchant': 'Cafe', 'category_hint': 'Food', 'date': '2026-09-07', 'confidence': 1}


def update(text=TEXT):
    return SimpleNamespace(message=SimpleNamespace(chat_id=100, message_id=10, text=text, reply_text=AsyncMock()))


def setup(storage):
    service = TelegramBotService(storage=storage, bot_token='test-token')
    service.llm_service = Mock(parse_telegram_message=Mock(return_value=PARSED))
    return service


def event(storage):
    return dict(storage._conn.execute("SELECT * FROM source_events WHERE source = 'telegram_nl'").fetchone())


@pytest.mark.asyncio
async def test_original_input_is_committed_before_parsing_and_linked_only_on_confirmation(in_memory_db):
    storage = Storage(in_memory_db)
    service = setup(storage)
    def parse(*args):
        raw = event(storage)
        assert json.loads(raw['payload']) == {'text': TEXT}
        assert raw['status'] == 'pending'
        assert raw['attempts'] == 1
        assert raw['parser_version'] == 'telegram-nl:1'
        assert raw['timestamp_precision'] == 'unknown'
        return PARSED
    service.llm_service.parse_telegram_message.side_effect = parse
    await service._handle_nl_message(update(), SimpleNamespace())
    raw = event(storage)
    assert raw['status'] == 'processed'
    assert raw['transaction_id'] is None
    draft = storage.get_telegram_draft_for_message(100, 10, TEXT.strip())
    tx_id, _ = storage.confirm_telegram_draft(draft['_id'], {}, chat_id=100)
    assert event(storage)['transaction_id'] == tx_id
    assert storage.get_transaction_provenance(tx_id) == {'transaction_id': tx_id, 'sources': [{'channel': 'manual', 'evidence_recorded': True}]}
    storage.update_transaction(tx_id, merchant='Corrected')
    storage.delete_transaction(tx_id)
    assert event(storage)['payload'] == raw['payload']
    assert event(storage)['transaction_id'] == tx_id


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['exception', 'unrecognized', 'missing_amount'])
async def test_failed_and_unrecognized_inputs_are_private_and_not_generically_replayed(in_memory_db, failure):
    storage = Storage(in_memory_db)
    service = setup(storage)
    if failure == 'exception':
        service.llm_service.parse_telegram_message.side_effect = RuntimeError(TEXT)
    else:
        service.llm_service.parse_telegram_message.return_value = None if failure == 'unrecognized' else {'confidence': 1}
    message = update()
    await service._handle_nl_message(message, SimpleNamespace())
    original = event(storage)
    assert original['status'] == ('failed' if failure == 'exception' else 'unrecognized')
    assert original['attempts'] == 1
    assert TEXT not in original['error_code']
    assert TEXT not in message.message.reply_text.call_args.args[0]
    IngestionPipeline(storage).retry_pending()
    assert event(storage) == original
    assert storage.pending_source_events(None, limit=100) == []
    with pytest.raises(ValueError, match='Use Telegram'):
        storage.retry_source_event(original['id'])
    assert storage.query_transactions(limit=50) == []


@pytest.mark.asyncio
async def test_crash_before_parse_completion_survives_restart_and_redelivery(tmp_path):
    class Crash(BaseException):
        pass
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    service = setup(storage)
    service.llm_service.parse_telegram_message.side_effect = Crash()
    with pytest.raises(Crash):
        await service._handle_nl_message(update(), SimpleNamespace())
    assert event(storage)['status'] == 'pending'
    conn.close()
    conn = init_db(path)
    storage = Storage(conn)
    try:
        IngestionPipeline(storage).retry_pending()
        assert event(storage)['attempts'] == 1
        service = setup(storage)
        await service._handle_nl_message(update(), SimpleNamespace())
        assert event(storage)['attempts'] == 2
        assert event(storage)['status'] == 'processed'
        assert json.loads(event(storage)['payload'])['text'] == TEXT
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_redelivery_attempt_limit_includes_processing_crashes(in_memory_db):
    storage = Storage(in_memory_db)
    for attempt in range(1, 6):
        assert storage.begin_telegram_nl_input(100, 10, TEXT)['attempts'] == attempt
    service = setup(storage)
    await service._handle_nl_message(update(), SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_not_called()
    assert event(storage)['attempts'] == 5


@pytest.mark.asyncio
async def test_raw_write_failure_prevents_model_call(in_memory_db):
    storage = Storage(in_memory_db)
    service = setup(storage)
    in_memory_db.execute("CREATE TRIGGER reject_raw BEFORE INSERT ON source_events BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        await service._handle_nl_message(update(), SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_not_called()
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_drafts').fetchone()[0] == 0


@pytest.mark.asyncio
async def test_processing_ack_failure_rolls_back_draft_and_can_retry(in_memory_db):
    storage = Storage(in_memory_db)
    service = setup(storage)
    in_memory_db.execute("CREATE TRIGGER reject_ack BEFORE UPDATE ON source_events WHEN NEW.status = 'processed' BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    await service._handle_nl_message(update(), SimpleNamespace())
    assert event(storage)['status'] == 'failed'
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_drafts').fetchone()[0] == 0
    assert in_memory_db.execute('SELECT COUNT(*) FROM telegram_draft_messages').fetchone()[0] == 0
    in_memory_db.execute('DROP TRIGGER reject_ack')
    await service._handle_nl_message(update(), SimpleNamespace())
    assert event(storage)['status'] == 'processed'
    assert event(storage)['attempts'] == 2
    storage.fail_telegram_nl_input(event(storage)['id'])
    assert event(storage)['status'] == 'processed'


@pytest.mark.asyncio
async def test_disabled_model_and_unlinked_users_do_not_capture_new_input(in_memory_db):
    storage = Storage(in_memory_db)
    service = setup(storage)
    service.llm_service = None
    await service._handle_nl_message(update(), SimpleNamespace())
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 0
    service = setup(storage)
    service.admin_storage = Mock()
    service.user_manager = SimpleNamespace(get_by_chat_id=lambda _: None)
    await service._handle_nl_message(update(), SimpleNamespace())
    service.llm_service.parse_telegram_message.assert_not_called()
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 0


def test_edited_received_text_never_rewrites_original(in_memory_db):
    storage = Storage(in_memory_db)
    storage.begin_telegram_nl_input(100, 10, TEXT)
    with pytest.raises(TransactionRequestConflict):
        storage.begin_telegram_nl_input(100, 10, 'different private text')
    assert json.loads(event(storage)['payload'])['text'] == TEXT
    assert event(storage)['attempts'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['link', 'consume'])
async def test_confirmation_raw_link_is_atomic_with_purchase_and_draft(in_memory_db, failure):
    storage = Storage(in_memory_db)
    service = setup(storage)
    await service._handle_nl_message(update(), SimpleNamespace())
    original = event(storage)
    draft = storage.get_telegram_draft_for_message(100, 10, TEXT.strip())
    if failure == 'link':
        in_memory_db.execute("CREATE TRIGGER reject_link BEFORE UPDATE ON source_events WHEN NEW.source = 'telegram_nl' AND NEW.transaction_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    else:
        in_memory_db.execute("CREATE TRIGGER reject_link BEFORE DELETE ON telegram_drafts BEGIN SELECT RAISE(ABORT, 'unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        storage.confirm_telegram_draft(draft['_id'], {}, chat_id=100)
    assert storage.query_transactions(limit=50) == []
    assert storage.get_telegram_draft(draft['_id'], 100) is not None
    assert event(storage) == original
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 1
    in_memory_db.execute('DROP TRIGGER reject_link')
    tx_id, _ = storage.confirm_telegram_draft(draft['_id'], {}, chat_id=100)
    assert event(storage)['transaction_id'] == tx_id
