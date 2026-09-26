"""Tests for LLMService — Gemini calls are mocked."""

import json
from unittest.mock import MagicMock, patch
import pytest
from src.llm_service import LLMService, create_llm_service


@pytest.fixture
def mock_model():
    """Patch Client so no real API call is made."""
    with patch("google.genai.Client") as MockClient:
        instance = MockClient.return_value
        yield instance


@pytest.fixture
def svc(mock_model):
    return LLMService(api_key="fake-key")


def _mock_response(model_mock, text: str):
    resp = MagicMock()
    resp.text = text
    model_mock.models.generate_content.return_value = resp


class TestParseTelegramMessage:
    def test_valid_transaction(self, svc, mock_model):
        payload = {
            "amount": 15.90, "currency": "SGD", "merchant": "Starbucks",
            "date": "2026-05-28", "category_hint": "Food", "confidence": 0.95,
        }
        _mock_response(mock_model, json.dumps(payload))
        result = svc.parse_telegram_message("spent $15.90 at Starbucks", ["Food", "Transport"])
        assert result["amount"] == 15.90
        assert result["merchant"] == "Starbucks"
        assert result["confidence"] == 0.95

    def test_non_transaction_returns_low_confidence(self, svc, mock_model):
        _mock_response(mock_model, json.dumps({"confidence": 0.0}))
        result = svc.parse_telegram_message("hello how are you", ["Food"])
        assert result["confidence"] == 0.0

    def test_api_error_returns_none(self, svc, mock_model):
        mock_model.models.generate_content.side_effect = Exception("API error")
        result = svc.parse_telegram_message("spent $10", ["Food"])
        assert result is None

    def test_strips_markdown_fences(self, svc, mock_model):
        payload = {"amount": 5.0, "currency": "SGD", "merchant": "Grab",
                   "date": "2026-05-28", "category_hint": "Transport", "confidence": 0.9}
        _mock_response(mock_model, f"```json\n{json.dumps(payload)}\n```")
        result = svc.parse_telegram_message("grab ride $5", ["Transport"])
        assert result["amount"] == 5.0


class TestGeneratePeriodInsight:
    def test_returns_narrative_and_nudges(self, svc, mock_model):
        payload = {"narrative": "Good month.", "nudges": ["Cut dining by $50", "Add to goals"]}
        _mock_response(mock_model, json.dumps(payload))
        result = svc.generate_period_insight({"period_label": "May 2026"})
        assert result["narrative"] == "Good month."
        assert len(result["nudges"]) == 2

    def test_caps_nudges_at_three(self, svc, mock_model):
        payload = {"narrative": "x", "nudges": ["a", "b", "c", "d", "e"]}
        _mock_response(mock_model, json.dumps(payload))
        result = svc.generate_period_insight({})
        assert len(result["nudges"]) == 3

    def test_api_error_returns_empty(self, svc, mock_model):
        mock_model.models.generate_content.side_effect = Exception("timeout")
        result = svc.generate_period_insight({})
        assert result["narrative"] == ""
        assert result["nudges"] == []


class TestCreateLlmService:
    def test_returns_none_when_no_key(self):
        result = create_llm_service({})
        assert result is None

    def test_returns_none_when_empty_key(self):
        result = create_llm_service({"gemini_api_key": ""})
        assert result is None

    def test_returns_none_when_key_present_but_policy_not_confirmed(self):
        """An API key alone must not enable cloud calls (fail-closed gate)."""
        result = create_llm_service({"gemini_api_key": "abc123"})
        assert result is None

    def test_returns_none_when_policy_confirmed_but_no_key(self):
        result = create_llm_service({"gemini_policy_confirmed": True})
        assert result is None

    def test_returns_service_when_key_present_and_policy_confirmed(self):
        with patch("google.genai.Client"):
            result = create_llm_service({"gemini_api_key": "abc123", "gemini_policy_confirmed": True})
        assert result is not None
        assert isinstance(result, LLMService)

