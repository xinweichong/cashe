import pytest
from datetime import datetime

from src.config import local_now
from src.exchange import ExchangeRateService, FALLBACK_RATES, RateResult


class TestExchangeRateService:
    def test_get_rate_sgd_is_native(self):
        svc = ExchangeRateService()
        result = svc.get_rate("SGD")
        assert result == RateResult(status="native", rate=1.0, source="native")

    def test_parse_currency_detects_thb(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("500 THB")
        assert amount == 500.0
        assert currency == "THB"

    def test_parse_currency_no_currency_returns_sgd(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("12.50")
        assert amount == 12.50
        assert currency == "SGD"

    def test_parse_currency_jpy(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("2000 JPY")
        assert amount == 2000.0
        assert currency == "JPY"

    def test_fallback_rate_is_labeled_indicative_not_resolved(self):
        svc = ExchangeRateService()
        svc._rates = {}  # Empty cache, no fetch
        svc._rates_fetched_at = local_now()  # Not stale
        result = svc.get_rate("THB")
        assert result.status == "indicative"
        assert result.rate == FALLBACK_RATES["THB"]
        assert result.source == "fallback"

    def test_parse_currency_invalid_amount(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("abc")
        assert amount == 0.0
        assert currency == "SGD"

    def test_parse_currency_usd(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("100 USD")
        assert amount == 100.0
        assert currency == "USD"

    def test_parse_currency_case_insensitive(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("500 thb")
        assert amount == 500.0
        assert currency == "THB"

    def test_parse_currency_unknown_code_defaults_sgd(self):
        svc = ExchangeRateService()
        amount, currency = svc.parse_currency_amount("500 XYZ")
        assert amount == 500.0
        assert currency == "SGD"

    def test_get_rate_unknown_but_has_fallback_is_indicative(self):
        svc = ExchangeRateService()
        svc._rates = {}
        svc._rates_fetched_at = local_now()
        result = svc.get_rate("USD")
        assert result.status == "indicative"
        assert result.rate == FALLBACK_RATES["USD"]

    def test_get_rate_with_no_fallback_is_unresolved_never_one(self):
        """The core fix: a currency with no live rate and no fallback must
        never silently become a 1.0 rate — that's exactly the sentinel
        legacy readers already treat as an unresolved conversion."""
        svc = ExchangeRateService()
        svc._rates = {}
        svc._rates_fetched_at = local_now()
        result = svc.get_rate("KRW")  # not in FALLBACK_RATES
        assert result == RateResult(status="unresolved", rate=None, source=None)

    def test_get_rate_live_fetch_is_resolved(self):
        svc = ExchangeRateService()
        svc._rates = {"USD": 0.74}  # what _fetch_rates stores after inverting
        svc._rates_fetched_at = local_now()
        result = svc.get_rate("USD")
        assert result.status == "resolved"
        assert result.rate == 0.74
        assert result.source == "api"

    def test_cache_stale_when_no_fetch_time(self):
        svc = ExchangeRateService()
        assert svc._is_cache_stale() is True

    def test_cache_not_stale_after_set(self):
        svc = ExchangeRateService()
        svc._rates_fetched_at = local_now()
        assert svc._is_cache_stale() is False

    def test_get_rate_triggers_fetch_when_stale(self):
        svc = ExchangeRateService()
        fetched = []

        def mock_fetch():
            fetched.append(True)
            svc._rates = FALLBACK_RATES
            svc._rates_fetched_at = local_now()
            return FALLBACK_RATES

        svc._fetch_rates = mock_fetch
        svc.get_rate("USD")
        assert len(fetched) == 1
