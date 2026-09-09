"""Canonical money domain: currency exponent lookup, integer minor-unit
conversion, Decimal arithmetic, explicit rounding.

Pure and side-effect-free — no database access, no I/O. See
docs/plans/2026-09-09-cashe-completion-roadmap.md R02.
"""
import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Union

Numeric = Union[Decimal, int, float, str]


class UnsupportedCurrencyError(ValueError):
    """Raised for a currency code with no reviewed minor-unit exponent.

    Never assume every three-letter code has two decimals — add a code here
    only after checking its actual ISO 4217 minor unit.
    """


# ISO 4217 minor-unit exponents. Deliberately not a complete ISO 4217 table:
# only currencies this codebase has reviewed. An unlisted code is
# unsupported, not assumed to be 2 — see UnsupportedCurrencyError.
CURRENCY_EXPONENTS: dict[str, int] = {
    # 2-decimal
    "SGD": 2, "USD": 2, "EUR": 2, "GBP": 2, "AUD": 2, "NZD": 2, "CAD": 2,
    "CHF": 2, "INR": 2, "THB": 2, "MYR": 2, "PHP": 2, "CNY": 2, "HKD": 2,
    "TWD": 2, "IDR": 2,
    # 0-decimal
    "JPY": 0, "KRW": 0, "VND": 0,
    # 3-decimal
    "BHD": 3, "KWD": 3, "OMR": 3, "JOD": 3, "TND": 3,
}

# Beyond this, a JSON integer silently loses precision when decoded by a
# JavaScript client (Number.MAX_SAFE_INTEGER).
MAX_SAFE_MINOR_UNITS = 2**53 - 1


def exponent_for(currency: str) -> int:
    code = currency.upper()
    try:
        return CURRENCY_EXPONENTS[code]
    except KeyError:
        raise UnsupportedCurrencyError(f"{code} has no reviewed minor-unit exponent") from None


def _to_decimal(amount: Numeric) -> Decimal:
    if isinstance(amount, Decimal):
        return amount
    if isinstance(amount, float):
        if not math.isfinite(amount):
            raise ValueError(f"amount must be finite, got {amount!r}")
        # Route through str() to avoid binary-float artifacts (e.g. 19.99
        # stored as 19.989999999999998...) leaking into the Decimal.
        return Decimal(str(amount))
    return Decimal(amount)


def to_minor_units(amount: Numeric, currency: str) -> int:
    """Convert a decimal amount to integer minor units, e.g. 12.50 SGD -> 1250.

    Rounds half-up at the currency's exponent. Negative amounts are
    preserved (for signed refund amounts).
    """
    exponent = exponent_for(currency)
    dec = _to_decimal(amount)
    quantum = Decimal(1).scaleb(-exponent)
    rounded = dec.quantize(quantum, rounding=ROUND_HALF_UP)
    return int(rounded.scaleb(exponent))


def from_minor_units(minor: int, currency: str) -> Decimal:
    """Convert integer minor units back to a Decimal amount, e.g. 1250 SGD -> Decimal('12.50')."""
    exponent = exponent_for(currency)
    return Decimal(minor).scaleb(-exponent)


def is_safe_for_client(minor: int) -> bool:
    return -MAX_SAFE_MINOR_UNITS <= minor <= MAX_SAFE_MINOR_UNITS
