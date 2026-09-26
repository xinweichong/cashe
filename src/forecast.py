"""Weekday-median month-remaining spending forecast (R12).

This is a distinct method from analytics.get_spending_velocity's straight-line
daily-rate projection. Per the roadmap's own instruction, that old method is
not renamed, replaced, or deleted here — both remain available until the new
method's backtested performance actually justifies retiring the old one.
"""
import statistics
import calendar
from datetime import date, timedelta

from src.config import DEFAULT_TIMEZONE, local_now
# _rows/_period/_signed are spending_facts-internal by convention, not by
# enforcement — reused here rather than reimplemented so the forecast agrees
# with every other money surface on refund netting, transfer exclusion, and
# canonical-money resolution by construction, not by parallel maintenance.
from src.spending_facts import _period as period_totals, _rows as ledger_rows, _signed as signed_amount, money, resolve_money, sgd_minor

LOOKBACK_WEEKS = 8
MIN_ELIGIBLE_WEEKS = 4


def _month_bounds(as_of: date) -> tuple[date, date]:
    return as_of.replace(day=1), as_of.replace(day=calendar.monthrange(as_of.year, as_of.month)[1])


def _lookback_window(as_of: date, weeks: int = LOOKBACK_WEEKS) -> tuple[date, date]:
    """The trailing `weeks` *complete* calendar weeks (Mon-Sun) before the
    current, possibly partial, week — same convention as R10's
    spending_facts.weekday_pattern, so the two don't quietly disagree on what
    a "complete week" means."""
    current_week_start = as_of - timedelta(days=as_of.weekday())
    end = current_week_start - timedelta(days=1)
    start = end - timedelta(days=weeks * 7 - 1)
    return start, end


def _weekday_medians(conn, as_of: date, earliest_transaction_date: date | None, matched_transaction_ids: set[int],
                      excluded_transaction_ids: set[int], timezone: str, category: str | None = None) -> dict[int, dict]:
    """Per-weekday median spend over the lookback window, excluding
    transactions already matched to a confirmed recurring charge (those are
    counted once, separately, as a confirmed commitment — not baked into the
    variable baseline too), transactions explicitly flagged unusual (R13's
    baseline-exclusion), and rows whose money can't be resolved (dropped,
    never fabricated as a zero). A day before the account's earliest
    transaction is a capture/history gap and is excluded entirely; a day at
    or after it with no expense that day is a genuine observed zero and
    counts as 0 in the median. An optional `category` scopes this to a single
    category's own weekday pattern (R13 sub-project 4's category-reduction
    scenario) — the "Other" bucket for legacy NULL categories, same
    convention _rows already applies."""
    start, end = _lookback_window(as_of)
    rows = [row for row in ledger_rows(conn, start, end, timezone)
            if row["day"] is not None and row["type"] in ("expense", "refund")
            and row["id"] not in matched_transaction_ids and row["id"] not in excluded_transaction_ids
            and (category is None or row["category"] == category)]
    by_day: dict[date, int] = {}
    for row in rows:
        if row["minor"] is None:
            continue
        by_day[row["day"]] = by_day.get(row["day"], 0) + signed_amount(row)

    result = {}
    for weekday in range(7):
        values = []
        day = start + timedelta(days=weekday)
        while day <= end:
            if earliest_transaction_date is not None and day >= earliest_transaction_date:
                values.append(by_day.get(day, 0))
            day += timedelta(days=7)
        eligible = len(values)
        has_data = eligible >= MIN_ELIGIBLE_WEEKS
        median = round(statistics.median(values)) if has_data else None
        result[weekday] = {
            "weekday": weekday, "eligible_weeks": eligible,
            "median": money(median) if median is not None else None,
            # The lowest/highest amount actually observed on this weekday in
            # the lookback window — a historical range, not a computed
            # statistical interval (R12's own explicit distinction).
            "low": money(min(values)) if has_data else None,
            "high": money(max(values)) if has_data else None,
        }
    return result


def month_forecast(conn, as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    as_of = as_of or local_now(timezone).date()
    period_start, period_end = _month_bounds(as_of)

    rows = ledger_rows(conn, period_start, period_end, timezone)
    actual_period = period_totals(rows, period_start, as_of)

    earliest_row = conn.execute("SELECT MIN(DATE(transaction_date)) FROM transactions").fetchone()[0]
    earliest_date = date.fromisoformat(earliest_row) if earliest_row else None

    matched_ids = {row[0] for row in conn.execute(
        "SELECT matched_transaction_id FROM upcoming_transactions WHERE matched_transaction_id IS NOT NULL")}
    excluded_ids = {row[0] for row in conn.execute(
        "SELECT id FROM transactions WHERE excluded_from_baseline = 1")}

    lookback_start, lookback_end = _lookback_window(as_of)
    medians = _weekday_medians(conn, as_of, earliest_date, matched_ids, excluded_ids, timezone)

    remaining_days = []
    day = as_of + timedelta(days=1)
    while day <= period_end:
        remaining_days.append(day)
        day += timedelta(days=1)

    reasons = []
    remaining_variable_minor = 0
    remaining_variable_estimate = None
    remaining_variable_low = None
    remaining_variable_high = None
    if any(medians[d.weekday()]["median"] is None for d in remaining_days):
        reasons.append("insufficient_history")
    else:
        remaining_variable_minor = sum(medians[d.weekday()]["median"]["minor_units"] for d in remaining_days)
        remaining_variable_estimate = money(remaining_variable_minor)
        remaining_variable_low = money(sum(medians[d.weekday()]["low"]["minor_units"] for d in remaining_days))
        remaining_variable_high = money(sum(medians[d.weekday()]["high"]["minor_units"] for d in remaining_days))

    commitment_rows = conn.execute(
        """SELECT expected_amount FROM upcoming_transactions
           WHERE matched_transaction_id IS NULL AND status = 'pending'
           AND DATE(expected_date) >= DATE(?) AND DATE(expected_date) <= DATE(?)""",
        (as_of.isoformat(), period_end.isoformat()),
    ).fetchall()
    confirmed_minor = 0
    unpriced_count = 0
    for row in commitment_rows:
        if row[0] is None:
            unpriced_count += 1
            continue
        minor = sgd_minor(row[0])
        if minor is None:
            unpriced_count += 1
        else:
            confirmed_minor += minor
    if unpriced_count:
        reasons.append("unpriced_commitment")
    if actual_period["unresolved_count"]:
        reasons.append("unresolved_conversion")

    known_minor = actual_period["spending"]["minor_units"] + confirmed_minor
    projected_total = None
    projected_total_low = None
    projected_total_high = None
    if remaining_variable_estimate is not None:
        projected_total = money(known_minor + remaining_variable_minor)
        projected_total_low = money(known_minor + remaining_variable_low["minor_units"])
        projected_total_high = money(known_minor + remaining_variable_high["minor_units"])

    status = "unavailable" if remaining_variable_estimate is None else ("partial" if reasons else "complete")

    return {
        "as_of": as_of.isoformat(), "timezone": timezone,
        "period_start": period_start.isoformat(), "period_end": period_end.isoformat(),
        "status": status, "reasons": reasons,
        "recorded_actual": actual_period["spending"],
        "confirmed_commitments": money(confirmed_minor),
        "unpriced_commitment_count": unpriced_count,
        "remaining_variable_estimate": remaining_variable_estimate,
        "remaining_variable_low": remaining_variable_low,
        "remaining_variable_high": remaining_variable_high,
        "projected_total": projected_total,
        "projected_total_low": projected_total_low,
        "projected_total_high": projected_total_high,
        "weekday_medians": [medians[weekday] for weekday in range(7)],
        "lookback_window": {"start": lookback_start.isoformat(), "end": lookback_end.isoformat()},
        "assumptions": [
            "Charges already matched to a confirmed recurring subscription are excluded from the variable "
            "estimate and counted once, separately, as a confirmed commitment.",
            f"The variable estimate is each remaining day's weekday median over the trailing "
            f"{LOOKBACK_WEEKS} complete weeks, requiring at least {MIN_ELIGIBLE_WEEKS} eligible weeks per weekday.",
            "The low/high range is the lowest and highest amount actually recorded on each remaining "
            "weekday within that window — a historical range, not a statistical confidence interval.",
        ] + ([
            "Purchases and trips you've explicitly marked as unusual are excluded from the variable "
            "estimate's history, but still count in every actual total and evidence list."
        ] if conn.execute(
            "SELECT 1 FROM transactions WHERE excluded_from_baseline = 1 "
            "AND DATE(transaction_date) >= DATE(?) AND DATE(transaction_date) <= DATE(?) LIMIT 1",
            (lookback_start.isoformat(), lookback_end.isoformat()),
        ).fetchone() else []),
    }


def _category_remaining_estimate(conn, as_of: date, period_end: date, category: str, timezone: str) -> int | None:
    """The remaining-days variable estimate for one category alone, using the
    same weekday-median machinery as the overall forecast, scoped to that
    category's own history. None if that category doesn't have enough
    lookback history to support an estimate."""
    earliest_row = conn.execute("SELECT MIN(DATE(transaction_date)) FROM transactions").fetchone()[0]
    earliest_date = date.fromisoformat(earliest_row) if earliest_row else None
    matched_ids = {row[0] for row in conn.execute(
        "SELECT matched_transaction_id FROM upcoming_transactions WHERE matched_transaction_id IS NOT NULL")}
    excluded_ids = {row[0] for row in conn.execute(
        "SELECT id FROM transactions WHERE excluded_from_baseline = 1")}
    medians = _weekday_medians(conn, as_of, earliest_date, matched_ids, excluded_ids, timezone, category=category)
    remaining_days = []
    day = as_of + timedelta(days=1)
    while day <= period_end:
        remaining_days.append(day)
        day += timedelta(days=1)
    if any(medians[d.weekday()]["median"] is None for d in remaining_days):
        return None
    return sum(medians[d.weekday()]["median"]["minor_units"] for d in remaining_days)


def scenario(conn, adjustments: list[dict], as_of: date | None = None, timezone: str = DEFAULT_TIMEZONE) -> dict:
    """Read-only 'what if' preview (R13 sub-project 4): applies labeled
    hypothetical adjustments to the real month_forecast and reports the
    delta, without writing anything — no transaction, goal, or schedule state
    changes. Each adjustment is one of:
      - {"kind": "one_off_exclusion", "transaction_id": int} — a purchase
        that already happened, previewed as if it hadn't.
      - {"kind": "category_reduction", "category": str, "reduce_by_percent": float}
        — reduce the *remaining* days' estimate for one category by a
        percentage (0-100).
      - {"kind": "subscription_removal", "subscription_id": int} — exclude
        that subscription's still-pending (unmatched) commitment this month,
        as if cancelled starting now.
    An adjustment that can't be honestly computed (insufficient category
    history, an unpriced commitment, a transaction outside the current
    period) is returned with amount_delta=None and a note explaining why,
    rather than guessing — it simply doesn't move the result total."""
    as_of = as_of or local_now(timezone).date()
    period_start, period_end = _month_bounds(as_of)
    base = month_forecast(conn, as_of, timezone)

    results = []
    total_delta_minor = 0
    for adjustment in adjustments:
        kind = adjustment.get("kind")
        label, delta_minor, note = None, None, None

        if kind == "one_off_exclusion":
            tx = conn.execute("SELECT * FROM transactions WHERE id = ?", (adjustment["transaction_id"],)).fetchone()
            if tx is None:
                label, note = f"Transaction {adjustment['transaction_id']}", "Transaction not found."
            else:
                tx_date = date.fromisoformat(tx["transaction_date"][:10])
                label = f"Exclude {tx['merchant'] or 'this purchase'} ({tx['transaction_date'][:10]})"
                if not (period_start <= tx_date <= as_of):
                    note = "This purchase isn't in the current recorded period."
                else:
                    minor, _ = resolve_money(dict(tx))
                    if minor is None:
                        note = "This purchase's currency conversion is unresolved."
                    else:
                        sign = -1 if tx["type"] == "refund" else 1
                        delta_minor = -sign * minor

        elif kind == "category_reduction":
            category = adjustment["category"]
            percent = adjustment.get("reduce_by_percent", 0)
            label = f"Reduce {category} by {percent:g}% for the rest of the month"
            category_minor = _category_remaining_estimate(conn, as_of, period_end, category, timezone)
            if category_minor is None:
                note = f"Not enough history for {category} to estimate its remaining spend."
            else:
                delta_minor = -round(category_minor * percent / 100)

        elif kind == "subscription_removal":
            sub = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (adjustment["subscription_id"],)).fetchone()
            label = f"Remove {sub['label'] or sub['merchant']}" if sub else f"Remove subscription {adjustment['subscription_id']}"
            if sub is None:
                note = "Subscription not found."
            else:
                pending_rows = conn.execute(
                    """SELECT expected_amount FROM upcoming_transactions
                       WHERE subscription_id = ? AND matched_transaction_id IS NULL AND status = 'pending'
                       AND DATE(expected_date) >= DATE(?) AND DATE(expected_date) <= DATE(?)""",
                    (sub["id"], as_of.isoformat(), period_end.isoformat()),
                ).fetchall()
                if not pending_rows:
                    note = "No pending charge for this subscription remains this month."
                elif any(row[0] is None for row in pending_rows):
                    note = "This subscription's pending charge has no known amount."
                else:
                    total = 0
                    for row in pending_rows:
                        total += sgd_minor(row[0]) or 0
                    delta_minor = -total

        else:
            label, note = str(kind), "Unknown scenario kind."

        if delta_minor is not None:
            total_delta_minor += delta_minor
        results.append({"kind": kind, "label": label, "amount_delta": money(delta_minor) if delta_minor is not None else None, "note": note})

    result = None
    if base["projected_total"] is not None:
        result = {"projected_total": money(base["projected_total"]["minor_units"] + total_delta_minor)}

    return {"base": base, "adjustments": results, "result": result}
