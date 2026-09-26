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


def _result(
    original: Optional[int] = None,
    reporting: Optional[int] = None,
    *,
    status: Optional[str] = None,
    rate: Optional[str] = None,
    source: Optional[str] = None,
    quoted_at: Optional[str] = None,
    issue: Optional[str] = None,
) -> CanonicalTransactionMoney:
    return {
        "issue": issue,
        "original_minor_units": original,
        "reporting_minor_units": reporting,
        "conversion_status": status,
        "conversion_rate": rate,
        "conversion_source": source,
        "conversion_quoted_at": quoted_at,
    }


def _empty(issue: str) -> CanonicalTransactionMoney:
    return _result(issue=issue)


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
        return _result(original_minor, original_minor, status="native", rate="1", source="native")

    if rate_override is not None:
        if rate_override.status == "unresolved" or rate_override.rate is None:
            return _result(original_minor, status="unresolved")
        rate_dec = Decimal(str(rate_override.rate))
        reporting_minor = to_minor_units(amount_dec * rate_dec, "SGD")
        return _result(original_minor, reporting_minor, status=rate_override.status,
                       rate=str(rate_dec), source=rate_override.source, quoted_at=quoted_at)

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
        return _result(original_minor, status="unresolved")

    rate_dec = Decimal(str(exchange_rate))
    reporting_minor = to_minor_units(amount_dec * rate_dec, "SGD")
    return _result(original_minor, reporting_minor, status="indicative",
                   rate=str(rate_dec), source="legacy_backfill")
