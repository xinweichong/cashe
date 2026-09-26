from dataclasses import dataclass
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx

from src.config import local_now

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateResult:
    """Replaces the old numeric-only get_rate() contract.

    status is one of:
      'native'     — SGD, no conversion needed (rate is always 1.0)
      'resolved'   — a live-fetched rate for this exact currency
      'indicative' — a hardcoded fallback estimate, not a live quote
      'unresolved' — no live rate and no fallback; rate is None

    Never conflate 'indicative' with 'resolved' — a fallback estimate must
    stay labeled as one. Unknown is always 'unresolved', never a silent 1.0.
    """
    status: str
    rate: Optional[float] = None
    source: Optional[str] = None

# Currencies Telegram accepts after an amount ("12 THB") — deliberately a
# short list of travel currencies, not every code src/money.py can store.
CURRENCY_CODES = {
    "USD", "EUR", "GBP", "JPY", "THB", "MYR", "IDR", "PHP",
    "VND", "CNY", "HKD", "TWD", "KRW", "AUD", "NZD", "CAD",
    "CHF", "INR", "SGD",
}

FALLBACK_RATES = {
    "SGD": 1.0, "USD": 1.34, "EUR": 1.45, "GBP": 1.70,
    "JPY": 0.0091, "THB": 0.037, "MYR": 0.30, "IDR": 0.000082,
    "PHP": 0.023, "CNY": 0.18, "HKD": 0.17, "AUD": 0.87,
}


class ExchangeRateService:
    def __init__(self, api_url: Optional[str] = None, cache_hours: int = 24):
        self.api_url = api_url or os.environ.get(
            "EXCHANGE_RATE_API_URL", "https://open.er-api.com/v6/latest/SGD"
        )
        self.cache_hours = cache_hours
        self._rates: dict[str, float] = {}
        self._rates_fetched_at: Optional[datetime] = None
        # Error state — read by /api/status
        self.using_fallback: bool = False
        self.last_fetch_error: Optional[str] = None

    def _is_cache_stale(self) -> bool:
        if not self._rates_fetched_at:
            return True
        return local_now() - self._rates_fetched_at > timedelta(hours=self.cache_hours)

    def _fetch_rates(self) -> dict[str, float]:
        try:
            resp = httpx.get(self.api_url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            rates = data.get("rates", {})
            # API returns rates with SGD as base (e.g. rates["GBP"] = 0.58 means
            # 1 SGD buys 0.58 GBP). We need "SGD per 1 unit of foreign currency"
            # (i.e. the inverse) so that amount * exchange_rate gives SGD value.
            self._rates = {k: (1.0 / v if v else 1.0) for k, v in rates.items()}
            self._rates_fetched_at = local_now()
            self.using_fallback = False
            self.last_fetch_error = None
            logger.info("Fetched exchange rates: %d currencies", len(rates))
            return rates
        except Exception as e:
            # Always update the timestamp on failure so _is_cache_stale() respects
            # the cache window and we don't retry on every single get_rate() call.
            self._rates_fetched_at = local_now()
            self.using_fallback = True
            self.last_fetch_error = str(e)
            logger.warning("Failed to fetch exchange rates: %s. Using fallback.", e)
            return FALLBACK_RATES

    def get_rate(self, currency: str) -> RateResult:
        if currency == "SGD":
            return RateResult(status="native", rate=1.0, source="native")
        if self._is_cache_stale():
            self._fetch_rates()
        if not self.using_fallback:
            rate = self._rates.get(currency)
            if rate is not None:
                return RateResult(status="resolved", rate=rate, source="api")
        fallback = FALLBACK_RATES.get(currency)
        if fallback is not None:
            logger.warning("No live rate for %s, using indicative fallback", currency)
            return RateResult(status="indicative", rate=fallback, source="fallback")
        logger.warning("No rate or fallback for %s; unresolved", currency)
        return RateResult(status="unresolved")
