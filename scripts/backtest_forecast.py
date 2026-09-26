"""Rolling-origin backtest (R12): compares forecast.month_forecast (the new
weekday-median method) against analytics.get_spending_velocity (the existing
straight-line daily-rate method) across scenario fixtures with a known true
month-end total.

Neither method is assumed to win — this prints what actually happened,
including cases where the new method does worse, per the roadmap's own
instruction to investigate regressions rather than assert the median model
must always win.

Run: python3 -m scripts.backtest_forecast > docs/forecast-backtest-2026-09-16.md
"""
from datetime import date, datetime, timedelta
from itertools import count

from src.analytics import get_spending_velocity
from src.forecast import month_forecast
from src.db import init_db
from src.storage import Storage

TARGET_MONTH_START = date(2026, 9, 1)
TARGET_MONTH_END = date(2026, 9, 30)


def _new_storage() -> Storage:
    return Storage(init_db(":memory:"))


def _add(storage, seq, amount, day, **kwargs):
    values = dict(source="manual", source_id=f"bt-{next(seq)}", amount=round(amount, 2),
                  transaction_date=day, merchant="Merchant", category="General", tx_type="expense")
    values.update(kwargs)
    return storage.insert_transaction(**values)


def _daily(storage, seq, start, end, amount_for_day):
    day = start
    while day <= end:
        amount = amount_for_day(day)
        if amount:
            _add(storage, seq, amount, f"{day.isoformat()}T12:00:00")
        day += timedelta(days=1)


def _true_total(storage) -> float:
    row = storage._conn.execute(
        """SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0)
           FROM transactions WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
           AND (type IS NULL OR type IN ('expense', 'refund'))""",
        (TARGET_MONTH_START.isoformat(), TARGET_MONTH_END.isoformat()),
    ).fetchone()[0]
    return round(row, 2)


def _evaluate(name: str, storage: Storage, cutoffs: list[date], notes: str) -> dict:
    true_total = _true_total(storage)
    rows = []
    for as_of in cutoffs:
        new = month_forecast(storage._conn, as_of)
        new_total = new["projected_total"]["minor_units"] / 100 if new["projected_total"] else None
        old = get_spending_velocity(storage._conn, now=datetime.combine(as_of, datetime.min.time()))
        old_total = old["projected_total"]
        rows.append({
            "as_of": as_of.isoformat(),
            "new_total": new_total, "new_status": new["status"], "new_reasons": new["reasons"],
            "old_total": old_total,
            "new_error": None if new_total is None else round(new_total - true_total, 2),
            "old_error": round(old_total - true_total, 2),
        })
    return {"scenario": name, "notes": notes, "true_total": true_total, "rows": rows}


LOOKBACK_START = TARGET_MONTH_START - timedelta(weeks=10)


def scenario_sparse_history() -> dict:
    """Only ~2 weeks of history exist before the target month — fewer than
    the 4 eligible weeks required per weekday."""
    storage = _new_storage()
    seq = count()
    _daily(storage, seq, TARGET_MONTH_START - timedelta(days=14), TARGET_MONTH_START - timedelta(days=1),
          lambda day: 15.0)
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, lambda day: 15.0)
    return _evaluate(
        "Sparse history", storage, [date(2026, 9, 10), date(2026, 9, 20)],
        "Only 2 weeks of account history exist before the target month.",
    )


def scenario_one_off_spike() -> dict:
    """Ten weeks of steady $15/day history, then a single $900 one-off
    purchase early in the target month, before either cutoff."""
    storage = _new_storage()
    seq = count()
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_START - timedelta(days=1), lambda day: 15.0)
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, lambda day: 15.0)
    _add(storage, seq, 900.0, f"{(TARGET_MONTH_START + timedelta(days=1)).isoformat()}T09:00:00", merchant="Electronics Store")
    return _evaluate(
        "One-off spike this month", storage, [date(2026, 9, 5), date(2026, 9, 20)],
        "A single $900 purchase on Sep 2, otherwise steady $15/day history and month.",
    )


def scenario_trip_late_in_month() -> dict:
    """Steady history and steady month, but a real, historically-unprecedented
    trip (elevated $80/day) happens late in the month, after both cutoffs."""
    storage = _new_storage()
    seq = count()
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_START - timedelta(days=1), lambda day: 15.0)
    def month_amount(day):
        if date(2026, 9, 25) <= day <= date(2026, 9, 29):
            return 80.0
        return 15.0
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, month_amount)
    return _evaluate(
        "Trip late in the month", storage, [date(2026, 9, 10), date(2026, 9, 20)],
        "A $80/day trip occurs Sep 25-29 — after both forecast cutoffs, so neither method can see it coming.",
    )


def scenario_capture_outage() -> dict:
    """A 2-week gap with zero transactions in the middle of otherwise-steady
    lookback history, simulating an integration outage."""
    storage = _new_storage()
    seq = count()
    outage_start, outage_end = date(2026, 8, 10), date(2026, 8, 23)
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_START - timedelta(days=1),
          lambda day: 0.0 if outage_start <= day <= outage_end else 15.0)
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, lambda day: 15.0)
    return _evaluate(
        "Capture outage in history", storage, [date(2026, 9, 10), date(2026, 9, 20)],
        "Zero transactions Aug 10-23 (simulated outage), steady $15/day otherwise.",
    )


def scenario_long_capture_outage() -> dict:
    """A 5-week outage — long enough that more than half of a weekday's
    lookback occurrences are zero, which *does* drag the median down. This is
    the known limitation documented in forecast.py: eligibility only excludes
    weeks before the account's very first transaction, not a gap in the
    middle of otherwise-real history. Reported here as an observed
    limitation, not silently patched over."""
    storage = _new_storage()
    seq = count()
    outage_start, outage_end = date(2026, 7, 27), date(2026, 8, 30)
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_START - timedelta(days=1),
          lambda day: 0.0 if outage_start <= day <= outage_end else 15.0)
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, lambda day: 15.0)
    return _evaluate(
        "Long capture outage in history", storage, [date(2026, 9, 10), date(2026, 9, 20)],
        "Zero transactions for 5 straight weeks (Jul 27 - Aug 30), steady $15/day otherwise — "
        "long enough to move most weekdays' median toward zero.",
    )


def scenario_heavy_refunds() -> dict:
    """Regular spend with frequent same-week refunds netting part of it out."""
    storage = _new_storage()
    seq = count()
    def amount_for(day):
        return 15.0
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_START - timedelta(days=1), amount_for)
    _daily(storage, seq, TARGET_MONTH_START, TARGET_MONTH_END, amount_for)
    # Every Friday (in history and in the target month), a $10 refund nets against that week's spend.
    day = LOOKBACK_START
    while day <= TARGET_MONTH_END:
        if day.weekday() == 4:
            _add(storage, seq, 10.0, f"{day.isoformat()}T18:00:00", tx_type="refund")
        day += timedelta(days=1)
    return _evaluate(
        "Heavy refunds", storage, [date(2026, 9, 10), date(2026, 9, 20)],
        "Steady $15/day spend, with a $10 refund every Friday netting against it.",
    )


def scenario_recurring_heavy() -> dict:
    """A $150 rent charge posts (matched to a subscription) on the 1st of
    every month, including the target month, on top of small daily spend."""
    storage = _new_storage()
    seq = count()
    _daily(storage, seq, LOOKBACK_START, TARGET_MONTH_END, lambda day: 10.0)
    sub = storage.create_subscription("Rent", "monthly", billing_day=1)
    month_cursor = date(LOOKBACK_START.year, LOOKBACK_START.month, 1)
    while month_cursor <= TARGET_MONTH_START:
        upcoming = storage.create_upcoming_transaction(sub, month_cursor.isoformat(), 150.0)
        tx = _add(storage, seq, 150.0, f"{month_cursor.isoformat()}T08:00:00", merchant="Landlord")
        storage.match_upcoming_transaction(upcoming, tx)
        if month_cursor.month == 12:
            month_cursor = month_cursor.replace(year=month_cursor.year + 1, month=1)
        else:
            month_cursor = month_cursor.replace(month=month_cursor.month + 1)
    return _evaluate(
        "Recurring-heavy (rent)", storage, [date(2026, 9, 15), date(2026, 9, 25)],
        "A $150 rent charge posts and is matched on the 1st of every month, on top of $10/day variable spend.",
    )


SCENARIOS = [
    scenario_sparse_history,
    scenario_one_off_spike,
    scenario_trip_late_in_month,
    scenario_capture_outage,
    scenario_long_capture_outage,
    scenario_heavy_refunds,
    scenario_recurring_heavy,
]


def render_markdown(results: list[dict]) -> str:
    lines = [
        "# Forecast backtest results (R12)",
        "",
        "Rolling-origin comparison of `forecast.month_forecast` (new, weekday-median) "
        "against `analytics.get_spending_velocity` (existing, straight-line daily-rate) "
        "on synthetic fixtures with a known true month-end total. Generated by "
        "`scripts/backtest_forecast.py` — not hand-edited numbers.",
        "",
        "Neither method is assumed superior; results below are reported as observed, "
        "including scenarios where the new method does no better or worse than the old one.",
        "",
    ]
    for result in results:
        lines.append(f"## {result['scenario']}")
        lines.append("")
        lines.append(result["notes"])
        lines.append("")
        lines.append(f"True month total: **${result['true_total']:.2f}**")
        lines.append("")
        lines.append("| As of | New method | New status | Old method | New error | Old error |")
        lines.append("|---|---|---|---|---|---|")
        for row in result["rows"]:
            new_total = f"${row['new_total']:.2f}" if row["new_total"] is not None else "—"
            new_error = f"${row['new_error']:+.2f}" if row["new_error"] is not None else "—"
            status = row["new_status"] if not row["new_reasons"] else f"{row['new_status']} ({', '.join(row['new_reasons'])})"
            lines.append(
                f"| {row['as_of']} | {new_total} | {status} | ${row['old_total']:.2f} | "
                f"{new_error} | ${row['old_error']:+.2f} |"
            )
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    results = [scenario() for scenario in SCENARIOS]
    print(render_markdown(results))
