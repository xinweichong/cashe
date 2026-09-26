"""Analytics computation module — pure functions that query the transactions table."""

import calendar
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from src.config import local_now
from src.spending_facts import SGD_SQL, SIGNED_SGD_SQL


def _get_month_range(date_str: str | None = None, now: datetime | None = None):
    """Return (start, end) for the month containing date_str (or current month)."""
    if date_str:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    else:
        d = now if now is not None else local_now()
    start = d.replace(day=1)
    end = d.replace(day=calendar.monthrange(d.year, d.month)[1])
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _get_week_range(date_str: str | None = None, now: datetime | None = None):
    """Return (start, end) for the week containing date_str."""
    if date_str:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    else:
        d = now if now is not None else local_now()
    start = d - timedelta(days=d.weekday())
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _get_previous_period(start: str, end: str):
    """Return (prev_start, prev_end) for the previous period of the same type."""
    s = datetime.strptime(start, "%Y-%m-%d")
    e = datetime.strptime(end, "%Y-%m-%d")
    span = (e - s).days + 1
    prev_end = s - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)
    return prev_start.strftime("%Y-%m-%d"), prev_end.strftime("%Y-%m-%d")


def _query_total(conn: sqlite3.Connection, start: str, end: str, category: str | None = None):
    """Query total spending for a date range, optionally filtered by category.

    Money goes through SIGNED_SGD_SQL, the same SGD rule as Storage's
    aggregates and spending_facts.resolve_money: canonical
    reporting_minor_units first, then an SGD face value, then a real
    (non-1.0) exchange rate. Anything unresolved is NULL, which SUM skips —
    a legacy 1.0 rate is never taken as conversion evidence.

    A refund (R05) nets against spending in its own period/category —
    never retroactively rewriting the original purchase's — so it's
    included here with its sign flipped, not excluded like a transfer.
    """
    query = f"""
        SELECT COALESCE(SUM({SIGNED_SGD_SQL}), 0) as total
        FROM transactions
        WHERE (type IS NULL OR type = 'expense' OR type = 'refund')
          AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
    """
    params: list[Any] = [start, end]
    if category:
        query += " AND category = ?"
        params.append(category)
    row = conn.execute(query, params).fetchone()
    return row["total"]


def _category_totals(conn: sqlite3.Connection, start: str, end: str) -> dict[str, float]:
    """_query_total for every category at once."""
    rows = conn.execute(
        f"""SELECT category,
                  COALESCE(SUM({SIGNED_SGD_SQL}), 0) AS total
           FROM transactions
           WHERE (type IS NULL OR type = 'expense' OR type = 'refund') AND category IS NOT NULL
             AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
           GROUP BY category""",
        [start, end],
    ).fetchall()
    return {r["category"]: r["total"] for r in rows}


def get_period_comparison(
    conn: sqlite3.Connection, period: str = "month", date: str | None = None
) -> dict:
    """Compare current period spending to the previous period."""
    if period == "week":
        start, end = _get_week_range(date)
    else:
        start, end = _get_month_range(date)

    prev_start, prev_end = _get_previous_period(start, end)

    current_total = _query_total(conn, start, end)
    previous_total = _query_total(conn, prev_start, prev_end)

    change = current_total - previous_total
    change_percent = (change / previous_total * 100) if previous_total > 0 else (None if current_total > 0 else 0)

    return {
        "current_start": start,
        "current_end": end,
        "previous_start": prev_start,
        "previous_end": prev_end,
        "current_total": round(current_total, 2),
        "previous_total": round(previous_total, 2),
        "change": round(change, 2),
        "change_percent": round(change_percent, 1) if change_percent is not None else None,
    }


def get_category_comparison(
    conn: sqlite3.Connection, period: str = "month", date: str | None = None
) -> list[dict]:
    """Compare per-category spending between current and previous period."""
    if period == "week":
        start, end = _get_week_range(date)
    else:
        start, end = _get_month_range(date)

    prev_start, prev_end = _get_previous_period(start, end)

    # Get all categories with spending in either period — includes 'refund'
    # so a category with only a refund (no expense) in this window still
    # surfaces, rather than silently dropping its net-negative total.
    categories = conn.execute(
        """SELECT DISTINCT category FROM transactions
           WHERE type IN ('expense', 'refund') AND category IS NOT NULL
             AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?""",
        [prev_start, end],
    ).fetchall()

    current_totals = _category_totals(conn, start, end)
    previous_totals = _category_totals(conn, prev_start, prev_end)
    results = []
    for row in categories:
        cat = row["category"]
        current = current_totals.get(cat, 0.0)
        previous = previous_totals.get(cat, 0.0)
        change = current - previous
        change_pct = (change / previous * 100) if previous > 0 else (None if current > 0 else 0)
        results.append({
            "category": cat,
            "current": round(current, 2),
            "previous": round(previous, 2),
            "change": round(change, 2),
            "change_percent": round(change_pct, 1) if change_pct is not None else None,
        })

    return sorted(results, key=lambda x: x["current"], reverse=True)


def get_top_merchants(
    conn: sqlite3.Connection, limit: int = 10, period: str = "month", date: str | None = None
) -> list[dict]:
    """Get top merchants by total spending in the current period."""
    if period == "week":
        start, end = _get_week_range(date)
    else:
        start, end = _get_month_range(date)

    rows = conn.execute(
        f"""
        SELECT merchant,
               COUNT(*) FILTER (WHERE type IS NULL OR type = 'expense') as count,
               ROUND(COALESCE(SUM({SIGNED_SGD_SQL}), 0), 2) as total,
               ROUND(COALESCE(AVG({SGD_SQL}) FILTER (WHERE type IS NULL OR type = 'expense'), 0), 2) as avg_amount
        FROM transactions
        WHERE (type IS NULL OR type = 'expense' OR type = 'refund')
          AND merchant IS NOT NULL
          AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
        GROUP BY merchant
        ORDER BY total DESC
        LIMIT ?
        """,
        [start, end, limit],
    ).fetchall()

    return [dict(r) for r in rows]


def get_merchant_trend(
    conn: sqlite3.Connection, merchant: str, now: datetime | None = None
) -> dict:
    """Get spending trend for a specific merchant across months (ASC order for charting)."""
    rows = conn.execute(
        f"""
        SELECT strftime('%Y-%m', transaction_date) as month,
               ROUND(COALESCE(SUM({SIGNED_SGD_SQL}), 0), 2) as total,
               COUNT(*) FILTER (WHERE type IS NULL OR type = 'expense') as count
        FROM transactions
        WHERE (type IS NULL OR type = 'expense' OR type = 'refund') AND merchant = ?
        GROUP BY strftime('%Y-%m', transaction_date)
        ORDER BY month ASC
        LIMIT 6
        """,
        [merchant],
    ).fetchall()

    months = [dict(r) for r in rows]

    now = now if now is not None else local_now()
    current_month_str = now.strftime("%Y-%m")
    prev_month_str = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    months_by_key = {m["month"]: m["total"] for m in months}
    current_month = months_by_key.get(current_month_str, 0)
    previous_month = months_by_key.get(prev_month_str, 0)

    return {
        "merchant": merchant,
        "months": months,
        "current_month": current_month,
        "previous_month": previous_month,
        "trend": "up" if current_month > previous_month else ("down" if current_month < previous_month else "stable"),
    }


def get_spending_velocity(conn: sqlite3.Connection, now: datetime | None = None) -> dict:
    """Calculate spending velocity: current MTD vs projected based on last month's pace."""
    now = now if now is not None else local_now()
    today = now.strftime("%Y-%m-%d")

    # Current month range
    mtd_start = now.replace(day=1).strftime("%Y-%m-%d")

    # Last month range
    last_end = now.replace(day=1) - timedelta(days=1)
    last_start = last_end.replace(day=1)

    current_mtd = _query_total(conn, mtd_start, today)
    last_month_total = _query_total(conn, last_start.strftime("%Y-%m-%d"), last_end.strftime("%Y-%m-%d"))

    # Project: if we're on day X of N days in the month, project based on daily rate
    days_elapsed = now.day
    total_days = calendar.monthrange(now.year, now.month)[1]

    daily_rate = current_mtd / days_elapsed if days_elapsed > 0 else 0
    projected_total = daily_rate * total_days

    pace_percent = (projected_total / last_month_total * 100) if last_month_total > 0 else 0

    return {
        "current_mtd": round(current_mtd, 2),
        "last_month_total": round(last_month_total, 2),
        "projected_total": round(projected_total, 2),
        "days_elapsed": days_elapsed,
        "total_days": total_days,
        "pace_percent": round(pace_percent, 1),
        "status": "ahead" if pace_percent > 110 else ("on_track" if pace_percent >= 80 else "behind"),
    }


def get_anomalies(conn: sqlite3.Connection, multiplier: float = 2.0) -> list[dict]:
    """Find transactions that are > multiplier * category average."""
    rows = conn.execute(
        """
        WITH cat_avg AS (
            SELECT category, AVG(reporting_minor_units) as avg_reporting_minor
            FROM transactions
            WHERE (type IS NULL OR type = 'expense') AND category IS NOT NULL
            GROUP BY category
            HAVING COUNT(*) >= 3
        )
        SELECT t.id, t.merchant, t.amount, t.currency, t.category,
               t.transaction_date, t.reporting_minor_units,
               ca.avg_reporting_minor / 100.0 as avg_amount
        FROM transactions t
        JOIN cat_avg ca ON t.category = ca.category
        WHERE (t.type IS NULL OR t.type = 'expense')
          AND t.reporting_minor_units > ca.avg_reporting_minor * ?
          AND t.transaction_date >= date('now', '-30 days')
        ORDER BY t.reporting_minor_units DESC
        """,
        [multiplier],
    ).fetchall()

    return [dict(r) for r in rows]


def check_new_merchants(conn: sqlite3.Connection) -> list[dict]:
    """Find merchants that appeared for the first time this month."""
    rows = conn.execute(
        """
        WITH first_seen AS (
            SELECT merchant, MIN(transaction_date) as first_date
            FROM transactions
            WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
            GROUP BY merchant
        ),
        first_tx AS (
            SELECT t.merchant, t.category, t.amount, t.reporting_minor_units, t.transaction_date as first_date,
                   ROW_NUMBER() OVER (PARTITION BY t.merchant ORDER BY t.id) as rn
            FROM transactions t
            INNER JOIN first_seen fs ON t.merchant = fs.merchant AND t.transaction_date = fs.first_date
            WHERE (t.type IS NULL OR t.type = 'expense')
        )
        SELECT merchant, first_date, category, amount, reporting_minor_units
        FROM first_tx
        WHERE rn = 1
          AND first_date >= date('now', 'start of month')
        ORDER BY first_date DESC
        """,
    ).fetchall()

    return [dict(r) for r in rows]


def generate_summary(
    conn: sqlite3.Connection,
    report_type: str = "monthly",
) -> dict:
    """Generate a summary report for the current period."""
    if report_type == "weekly":
        start, end = _get_week_range()
    else:
        start, end = _get_month_range()

    total_spent = _query_total(conn, start, end)

    count_row = conn.execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE type='expense' AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?",
        [start, end],
    ).fetchone()

    top_cat = conn.execute(
        f"""
        SELECT category, ROUND(COALESCE(SUM({SIGNED_SGD_SQL}), 0), 2) as total
        FROM transactions
        WHERE type IN ('expense', 'refund') AND category IS NOT NULL
          AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
        GROUP BY category
        ORDER BY total DESC LIMIT 1
        """,
        [start, end],
    ).fetchone()

    biggest = conn.execute(
        f"""
        SELECT merchant, amount, currency, category, transaction_date
        FROM transactions
        WHERE type='expense' AND DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
        ORDER BY {SGD_SQL} DESC LIMIT 1
        """,
        [start, end],
    ).fetchone()

    prev_start, prev_end = _get_previous_period(start, end)
    prev_total = _query_total(conn, prev_start, prev_end)
    change = total_spent - prev_total
    change_pct = (change / prev_total * 100) if prev_total > 0 else (None if total_spent > 0 else 0)

    new_merchant_count_row = conn.execute(
        """
        WITH first_seen AS (
            SELECT merchant, MIN(transaction_date) as first_date
            FROM transactions
            WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
            GROUP BY merchant
        )
        SELECT COUNT(DISTINCT f.merchant) as cnt
        FROM first_seen f
        WHERE DATE(f.first_date) >= ? AND DATE(f.first_date) <= ?
        """,
        [start, end],
    ).fetchone()

    report = {
        "type": report_type,
        "start_date": start,
        "end_date": end,
        "total_spent": round(total_spent, 2),
        "transaction_count": count_row["cnt"],
        "top_category": dict(top_cat) if top_cat else None,
        "biggest_transaction": dict(biggest) if biggest else None,
        "previous_total": round(prev_total, 2),
        "change": round(change, 2),
        "change_percent": round(change_pct, 1) if change_pct is not None else None,
        "new_merchant_count": new_merchant_count_row["cnt"],
        "generated_at": local_now().isoformat(),
    }

    return report

