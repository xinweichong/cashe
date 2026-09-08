from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.storage import Storage
from src.telegram_bot import TelegramBotService


def add(storage, key, day, amount=10, kind='expense', currency='SGD', rate=1):
    return storage.insert_transaction(source='manual', source_id=key, amount=amount,
                                     merchant=key, category='Food', transaction_date=day,
                                     tx_type=kind, currency=currency, exchange_rate=rate)


def test_daily_facts_select_one_day_and_same_prior_weekday(in_memory_db):
    storage = Storage(in_memory_db)
    add(storage, 'Today', '2026-01-02', 12.005, kind=None)
    add(storage, 'Last week', '2025-12-26', 3)
    add(storage, 'Yesterday', '2026-01-01', 99)
    add(storage, 'Tomorrow', '2026-01-03', 99)
    facts = storage.get_day_spending_facts(date(2026, 1, 2))
    assert facts['current']['start'] == facts['current']['end'] == '2026-01-02'
    assert facts['current']['spending']['minor_units'] == 1201
    assert facts['previous']['start'] == facts['previous']['end'] == '2025-12-26'
    assert facts['change']['minor_units'] == 901
    assert facts['category_changes'] == [{'category': 'Food', 'change': {'minor_units': 901, 'currency': 'SGD'}}]
    evidence = storage.get_spending_evidence(date(2026, 1, 2), date(2026, 1, 2), limit=50)
    assert sum(row['amount']['minor_units'] for row in evidence['items']) == 1201


def test_daily_refunds_transfers_income_and_indicative_money(in_memory_db):
    storage = Storage(in_memory_db)
    add(storage, 'Foreign', '2026-09-08', 10, currency='USD', rate=1.3)
    add(storage, 'Refund', '2026-09-08', 2, kind='refund')
    add(storage, 'Income', '2026-09-08', 3, kind='income')
    add(storage, 'Transfer', '2026-09-08', 99, kind='transfer')
    current = storage.get_day_spending_facts(date(2026, 9, 8))['current']
    assert current['spending']['minor_units'] == 1100
    assert current['recorded_net_flow']['minor_units'] == -800
    assert current['status'] == 'indicative'
    assert current['transaction_count'] == 3


@pytest.mark.parametrize('day', [None, '2026-09-08'])
def test_daily_unknown_money_and_dates_keep_comparison_unavailable(in_memory_db, day):
    storage = Storage(in_memory_db)
    add(storage, 'Unknown', day, currency='USD', rate=None)
    facts = storage.get_day_spending_facts(date(2026, 9, 8))
    assert facts['current']['status'] == 'partial'
    assert facts['current']['spending']['minor_units'] == 0
    assert facts['current']['income'] is None
    assert facts['change'] is None
    assert facts['undated_count'] == int(day is None)


def test_daily_default_date_uses_requested_timezone_and_projects_offsets(in_memory_db):
    storage = Storage(in_memory_db)
    add(storage, 'Boundary', '2026-09-07T18:00:00+00:00')
    with patch('src.spending_facts.local_now', return_value=datetime(2026, 9, 8, 2)) as clock:
        facts = storage.get_day_spending_facts(timezone='Asia/Singapore')
    clock.assert_called_once_with('Asia/Singapore')
    assert facts['current']['spending']['minor_units'] == 1000
    assert storage.get_day_spending_facts(date(2026, 9, 8), 'America/Los_Angeles')['current']['spending']['minor_units'] == 0


def test_daily_minimum_date_is_explicitly_rejected(in_memory_db):
    with pytest.raises(ValueError, match='previous weekday'):
        Storage(in_memory_db).get_day_spending_facts(date.min)


@pytest.mark.asyncio
@pytest.mark.parametrize('command,expected', [('_today', '2026-01-01'), ('_yesterday', '2025-12-31')])
async def test_daily_commands_use_shared_facts_and_keep_navigation(in_memory_db, command, expected):
    storage = Storage(in_memory_db)
    add(storage, 'Selected', expected, currency='USD', rate=None)
    bot = TelegramBotService(storage, bot_token='test')
    bot._local_now = Mock(return_value=datetime(2026, 1, 1, 8))
    bot._require_ctx = AsyncMock(return_value=SimpleNamespace(storage=storage))
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    with patch.object(storage, 'get_spending_summary', side_effect=AssertionError('legacy query')), patch.object(storage, 'get_budget_progress', side_effect=AssertionError('legacy pace')):
        await getattr(bot, command)(update, SimpleNamespace())
    message = update.message.reply_text.call_args
    assert f'Daily Summary ({expected} to {expected})' in message.args[0]
    assert 'Status: partial' in message.args[0]
    assert 'SGD unresolved' in message.args[0]
    if command == '_today':
        assert message.kwargs['reply_markup'] is not None
    bot._require_ctx.return_value = None
    update.message.reply_text.reset_mock()
    await getattr(bot, command)(update, SimpleNamespace())
    update.message.reply_text.assert_not_called()
