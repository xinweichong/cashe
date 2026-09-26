"""Tests for TelegramBotService._build_context_line."""
import pytest
from unittest.mock import MagicMock, patch
from src.telegram_bot import TelegramBotService
from src.storage import Storage


@pytest.fixture
def bot(in_memory_db):
    storage = Storage(connection=in_memory_db)
    return TelegramBotService(storage=storage, bot_token="test-token")


# ---------------------------------------------------------------------------
# 1. Budget 80% used → returns budget message
# ---------------------------------------------------------------------------

class TestBuildContextLineBudget:
    def test_budget_75_to_99_pct_returns_budget_message(self, bot):
        mock_progress = [
            {
                "category": "Food",
                "budget_amount": 100.0,
                "spent": 80.0,
                "remaining": 20.0,
                "percent": 80.0,
            }
        ]
        bot.storage.get_budget_progress = MagicMock(return_value=mock_progress)
        result = bot._build_context_line(bot.storage, "Food", "KFC", 10.0)
        assert result == "Budget 80% used — 20 left this month."

    def test_budget_over_100_pct_returns_over_budget_message(self, bot):
        mock_progress = [
            {
                "category": "Food",
                "budget_amount": 100.0,
                "spent": 105.0,
                "remaining": -5.0,
                "percent": 105.0,
            }
        ]
        bot.storage.get_budget_progress = MagicMock(return_value=mock_progress)
        result = bot._build_context_line(bot.storage, "Food", "KFC", 10.0)
        assert result == "Over budget by 5."

    def test_budget_below_75_pct_skips_budget_check(self, bot, in_memory_db):
        # Budget at 50% — should not produce a budget message
        mock_progress = [
            {
                "category": "Food",
                "budget_amount": 100.0,
                "spent": 50.0,
                "remaining": 50.0,
                "percent": 50.0,
            }
        ]
        bot.storage.get_budget_progress = MagicMock(return_value=mock_progress)
        # No merchant visits, no anomaly data → empty string
        result = bot._build_context_line(bot.storage, "Food", "UniqueMerchantXYZ", 5.0)
        assert result == ""


# ---------------------------------------------------------------------------
# 2. Repeat merchant ≥ 3 times this week → returns repeat message
# ---------------------------------------------------------------------------

class TestBuildContextLineRepeatMerchant:
    def _insert_merchant_txns(self, in_memory_db, merchant, count, days_ago=0):
        """Insert `count` transactions for a merchant, all within the last 7 days."""
        from datetime import date, timedelta
        base_date = (date.today() - timedelta(days=days_ago)).isoformat()
        for i in range(count):
            in_memory_db.execute(
                "INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date) "
                "VALUES ('manual', ?, 10.0, ?, 'Food', ?)",
                (f"sid-{merchant}-{i}", merchant, f"{base_date}T10:00:00"),
            )
        in_memory_db.commit()

    def test_merchant_3x_this_week_returns_repeat_message(self, bot, in_memory_db):
        # 2 prior DB rows + this transaction = 3 total → triggers at exactly ≥ 3
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        self._insert_merchant_txns(in_memory_db, "Starbucks", 2)
        result = bot._build_context_line(bot.storage, "Food", "Starbucks", 8.0)
        assert result == "Starbucks — 3× this week."

    def test_merchant_4x_this_week_returns_correct_count(self, bot, in_memory_db):
        # 3 prior DB rows + this transaction = 4 total
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        self._insert_merchant_txns(in_memory_db, "GrabFood", 3)
        result = bot._build_context_line(bot.storage, "Food", "GrabFood", 8.0)
        assert result == "GrabFood — 4× this week."

    def test_merchant_1x_in_db_with_current_is_2x_no_repeat(self, bot, in_memory_db):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        self._insert_merchant_txns(in_memory_db, "PastaMania", 1)
        # 1 in DB + this transaction = 2 total → should NOT trigger (need ≥ 3)
        result = bot._build_context_line(bot.storage, "Food", "PastaMania", 8.0)
        assert result == ""

    def test_merchant_3x_older_than_7_days_no_repeat_message(self, bot, in_memory_db):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        self._insert_merchant_txns(in_memory_db, "OldMerchant", 3, days_ago=10)
        result = bot._build_context_line(bot.storage, "Food", "OldMerchant", 8.0)
        assert result == ""


# ---------------------------------------------------------------------------
# 3. Anomaly ≥ 2× category median → returns anomaly message
# ---------------------------------------------------------------------------

class TestBuildContextLineAnomaly:
    def _insert_category_txns(self, in_memory_db, category, amounts, days_ago=15):
        """Insert transactions for a category with given amounts."""
        from datetime import date, timedelta
        base_date = (date.today() - timedelta(days=days_ago)).isoformat()
        for i, amt in enumerate(amounts):
            in_memory_db.execute(
                "INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date) "
                "VALUES ('manual', ?, ?, 'SomeMerchant', ?, ?)",
                (f"sid-cat-{i}", amt, category, f"{base_date}T10:00:00"),
            )
        in_memory_db.commit()

    def test_anomaly_2_5x_median_returns_anomaly_message(self, bot, in_memory_db):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        # Median of [10, 10, 10] = 10; amount = 25.0 → 2.5× → triggers
        self._insert_category_txns(in_memory_db, "Dining", [10.0, 10.0, 10.0])
        result = bot._build_context_line(bot.storage, "Dining", "UniqueRestaurantXYZ", 25.0)
        assert result == "Unusual — 2.5× the usual Dining spend."

    def test_anomaly_1_5x_median_no_message(self, bot, in_memory_db):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        # Median of [10, 10, 10] = 10; amount = 15.0 → 1.5× → no trigger
        self._insert_category_txns(in_memory_db, "Transport", [10.0, 10.0, 10.0])
        result = bot._build_context_line(bot.storage, "Transport", "UniqueGrab", 15.0)
        assert result == ""

    def test_anomaly_fewer_than_3_prior_txns_no_message(self, bot, in_memory_db):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        # Only 2 prior transactions → minimum 3 required → no trigger
        self._insert_category_txns(in_memory_db, "Coffee", [5.0, 5.0])
        result = bot._build_context_line(bot.storage, "Coffee", "UniqueBarXYZ", 50.0)
        assert result == ""


# ---------------------------------------------------------------------------
# 4. None apply → returns empty string
# ---------------------------------------------------------------------------

class TestBuildContextLineNoneApply:
    def test_returns_empty_when_nothing_applies(self, bot):
        bot.storage.get_budget_progress = MagicMock(return_value=[])
        # No transactions in DB at all
        result = bot._build_context_line(bot.storage, "Food", "NewMerchantEver", 10.0)
        assert result == ""


# ---------------------------------------------------------------------------
# 5. Budget takes priority over repeat merchant
# ---------------------------------------------------------------------------

class TestBuildContextLinePriority:
    def test_budget_check_takes_priority_over_repeat_merchant(self, bot, in_memory_db):
        # Budget at 80% for Food
        mock_progress = [
            {
                "category": "Food",
                "budget_amount": 100.0,
                "spent": 80.0,
                "remaining": 20.0,
                "percent": 80.0,
            }
        ]
        bot.storage.get_budget_progress = MagicMock(return_value=mock_progress)

        # Also insert 3 merchant visits this week
        from datetime import date
        today = date.today().isoformat()
        for i in range(3):
            in_memory_db.execute(
                "INSERT INTO transactions (source, source_id, amount, merchant, category, transaction_date) "
                "VALUES ('manual', ?, 10.0, 'BudgetMerchant', 'Food', ?)",
                (f"sid-priority-{i}", f"{today}T10:00:00"),
            )
        in_memory_db.commit()

        result = bot._build_context_line(bot.storage, "Food", "BudgetMerchant", 10.0)
        # Should return budget message, not repeat message
        assert result == "Budget 80% used — 20 left this month."
