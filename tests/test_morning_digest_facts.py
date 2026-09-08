import asyncio
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
    service.chat_id = 100
    service.app = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock()))
    service._local_now = Mock(return_value=datetime(2026, 9, 8, 8))
    return service


def add(storage, key, day, amount=10, kind='expense', currency='SGD', rate=1):
    return storage.insert_transaction(source='manual', source_id=key, merchant=key, amount=amount,
                                     transaction_date=day, tx_type=kind, category='Food',
                                     currency=currency, exchange_rate=rate, raw_data='private raw')


async def digest(bot, **kwargs):
    await bot._send_daily_digest(**kwargs)
    return bot.app.bot.send_message.call_args.kwargs['text']


@pytest.mark.asyncio
async def test_digest_reconciles_daily_monthly_facts_without_legacy_queries_or_prose(bot):
    add(bot.storage, 'Before yesterday', '2026-09-01', 5)
    add(bot.storage, 'Yesterday', '2026-09-07', 12.005, kind=None)
    add(bot.storage, 'Refund', '2026-09-07', 2, kind='refund')
    add(bot.storage, 'Pay', '2026-09-07', 3, kind='income')
    add(bot.storage, 'Transfer', '2026-09-07', 99, kind='transfer')
    bot.storage.set_setting('llm_insight_content', '{"narrative":"STALE PRIVATE TEXT"}')
    with patch.object(bot.storage, 'get_spending_summary', side_effect=AssertionError('legacy')), patch.object(bot.storage, 'spending_velocity', side_effect=AssertionError('legacy')), patch.object(bot.storage, 'new_merchants', side_effect=AssertionError('legacy')), patch.object(bot.storage, 'spending_anomalies', side_effect=AssertionError('legacy')), patch.object(bot.storage, 'get_spending_evidence', side_effect=AssertionError('evidence list')):
        text = await digest(bot)
    daily, monthly = text.split('*Month to date*')
    assert 'Morning Digest' in daily
    assert 'Spending: `S$10.01`' in daily
    assert 'Recorded net flow: `S$-7.01`' in daily
    assert 'Spending: `S$15.01`' in monthly
    assert 'Recorded net flow: `S$-12.01`' in monthly
    assert 'STALE PRIVATE TEXT' not in text
    assert 'private raw' not in text
    assert bot.app.bot.send_message.call_args.kwargs['reply_markup'] is not None


@pytest.mark.asyncio
@pytest.mark.parametrize('today,previous', [(datetime(2026, 1, 1, 8), '2025-12-31'), (datetime(2028, 3, 1, 8), '2028-02-29')])
async def test_digest_crosses_year_and_leap_month_without_mixing_totals(bot, today, previous):
    bot._local_now.return_value = today
    add(bot.storage, 'Prior month', previous, 12)
    add(bot.storage, 'Current month', today.date().isoformat(), 3)
    daily, monthly = (await digest(bot)).split('*Month to date*')
    assert f'Daily Summary ({previous} to {previous})' in daily
    assert 'Spending: `S$12.00`' in daily
    assert 'Spending: `S$3.00`' in monthly


@pytest.mark.asyncio
async def test_digest_preserves_partial_and_indicative_states(bot):
    add(bot.storage, 'Unknown', '2026-09-07', currency='USD', rate=None)
    add(bot.storage, 'Estimated', '2026-09-08', currency='USD', rate=1.3)
    text = await digest(bot)
    daily, monthly = text.split('*Month to date*')
    assert 'Spending known subtotal: `S$0.00`' in daily
    assert 'Spending known subtotal: `S$13.00`' in monthly
    assert 'Comparison unavailable' in daily
    assert 'Currency conversions are indicative estimates.' in monthly


@pytest.mark.asyncio
async def test_digest_uses_explicit_user_storage_and_releases_lock_before_delivery(bot):
    other_conn = init_db(':memory:')
    try:
        other = Storage(other_conn)
        add(bot.storage, 'Wrong user', '2026-09-07', 999)
        add(other, 'Right user', '2026-09-07', 12)

        async def send(**kwargs):
            # A separate worker can access Storage while Telegram delivery is pending.
            facts = await asyncio.wait_for(asyncio.to_thread(other.get_month_spending_facts, datetime(2026, 9, 8).date()), timeout=2)
            assert facts['current']['spending']['minor_units'] == 1200

        bot.app.bot.send_message.side_effect = send
        text = await digest(bot, chat_id=200, storage=other)
        assert 'S$12.00' in text
        assert 'S$999.00' not in text
        assert bot.app.bot.send_message.call_args.kwargs['chat_id'] == 200
    finally:
        other_conn.close()


@pytest.mark.asyncio
async def test_digest_projects_timezone_and_bounds_compact_category_labels(bot):
    add(bot.storage, 'Boundary', '2026-09-06T18:00:00+00:00', 12)
    bot.storage.update_transaction(1, category='_*' * 10000)
    text = await digest(bot)
    assert 'Spending: `S$12.00`' in text.split('*Month to date*')[0]
    assert len(text.encode('utf-16-le')) // 2 < 4096
    bot.timezone = 'America/Los_Angeles'
    text = await digest(bot)
    assert 'Spending: `S$0.00`' in text.split('*Month to date*')[0]


@pytest.mark.asyncio
async def test_digest_empty_and_undated_states_do_not_claim_complete_capture(bot):
    text = await digest(bot)
    assert 'No income recorded.' in text
    assert 'do not establish capture completeness' in text
    add(bot.storage, 'Undated', None)
    text = await digest(bot)
    assert text.count('1 undated records') == 2
    assert text.count('Status: partial') == 2
    bot.chat_id = None
    bot.app.bot.send_message.reset_mock()
    await bot._send_daily_digest()
    bot.app.bot.send_message.assert_not_called()
