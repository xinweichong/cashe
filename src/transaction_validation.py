"""Validation shared by manual creation and transaction corrections."""
import math
import re
from datetime import datetime


def normalize_transaction_fields(values: dict) -> dict:
    fields = dict(values)
    for key in ("amount", "exchange_rate"):
        if key not in fields or (key == "exchange_rate" and fields[key] is None):
            continue
        value = fields[key]
        try:
            number = float(value)
        except (ValueError, TypeError, OverflowError):
            raise ValueError(f"{key} must be a finite number") from None
        if isinstance(value, bool) or not math.isfinite(number) or number < 0 or (key == "exchange_rate" and number == 0):
            raise ValueError(f"{key} must be {'positive' if key == 'exchange_rate' else 'non-negative'} and finite")
        fields[key] = number
    if "currency" in fields:
        currency = fields["currency"]
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
            raise ValueError("Currency must be a three-letter code")
        fields["currency"] = currency.upper()
    if "type" in fields and fields["type"] not in ("expense", "income", "refund", "transfer"):
        raise ValueError("Type must be expense, income, refund, or transfer")
    if "transaction_date" in fields:
        value = fields["transaction_date"]
        if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?", value
        ):
            raise ValueError("Transaction date must be an ISO date or timestamp")
        try:
            fields["transaction_date"] = datetime.fromisoformat(value).isoformat()
        except ValueError:
            raise ValueError("Transaction date must be a valid calendar date and time") from None
    return fields
