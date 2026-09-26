"""Shared read-only spending facts over the legacy ledger.

SGD reporting amounts are rounded per observation with Decimal. This does not
replace the planned audited migration of stored money to integer minor units.
"""
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from src.config import DEFAULT_TIMEZONE, local_now
from src.money import CURRENCY_EXPONENTS


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


def week_periods(as_of: date) -> tuple[date, date, date, date]:
    current_start = as_of - timedelta(days=as_of.weekday())
    if current_start < date(1, 1, 8):
        raise ValueError("No previous week is representable")
    return current_start, as_of, current_start - timedelta(days=7), as_of - timedelta(days=7)


def convert_legacy_sgd(row: dict) -> tuple[int | None, str]:
    """Read-time fallback only — used for rows whose canonical columns were
    never computed (conversion_status IS NULL): straggler pre-R02 rows, or
    a raw fixture that bypassed Storage.insert_transaction/update_transaction.
    Every row written through Storage has canonical columns already, which
    resolve_money prefers — this recomputation has no currency validation
    and must not be trusted over stored canonical truth."""
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


def sgd_minor(amount) -> int | None:
    """An SGD amount (e.g. a planned charge's expected amount) in minor
    units; None when it is missing, invalid or negative."""
    minor, _ = convert_legacy_sgd({"amount": amount, "currency": "SGD"})
    return minor


def resolve_money(row: dict) -> tuple[int | None, str]:
    """Prefer the canonical reporting_minor_units/conversion_status Storage
    already computed at write time (single source of truth); a NULL
    conversion_status means canonical money was genuinely never computed for
    this row — it predates the R02 migration/backfill, or was written by
    something that bypassed Storage. Fall back to legacy read-time
    conversion only for a currency this codebase actually reviews
    (src.money.CURRENCY_EXPONENTS) — never for an unrecognized code, which
    convert_legacy_sgd has no way to validate and would otherwise fabricate
    a conversion for."""
    if row["conversion_status"] is not None:
        return row["reporting_minor_units"], row["conversion_status"]
    if (row["currency"] or "SGD").upper() not in CURRENCY_EXPONENTS:
        return None, "unresolved"
    return convert_legacy_sgd(row)


def _rows(conn, start: date, end: date, timezone: str) -> list[dict]:
    tz = ZoneInfo(timezone)
    # Include the adjacent UTC days before projecting offset timestamps locally.
    rows = conn.execute(
        """SELECT id, amount, currency, exchange_rate, merchant, category, type, transaction_date,
                  reporting_minor_units, conversion_status
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
            # R06: preserve whether the category was genuinely unset, before
            # coercing it to "Other" for aggregation purposes below — the
            # review feature needs to tell "no category yet" apart from
            # "the user chose 'Other'".
            row["category_missing"] = row["category"] is None
            row["category"] = row["category"] or "Other"
            row["minor"], row["conversion_status"] = resolve_money(row)
            if day is None:
                row["minor"], row["conversion_status"] = None, "unresolved"
            result.append(row)
    return result


def _aggregate(selected: list[dict]) -> dict:
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
        "spending": money(spending), "income": money(income) if income_count else None,
        "recorded_net_flow": money(income - spending) if income_count and not unresolved else None,
        "transaction_count": len(selected), "unresolved_count": unresolved,
        "indicative_count": indicative,
        "status": "partial" if unresolved else "indicative" if indicative else "complete",
        "categories": categories,
    }


def _signed(row: dict) -> int:
    return -row["minor"] if row["type"] == "refund" else row["minor"]


def _spending_rows(rows: list[dict], start: date, end: date) -> list[dict]:
    return [row for row in rows if row["day"] is not None and start <= row["day"] <= end
            and row["type"] in ("expense", "refund") and row["minor"] is not None]


_OVERLAP_NOTE = "This breaks down the category change above; it is not an additional amount on top of it."
_TRIP_OVERLAP_NOTE = "Trip spending is already included in the category totals above; shown separately as context, not an additional amount."


def _top_category_driver(rows: list[dict], category: str, change: dict,
                          current_start: date, comparison_end: date,
                          previous_start: date, previous_end: date) -> dict:
    """R10: merchant contribution, frequency-vs-size, and one-off breakdown
    for the single largest category driver. Deliberately scoped to only the
    top category rather than every one — computing this for every category
    change multiplies the overlap bookkeeping without adding evidence value
    beyond what the user actually needs to act on."""
    current_rows = [row for row in _spending_rows(rows, current_start, comparison_end) if row["category"] == category]
    previous_rows = [row for row in _spending_rows(rows, previous_start, previous_end) if row["category"] == category]

    current_by_merchant: dict[str, int] = {}
    previous_by_merchant: dict[str, int] = {}
    for row in current_rows:
        merchant = row["merchant"] or "Unknown merchant"
        current_by_merchant[merchant] = current_by_merchant.get(merchant, 0) + _signed(row)
    for row in previous_rows:
        merchant = row["merchant"] or "Unknown merchant"
        previous_by_merchant[merchant] = previous_by_merchant.get(merchant, 0) + _signed(row)
    merchant_driver = None
    merchants = current_by_merchant.keys() | previous_by_merchant.keys()
    if merchants:
        best = max(merchants, key=lambda m: abs(current_by_merchant.get(m, 0) - previous_by_merchant.get(m, 0)))
        merchant_change = current_by_merchant.get(best, 0) - previous_by_merchant.get(best, 0)
        if merchant_change:
            merchant_driver = {"merchant": best, "change": money(merchant_change)}

    current_count, previous_count = len(current_rows), len(previous_rows)
    current_total = sum(_signed(row) for row in current_rows)
    previous_total = sum(_signed(row) for row in previous_rows)
    current_avg = round(current_total / current_count) if current_count else 0
    previous_avg = round(previous_total / previous_count) if previous_count else 0
    count_changed = current_count != previous_count
    avg_changed = abs(current_avg - previous_avg) > max(100, abs(previous_avg) * 0.1)
    if count_changed and not avg_changed:
        classification = "frequency"
    elif avg_changed and not count_changed:
        classification = "size"
    elif count_changed and avg_changed:
        classification = "mixed"
    else:
        classification = "none"
    frequency_driver = {
        "classification": classification, "current_count": current_count, "previous_count": previous_count,
        "current_avg": money(current_avg), "previous_avg": money(previous_avg),
    }

    one_off_driver = None
    if current_rows:
        largest = max(current_rows, key=lambda row: abs(_signed(row)))
        change_magnitude = abs(change["minor_units"])
        if change_magnitude and abs(_signed(largest)) >= change_magnitude * 0.5:
            one_off_driver = {
                "transaction_id": largest["id"], "merchant": largest["merchant"],
                "amount": money(_signed(largest)), "date": largest["day"].isoformat(),
            }

    return {
        "category": category, "change": change, "merchant_driver": merchant_driver,
        "frequency_driver": frequency_driver, "one_off_driver": one_off_driver,
        "overlap_note": _OVERLAP_NOTE,
    }


def _trip_drivers(conn, rows: list[dict], current_start: date, comparison_end: date,
                   previous_start: date, previous_end: date) -> list[dict]:
    trip_map = {row["transaction_id"]: (row["trip_id"], row["name"]) for row in conn.execute(
        """SELECT tt.transaction_id, tt.trip_id, tr.name FROM trip_transactions tt
           JOIN trips tr ON tr.id = tt.trip_id""")}
    if not trip_map:
        return []
    current_totals: dict[int, int] = {}
    previous_totals: dict[int, int] = {}
    for row in _spending_rows(rows, current_start, comparison_end):
        info = trip_map.get(row["id"])
        if info:
            current_totals[info[0]] = current_totals.get(info[0], 0) + _signed(row)
    for row in _spending_rows(rows, previous_start, previous_end):
        info = trip_map.get(row["id"])
        if info:
            previous_totals[info[0]] = previous_totals.get(info[0], 0) + _signed(row)
    names = {trip_id: name for trip_id, name in trip_map.values()}
    drivers = []
    for trip_id in current_totals.keys() | previous_totals.keys():
        current_total = current_totals.get(trip_id, 0)
        previous_total = previous_totals.get(trip_id, 0)
        if current_total or previous_total:
            drivers.append({
                "trip_id": trip_id, "name": names[trip_id],
                "current_total": money(current_total), "previous_total": money(previous_total),
                "change": money(current_total - previous_total), "overlap_note": _TRIP_OVERLAP_NOTE,
            })
    drivers.sort(key=lambda driver: (-abs(driver["change"]["minor_units"]), driver["trip_id"]))
    return drivers


def _period(rows: list[dict], start: date, end: date) -> dict:
    selected = [row for row in rows if row["day"] is not None and start <= row["day"] <= end and row["type"] != "transfer"]
    return {"start": start.isoformat(), "end": end.isoformat(), **_aggregate(selected)}


def category_breakdown(conn, start: date, end: date, timezone: str = DEFAULT_TIMEZONE) -> dict:
    """Category totals for [start, end], built on the same _rows/_period/
    _aggregate primitives month_facts/day_facts use — so a chart built on
    this reconciles with the hero's spending total for the same period
    instead of risking the timezone/conversion drift the legacy SQL
    aggregates (storage.get_spending_summary et al.) can introduce near a
    day boundary or an unvalidated currency code."""
    rows = _rows(conn, start, end, timezone)
    period = _period(rows, start, end)
    return {
        "start": period["start"], "end": period["end"],
        "by_category": {category: money(amount) for category, amount in period["categories"].items()},
        "unresolved_count": period["unresolved_count"],
        "indicative_count": period["indicative_count"],
        "status": period["status"],
    }


def category_daily_trend(conn, start: date, end: date, timezone: str = DEFAULT_TIMEZONE,
                          categories: list[str] | None = None) -> list[dict]:
    """Per-local-day category totals for [start, end], built on the same
    _rows/_spending_rows primitives as category_breakdown/daily_totals, so a
    category trend chart reconciles with both for the identical period and
    range — unlike storage.get_trend_by_category's legacy SQL (no timezone
    conversion on transaction_date). `categories`, when given, limits which
    categories are aggregated (the frontend's "at most three selectable
    categories" rule) rather than filtering after the fact."""
    rows = _rows(conn, start, end, timezone)
    by_day: dict[date, dict[str, int]] = {}
    for row in _spending_rows(rows, start, end):
        if categories is not None and row["category"] not in categories:
            continue
        bucket = by_day.setdefault(row["day"], {})
        bucket[row["category"]] = bucket.get(row["category"], 0) + _signed(row)
    return [
        {"date": day.isoformat(), "categories": {cat: money(amt) for cat, amt in by_day[day].items()}}
        for day in sorted(by_day)
    ]


def merchant_ranking(conn, start: date, end: date, timezone: str = DEFAULT_TIMEZONE,
                      category: str | None = None, limit: int = 10) -> list[dict]:
    """Merchant totals for [start, end], optionally scoped to one category —
    built on the same _rows/_spending_rows primitives _top_category_driver
    uses internally, so a merchant ranking under a selected category always
    agrees with that category's total from category_breakdown for the
    identical period (unlike storage.get_merchant_ranking's legacy SQL)."""
    rows = _rows(conn, start, end, timezone)
    selected = _spending_rows(rows, start, end)
    if category is not None:
        selected = [row for row in selected if row["category"] == category]
    totals: dict[str, int] = {}
    visits: dict[str, int] = {}
    for row in selected:
        merchant = row["merchant"] or "Unknown merchant"
        totals[merchant] = totals.get(merchant, 0) + _signed(row)
        visits[merchant] = visits.get(merchant, 0) + (row["type"] == "expense")
    ranked = sorted(totals.items(), key=lambda item: -item[1])
    return [
        {"merchant": merchant, "visits": visits[merchant], "total": money(total)}
        for merchant, total in ranked[:limit]
    ]


def daily_totals(conn, start: date, end: date, timezone: str = DEFAULT_TIMEZONE) -> list[dict]:
    """Per-local-day totals over [start, end], built on the same _rows/
    _aggregate primitives every other shared-fact surface uses (R04 parity).
    Callers that page through transactions independently (R09's Activity
    list) can fetch this for whatever date range is currently on screen —
    a day's total is always computed from every transaction on that day,
    never from however many of that day's rows a row-pagination cursor has
    happened to load, so a day split across a page boundary never shows a
    duplicate or partial total."""
    rows = _rows(conn, start, end, timezone)
    by_day: dict[date, list[dict]] = {}
    for row in rows:
        if row["day"] is not None and start <= row["day"] <= end and row["type"] != "transfer":
            by_day.setdefault(row["day"], []).append(row)
    result = []
    for day, day_rows in sorted(by_day.items(), reverse=True):
        aggregate = _aggregate(day_rows)
        del aggregate["categories"]
        result.append({"date": day.isoformat(), **aggregate})
    return result


def day_facts(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    as_of = as_of or local_now(timezone).date()
    if as_of < date(1, 1, 8):
        raise ValueError("No previous weekday is representable")
    previous = as_of - timedelta(days=7)
    return _facts(conn, as_of, timezone, (as_of, as_of, previous, previous))


def month_facts(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    as_of = as_of or local_now(timezone).date()
    return _facts(conn, as_of, timezone, month_periods(as_of))


def week_facts(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    as_of = as_of or local_now(timezone).date()
    return _facts(conn, as_of, timezone, week_periods(as_of))


def _facts(conn, as_of: date, timezone: str, periods: tuple[date, date, date, date]) -> dict:
    current_start, comparison_end, previous_start, previous_end = periods
    rows = _rows(conn, previous_start, as_of, timezone)
    current = _period(rows, current_start, as_of)
    comparable = _period(rows, current_start, comparison_end)
    previous = _period(rows, previous_start, previous_end)
    undated = sum(row["day"] is None and row["type"] != "transfer" for row in rows)
    available = not undated and not comparable["unresolved_count"] and not previous["unresolved_count"]
    drivers = []
    top_category_driver = None
    trip_drivers = []
    if available:
        for category in comparable["categories"].keys() | previous["categories"].keys():
            change = comparable["categories"].get(category, 0) - previous["categories"].get(category, 0)
            if change:
                drivers.append({"category": category, "change": money(change)})
        drivers.sort(key=lambda driver: (-abs(driver["change"]["minor_units"]), driver["category"]))
        if drivers:
            top = drivers[0]
            top_category_driver = _top_category_driver(
                rows, top["category"], top["change"], current_start, comparison_end, previous_start, previous_end)
        trip_drivers = _trip_drivers(conn, rows, current_start, comparison_end, previous_start, previous_end)
    for period in (current, comparable, previous):
        del period["categories"]
        if undated:
            period["status"] = "partial"
            period["recorded_net_flow"] = None
    return {
        "as_of": as_of.isoformat(), "timezone": timezone, "undated_count": undated,
        "money_basis": "canonical_minor_units_with_legacy_fallback",
        "current": current, "comparison_current": comparable, "previous": previous,
        "change": money(comparable["spending"]["minor_units"] - previous["spending"]["minor_units"]) if available else None,
        "category_changes": drivers,
        "top_category_driver": top_category_driver,
        "trip_drivers": trip_drivers,
    }


def weekday_pattern(conn, as_of: date | None = None, weeks: int = 8, timezone: str = DEFAULT_TIMEZONE) -> dict:
    """R10 Explore question: 'what does a normal week look like?' — average
    spend per weekday over the trailing `weeks` *complete* weeks (excluding
    the current, possibly partial, week), so a big Saturday isn't diluted by
    a same-weekday that hasn't happened yet this week. The window is exactly
    weeks*7 days aligned to full weeks, so every weekday occurs exactly
    `weeks` times — dividing each weekday's total by `weeks` is exact, not
    an approximation."""
    if weeks < 1:
        raise ValueError("weeks must be at least 1")
    as_of = as_of or local_now(timezone).date()
    current_week_start = as_of - timedelta(days=as_of.weekday())
    end = current_week_start - timedelta(days=1)
    start = end - timedelta(days=weeks * 7 - 1)
    excluded_ids = _excluded_ids(conn)
    rows = [row for row in _spending_rows(_rows(conn, start, end, timezone), start, end)
            if row["id"] not in excluded_ids]
    by_weekday: dict[int, list[int]] = {i: [] for i in range(7)}
    for row in rows:
        by_weekday[row["day"].weekday()].append(_signed(row))
    pattern = [
        {"weekday": weekday, "average": money(round(sum(amounts) / weeks)), "transaction_count": len(amounts)}
        for weekday, amounts in by_weekday.items()
    ]
    return {"start": start.isoformat(), "end": end.isoformat(), "weeks": weeks, "pattern": pattern}


def _needs_review(row: dict) -> bool:
    return row["type"] != "transfer" and (
        row["minor"] is None or row["type"] not in ("expense", "refund", "income")
    )


def _missing_data(row: dict) -> bool:
    """R06: a missing merchant/category is a data-completeness issue, not a
    money-resolution one — kept separate from _needs_review so it never
    leaks into the "unresolved money" evidence measure (spending_evidence's
    measure='unresolved'), which is specifically about amounts that can't be
    computed, not ones that merely aren't categorized yet."""
    return (
        row["type"] != "transfer" and row["type"] in ("expense", "refund", "income")
        and (row["merchant"] is None or row["category_missing"])
    )


def spending_review(conn, *, timezone: str = DEFAULT_TIMEZONE,
                    limit: int = 50, offset: int = 0) -> dict:
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Invalid review query")
    rows = [row for row in _rows(conn, date.min, date.max, timezone) if _needs_review(row) or _missing_data(row)]
    items = []
    for row in rows[offset:offset + limit]:
        reasons = []
        if row["day"] is None:
            reasons.append("missing_date")
        # Date uncertainty alone must not be described as a conversion problem —
        # row["minor"] is forced to None for undated rows regardless of money
        # resolvability (see _rows), so re-resolve independently of that override.
        if resolve_money(row)[0] is None:
            reasons.append("unresolved_money")
        if row["type"] not in ("expense", "refund", "income"):
            reasons.append("unknown_type")
        if row["merchant"] is None:
            reasons.append("missing_merchant")
        if row["category_missing"]:
            reasons.append("missing_category")
        items.append({"id": row["id"], "merchant": row["merchant"], "category": row["category"],
                      "date": row["day"].isoformat() if row["day"] else None, "reasons": reasons})
    return {"items": items, "total": len(rows), "limit": limit, "offset": offset}


def refund_match_candidate(conn, refund: dict) -> dict | None:
    """R06: the best unlinked purchase this refund likely belongs to, for the
    refund-match review — same merchant and currency, dated on or before the
    refund and within 180 days, with enough amount to cover it. Rows sorted
    closest-date-first; the first that resolves money and covers the refund
    wins. A row on either side whose money can't be resolved is skipped
    rather than guessed at."""
    refund_minor, _ = resolve_money(refund)
    if refund_minor is None or not refund["merchant"] or not refund["transaction_date"]:
        return None
    rows = conn.execute(
        """SELECT * FROM transactions
           WHERE (type = 'expense' OR type IS NULL) AND merchant = ? AND currency IS ?
           AND transaction_date IS NOT NULL
           AND DATE(transaction_date) <= DATE(?) AND DATE(transaction_date) >= DATE(?, '-180 days')
           ORDER BY transaction_date DESC, id DESC""",
        (refund["merchant"], refund["currency"], refund["transaction_date"], refund["transaction_date"]),
    ).fetchall()
    for record in rows:
        candidate = dict(record)
        candidate_minor, _ = resolve_money(candidate)
        if candidate_minor is not None and candidate_minor >= refund_minor:
            return candidate
    return None


def refund_match_review(conn, *, limit: int = 50, offset: int = 0) -> dict:
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Invalid refund match review query")
    refunds = conn.execute(
        """SELECT * FROM transactions WHERE type = 'refund' AND refund_of_transaction_id IS NULL
           AND id NOT IN (SELECT refund_transaction_id FROM refund_match_dismissals)
           ORDER BY transaction_date DESC, id DESC"""
    ).fetchall()
    items = []
    for record in refunds:
        refund = dict(record)
        candidate = refund_match_candidate(conn, refund)
        if candidate is None:
            continue
        refund_minor, _ = resolve_money(refund)
        candidate_minor, _ = resolve_money(candidate)
        items.append({
            "refund_transaction_id": refund["id"],
            "refund": {"merchant": refund["merchant"], "date": refund["transaction_date"], "amount": money(refund_minor)},
            "candidate_purchase": {"transaction_id": candidate["id"], "merchant": candidate["merchant"],
                                   "date": candidate["transaction_date"], "amount": money(candidate_minor)},
            "reason": "same_merchant_amount_window",
        })
    return {"items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset}


def spending_evidence(conn, start: date, end: date, *, timezone: str = DEFAULT_TIMEZONE,
                      category: str | None = None, merchant: str | None = None, weekday: int | None = None,
                      measure: str = "spending", limit: int = 50, offset: int = 0) -> dict:
    if (end < start or measure not in ("spending", "income", "unresolved") or not 1 <= limit <= 100 or offset < 0
            or (weekday is not None and not 0 <= weekday <= 6)):
        raise ValueError("Invalid evidence query")
    kinds = ("expense", "refund") if measure == "spending" else ("income",)
    rows = [row for row in _rows(conn, start, end, timezone)
            if (category is None or row["category"] == category)
            and (merchant is None or (row["merchant"] or "Unknown merchant") == merchant)
            and (weekday is None or (row["day"] is not None and row["day"].weekday() == weekday))
            and ((measure == "unresolved" and _needs_review(row))
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


def _history_rows(conn, end: date, timezone: str) -> list[dict]:
    """Every dated, money-resolved expense/refund row up to `end`, for the
    baselines behind unusual-spending and first-seen checks."""
    return [row for row in _rows(conn, date.min, end, timezone)
            if row["day"] is not None and row["day"] <= end]


def _unusual(rows: list[dict], start: date, end: date, multiplier: float, excluded_ids: set[int]) -> list[dict]:
    """A purchase in [start, end] above `multiplier` times the same
    merchant's average purchase before `start`. Needs at least two prior
    resolved purchases so a single earlier visit is not treated as typical."""
    history: dict[str, list[int]] = {}
    for row in rows:
        if (row["day"] < start and row["type"] == "expense" and row["minor"] is not None
                and row["merchant"] and row["id"] not in excluded_ids):
            history.setdefault(row["merchant"], []).append(row["minor"])
    found = []
    for row in rows:
        if not (start <= row["day"] <= end and row["type"] == "expense" and row["minor"] is not None and row["merchant"]):
            continue
        prior = history.get(row["merchant"], [])
        if len(prior) < 2:
            continue
        typical = round(sum(prior) / len(prior))
        if typical > 0 and row["minor"] > multiplier * typical:
            found.append({
                "transaction_id": row["id"], "merchant": row["merchant"], "category": row["category"],
                "date": row["day"].isoformat(), "amount": money(row["minor"]), "typical": money(typical),
                "ratio": round(row["minor"] / typical, 1),
            })
    found.sort(key=lambda item: (-item["ratio"], item["date"]))
    return found


def _excluded_ids(conn) -> set[int]:
    return {row[0] for row in conn.execute("SELECT id FROM transactions WHERE excluded_from_baseline = 1")}


def _new_merchants(rows: list[dict], start: date, end: date) -> list[dict]:
    first: dict[str, dict] = {}
    for row in rows:
        if row["type"] != "expense" or not row["merchant"]:
            continue
        seen = first.get(row["merchant"])
        if seen is None or (row["day"], row["id"]) < (seen["day"], seen["id"]):
            first[row["merchant"]] = row
    found = [
        {"merchant": merchant, "first_date": row["day"].isoformat(), "category": row["category"],
         "amount": money(row["minor"]) if row["minor"] is not None else None, "transaction_id": row["id"]}
        for merchant, row in first.items() if start <= row["day"] <= end
    ]
    found.sort(key=lambda item: (item["first_date"], item["merchant"]), reverse=True)
    return found


def spending_signals(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE,
                     multiplier: float = 2.0) -> dict:
    """Month-to-date purchases worth a second look: unusually large charges
    for a merchant, and merchants recorded for the first time. Same
    conversion rules as every other shared fact; unresolved amounts are
    never compared."""
    as_of = as_of or local_now(timezone).date()
    start = as_of.replace(day=1)
    rows = _history_rows(conn, as_of, timezone)
    return {
        "start": start.isoformat(), "end": as_of.isoformat(), "multiplier": multiplier,
        "unusual": _unusual(rows, start, as_of, multiplier, _excluded_ids(conn)),
        "new_merchants": _new_merchants(rows, start, as_of),
    }


def monthly_flows(conn, months: int = 6, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> list[dict]:
    """Spending and income per calendar month, oldest first; the current
    month runs to `as_of`. Income stays absent (None) for a month with no
    income records rather than a fabricated zero."""
    if not 1 <= months <= 36:
        raise ValueError("months must be between 1 and 36")
    as_of = as_of or local_now(timezone).date()
    starts = []
    year, month = as_of.year, as_of.month
    for _ in range(months):
        starts.append(date(year, month, 1))
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    starts.reverse()
    rows = _rows(conn, starts[0], as_of, timezone)
    result = []
    for start in starts:
        end = min(as_of, start.replace(day=calendar.monthrange(start.year, start.month)[1]))
        period = _period(rows, start, end)
        del period["categories"]
        result.append({"month": start.strftime("%Y-%m"), **period})
    return result


_GRADES = ((80, "Excellent"), (60, "Good"), (40, "Fair"))


def health_score(conn, months: int = 1, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE,
                 multiplier: float = 2.0) -> dict:
    """0-100 financial health score on the 50/30/20 rule, over the last
    `months` calendar months to date:

      savings_rate      40  min(savings_rate / 0.20, 1) x 40
      needs_ratio       20  max(0, 1 - (needs_ratio - 0.50) / 0.50) x 20
      wants_ratio       20  max(0, 1 - (wants_ratio - 0.30) / 0.30) x 20
      budget_adherence  10  budgets within limit / budgets x 10
      anomaly_frequency 10  max(0, 1 - unusual purchases / 5) x 10

    Built on the same rows, conversion and refund netting as the other
    shared facts. Unresolved amounts are left out of every ratio and the
    result is marked partial, never guessed."""
    if not 1 <= months <= 12:
        raise ValueError("months must be between 1 and 12")
    as_of = as_of or local_now(timezone).date()
    year, month = as_of.year, as_of.month - (months - 1)
    while month <= 0:
        month += 12
        year -= 1
    start = date(year, month, 1)
    rows = _history_rows(conn, as_of, timezone)
    period = _period(rows, start, as_of)
    income = period["income"]["minor_units"] if period["income"] else 0
    base = {"period": as_of.strftime("%Y-%m"), "start": start.isoformat(), "end": as_of.isoformat(),
            "status": period["status"], "unresolved_count": period["unresolved_count"],
            "income": period["income"], "spending": period["spending"]}
    if income <= 0:
        return {**base, "has_income_data": False, "score": None, "grade": None, "components": {}}

    category_types = {row[0]: row[1] for row in conn.execute("SELECT name, type FROM categories")}
    by_type = {"needs": 0, "wants": 0}
    for category, amount in period["categories"].items():
        kind = category_types.get(category) or "neutral"
        if kind in by_type:
            by_type[kind] += amount
    spending = period["spending"]["minor_units"]
    savings_rate = (income - spending) / income
    needs_ratio = by_type["needs"] / income
    wants_ratio = by_type["wants"] / income
    savings_score = round(min(max(savings_rate, 0.0) / 0.20, 1.0) * 40, 1)
    needs_score = round(max(0.0, 1.0 - max(0.0, needs_ratio - 0.50) / 0.50) * 20, 1)
    wants_score = round(max(0.0, 1.0 - max(0.0, wants_ratio - 0.30) / 0.30) * 20, 1)

    budgets = conn.execute("SELECT category, period, amount FROM budgets").fetchall()
    within = 0
    for category, budget_period, amount in budgets:
        budget_start = as_of.replace(day=1) if budget_period == "monthly" else as_of - timedelta(days=as_of.weekday())
        spent = sum(_signed(row) for row in _spending_rows(rows, budget_start, as_of)
                    if category is None or row["category"] == category)
        within += Decimal(spent) <= Decimal(str(amount)) * 100
    budget_value = round(within / len(budgets), 2) if budgets else 0.0
    budget_score = round(within / len(budgets) * 10, 1) if budgets else 0.0

    unusual = _unusual(rows, start, as_of, multiplier, _excluded_ids(conn))
    anomaly_score = round(max(0.0, 1.0 - len(unusual) / 5.0) * 10, 1)

    total = round(savings_score + needs_score + wants_score + budget_score + anomaly_score)
    grade = next((label for floor, label in _GRADES if total >= floor), "Needs Attention")
    return {
        **base, "has_income_data": True, "score": total, "grade": grade,
        "components": {
            "savings_rate": {"score": savings_score, "max": 40, "value": round(savings_rate, 3), "benchmark": 0.20,
                             "label": "Savings Rate", "description": "Income left after all spending"},
            "needs_ratio": {"score": needs_score, "max": 20, "value": round(needs_ratio, 3), "benchmark": 0.50,
                            "label": "Needs Ratio", "description": "Essentials: transport, groceries, bills"},
            "wants_ratio": {"score": wants_score, "max": 20, "value": round(wants_ratio, 3), "benchmark": 0.30,
                            "label": "Wants Ratio", "description": "Extras: dining, entertainment, shopping"},
            "budget_adherence": {"score": budget_score, "max": 10, "value": budget_value,
                                 "label": "Budget Adherence", "description": "Budgets within their limit this period"},
            "anomaly_frequency": {"score": anomaly_score, "max": 10, "value": len(unusual),
                                  "label": "Unusual Purchases", "description": "Over twice your usual at that merchant"},
        },
    }
