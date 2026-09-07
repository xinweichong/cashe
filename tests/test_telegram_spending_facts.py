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
    service._local_now = Mock(return_value=datetime(2026, 9, 9, 12))
    return service


def add(storage, key, amount=10, day='2026-09-08', kind='expense', currency='SGD', rate=1):
    return storage.insert_transaction(source='manual', source_id=key, amount=amount,
                                     merchant=key, category='Food', transaction_date=day,
                                     tx_type=kind, currency=currency, exchange_rate=rate,
                                     raw_data='PRIVATE RAW PAYLOAD')


@pytest.mark.parametrize('period', ['week', 'month'])
def test_shared_rounding_classification_and_negative_net_flow(bot, period):
    add(bot.storage, 'Legacy', amount=10.005, kind=None)
    add(bot.storage, 'Refund', amount=2, kind='refund')
    add(bot.storage, 'Transfer', amount=999, kind='transfer')
    add(bot.storage, 'Income', amount=3, kind='income')
    with patch.object(bot.storage, 'get_spending_summary', side_effect=AssertionError('legacy query')):
        text = bot._format_spending_period(bot.storage, period)
    assert 'Spending: `S$8.01`' in text
    assert 'Recorded income: `S$3.00`' in text
    assert 'Recorded net flow: `S$-5.01`' in text
    assert 'Spending evidence (2 of 2)' in text
    assert 'Income evidence (1 of 1)' in text
    assert 'Refund · `S$-2.00`' in text
    assert 'Transfer' not in text
    assert 'PRIVATE RAW PAYLOAD' not in text


@pytest.mark.parametrize('rate', [None, 1])
def test_unknown_fx_is_partial_zero_not_empty_and_does_not_offer_pace(bot, rate):
    add(bot.storage, 'Foreign', currency='USD', rate=rate)
    text = bot._format_spending_period(bot.storage, 'week')
    assert 'Spending known subtotal: `S$0.00`' in text
    assert 'Status: partial' in text
    assert 'Nothing logged yet' not in text
    assert 'No income recorded.' in text
    assert 'Recorded net flow:' not in text
    assert 'Comparison unavailable' in text
    assert 'SGD unresolved' in text


def test_undated_records_suppress_comparison_and_net_flow(bot):
    add(bot.storage, 'Undated', day=None)
    add(bot.storage, 'Pay', kind='income')
    text = bot._format_spending_period(bot.storage, 'month')
    assert '1 undated records cannot be assigned' in text
    assert 'Income known subtotal: `S$10.00`' in text
    assert 'Recorded net flow:' not in text
    assert 'Comparison unavailable' in text


def test_indicative_comparison_is_labeled_even_with_native_current_total(bot):
    add(bot.storage, 'Previous', day='2026-09-01', currency='USD', rate=1.3)
    add(bot.storage, 'Current')
    text = bot._format_spending_period(bot.storage, 'week')
    assert 'Status: complete' in text
    assert '2026-08-31 to 2026-09-02: `S$13.00`' in text
    assert 'Change: `S$-3.00`' in text
    assert 'Comparison uses indicative currency conversions.' in text


def test_short_previous_month_uses_separate_comparison_window(bot):
    bot._local_now.return_value = datetime(2026, 3, 31)
    add(bot.storage, 'February', day='2026-02-28', amount=5)
    add(bot.storage, 'March comparable', day='2026-03-28', amount=8)
    add(bot.storage, 'March extra', day='2026-03-31', amount=20)
    text = bot._format_spending_period(bot.storage, 'month')
    assert 'Spending: `S$28.00`' in text
    assert '2026-03-01 to 2026-03-28: `S$8.00`' in text
    assert '2026-02-01 to 2026-02-28: `S$5.00`' in text
    assert 'Change: `S$3.00`' in text


def test_evidence_and_totals_project_timestamps_into_configured_timezone(bot):
    bot._local_now.return_value = datetime(2026, 9, 7, 12)
    add(bot.storage, 'Boundary', day='2026-09-06T18:00:00+00:00')
    singapore = bot._format_spending_period(bot.storage, 'week')
    assert 'Spending: `S$10.00`' in singapore
    assert '2026-09-07 · Boundary' in singapore
    bot.timezone = 'America/Los_Angeles'
    pacific = bot._format_spending_period(bot.storage, 'week')
    assert 'Spending: `S$0.00`' in pacific
    assert 'Boundary' not in pacific


def test_evidence_limit_is_explicit_without_truncating_total(bot):
    for index in range(51):
        add(bot.storage, f'Cafe {index}')
    text = bot._format_spending_period(bot.storage, 'week')
    assert 'Spending: `S$510.00`' in text
    assert 'Spending evidence (50 of 51)' in text
    assert text.count(' · ID ') == 50
    assert 'Open Activity for the remaining records.' in text


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['_week', '_month'])
async def test_commands_use_resolved_user_and_skip_legacy_budget_queries(bot, command):
    other_conn = init_db(':memory:')
    try:
        other = Storage(other_conn)
        add(bot.storage, 'Wrong user', amount=999)
        add(other, 'Right user', amount=12)
        bot._require_ctx = AsyncMock(return_value=SimpleNamespace(storage=other))
        message = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
        with patch.object(other, 'get_budget_progress', side_effect=AssertionError('legacy pace')):
            await getattr(bot, command)(message, SimpleNamespace())
        text = message.message.reply_text.call_args.args[0]
        assert 'Right user' in text
        assert 'Wrong user' not in text
        assert 'Spending: `S$12.00`' in text
        bot._require_ctx.return_value = None
        message.message.reply_text.reset_mock()
        await getattr(bot, command)(message, SimpleNamespace())
        message.message.reply_text.assert_not_called()
    finally:
        other_conn.close()
