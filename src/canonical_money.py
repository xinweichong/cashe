"""Computes the R02 canonical money columns from a legacy transaction row.

Business rules specific to this app (SGD is native, a legacy 1.0 rate may be
a silent fallback, ...) — layered on top of the generic src/money.py domain
module. Pure and side-effect-free; reused by scripts/backfill_canonical_money.py.

Never infers a refund from old income, never fabricates a rate, and never
treats a legacy 1.0 foreign rate as real conversion evidence — matching
src/spending_facts.convert_legacy_sgd, which this supersedes for storage
(that function stays as the read-time compatibility path).
"""
import math
from decimal import Decimal
from typing import Optional, TypedDict

from src.money import UnsupportedCurrencyError, to_minor_units


class CanonicalTransactionMoney(TypedDict):
    issue: Optional[str]
    original_minor_units: Optional[int]
    reporting_minor_units: Optional[int]
    conversion_status: Optional[str]
    conversion_rate: Optional[str]
    conversion_source: Optional[str]


def _empty(issue: str) -> CanonicalTransactionMoney:
    return {
        "issue": issue,
        "original_minor_units": None,
        "reporting_minor_units": None,
        "conversion_status": None,
        "conversion_rate": None,
        "conversion_source": None,
    }


def compute_transaction_canonical(row: dict) -> CanonicalTransactionMoney:
    """row needs 'amount', 'currency', 'exchange_rate' (legacy REAL columns)."""
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
    }
