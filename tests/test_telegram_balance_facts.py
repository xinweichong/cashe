from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.main import init_db
from src.storage import Storage
from src.telegram_bot import TelegramBotService


@pytest.fixture
def bot(in_memory_db):
    service = TelegramBotService(Storage(in_memory_db), bot_token='test')
    service._local_now = Mock(return_value=datetime(2026, 9, 8, 12))
    return service


def add(storage, key, amount, kind='expense', currency='SGD', rate=1, day='2026-09-07'):
    storage.insert_transaction(source='manual', source_id=key, amount=amount, merchant=key,
                               category='Food', transaction_date=day, tx_type=kind,
                               currency=currency, exchange_rate=rate, raw_data='PRIVATE')


async def balance(bot):
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    with patch.object(bot.storage, 'get_balance', side_effect=AssertionError('legacy balance')):
        await bot._balance(update, SimpleNamespace())
    return update.message.reply_text.call_args


@pytest.mark.asyncio
async def test_balance_uses_shared_rounding_refunds_transfers_and_negative_flow(bot):
    add(bot.storage, 'Legacy', 10.005, kind=None)
    add(bot.storage, 'Refund', 2, kind='refund')
    add(bot.storage, 'Transfer', 99, kind='transfer')
    add(bot.storage, 'Income', 3, kind='income')
    result = await balance(bot)
    text = result.args[0]
    assert 'Recorded flow for September 2026' in text
    assert '2026-09-01 to 2026-09-08' in text
    assert 'Spending: `S$8.01`' in text
    assert 'Recorded income: `S$3.00`' in text
    assert 'Recorded net flow: `S$-5.01`' in text
    assert '22 days remaining' in text
    assert result.kwargs['reply_markup'] is not None
    assert 'PRIVATE' not in text


@pytest.mark.asyncio
async def test_empty_balance_retains_navigation_and_does_not_invent_income(bot):
    result = await balance(bot)
    text = result.args[0]
    assert 'Spending: `S$0.00`' in text
    assert 'No income recorded.' in text
    assert 'Recorded net flow:' not in text
    assert result.kwargs['reply_markup'] is not None


@pytest.mark.asyncio
async def test_recorded_zero_income_is_distinct_from_absent_income(bot):
    add(bot.storage, 'Zero income', 0, kind='income')
    text = (await balance(bot)).args[0]
    assert 'Recorded income: `S$0.00`' in text
    assert 'Recorded net flow: `S$0.00`' in text


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,rate', [('expense', None), ('income', 1)])
async def test_unresolved_foreign_records_are_partial_instead_of_empty(bot, kind, rate):
    add(bot.storage, 'Foreign', 12, kind=kind, currency='USD', rate=rate)
    text = (await balance(bot)).args[0]
    assert 'Status: partial' in text
    assert 'Spending known subtotal: `S$0.00`' in text
    assert 'Recorded net flow:' not in text
    assert 'Nothing logged yet' not in text
    assert '1 records in this period have unresolved' in text


@pytest.mark.asyncio
async def test_undated_income_suppresses_flow_and_marks_known_subtotals(bot):
    add(bot.storage, 'Pay', 20, kind='income')
    add(bot.storage, 'Undated', 10, day=None)
    text = (await balance(bot)).args[0]
    assert 'Income known subtotal: `S$20.00`' in text
    assert '1 undated records' in text
    assert 'Recorded net flow is unavailable while records remain unresolved.' in text


@pytest.mark.asyncio
async def test_indicative_conversion_is_labeled_with_known_flow(bot):
    add(bot.storage, 'Foreign', 10, currency='USD', rate=1.3)
    add(bot.storage, 'Pay', 20, kind='income')
    text = (await balance(bot)).args[0]
    assert 'Status: indicative' in text
    assert 'Recorded net flow: `S$7.00`' in text
    assert 'Currency conversions are indicative estimates.' in text


@pytest.mark.asyncio
async def test_balance_resolves_user_storage_and_configured_timezone(bot):
    other_conn = init_db(':memory:')
    try:
        other = Storage(other_conn)
        add(bot.storage, 'Wrong user', 999, kind='income')
        add(other, 'Boundary', 12, day='2026-08-31T18:00:00+00:00')
        bot._require_ctx = AsyncMock(return_value=SimpleNamespace(storage=other))
        bot._local_now.return_value = datetime(2026, 9, 1, 8)
        text = (await balance(bot)).args[0]
        assert 'Spending: `S$12.00`' in text
        assert 'S$999.00' not in text
        bot.timezone = 'America/Los_Angeles'
        text = (await balance(bot)).args[0]
        assert 'Spending: `S$0.00`' in text
        bot._require_ctx.return_value = None
        assert await balance(bot) is None
    finally:
        other_conn.close()
