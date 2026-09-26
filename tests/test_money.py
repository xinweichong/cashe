"""Golden fixtures for src/money.py — the canonical money domain module.

Pure logic only: no database, no I/O. See docs/plans/2026-09-09-cashe-
completion-roadmap.md R02.
"""
from decimal import Decimal

import pytest

from src.money import (
    MAX_SAFE_MINOR_UNITS,
    UnsupportedCurrencyError,
    exponent_for,
    from_minor_units,
    is_safe_for_client,
    to_minor_units,
)


class TestExponentFor:
    def test_two_decimal_currency(self):
        assert exponent_for("SGD") == 2
        assert exponent_for("USD") == 2

    def test_zero_decimal_currency(self):
        assert exponent_for("JPY") == 0
        assert exponent_for("KRW") == 0

    def test_three_decimal_currency(self):
        assert exponent_for("BHD") == 3
        assert exponent_for("KWD") == 3

    def test_case_insensitive(self):
        assert exponent_for("sgd") == 2

    def test_unknown_currency_raises_reviewable_error(self):
        with pytest.raises(UnsupportedCurrencyError, match="XYZ"):
            exponent_for("XYZ")


class TestToMinorUnits:
    def test_two_decimal_currency(self):
        assert to_minor_units(Decimal("12.50"), "SGD") == 1250
        assert to_minor_units("12.50", "SGD") == 1250

    def test_zero_decimal_currency(self):
        assert to_minor_units(Decimal("1500"), "JPY") == 1500
        assert to_minor_units(Decimal("1500.00"), "JPY") == 1500

    def test_three_decimal_currency(self):
        assert to_minor_units(Decimal("12.345"), "BHD") == 12345

    def test_half_up_rounding_at_the_exponent_boundary(self):
        # 12.345 SGD (only 2 decimals supported) rounds half-up to 12.35
        assert to_minor_units(Decimal("12.345"), "SGD") == 1235
        assert to_minor_units(Decimal("12.344"), "SGD") == 1234
        assert to_minor_units(Decimal("-12.345"), "SGD") == -1235

    def test_negative_amount_for_refunds(self):
        assert to_minor_units(Decimal("-5.00"), "SGD") == -500

    def test_large_value(self):
        assert to_minor_units(Decimal("999999999.99"), "SGD") == 99999999999

    def test_zero(self):
        assert to_minor_units(Decimal("0"), "SGD") == 0

    def test_float_input_avoids_binary_artifacts(self):
        # 0.1 + 0.2 style artifacts must not leak through — float input is
        # routed via str() before Decimal parsing.
        assert to_minor_units(19.99, "SGD") == 1999

    def test_non_finite_input_rejected(self):
        with pytest.raises(ValueError, match="finite"):
            to_minor_units(float("nan"), "SGD")
        with pytest.raises(ValueError, match="finite"):
            to_minor_units(float("inf"), "SGD")

    def test_non_numeric_string_input_rejected(self):
        # SQLite's dynamic typing can let a stray TEXT value sit in a
        # REAL-affinity column from old/corrupt data — must not raise a raw
        # decimal.InvalidOperation callers aren't expecting.
        with pytest.raises(ValueError):
            to_minor_units("not-a-number", "SGD")

    def test_unknown_currency_raises(self):
        with pytest.raises(UnsupportedCurrencyError):
            to_minor_units(Decimal("1.00"), "XYZ")


class TestFromMinorUnits:
    def test_two_decimal_currency(self):
        assert from_minor_units(1250, "SGD") == Decimal("12.50")

    def test_zero_decimal_currency(self):
        assert from_minor_units(1500, "JPY") == Decimal("1500")

    def test_three_decimal_currency(self):
        assert from_minor_units(12345, "BHD") == Decimal("12.345")

    def test_negative(self):
        assert from_minor_units(-500, "SGD") == Decimal("-5.00")

    def test_round_trips_with_to_minor_units(self):
        for amount, currency in [("12.50", "SGD"), ("1500", "JPY"), ("12.345", "BHD")]:
            minor = to_minor_units(Decimal(amount), currency)
            assert from_minor_units(minor, currency) == Decimal(amount)


class TestSafeForClient:
    def test_typical_amount_is_safe(self):
        assert is_safe_for_client(1250) is True

    def test_max_safe_integer_boundary(self):
        assert is_safe_for_client(MAX_SAFE_MINOR_UNITS) is True
        assert is_safe_for_client(MAX_SAFE_MINOR_UNITS + 1) is False
        assert is_safe_for_client(-MAX_SAFE_MINOR_UNITS) is True
        assert is_safe_for_client(-MAX_SAFE_MINOR_UNITS - 1) is False
