"""Golden fixtures for src/canonical_money.py — computing the R02 canonical
columns from a legacy transaction row. Pure logic; no database."""
from decimal import Decimal

import pytest

from src.canonical_money import compute_transaction_canonical


def _row(amount, currency="SGD", exchange_rate=1.0):
    return {"amount": amount, "currency": currency, "exchange_rate": exchange_rate}


class TestNativeSgd:
    def test_sgd_is_native_and_rate_is_one(self):
        result = compute_transaction_canonical(_row(12.50, "SGD", 1.0))
        assert result["issue"] is None
        assert result["original_minor_units"] == 1250
        assert result["reporting_minor_units"] == 1250
        assert result["conversion_status"] == "native"
        assert result["conversion_rate"] == "1"
        assert result["conversion_source"] == "native"


class TestForeignWithRate:
    def test_foreign_currency_with_a_real_rate_is_indicative(self):
        result = compute_transaction_canonical(_row(20.0, "USD", 1.34))
        assert result["issue"] is None
        assert result["original_minor_units"] == 2000
        assert result["conversion_status"] == "indicative"
        assert result["conversion_rate"] == "1.34"
        assert result["conversion_source"] == "legacy_backfill"
        # 20.00 * 1.34 = 26.80 SGD -> 2680 minor units
        assert result["reporting_minor_units"] == 2680

    def test_zero_decimal_foreign_currency(self):
        result = compute_transaction_canonical(_row(1500, "JPY", 0.0091))
        assert result["issue"] is None
        assert result["original_minor_units"] == 1500  # JPY has 0 decimals
        assert result["conversion_status"] == "indicative"

    def test_three_decimal_foreign_currency(self):
        result = compute_transaction_canonical(_row(12.345, "BHD", 3.5))
        assert result["issue"] is None
        assert result["original_minor_units"] == 12345


class TestUnresolvedLegacyRate:
    def test_missing_rate_is_unresolved(self):
        result = compute_transaction_canonical(_row(20.0, "USD", None))
        assert result["issue"] is None
        assert result["conversion_status"] == "unresolved"
        assert result["conversion_rate"] is None
        assert result["reporting_minor_units"] is None
        # original amount is still known even when the conversion isn't
        assert result["original_minor_units"] == 2000

    def test_legacy_one_point_zero_is_never_treated_as_a_real_rate(self):
        """A stored 1.0 for a foreign currency may be a silent fallback —
        it cannot establish a valid conversion, even if that currency could
        legitimately trade at parity."""
        result = compute_transaction_canonical(_row(20.0, "USD", 1.0))
        assert result["conversion_status"] == "unresolved"
        assert result["reporting_minor_units"] is None

    def test_non_positive_rate_is_unresolved(self):
        result = compute_transaction_canonical(_row(20.0, "USD", 0))
        assert result["conversion_status"] == "unresolved"

    def test_non_finite_rate_is_unresolved(self):
        result = compute_transaction_canonical(_row(20.0, "USD", float("inf")))
        assert result["conversion_status"] == "unresolved"


class TestIssues:
    def test_unknown_currency_is_reported_as_an_issue_not_silently_skipped(self):
        result = compute_transaction_canonical(_row(10.0, "XYZ", 1.0))
        assert result["issue"] == "unknown_currency"
        assert result["original_minor_units"] is None

    def test_negative_amount_is_an_issue(self):
        # DB convention: amount is a stored positive magnitude; sign comes
        # from `type` at read time. A negative stored amount is invalid data.
        result = compute_transaction_canonical(_row(-5.0, "SGD", 1.0))
        assert result["issue"] == "invalid_amount"

    def test_non_finite_amount_is_an_issue(self):
        result = compute_transaction_canonical(_row(float("nan"), "SGD", 1.0))
        assert result["issue"] == "invalid_amount"

    def test_missing_currency_defaults_to_sgd(self):
        result = compute_transaction_canonical(_row(10.0, None, 1.0))
        assert result["issue"] is None
        assert result["conversion_status"] == "native"


class TestReportingComparedAgainstLegacyFloatMath:
    def test_reporting_minor_units_matches_legacy_float_rounding_for_typical_values(self):
        # Sanity check: the new Decimal path should agree with the old
        # `round(amount * exchange_rate, 2)` float math for well-behaved inputs.
        amount, rate = 45.90, 1.34
        legacy = round(amount * rate, 2)
        result = compute_transaction_canonical(_row(amount, "USD", rate))
        assert Decimal(result["reporting_minor_units"]) / 100 == Decimal(str(legacy))
