"""Tests for TelegramBotService pace note helper methods."""
import pytest
from src.telegram_bot import TelegramBotService


@pytest.fixture
def bot():
    return TelegramBotService(bot_token="test-token")


class TestBuildPaceNoteDaily:
    def test_on_track_under_50_pct(self, bot):
        # $20 of $100 budget = 20%
        assert bot._build_pace_note_daily(20.0, 100.0) == "On track."

    def test_on_track_exactly_50_pct(self, bot):
        assert bot._build_pace_note_daily(50.0, 100.0) == "On track."

    def test_pacing_70_pct(self, bot):
        # $70 of $100 = 70%
        result = bot._build_pace_note_daily(70.0, 100.0)
        assert result == "Pacing 70% of daily budget."

    def test_pacing_90_pct(self, bot):
        result = bot._build_pace_note_daily(90.0, 100.0)
        assert result == "Pacing 90% of daily budget."

    def test_nearly_at_limit_between_90_and_100(self, bot):
        # $95 of $100 = 95%
        result = bot._build_pace_note_daily(95.0, 100.0)
        assert result == "Nearly at daily limit."

    def test_over_daily_budget(self, bot):
        # $120 of $100 = 20% over
        result = bot._build_pace_note_daily(120.0, 100.0)
        assert result == "Over daily by $20.00."

    def test_zero_budget_returns_empty(self, bot):
        assert bot._build_pace_note_daily(50.0, 0.0) == ""

    def test_negative_budget_returns_empty(self, bot):
        assert bot._build_pace_note_daily(50.0, -10.0) == ""
