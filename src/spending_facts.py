"""Shared read-only spending facts over the legacy ledger.

SGD reporting amounts are rounded per observation with Decimal. This does not
replace the planned audited migration of stored money to integer minor units.
"""
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from src.config import DEFAULT_TIMEZONE, local_now


def money(minor: int) -> dict:
    return {"minor_units": minor, "currency": "SGD"}


def month_periods(as_of: date) -> tuple[date, date, date, date]:
    if as_of.year == 1 and as_of.month == 1:
        raise ValueError("No previous month is representable")
    current_start = as_of.replace(day=1)
    previous_end = current_start - timedelta(days=1)
    previous_start = previous_end.replace(day=1)
    days = min(as_of.day, calendar.monthrange(previous_start.year, previous_start.month)[1])
    return current_start, current_start + timedelta(days=days - 1), previous_start, previous_start + timedelta(days=days - 1)


def _converted(row: dict) -> tuple[int | None, str]:
    try:
        amount = Decimal(str(row["amount"]))
        if not amount.is_finite() or amount < 0:
            return None, "unresolved"
        if row["currency"] == "SGD":
            rate, status = Decimal(1), "native"
        else:
            rate = Decimal(str(row["exchange_rate"]))
            # Legacy 1.0 may be a silent fallback. It is not conversion evidence.
            if not row["currency"] or not rate.is_finite() or rate <= 0 or rate == 1:
                return None, "unresolved"
            status = "indicative"
        minor = int((amount * rate * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        return minor, status
    except (InvalidOperation, ValueError, TypeError):
        return None, "unresolved"


def _rows(conn, start: date, end: date, timezone: str) -> list[dict]:
    tz = ZoneInfo(timezone)
    # Include the adjacent UTC days before projecting offset timestamps locally.
    rows = conn.execute(
        """SELECT id, amount, currency, exchange_rate, merchant, category, type, transaction_date
           FROM transactions WHERE (DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?)
           OR DATE(transaction_date) IS NULL
           ORDER BY transaction_date DESC, id DESC""",
        ((start - timedelta(days=1) if start > date.min else start).isoformat(),
         (end + timedelta(days=1) if end < date.max else end).isoformat()),
    )
    result = []
    for record in rows:
        row = dict(record)
        try:
            timestamp = datetime.fromisoformat(row["transaction_date"])
            day = timestamp.astimezone(tz).date() if timestamp.tzinfo else timestamp.date()
        except (ValueError, TypeError):
            day = None
        if day is None or start <= day <= end:
            row["day"] = day
            row["type"] = row["type"] or "expense"
            row["category"] = row["category"] or "Other"
            row["minor"], row["conversion_status"] = _converted(row)
            if day is None:
                row["minor"], row["conversion_status"] = None, "unresolved"
            result.append(row)
    return result


def _period(rows: list[dict], start: date, end: date) -> dict:
    selected = [row for row in rows if row["day"] is not None and start <= row["day"] <= end and row["type"] != "transfer"]
    spending, income, income_count, unresolved, indicative = 0, 0, 0, 0, 0
    categories = {}
    for row in selected:
        kind = row["type"]
        income_count += kind == "income"
        if row["minor"] is None or kind not in ("expense", "refund", "income"):
            unresolved += 1
            continue
        indicative += row["conversion_status"] == "indicative"
        if kind == "income":
            income += row["minor"]
        else:
            amount = -row["minor"] if kind == "refund" else row["minor"]
            spending += amount
            categories[row["category"]] = categories.get(row["category"], 0) + amount
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "spending": money(spending), "income": money(income) if income_count else None,
        "recorded_net_flow": money(income - spending) if income_count and not unresolved else None,
        "transaction_count": len(selected), "unresolved_count": unresolved,
        "indicative_count": indicative,
        "status": "partial" if unresolved else "indicative" if indicative else "complete",
        "categories": categories,
    }


def month_facts(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    as_of = as_of or local_now(timezone).date()
    current_start, comparison_end, previous_start, previous_end = month_periods(as_of)
    rows = _rows(conn, previous_start, as_of, timezone)
    current = _period(rows, current_start, as_of)
    comparable = _period(rows, current_start, comparison_end)
    previous = _period(rows, previous_start, previous_end)
    undated = sum(row["day"] is None and row["type"] != "transfer" for row in rows)
    available = not undated and not comparable["unresolved_count"] and not previous["unresolved_count"]
    drivers = []
    if available:
        for category in comparable["categories"].keys() | previous["categories"].keys():
            change = comparable["categories"].get(category, 0) - previous["categories"].get(category, 0)
            if change:
                drivers.append({"category": category, "change": money(change)})
        drivers.sort(key=lambda driver: (-abs(driver["change"]["minor_units"]), driver["category"]))
    for period in (current, comparable, previous):
        del period["categories"]
        if undated:
            period["status"] = "partial"
            period["recorded_net_flow"] = None
    return {
        "as_of": as_of.isoformat(), "timezone": timezone, "undated_count": undated,
        "money_basis": "legacy_values_rounded_per_transaction",
        "current": current, "comparison_current": comparable, "previous": previous,
        "change": money(comparable["spending"]["minor_units"] - previous["spending"]["minor_units"]) if available else None,
        "category_changes": drivers,
    }


def spending_evidence(conn, start: date, end: date, *, timezone: str = DEFAULT_TIMEZONE,
                      category: str | None = None, measure: str = "spending",
                      limit: int = 50, offset: int = 0) -> dict:
    if end < start or measure not in ("spending", "income", "unresolved") or not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Invalid evidence query")
    kinds = ("expense", "refund") if measure == "spending" else ("income",)
    rows = [row for row in _rows(conn, start, end, timezone)
            if (category is None or row["category"] == category)
            and ((measure == "unresolved" and row["type"] != "transfer"
                  and (row["minor"] is None or row["type"] not in ("expense", "refund", "income")))
                 or (measure != "unresolved" and row["day"] is not None and row["type"] in kinds))]
    items = []
    for row in rows[offset:offset + limit]:
        minor = row["minor"]
        items.append({
            "id": row["id"], "merchant": row["merchant"], "category": row["category"],
            "type": row["type"], "date": row["day"].isoformat() if row["day"] is not None else None,
            "amount": money(-minor if row["type"] == "refund" else minor) if minor is not None else None,
            "conversion_status": row["conversion_status"],
        })
    return {"items": items, "total": len(rows), "limit": limit, "offset": offset}
