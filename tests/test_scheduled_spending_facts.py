from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.main import init_db
from src.storage import Storage
from src.telegram_bot import TelegramBotService
from src.user_manager import UserManager, _monthly_summary, _weekly_summary


@pytest.fixture
def bot(in_memory_db):
    return TelegramBotService(Storage(in_memory_db), bot_token='test')


def add(storage, key, day, amount=10, currency='SGD', rate=1):
    return storage.insert_transaction(source='manual', source_id=key, amount=amount,
                                     merchant=key, category='Food', transaction_date=day,
                                     currency=currency, exchange_rate=rate)


def test_weekly_report_uses_current_monday_through_sunday_without_evidence_queries(bot):
    add(bot.storage, 'Last Sunday', '2026-09-06', 99)
    add(bot.storage, 'This Monday', '2026-09-07', 12)
    add(bot.storage, 'This Sunday', '2026-09-13', 3)
    bot._local_now = Mock(return_value=datetime(2026, 9, 13, 8))
    with patch.object(bot.storage, 'get_spending_evidence', side_effect=AssertionError('unbounded notification')):
        text = _weekly_summary(bot.storage, bot)
    assert '2026-09-07 to 2026-09-13' in text
    assert 'Spending: `S$15.00`' in text
    assert '2026-08-31 to 2026-09-06: `S$99.00`' in text
    assert 'Last Sunday' not in text
    assert 'evidence (' not in text


@pytest.mark.parametrize('send_date,previous_end', [
    (datetime(2026, 3, 1, 8), '2026-02-28'),
    (datetime(2028, 3, 1, 8), '2028-02-29'),
    (datetime(2027, 1, 1, 8), '2026-12-31'),
])
def test_monthly_report_covers_completed_previous_month(bot, send_date, previous_end):
    add(bot.storage, 'Previous month', previous_end, 12)
    add(bot.storage, 'New month', send_date.date().isoformat(), 99)
    bot._local_now = Mock(return_value=send_date)
    text = _monthly_summary(bot.storage, bot)
    assert f"{previous_end[:8]}01 to {previous_end}" in text
    assert 'Spending: `S$12.00`' in text
    assert 'S$99.00' not in text
    assert 'New month' not in text


def test_scheduler_month_and_interactive_month_keep_different_periods(bot):
    add(bot.storage, 'August', '2026-08-31', 12)
    add(bot.storage, 'September', '2026-09-01', 99)
    bot._local_now = Mock(return_value=datetime(2026, 9, 1, 8))
    assert 'Spending: `S$12.00`' in _monthly_summary(bot.storage, bot)
    assert 'Spending: `S$99.00`' in bot._format_spending_period(bot.storage, 'month')


def test_scheduler_uses_bot_calendar_and_timezone_projection(bot):
    add(bot.storage, 'Boundary', '2026-08-31T23:30:00+00:00', 12)
    bot._local_now = Mock(return_value=datetime(2026, 9, 1, 8))
    bot.timezone = 'Asia/Singapore'
    assert 'Spending: `S$0.00`' in _monthly_summary(bot.storage, bot)
    bot.timezone = 'America/Los_Angeles'
    assert 'Spending: `S$12.00`' in _monthly_summary(bot.storage, bot)


def test_compact_report_keeps_partial_and_indicative_status_and_bounds_category_text(bot):
    bot._local_now = Mock(return_value=datetime(2026, 9, 13, 8))
    add(bot.storage, 'Unresolved', '2026-09-08', currency='USD', rate=None)
    text = _weekly_summary(bot.storage, bot)
    assert 'Spending known subtotal: `S$0.00`' in text
    assert 'Comparison unavailable' in text
    bot.storage.update_transaction(1, exchange_rate=1.3, category='_*' * 5000)
    text = _weekly_summary(bot.storage, bot)
    assert 'Status: indicative' in text
    assert 'Comparison uses indicative currency conversions.' in text
    assert len(text.encode('utf-16-le')) // 2 < 4096


def test_registered_jobs_route_user_storage_without_model_or_cached_narratives(bot):
    other_conn = init_db(':memory:')
    try:
        other = Storage(other_conn)
        for storage, value in ((bot.storage, 12), (other, 99)):
            add(storage, 'August', '2026-08-31', value)
            add(storage, 'September', '2026-09-01', value)
            storage.set_setting('llm_monthly_insight_content', '{"narrative":"STALE PRIVATE NARRATIVE"}')
        bot._local_now = Mock(return_value=datetime(2026, 9, 1, 8))
        bot.notify_text = Mock()
        model = Mock()
        manager = UserManager.__new__(UserManager)
        manager._bot = bot
        manager._llm_service = model
        manager._config = {'timezone': bot.timezone}
        manager.get = lambda name: SimpleNamespace(storage={'alice': bot.storage, 'bob': other}[name], poller=None)
        jobs = {}
        manager._scheduler = Mock()
        manager._scheduler.add_job.side_effect = lambda fn, *args, **kwargs: jobs.update({kwargs['id']: fn})
        for username, value in (('alice', 12), ('bob', 99)):
            manager._register_scheduler_jobs(username)
            for period in ('weekly', 'monthly'):
                jobs[f'{period}_{username}']()
                text, recipient = bot.notify_text.call_args.args
                assert recipient == username
                expected = value * (2 if period == 'weekly' else 1)
                assert f'Spending: `S${expected}.00`' in text
                assert 'STALE PRIVATE NARRATIVE' not in text
        assert model.mock_calls == []
    finally:
        other_conn.close()
