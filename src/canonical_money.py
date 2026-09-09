"""Computes the R02 canonical money columns from a legacy transaction row.

Business rules specific to this app (SGD is native, a legacy 1.0 rate may be
a silent fallback, ...) — layered on top of the generic src/money.py domain
module. Pure and side-effect-free; reused by scripts/backfill_canonical_money.py
and by Storage.insert_transaction for new captures.

Never infers a refund from old income, never fabricates a rate, and never
treats a legacy 1.0 foreign rate as real conversion evidence — matching
src/spending_facts.convert_legacy_sgd, which this supersedes for storage
(that function stays as the read-time compatibility path).
"""
import math
from decimal import Decimal
from typing import Optional, TypedDict

from src.exchange import RateResult
from src.money import UnsupportedCurrencyError, to_minor_units


class CanonicalTransactionMoney(TypedDict):
    issue: Optional[str]
    original_minor_units: Optional[int]
    reporting_minor_units: Optional[int]
    conversion_status: Optional[str]
    conversion_rate: Optional[str]
    conversion_source: Optional[str]
    conversion_quoted_at: Optional[str]


def _empty(issue: str) -> CanonicalTransactionMoney:
    return {
        "issue": issue,
        "original_minor_units": None,
        "reporting_minor_units": None,
        "conversion_status": None,
        "conversion_rate": None,
        "conversion_source": None,
        "conversion_quoted_at": None,
    }


def compute_transaction_canonical(
    row: dict,
    *,
    rate_override: Optional[RateResult] = None,
    quoted_at: Optional[str] = None,
) -> CanonicalTransactionMoney:
    """row needs 'amount', 'currency', 'exchange_rate' (legacy REAL columns).

    rate_override: pass the RateResult from a fresh ExchangeRateService.get_rate()
    call at capture time, so a live-fetched rate is correctly labeled 'resolved'
    (with source='api') instead of falling back to inferring 'indicative' from
    the stored legacy float alone — the inference can't tell a live rate from
    an old backfilled one. Omit it (as scripts/backfill_canonical_money.py
    does) to fall back to that legacy inference.
    """
    amount = row["amount"]
    currency = (row.get("currency") or "SGD").upper()
    exchange_rate = row.get("exchange_rate")

    if isinstance(amount, float) and not math.isfinite(amount):
        return _empty("invalid_amount")
    try:
        amount_dec = Decimal(str(amount))
    except (ValueError, TypeError):
        return _empty("invalid_amount")
    if amount_dec < 0:
        return _empty("invalid_amount")

    try:
        original_minor = to_minor_units(amount_dec, currency)
    except UnsupportedCurrencyError:
        return _empty("unknown_currency")

    if currency == "SGD":
        return {
            "issue": None,
            "original_minor_units": original_minor,
            "reporting_minor_units": original_minor,
            "conversion_status": "native",
            "conversion_rate": "1",
            "conversion_source": "native",
            "conversion_quoted_at": None,
        }

    if rate_override is not None:
        if rate_override.status == "unresolved" or rate_override.rate is None:
            return {
                "issue": None,
                "original_minor_units": original_minor,
                "reporting_minor_units": None,
                "conversion_status": "unresolved",
                "conversion_rate": None,
                "conversion_source": None,
                "conversion_quoted_at": None,
            }
        rate_dec = Decimal(str(rate_override.rate))
        reporting_minor = to_minor_units(amount_dec * rate_dec, "SGD")
        return {
            "issue": None,
            "original_minor_units": original_minor,
            "reporting_minor_units": reporting_minor,
            "conversion_status": rate_override.status,
            "conversion_rate": str(rate_dec),
            "conversion_source": rate_override.source,
            "conversion_quoted_at": quoted_at,
        }

    rate_ok = (
        exchange_rate is not None
        and math.isfinite(exchange_rate)
        and exchange_rate > 0
        # Legacy 1.0 may be a silent fallback — never treated as real
        # conversion evidence, even for a currency that could legitimately
        # trade at parity.
        and exchange_rate != 1
    )
    if not rate_ok:
        return {
            "issue": None,
            "original_minor_units": original_minor,
            "reporting_minor_units": None,
            "conversion_status": "unresolved",
            "conversion_rate": None,
            "conversion_source": None,
            "conversion_quoted_at": None,
        }

    rate_dec = Decimal(str(exchange_rate))
    reporting_minor = to_minor_units(amount_dec * rate_dec, "SGD")
    return {
        "issue": None,
        "original_minor_units": original_minor,
        "reporting_minor_units": reporting_minor,
        "conversion_status": "indicative",
        "conversion_rate": str(rate_dec),
        "conversion_source": "legacy_backfill",
        "conversion_quoted_at": None,
    }
