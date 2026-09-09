import pytest
import calendar
from datetime import datetime, timedelta, date
from src.storage import Storage


class TestBudgetCRUD:
    def test_create_overall_monthly_budget(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        budget_id = storage.create_budget(category=None, amount=3000.0, period="monthly")
        assert isinstance(budget_id, int)
        budgets = storage.get_budgets()
        assert len(budgets) == 1
        assert budgets[0]["category"] is None
        assert budgets[0]["amount"] == 3000.0
        assert budgets[0]["period"] == "monthly"

    def test_create_category_budget(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category="Dining", amount=200.0, period="monthly")
        budgets = storage.get_budgets()
        assert budgets[0]["category"] == "Dining"

    def test_create_weekly_budget(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category="Dining", amount=50.0, period="weekly")
        budgets = storage.get_budgets()
        assert budgets[0]["period"] == "weekly"

    def test_same_category_can_have_both_monthly_and_weekly(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category="Dining", amount=200.0, period="monthly")
        storage.create_budget(category="Dining", amount=50.0, period="weekly")
        assert len(storage.get_budgets()) == 2

    def test_duplicate_category_period_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category="Dining", amount=200.0, period="monthly")
        with pytest.raises(ValueError, match="already exists"):
            storage.create_budget(category="Dining", amount=300.0, period="monthly")

    def test_update_budget_amount(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        budget_id = storage.create_budget(category=None, amount=3000.0, period="monthly")
        storage.update_budget(budget_id, amount=4000.0)
        assert storage.get_budgets()[0]["amount"] == 4000.0

    def test_update_nonexistent_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        with pytest.raises(ValueError):
            storage.update_budget(999, amount=100.0)

    def test_delete_budget(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        budget_id = storage.create_budget(category=None, amount=3000.0, period="monthly")
        storage.delete_budget(budget_id)
        assert storage.get_budgets() == []

    def test_delete_nonexistent_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        with pytest.raises(ValueError):
            storage.delete_budget(999)


class TestBudgetProgress:
    def test_empty_progress_when_no_budgets(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        assert storage.get_budget_progress() == []

    def test_monthly_budget_zero_spending(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=3000.0, period="monthly")
        progress = storage.get_budget_progress()
        assert len(progress) == 1
        p = progress[0]
        assert p["spent"] == 0.0
        assert p["remaining"] == 3000.0
        assert p["percent"] == 0.0
        assert p["status"] == "on_track"
        assert p["label"] == "Overall"
        assert p["budget_amount"] == 3000.0

    def test_category_budget_only_counts_matching_category(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category="Dining", amount=200.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, 'M', ?, ?, 'expense')",
            [("b1", 50.0, "Dining", today), ("b2", 100.0, "Transport", today)],
        )
        in_memory_db.commit()
        progress = storage.get_budget_progress()
        assert progress[0]["spent"] == 50.0  # only Dining

    def test_overall_budget_sums_all_expense_categories(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=1000.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.executemany(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, category, transaction_date, type) VALUES ('manual', ?, ?, 'SGD', 1.0, 'M', ?, ?, 'expense')",
            [("b1", 100.0, "Dining", today), ("b2", 50.0, "Transport", today)],
        )
        in_memory_db.commit()
        progress = storage.get_budget_progress()
        assert progress[0]["spent"] == 150.0

    def test_income_excluded_from_budget_progress(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=1000.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'i1', 5000, 'SGD', 1.0, 'Employer', ?, 'income')",
            (today,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["spent"] == 0.0

    def test_previous_month_transactions_excluded(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=1000.0, period="monthly")
        last_month = (date.today().replace(day=1) - timedelta(days=1)).isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'b1', 500.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (last_month,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["spent"] == 0.0

    def test_status_on_track_below_80(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=100.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'b1', 70.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["status"] == "on_track"

    def test_status_warning_at_80_percent(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=100.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'b1', 80.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["status"] == "warning"

    def test_status_over_budget_at_100_percent(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=100.0, period="monthly")
        today = date.today().isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'b1', 110.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["status"] == "over_budget"

    def test_exchange_rate_applied_to_progress(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=200.0, period="monthly")
        today = date.today().isoformat()
        # JPY transaction: 1000 JPY at 0.01 rate = SGD 10
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'b1', 1000.0, 'JPY', 0.01, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()
        assert storage.get_budget_progress()[0]["spent"] == pytest.approx(10.0, 0.01)

    def test_unresolved_foreign_amount_excluded_from_progress(self, in_memory_db):
        """R04: a legacy exchange_rate of 1.0 is a silent unresolved fallback,
        not real conversion evidence — must not be summed at face value."""
        storage = Storage(connection=in_memory_db)
        storage.create_budget(category=None, amount=200.0, period="monthly")
        today = date.today().isoformat()
        storage.insert_transaction(
            source="manual", source_id="b1", amount=50.0,
            merchant="M", transaction_date=today,
        )
        storage.insert_transaction(
            source="manual", source_id="b2", amount=500.0, currency="THB", exchange_rate=1.0,
            merchant="M", transaction_date=today,
        )
        assert storage.get_budget_progress()[0]["spent"] == pytest.approx(50.0, 0.01)


import bcrypt
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


@pytest.fixture
def budget_app(in_memory_db):
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user()
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    yield create_dashboard_app(user_manager, admin_storage), storage
    _auth._admin_storage = None


@pytest_asyncio.fixture
async def api(budget_app):
    app, storage = budget_app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac, storage


class TestBudgetAPI:
    @pytest.mark.asyncio
    async def test_get_budgets_empty(self, api):
        ac, _ = api
        resp = await ac.get("/api/budgets")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_create_budget(self, api):
        ac, _ = api
        resp = await ac.post("/api/budgets", json={"category": None, "amount": 3000, "period": "monthly"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["amount"] == 3000.0
        assert data["category"] is None
        assert data["period"] == "monthly"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_budget_invalid_period(self, api):
        ac, _ = api
        resp = await ac.post("/api/budgets", json={"amount": 1000, "period": "yearly"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_duplicate_raises_409(self, api):
        ac, _ = api
        await ac.post("/api/budgets", json={"category": None, "amount": 1000, "period": "monthly"})
        resp = await ac.post("/api/budgets", json={"category": None, "amount": 2000, "period": "monthly"})
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_get_budget_progress(self, api):
        ac, _ = api
        await ac.post("/api/budgets", json={"category": None, "amount": 1000, "period": "monthly"})
        resp = await ac.get("/api/budgets/progress")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["label"] == "Overall"
        assert data[0]["spent"] == 0.0
        assert data[0]["status"] == "on_track"

    @pytest.mark.asyncio
    async def test_get_budget_progress_v2_returns_canonical_money(self, api):
        ac, storage = api
        await ac.post("/api/budgets", json={"category": None, "amount": 100, "period": "monthly"})
        today = date.today().isoformat()
        storage.insert_transaction(
            source="manual", source_id="v2-1", amount=110.0,
            merchant="M", transaction_date=today,
        )
        resp = await ac.get("/api/v2/budgets/progress")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["label"] == "Overall"
        assert data[0]["budget_amount"] == {"minor_units": 10000, "currency": "SGD"}
        assert data[0]["spent"] == {"minor_units": 11000, "currency": "SGD"}
        assert data[0]["remaining"] == {"minor_units": -1000, "currency": "SGD"}
        assert data[0]["status"] == "over_budget"

    @pytest.mark.asyncio
    async def test_update_budget(self, api):
        ac, _ = api
        create = await ac.post("/api/budgets", json={"category": None, "amount": 1000, "period": "monthly"})
        budget_id = create.json()["id"]
        resp = await ac.put(f"/api/budgets/{budget_id}", json={"amount": 2000})
        assert resp.status_code == 200
        assert resp.json()["amount"] == 2000.0

    @pytest.mark.asyncio
    async def test_update_nonexistent_returns_404(self, api):
        ac, _ = api
        resp = await ac.put("/api/budgets/999", json={"amount": 100})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_budget(self, api):
        ac, _ = api
        create = await ac.post("/api/budgets", json={"category": None, "amount": 1000, "period": "monthly"})
        budget_id = create.json()["id"]
        resp = await ac.delete(f"/api/budgets/{budget_id}")
        assert resp.status_code == 200
        assert (await ac.get("/api/budgets")).json() == []

    @pytest.mark.asyncio
    async def test_settings_includes_budgets_enabled(self, api):
        ac, _ = api
        resp = await ac.get("/api/settings")
        assert resp.status_code == 200
        assert "budgets_enabled" in resp.json()
        assert resp.json()["budgets_enabled"] is False

    @pytest.mark.asyncio
    async def test_toggle_budgets_enabled(self, api):
        ac, _ = api
        resp = await ac.put("/api/settings", json={"budgets_enabled": True})
        assert resp.status_code == 200
        resp2 = await ac.get("/api/settings")
        assert resp2.json()["budgets_enabled"] is True


from unittest.mock import AsyncMock, MagicMock, patch


class TestBudgetAlerts:
    @pytest.mark.asyncio
    async def test_no_alert_when_budgets_disabled(self, in_memory_db):
        """_check_and_alert_budgets should be a no-op when budgets_enabled=false."""
        from src.storage import Storage
        from src.telegram_bot import TelegramBotService

        storage = Storage(connection=in_memory_db)
        # budgets_enabled defaults to "false" (not set = uses default)
        bot = TelegramBotService.__new__(TelegramBotService)
        bot.storage = storage
        bot.chat_id = 12345
        bot.app = MagicMock()
        bot.app.bot.send_message = AsyncMock()

        await bot._check_and_alert_budgets("Dining", 50.0)

        bot.app.bot.send_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_warning_alert_fired_when_crossing_80_percent(self, in_memory_db):
        """Alert sent when a transaction pushes spending from below 80% to at/above 80%."""
        from src.storage import Storage
        from src.telegram_bot import TelegramBotService

        storage = Storage(connection=in_memory_db)
        storage.set_setting("budgets_enabled", "true")
        storage.create_budget(category=None, amount=100.0, period="monthly")

        today = date.today().isoformat()
        # Pre-seed 70 already spent (below 80%)
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'p1', 70.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()

        bot = TelegramBotService.__new__(TelegramBotService)
        bot.storage = storage
        bot.chat_id = 12345
        bot.app = MagicMock()
        bot.app.bot.send_message = AsyncMock()

        # New transaction adds 15 SGD → total 85 → 85%, crosses 80%
        await bot._check_and_alert_budgets(None, 15.0)

        bot.app.bot.send_message.assert_called_once()
        call_text = bot.app.bot.send_message.call_args[1]["text"]
        assert "⚠️" in call_text or "Budget Alert" in call_text

    @pytest.mark.asyncio
    async def test_exceeded_alert_fired_when_crossing_100_percent(self, in_memory_db):
        """Alert sent when a transaction pushes spending from below 100% to at/above 100%."""
        from src.storage import Storage
        from src.telegram_bot import TelegramBotService

        storage = Storage(connection=in_memory_db)
        storage.set_setting("budgets_enabled", "true")
        storage.create_budget(category=None, amount=100.0, period="monthly")

        today = date.today().isoformat()
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, "
            "merchant, transaction_date, type) VALUES ('manual', 'p1', 90.0, 'SGD', 1.0, 'M', ?, 'expense')",
            (today,),
        )
        in_memory_db.commit()

        bot = TelegramBotService.__new__(TelegramBotService)
        bot.storage = storage
        bot.chat_id = 12345
        bot.app = MagicMock()
        bot.app.bot.send_message = AsyncMock()

        await bot._check_and_alert_budgets(None, 20.0)

        bot.app.bot.send_message.assert_called_once()
        call_text = bot.app.bot.send_message.call_args[1]["text"]
        assert "🚨" in call_text or "Exceeded" in call_text

    @pytest.mark.asyncio
    async def test_no_alert_when_below_80_percent(self, in_memory_db):
        from src.storage import Storage
        from src.telegram_bot import TelegramBotService

        storage = Storage(connection=in_memory_db)
        storage.set_setting("budgets_enabled", "true")
        storage.create_budget(category=None, amount=1000.0, period="monthly")

        bot = TelegramBotService.__new__(TelegramBotService)
        bot.storage = storage
        bot.chat_id = 12345
        bot.app = MagicMock()
        bot.app.bot.send_message = AsyncMock()

        await bot._check_and_alert_budgets(None, 100.0)  # 10% of 1000

        bot.app.bot.send_message.assert_not_called()
