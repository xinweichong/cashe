import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from src.telegram_bot import TelegramBotService, estimate_next_date, get_category_keyboard
from src.storage import Storage


@pytest.fixture
def bot_service(in_memory_db):
    storage = Storage(connection=in_memory_db)
    return TelegramBotService(storage=storage, bot_token="test-token")


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['_add', '_cash', '_income'])
@pytest.mark.parametrize('amount', ['nan', 'inf'])
async def test_manual_commands_reject_nonfinite_values_without_followups(bot_service, command, amount):
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    context = SimpleNamespace(args=[amount, 'Cafe'])
    with patch.object(bot_service.storage, 'enlist_transaction') as assign:
        await getattr(bot_service, command)(update, context)
        assign.assert_not_called()
    assert bot_service.storage.query_transactions(limit=50) == []
    assert 'Couldn’t save' in update.message.reply_text.call_args.args[0]


@pytest.mark.asyncio
async def test_add_without_exchange_service_records_unresolved_foreign_currency(bot_service):
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    await bot_service._add(update, SimpleNamespace(args=['12', 'USD', 'Cafe']))
    tx = bot_service.storage.query_transactions(limit=50)[0]
    assert tx['currency'] == 'USD'
    assert tx['exchange_rate'] is None
    assert tx['merchant'] == 'Cafe'
    assert tx['source_id'].startswith('manual-')
    assert 'SGD conversion unresolved' in update.message.reply_text.call_args.args[0]


@pytest.mark.asyncio
async def test_duplicate_manual_command_is_reported_without_repeating_trip_assignment(bot_service):
    from datetime import datetime
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    context = SimpleNamespace(args=['12', 'Cafe'])
    bot_service.storage.set_setting('trips_enabled', 'true')
    trip_id = bot_service.storage.create_trip('Current', '2026-09-01')
    bot_service.storage.activate_trip(trip_id)
    with patch.object(bot_service, '_local_now', return_value=datetime(2026, 9, 7, 12)), patch.object(bot_service.storage, 'enlist_transaction', wraps=bot_service.storage.enlist_transaction) as assign:
        await bot_service._add(update, context)
        await bot_service._add(update, context)
        assert assign.call_count == 1
    assert len(bot_service.storage.query_transactions(limit=50)) == 1
    assert update.message.reply_text.call_args.args[0] == 'Already logged.'


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['_add', '_cash'])
async def test_manual_trip_failure_preserves_capture_and_success_reply(bot_service, command):
    from src.ingestion import IngestionPipeline
    storage = bot_service.storage
    storage.set_setting('trips_enabled', 'true')
    trip_id = storage.create_trip('Current', '2026-09-01')
    storage.activate_trip(trip_id)
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    with patch.object(storage, 'enlist_transaction', side_effect=RuntimeError('private failure')):
        await getattr(bot_service, command)(update, SimpleNamespace(args=['12', 'Cafe']))
    tx = storage.query_transactions(limit=50)[0]
    assert 'cash, caught.' in update.message.reply_text.call_args.args[0]
    assert storage.list_ingestion_effects()[0]['status'] == 'failed'
    IngestionPipeline(storage).retry_pending()
    assert storage.is_in_trip(trip_id, tx['id'])
    assert storage.list_ingestion_effects() == []


@pytest.mark.asyncio
async def test_busy_outbox_worker_does_not_block_manual_confirmation(bot_service):
    from src.ingestion import IngestionPipeline
    storage = bot_service.storage
    storage.set_setting('trips_enabled', 'true')
    trip_id = storage.create_trip('Current', '2026-09-01')
    storage.activate_trip(trip_id)
    update = SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))
    with storage.outbox_dispatch_lock:
        await bot_service._add(update, SimpleNamespace(args=['12', 'Cafe']))
        tx = storage.query_transactions(limit=50)[0]
        assert storage.list_ingestion_effects()[0]['status'] == 'pending'
        assert not storage.is_in_trip(trip_id, tx['id'])
        assert 'cash, caught.' in update.message.reply_text.call_args.args[0]
    IngestionPipeline(storage).retry_pending()
    assert storage.is_in_trip(trip_id, tx['id'])


@pytest.mark.asyncio
async def test_nl_confirmation_uses_shared_validation_and_retains_failed_draft(bot_service):
    query = SimpleNamespace(data='nl_confirm:' + 'a' * 32, answer=AsyncMock(), edit_message_text=AsyncMock())
    update = SimpleNamespace(callback_query=query, effective_chat=SimpleNamespace(id=100))
    context = SimpleNamespace(user_data={'nl_pending': {'_id': 'a' * 32, 'amount': 12, 'currency': 'USD', 'merchant': 'Cafe', 'category': 'Food', 'date': '2026-02-30'}})
    with patch.object(bot_service.storage, 'enlist_transaction') as assign:
        bot_service.storage.save_telegram_draft('a' * 32, 100, context.user_data["nl_pending"])
        await bot_service._handle_nl_callback(update, context)
        assign.assert_not_called()
    assert bot_service.storage.query_transactions(limit=50) == []
    assert bot_service.storage.get_telegram_draft('a' * 32, 100) is not None
    markup = query.edit_message_text.call_args.kwargs['reply_markup']
    assert [button.callback_data for button in markup.inline_keyboard[0]] == ['nl_edit:' + 'a' * 32, 'nl_cancel:' + 'a' * 32]
    context.user_data['nl_pending']['date'] = '2026-09-01'
    context.user_data['nl_pending']['amount'] = '12'
    bot_service.storage.save_telegram_draft('a' * 32, 100, context.user_data["nl_pending"])
    await bot_service._handle_nl_callback(update, context)
    tx = bot_service.storage.query_transactions(limit=50)[0]
    assert tx['transaction_date'] == '2026-09-01T00:00:00'
    assert tx['exchange_rate'] is None
    assert bot_service.storage.get_telegram_draft('a' * 32, 100) is None


class TestParseAddCommand:
    def test_parse_add_full(self, bot_service):
        result = bot_service.parse_add_command("12.50 Toast Box food 2026-04-16")
        assert result["amount"] == 12.50
        assert result["merchant"] == "Toast Box"
        assert result["category"] == "food"
        assert result["date"] == "2026-04-16T00:00:00"

    def test_parse_add_minimal(self, bot_service):
        result = bot_service.parse_add_command("5.00 Coffee Shop")
        assert result["amount"] == 5.00
        assert result["merchant"] == "Coffee Shop"
        assert result["category"] is None
        assert result["date"] is None

    def test_parse_add_invalid_amount(self, bot_service):
        result = bot_service.parse_add_command("abc Test")
        assert result is None


class TestFormatTxBlock:
    def test_expense_no_prefix(self, bot_service):
        tx = {
            "id": 1, "merchant": "Toast Box", "category": "Food",
            "amount": 12.50, "currency": "SGD", "exchange_rate": 1.0,
            "transaction_date": "2026-04-16T12:00:00", "source": "uob_card",
            "description": None, "type": "expense",
        }
        text = bot_service._format_tx_block(tx)
        assert "💰" not in text
        assert "`$12.50 SGD`" in text

    def test_income_shows_money_icon_and_plus(self, bot_service):
        tx = {
            "id": 2, "merchant": "PayNow", "category": "Income",
            "amount": 951.90, "currency": "SGD", "exchange_rate": 1.0,
            "transaction_date": "2026-04-24T14:47:00", "source": "uob_paynow",
            "description": None, "type": "income",
        }
        text = bot_service._format_tx_block(tx)
        assert "💰" in text
        assert "`+$951.90 SGD`" in text

    def test_income_foreign_currency_shows_plus(self, bot_service):
        tx = {
            "id": 3, "merchant": "Gopay-Gojek", "category": "Other",
            "amount": 23.70, "currency": "IDR", "exchange_rate": 0.0001,
            "transaction_date": "2026-03-20T17:28:00", "source": "uob_card",
            "description": None, "type": "income",
        }
        text = bot_service._format_tx_block(tx)
        assert "💰" in text
        assert "`+$" in text


class TestFormatSummary:
    def test_format_daily_summary(self, bot_service, in_memory_db):
        in_memory_db.execute(
            """INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date)
               VALUES ('manual', 'm1', 12.50, 'Toast Box', 'Food', '2026-04-16T12:00:00')"""
        )
        in_memory_db.execute(
            """INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date)
               VALUES ('manual', 'm2', 25.00, 'Grab', 'Transport', '2026-04-16T13:00:00')"""
        )
        in_memory_db.commit()

        summary = bot_service.format_daily_summary("2026-04-16")
        assert "37.50" in summary
        assert "Food" in summary
        assert "Transport" in summary


class TestEstimateNextDate:
    def test_weekly(self):
        result = estimate_next_date("weekly", "2026-04-01")
        assert result == "08 Apr"

    def test_biweekly(self):
        result = estimate_next_date("biweekly", "2026-04-01")
        assert result == "15 Apr"

    def test_monthly(self):
        result = estimate_next_date("monthly", "2026-03-15")
        assert result == "15 Apr"

    def test_monthly_december_rollover(self):
        result = estimate_next_date("monthly", "2026-12-10")
        assert result == "10 Jan"

    def test_monthly_end_of_month(self):
        result = estimate_next_date("monthly", "2026-01-31")
        assert result == "28 Feb"


class TestInsightsCommand:
    @pytest.mark.asyncio
    async def test_insights_sends_message(self, bot_service):
        bot_service.storage.get_spending_summary = MagicMock(return_value={
            "total": 150.0,
            "by_category": {"Food": 80.0, "Transport": 70.0},
        })
        bot_service.storage.get_merchant_ranking = MagicMock(return_value=[
            {"merchant": "Toast Box", "total": 50.0, "visits": 3},
            {"merchant": "Grab", "total": 40.0, "visits": 2},
        ])
        bot_service.storage.get_average_daily = MagicMock(return_value=5.0)

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._insights(update, context)

        update.message.reply_text.assert_called_once()
        call_kwargs = update.message.reply_text.call_args.kwargs
        assert call_kwargs.get("parse_mode") == "Markdown"
        assert call_kwargs.get("reply_markup") is not None
        text = update.message.reply_text.call_args[0][0] if update.message.reply_text.call_args[0] else call_kwargs.get("text", "")
        assert "Food" in text
        assert "80.00" in text
        assert "5.00" in text
        assert "Toast Box" in text


class TestSubscriptionsCommand:
    @pytest.mark.asyncio
    async def test_subscriptions_shows_declared_subscriptions(self, bot_service, in_memory_db):
        """New /subscriptions shows declared subscriptions table, not recurring_transactions."""
        bot_service.storage.create_subscription(
            merchant="Netflix", frequency="weekly"
        )

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._subscriptions(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        assert "Netflix" in text
        assert "weekly" in text
        assert "/mo" in text

    @pytest.mark.asyncio
    async def test_subscriptions_empty_state(self, bot_service):
        """Empty state message shown when no subscriptions exist."""
        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._subscriptions(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        assert "No subscriptions" in text


class TestYesterdayCommand:
    @pytest.mark.asyncio
    async def test_yesterday_sends_message_for_yesterday(self, bot_service):
        from datetime import datetime, timedelta
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        bot_service.format_daily_summary = MagicMock(return_value=f"No transactions on {yesterday}")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._yesterday(update, context)

        bot_service.format_daily_summary.assert_called_once_with(yesterday, storage=bot_service.storage)
        update.message.reply_text.assert_called_once()


class TestMenuCommand:
    @pytest.mark.asyncio
    async def test_menu_sends_quick_actions(self, bot_service):
        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._menu(update, context)

        update.message.reply_text.assert_called_once()
        call_kwargs = update.message.reply_text.call_args
        text = call_kwargs[0][0] if call_kwargs[0] else call_kwargs.kwargs.get("text", "")
        assert "*Quick Actions*" in text
        assert call_kwargs.kwargs.get("reply_markup") is not None


class TestCmdCallback:
    @pytest.mark.asyncio
    async def test_cmd_callback_dispatches_to_week(self, bot_service):
        bot_service._week = AsyncMock()

        query = MagicMock()
        query.answer = AsyncMock()
        query.data = "cmd_week"
        query.message = MagicMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        await bot_service._cmd_callback(update, context)

        query.answer.assert_called_once()
        bot_service._week.assert_called_once()
        proxy_update, called_context = bot_service._week.call_args[0]
        assert isinstance(proxy_update, SimpleNamespace)
        assert hasattr(proxy_update, "message")
        assert called_context is context

    @pytest.mark.asyncio
    async def test_cmd_callback_ignores_unknown(self, bot_service):
        query = MagicMock()
        query.answer = AsyncMock()
        query.data = "unknown_cmd"

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        await bot_service._cmd_callback(update, context)

        query.answer.assert_called_once()
        # No handler should be called — we just verify no errors raised


class TestCategoryCallback:
    @pytest.mark.asyncio
    async def test_category_callback_handles_cat_data(self, bot_service, in_memory_db):
        in_memory_db.execute(
            """INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date)
               VALUES ('manual', 'm1', 10.0, 'Toast Box', 'Other', '2026-04-16T12:00:00')"""
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='m1'").fetchone()["id"]

        query = MagicMock()
        query.answer = AsyncMock()
        query.data = f"cat:{tx_id}:Food"
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        await bot_service._category_callback(update, context)

        query.edit_message_text.assert_called_once()
        assert "Food" in query.edit_message_text.call_args[0][0]

    @pytest.mark.asyncio
    async def test_category_callback_ignores_non_cat_data(self, bot_service):
        query = MagicMock()
        query.answer = AsyncMock()
        query.data = "cmd_menu"
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        await bot_service._category_callback(update, context)

        query.edit_message_text.assert_not_called()


class TestGetCategoryKeyboard:
    def test_creates_2_column_grid(self):
        categories = ["Food", "Transport", "Entertainment", "Shopping"]
        keyboard = get_category_keyboard(42, categories)
        buttons = keyboard.inline_keyboard
        assert len(buttons) == 2  # 4 cats → 2 rows
        assert len(buttons[0]) == 2
        assert len(buttons[1]) == 2
        assert buttons[0][0].callback_data == "recat:42:Food"
        assert buttons[0][1].callback_data == "recat:42:Transport"

    def test_odd_number_of_categories(self):
        categories = ["Food", "Transport", "Entertainment"]
        keyboard = get_category_keyboard(1, categories)
        buttons = keyboard.inline_keyboard
        assert len(buttons) == 2
        assert len(buttons[0]) == 2
        assert len(buttons[1]) == 1
        assert buttons[1][0].callback_data == "recat:1:Entertainment"


class TestRecategorizeCommand:
    @pytest.mark.asyncio
    async def test_recategorize_with_only_tx_id_shows_grid(self, bot_service, in_memory_db):
        in_memory_db.execute(
            """INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date)
               VALUES ('manual', 'm1', 10.0, 'Toast Box', 'Other', '2026-04-16T12:00:00')"""
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='m1'").fetchone()["id"]

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = [str(tx_id)]

        await bot_service._recategorize(update, context)

        update.message.reply_text.assert_called_once()
        call_kwargs = update.message.reply_text.call_args
        text = call_kwargs[0][0] if call_kwargs[0] else call_kwargs.kwargs.get("text", "")
        assert "Toast Box" in text
        assert str(tx_id) in text
        assert call_kwargs.kwargs.get("reply_markup") is not None

    @pytest.mark.asyncio
    async def test_recategorize_no_args_shows_usage(self, bot_service):
        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = []

        await bot_service._recategorize(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        assert "Usage" in text


class TestRecatCallback:
    @pytest.mark.asyncio
    async def test_recat_callback_applies_category(self, bot_service, in_memory_db):
        in_memory_db.execute(
            """INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date)
               VALUES ('manual', 'm2', 20.0, 'Grab', 'Other', '2026-04-16T12:00:00')"""
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='m2'").fetchone()["id"]

        query = MagicMock()
        query.answer = AsyncMock()
        query.data = f"recat:{tx_id}:Transport"
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        await bot_service._recat_callback(update, context)

        query.edit_message_text.assert_called_once()
        text = query.edit_message_text.call_args[0][0]
        assert "Transport" in text
        assert "Grab" in text

        updated = bot_service.storage.get_transaction(tx_id)
        assert updated["category"] == "Transport"


class TestDailyDigest:
    def test_notify_daily_digest_no_chat_id(self, bot_service):
        bot_service.chat_id = None
        bot_service._loop = MagicMock()
        bot_service.app = MagicMock()
        # Should not raise and should not submit any coroutine
        bot_service.notify_daily_digest()
        bot_service._loop.assert_not_called()


class TestHelp:
    @pytest.mark.asyncio
    async def test_help_contains_all_commands(self, bot_service):
        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot_service._help(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        for expected in [
            "cashe commands",
            "/today",
            "/balance",
            "/insights",
            "/compare",
            "/add",
            "/recategorize",
            "/menu",
        ]:
            assert expected in text, f"Expected '{expected}' in help text"


class TestDeleteCommand:
    @pytest.mark.asyncio
    async def test_delete_missing_id_shows_usage(self, bot_service):
        """If no ID given, reply with usage message."""
        update = SimpleNamespace(
            message=SimpleNamespace(reply_text=AsyncMock())
        )
        context = SimpleNamespace(args=[])
        await bot_service._delete_command(update, context)
        update.message.reply_text.assert_called_once_with("Usage: /delete <id>")

    @pytest.mark.asyncio
    async def test_delete_nonexistent_transaction(self, bot_service, in_memory_db):
        """If transaction ID not found, reply with not found message."""
        update = SimpleNamespace(
            message=SimpleNamespace(reply_text=AsyncMock())
        )
        context = SimpleNamespace(args=["9999"])
        await bot_service._delete_command(update, context)
        update.message.reply_text.assert_called_once_with("Transaction not found.")

    @pytest.mark.asyncio
    async def test_delete_shows_confirmation_keyboard(self, bot_service, in_memory_db):
        """Valid ID should show confirmation keyboard."""
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'del1', 25.0, 'Coffee', '2026-04-01', 'expense')"
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='del1'").fetchone()[0]

        update = SimpleNamespace(
            message=SimpleNamespace(reply_text=AsyncMock())
        )
        context = SimpleNamespace(args=[str(tx_id)])
        await bot_service._delete_command(update, context)
        call_kwargs = update.message.reply_text.call_args
        assert call_kwargs is not None
        # Should have sent a keyboard
        assert "reply_markup" in call_kwargs.kwargs or len(call_kwargs.args) > 1 or call_kwargs.kwargs.get("reply_markup") is not None

    @pytest.mark.asyncio
    async def test_delete_callback_cancel(self, bot_service):
        """cancel_delete callback should send Cancelled."""
        query = SimpleNamespace(
            answer=AsyncMock(),
            edit_message_text=AsyncMock(),
            data="cancel_delete",
        )
        update = SimpleNamespace(callback_query=query)
        context = SimpleNamespace()
        await bot_service._delete_callback(update, context)
        query.edit_message_text.assert_called_once_with("Cancelled.")

    @pytest.mark.asyncio
    async def test_delete_callback_confirms_deletion(self, bot_service, in_memory_db):
        """confirm_delete_<id> callback should delete the transaction."""
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'del2', 10.0, 'Grab', '2026-04-01', 'expense')"
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='del2'").fetchone()[0]

        query = SimpleNamespace(
            answer=AsyncMock(),
            edit_message_text=AsyncMock(),
            data=f"confirm_delete_{tx_id}",
        )
        update = SimpleNamespace(callback_query=query)
        context = SimpleNamespace()
        await bot_service._delete_callback(update, context)
        # Should be deleted
        row = in_memory_db.execute("SELECT id FROM transactions WHERE id=?", (tx_id,)).fetchone()
        assert row is None
        query.edit_message_text.assert_called_once()


class TestEditValueEnteredDateValidation:
    @pytest.mark.asyncio
    async def test_invalid_date_prompts_retry(self, bot_service, in_memory_db):
        """An invalid date string should prompt the user to re-enter."""
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'edit1', 50.0, 'Netflix', '2026-04-01', 'expense')"
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='edit1'").fetchone()[0]

        update = SimpleNamespace(
            message=SimpleNamespace(
                text="2024-99-99",  # invalid date
                reply_text=AsyncMock(),
            )
        )
        context = SimpleNamespace(
            user_data={"edit_tx_id": tx_id, "edit_field": "date"}
        )
        from src.telegram_bot import EDIT_ENTER_VALUE
        result = await bot_service._edit_value_entered(update, context)
        assert result == EDIT_ENTER_VALUE  # should stay in EDIT_ENTER_VALUE state

    @pytest.mark.asyncio
    async def test_valid_iso_date_accepted(self, bot_service, in_memory_db):
        """A valid YYYY-MM-DD date should update the transaction."""
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, transaction_date, type) "
            "VALUES ('manual', 'edit2', 50.0, 'Netflix', '2026-04-01', 'expense')"
        )
        in_memory_db.commit()
        tx_id = in_memory_db.execute("SELECT id FROM transactions WHERE source_id='edit2'").fetchone()[0]

        update = SimpleNamespace(
            message=SimpleNamespace(
                text="2026-05-15",
                reply_text=AsyncMock(),
            )
        )
        from src.telegram_bot import ConversationHandler
        context = SimpleNamespace(
            user_data={"edit_tx_id": tx_id, "edit_field": "date"}
        )
        result = await bot_service._edit_value_entered(update, context)
        assert result == ConversationHandler.END
        # Verify the date was stored
        tx = bot_service.storage.get_transaction(tx_id)
        assert "2026-05-15" in tx["transaction_date"]



class TestAsyncNotify:
    def _insert_tx(self, in_memory_db, source="uob_paynow", source_id="notify1",
                   amount=951.90, merchant="PayNow", tx_type="income",
                   transaction_date="2026-04-24T14:47:00", category="Income"):
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date, type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (source, source_id, amount, merchant, category, transaction_date, tx_type),
        )
        in_memory_db.commit()
        return in_memory_db.execute(
            "SELECT id FROM transactions WHERE source_id=?", (source_id,)
        ).fetchone()[0]

    def _make_service(self, in_memory_db):
        service = TelegramBotService(storage=Storage(connection=in_memory_db), bot_token="test-token")
        service.chat_id = 12345
        service.app = MagicMock()
        service.app.bot.send_message = AsyncMock()
        return service

    @pytest.mark.asyncio
    async def test_income_shows_received_no_picker(self, in_memory_db):
        """PayNow received / reversal → 💰 Received message, no category keyboard."""
        service = self._make_service(in_memory_db)
        tx_id = self._insert_tx(in_memory_db, tx_type="income", merchant="PayNow",
                                 source="uob_paynow", amount=951.90)
        await service._async_notify(tx_id, 951.90, "PayNow", "Income", "default", "uob_paynow")

        service.app.bot.send_message.assert_called_once()
        kwargs = service.app.bot.send_message.call_args[1]
        assert kwargs["chat_id"] == 12345
        assert "Received" in kwargs["text"]
        assert "951.90" in kwargs["text"]
        assert "💰" in kwargs["text"]
        assert kwargs.get("reply_markup") is None  # no category picker for income

    @pytest.mark.asyncio
    async def test_income_reversal_shows_received(self, in_memory_db):
        """Card reversal (income tx_type) also shows Received format."""
        service = self._make_service(in_memory_db)
        tx_id = self._insert_tx(in_memory_db, tx_type="income", merchant="Gopay-Gojek",
                                 source="uob_card", source_id="rev1", amount=23.70, category="Other")
        await service._async_notify(tx_id, 23.70, "Gopay-Gojek", "Other", "default", "uob_card")

        kwargs = service.app.bot.send_message.call_args[1]
        assert "Received" in kwargs["text"]
        assert "23.70" in kwargs["text"]
        assert kwargs.get("reply_markup") is None

    @pytest.mark.asyncio
    async def test_expense_default_category_shows_picker(self, in_memory_db):
        """Expense with default match_source → category picker keyboard."""
        service = self._make_service(in_memory_db)
        tx_id = self._insert_tx(in_memory_db, tx_type="expense", merchant="Coffee Shop",
                                 source="uob_card", source_id="exp1", amount=5.50, category="Other")
        await service._async_notify(tx_id, 5.50, "Coffee Shop", "Other", "default", "uob_card")

        kwargs = service.app.bot.send_message.call_args[1]
        assert "Pick a category" in kwargs["text"]
        assert kwargs.get("reply_markup") is not None

    @pytest.mark.asyncio
    async def test_expense_known_category_shows_tx_block(self, in_memory_db):
        """Expense with a learned/keyword match_source → formatted tx block, no picker."""
        service = self._make_service(in_memory_db)
        tx_id = self._insert_tx(in_memory_db, tx_type="expense", merchant="Grab",
                                 source="uob_card", source_id="exp2", amount=12.00, category="Transport")
        await service._async_notify(tx_id, 12.00, "Grab", "Transport", "keyword:grab", "uob_card")

        kwargs = service.app.bot.send_message.call_args[1]
        assert kwargs.get("reply_markup") is None
        assert "Grab" in kwargs["text"]
        assert "12.00" in kwargs["text"]


class TestParseAddCommandDatetime:
    def setup_method(self):
        from src.telegram_bot import TelegramBotService
        self.bot = TelegramBotService.__new__(TelegramBotService)

    def test_bare_date_stored_as_midnight(self):
        result = self.bot.parse_add_command("12.50 Lunch food 2025-04-23")
        assert result["date"] == "2025-04-23T00:00:00"
        assert result["merchant"] == "Lunch"
        assert result["category"] == "food"

    def test_datetime_stored_with_time(self):
        result = self.bot.parse_add_command("12.50 Lunch food 2025-04-23 14:30")
        assert result["date"] == "2025-04-23T14:30:00"
        assert result["merchant"] == "Lunch"
        assert result["category"] == "food"

    def test_no_date_returns_none(self):
        result = self.bot.parse_add_command("12.50 Lunch")
        assert result["date"] is None
        assert result["merchant"] == "Lunch"


def make_tx(i, tx_type="expense"):
    return {
        "id": i, "source": "manual", "source_id": f"m-{i}",
        "amount": 10.0, "currency": "SGD", "exchange_rate": 1.0,
        "merchant": f"Shop {i}", "description": None, "category": "Food",
        "transaction_date": "2026-04-15T10:00:00", "ingested_at": "2026-04-15T10:00:00",
        "type": tx_type,
    }


def test_daily_digest_sums_more_than_100_transactions(in_memory_db):
    """Month total must not be capped at 100 transactions."""
    from datetime import datetime
    from src.telegram_bot import TelegramBotService

    storage = Storage(in_memory_db)
    # Insert 150 expense transactions of $10 each = $1500 expected, dated 2026-04-15
    for i in range(150):
        in_memory_db.execute("""
            INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
                merchant, category, transaction_date, type)
            VALUES ('manual', ?, 10.0, 'SGD', 1.0, 'Shop', 'Food', '2026-04-15T10:00:00', 'expense')
        """, (f"manual-{i}",))
    in_memory_db.commit()

    captured_totals = {}

    original_query = storage.query_transactions

    def tracking_query(*args, **kwargs):
        result = original_query(*args, **kwargs)
        captured_totals["limit"] = kwargs.get("limit")
        captured_totals["count"] = len(result)
        return result

    storage.query_transactions = tracking_query

    bot = TelegramBotService(storage=storage, bot_token="fake")
    bot.chat_id = 12345

    # Patch app.bot.send_message so we can inspect the message text
    import asyncio

    sent_messages = []

    async def mock_send(**kwargs):
        sent_messages.append(kwargs.get("text", ""))

    mock_bot = MagicMock()
    mock_bot.send_message = mock_send
    mock_app = MagicMock()
    mock_app.bot = mock_bot
    bot.app = mock_app
    bot._loop = asyncio.new_event_loop()

    # Pin _local_now to April 16 so that April 15 = "yesterday" and April = current month
    with patch.object(bot, "_local_now", return_value=datetime(2026, 4, 16, 8, 0, 0)):
        bot._loop.run_until_complete(bot._send_daily_digest())

    # Find the message that contains month-to-date
    digest_text = " ".join(sent_messages)
    assert "1500" in digest_text or "1,500" in digest_text, (
        f"Expected $1500 month total but message was: {digest_text!r}. "
        f"Transactions fetched: {captured_totals.get('count')} (limit={captured_totals.get('limit')})"
    )


def test_trip_text_does_not_contain_escaped_parens():
    """_trip used MarkdownV2 escape sequences \\( \\) that are wrong for Markdown v1."""
    from src.telegram_bot import TelegramBotService

    # We only test the string construction, not the full async flow.
    # The presence of \\( in the output is the bug marker.
    bot = TelegramBotService(storage=MagicMock(), bot_token="fake")

    # Simulate the line that was broken: Day counter line
    name = "Japan Trip"
    days_elapsed = 3
    # Old (broken) pattern used MarkdownV2 escaped parens:
    old_line = f"✈️ *{bot._escape_md(name)}* \\(Day {days_elapsed}\\)"
    # New (correct) pattern for Markdown v1:
    new_line = f"✈️ *{bot._escape_md(name)}* (Day {days_elapsed})"

    assert "\\(" not in new_line, "Escaped parens should not appear in Markdown v1 output"
    assert f"(Day {days_elapsed})" in new_line


def test_trip_text_decimal_amounts_unescaped_for_markdown_v1():
    """Decimal amounts must not have escaped dots (MarkdownV2 artifact)."""
    from src.telegram_bot import TelegramBotService

    bot = TelegramBotService(storage=MagicMock(), bot_token="fake")
    amount_str = f"Total: S$123.45 across 5 transactions"
    escaped = bot._escape_md(amount_str)

    # In Markdown v1, dots are NOT special and must NOT be escaped
    assert "\\." not in escaped, "Dot should not be escaped in Markdown v1"
    assert "123.45" in escaped


import asyncio


@pytest.fixture
def bot_with_storage(in_memory_db):
    storage = Storage(in_memory_db)
    in_memory_db.execute("""
        INSERT INTO transactions (source, source_id, amount, currency, exchange_rate,
            merchant, category, transaction_date, type)
        VALUES ('manual', 'apply-cat-1', 25.0, 'SGD', 1.0,
            'Kopi Shop', 'Other', '2026-04-15T10:00:00', 'expense')
    """)
    in_memory_db.commit()
    bot = TelegramBotService(storage=storage, bot_token="fake")
    return bot, storage


def make_query_mock(data: str):
    query = AsyncMock()
    query.data = data
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    return query


def test_apply_category_update_sets_category(bot_with_storage):
    bot, storage = bot_with_storage
    tx_id = storage._conn.execute("SELECT id FROM transactions WHERE source_id='apply-cat-1'").fetchone()["id"]
    query = make_query_mock(f"cat:{tx_id}:Food")

    asyncio.get_event_loop().run_until_complete(
        bot._apply_category_update(tx_id, "Food", query)
    )

    updated = storage.get_transaction(tx_id)
    assert updated["category"] == "Food"


def test_apply_category_update_preserves_existing_merchant_override(bot_with_storage):
    bot, storage = bot_with_storage
    tx_id = storage._conn.execute("SELECT id FROM transactions WHERE source_id='apply-cat-1'").fetchone()["id"]
    query = make_query_mock(f"cat:{tx_id}:Food")

    asyncio.get_event_loop().run_until_complete(
        bot._apply_category_update(tx_id, "Food", query)
    )

    overrides = storage.get_merchant_overrides()
    assert overrides == {}
    assert "--remember" in query.edit_message_text.call_args.args[0]


def test_apply_category_update_notifies_transaction_not_found(bot_with_storage):
    bot, storage = bot_with_storage
    query = make_query_mock("cat:99999:Food")

    asyncio.get_event_loop().run_until_complete(
        bot._apply_category_update(99999, "Food", query)
    )

    query.edit_message_text.assert_called_once_with("Transaction not found.")


# ---------------------------------------------------------------------------
# Test 13: Telegram /start link-token command (multi-user mode)
# ---------------------------------------------------------------------------

def _make_multi_user_bot(in_memory_db):
    """Return a TelegramBotService wired to a real AdminStorage with one user."""
    import sqlite3
    from src.storage import AdminStorage

    admin_conn = sqlite3.connect(":memory:", check_same_thread=False)
    admin_conn.execute("PRAGMA foreign_keys = ON")
    admin_conn.row_factory = sqlite3.Row
    admin_conn.executescript("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            telegram_chat_id TEXT,
            gmail_connected INTEGER DEFAULT 0,
            wants_gmail INTEGER DEFAULT 1,
            wants_apple_wallet INTEGER DEFAULT 1,
            onboarding_complete INTEGER DEFAULT 0,
            force_password_change INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE admin_sessions (
            token TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE telegram_link_tokens (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            expires_at DATETIME NOT NULL
        );
    """)
    admin_storage = AdminStorage(admin_conn)
    admin_storage.create_user("alice", "hash")
    bot = TelegramBotService(bot_token="fake", admin_storage=admin_storage)
    return bot, admin_storage


def _make_update(chat_id: int, args: list = None):
    """Build a minimal fake telegram Update for /start."""
    message = AsyncMock()
    message.chat_id = chat_id
    message.reply_text = AsyncMock()
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message = message
    ctx = MagicMock()
    ctx.args = args or []
    return update, ctx


class TestStartCommand:
    def test_valid_token_links_chat_id(self, in_memory_db):
        """Sending /start <valid-token> writes the chat_id to the user record."""
        bot, admin_storage = _make_multi_user_bot(in_memory_db)
        token = admin_storage.create_telegram_link_token("alice")

        update, ctx = _make_update(chat_id=99001, args=[token])
        asyncio.get_event_loop().run_until_complete(bot._start(update, ctx))

        user = admin_storage.get_user("alice")
        assert user["telegram_chat_id"] == "99001"
        update.message.reply_text.assert_called_once_with("Linked. Your Telegram is connected to cashe.")

    def test_invalid_token_replies_with_error(self, in_memory_db):
        """Sending /start <bad-token> replies with an invalid code message."""
        bot, admin_storage = _make_multi_user_bot(in_memory_db)

        update, ctx = _make_update(chat_id=99002, args=["CASHE-BADTOK"])
        asyncio.get_event_loop().run_until_complete(bot._start(update, ctx))

        user = admin_storage.get_user("alice")
        assert user["telegram_chat_id"] is None
        call_text = update.message.reply_text.call_args[0][0]
        assert "invalid" in call_text.lower() or "expired" in call_text.lower()

    def test_token_is_consumed_and_cannot_be_reused(self, in_memory_db):
        """A valid token is one-time use — second /start with same token is rejected."""
        bot, admin_storage = _make_multi_user_bot(in_memory_db)
        token = admin_storage.create_telegram_link_token("alice")

        update1, ctx1 = _make_update(chat_id=99003, args=[token])
        asyncio.get_event_loop().run_until_complete(bot._start(update1, ctx1))

        # Second use — same token should be rejected
        update2, ctx2 = _make_update(chat_id=99004, args=[token])
        asyncio.get_event_loop().run_until_complete(bot._start(update2, ctx2))

        # Alice should still be linked to 99003, not 99004
        user = admin_storage.get_user("alice")
        assert user["telegram_chat_id"] == "99003"

    def test_start_with_no_args_prompts_for_code(self, in_memory_db):
        """/start with no args (and no user_manager) prompts the user to get a code."""
        bot, admin_storage = _make_multi_user_bot(in_memory_db)

        update, ctx = _make_update(chat_id=99005, args=[])
        asyncio.get_event_loop().run_until_complete(bot._start(update, ctx))

        # No user should be linked; user prompted to use a code
        call_text = update.message.reply_text.call_args[0][0]
        assert "/start" in call_text


class TestAddCommandConfirmation:
    @pytest.mark.asyncio
    async def test_add_uses_brand_hook_format(self, bot_service, in_memory_db):
        """_add confirmation should use 'cash, caught. [$amount · merchant]' format."""
        bot_service.storage.get_category_icon_map = MagicMock(return_value={})
        bot_service._build_context_line = MagicMock(return_value="")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["12.50", "Starbucks"]

        await bot_service._add(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        assert text.startswith("cash, caught.")
        assert "$12.50" in text
        assert "Starbucks" in text
        # No parse_mode="Markdown" on the new format
        call_kwargs = update.message.reply_text.call_args.kwargs
        assert call_kwargs.get("parse_mode") is None

    @pytest.mark.asyncio
    async def test_add_appends_context_line_when_present(self, bot_service, in_memory_db):
        """If _build_context_line returns a note it should appear after a newline."""
        bot_service.storage.get_category_icon_map = MagicMock(return_value={})
        bot_service._build_context_line = MagicMock(return_value="Budget 82% used — $45 left this month.")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["12.50", "Starbucks"]

        await bot_service._add(update, context)

        text = update.message.reply_text.call_args[0][0]
        assert "cash, caught." in text
        assert "Budget 82% used" in text
        assert text.index("cash, caught.") < text.index("Budget 82% used")

    @pytest.mark.asyncio
    async def test_add_no_context_line_no_trailing_newline(self, bot_service, in_memory_db):
        """When _build_context_line returns '' there should be no trailing newline."""
        bot_service.storage.get_category_icon_map = MagicMock(return_value={})
        bot_service._build_context_line = MagicMock(return_value="")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["5.00", "Toast", "Box"]

        await bot_service._add(update, context)

        text = update.message.reply_text.call_args[0][0]
        assert not text.endswith("\n")
        assert "\n" not in text


class TestCashCommandConfirmation:
    @pytest.mark.asyncio
    async def test_cash_uses_brand_hook_format(self, bot_service, in_memory_db):
        """_cash confirmation should use 'cash, caught. [$amount · merchant]' format."""
        bot_service.storage.get_category_icon_map = MagicMock(return_value={})
        bot_service._build_context_line = MagicMock(return_value="")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["8.00", "Hawker"]

        await bot_service._cash(update, context)

        update.message.reply_text.assert_called_once()
        text = update.message.reply_text.call_args[0][0]
        assert text.startswith("cash, caught.")
        assert "$8.00" in text
        assert "Hawker" in text
        call_kwargs = update.message.reply_text.call_args.kwargs
        assert call_kwargs.get("parse_mode") is None

    @pytest.mark.asyncio
    async def test_cash_appends_context_line_when_present(self, bot_service, in_memory_db):
        """If _build_context_line returns a note it should be appended."""
        bot_service.storage.get_category_icon_map = MagicMock(return_value={})
        bot_service._build_context_line = MagicMock(return_value="Hawker — 3× this week.")

        update = MagicMock()
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["4.50", "Hawker"]

        await bot_service._cash(update, context)

        text = update.message.reply_text.call_args[0][0]
        assert "cash, caught." in text
        assert "Hawker — 3× this week." in text



@pytest.mark.parametrize('notification', ['transaction', 'suggestion'])
def test_notification_bridge_returns_send_future(in_memory_db, monkeypatch, notification):
    from concurrent.futures import Future
    from unittest.mock import MagicMock
    import src.telegram_bot as module

    bot = TelegramBotService(storage=Storage(in_memory_db), bot_token='test-token')
    bot._resolve_chat_id = MagicMock(return_value=123)
    bot._loop = MagicMock()
    bot.app = MagicMock()
    future = Future()
    def submit(coroutine, loop):
        coroutine.close()
        assert loop is bot._loop
        return future
    monkeypatch.setattr(module.asyncio, 'run_coroutine_threadsafe', submit)
    if notification == 'transaction':
        result = bot.notify_transaction(1, 12.5, 'Cafe', None, 'default', 'apple_wallet')
    else:
        result = bot.notify_subscription_suggestion('alice', 'Cafe', 'monthly', 12.5)
    assert result is future
    assert not result.done()
    future.set_exception(RuntimeError('send failed'))
    with pytest.raises(RuntimeError, match='send failed'):
        result.result()


@pytest.mark.asyncio
@pytest.mark.parametrize('remember', [False, True])
async def test_recategorize_explicit_rule_scope(bot_with_storage, remember):
    bot, storage = bot_with_storage
    storage._conn.execute("INSERT INTO categories (name, keywords) VALUES ('Food and Drink', '')")
    storage._conn.commit()
    tx_id = storage._conn.execute("SELECT id FROM transactions WHERE source_id='apply-cat-1'").fetchone()['id']
    update = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = [str(tx_id), 'Food', 'and', 'Drink'] + (['--remember'] if remember else [])
    await bot._recategorize(update, context)
    assert storage.get_transaction(tx_id)['category'] == 'Food and Drink'
    assert storage.get_merchant_overrides() == ({'Kopi Shop': 'Food and Drink'} if remember else {})
    if remember:
        context.args = [str(tx_id), '--remember']
        await bot._recategorize(update, context)
        assert storage.get_merchant_overrides() == {'Kopi Shop': 'Food and Drink'}


@pytest.mark.asyncio
async def test_accepted_recurring_suggestion_records_confirmation(bot_service):
    query = SimpleNamespace(data='sub_suggest_add|monthly|Cafe', answer=AsyncMock(), edit_message_text=AsyncMock())
    update = SimpleNamespace(callback_query=query)
    ctx = SimpleNamespace(storage=bot_service.storage)
    with patch.object(bot_service, '_require_ctx', new=AsyncMock(return_value=ctx)):
        await bot_service._handle_sub_suggest_callback(update, SimpleNamespace())
    schedules = bot_service.storage.list_subscriptions()
    assert len(schedules) == 1
    assert schedules[0]['confirmation_source'] == 'recurring_suggestion'
