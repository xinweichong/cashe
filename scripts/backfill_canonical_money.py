"""Backfill canonical money columns (migration 12) from legacy amount/
currency/exchange_rate: python -m scripts.backfill_canonical_money DATABASE [--apply]

Dry-run by default — reports counts without writing. Only rows where
original_minor_units IS NULL are touched, so re-running only processes rows
added since the last run; it never re-derives or overwrites an already
backfilled or since-corrected row (that recomputation-on-correction path is
separate, later scope — see docs/plans/2026-09-09-cashe-completion-roadmap.md
R03). amount/currency/exchange_rate are never modified — legacy readers and
user corrections keep working unchanged.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3

from src.canonical_money import compute_transaction_canonical
from src.money import to_minor_units

# The only tables/columns this script is allowed to touch — never derived
# from CLI input, so this is a closed set rather than a runtime whitelist.
_SGD_TARGETS = (
    ("budgets", "amount", "amount_minor_units"),
    ("goals", "target_amount", "target_minor_units"),
    ("goals", "saved_amount", "saved_minor_units"),
    ("goal_contributions", "amount", "amount_minor_units"),
    ("upcoming_transactions", "expected_amount", "expected_minor_units"),
)


def backfill_transactions(conn: sqlite3.Connection, apply: bool) -> dict:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, amount, currency, exchange_rate, transaction_date FROM transactions "
        "WHERE original_minor_units IS NULL"
    ).fetchall()

    issues: Counter = Counter()
    status_counts: Counter = Counter()
    missing_date_count = 0
    updated = 0

    for row in rows:
        if row["transaction_date"] is None:
            missing_date_count += 1
        result = compute_transaction_canonical(dict(row))
        if result["issue"]:
            issues[result["issue"]] += 1
            continue
        status_counts[result["conversion_status"]] += 1
        if apply:
            conn.execute(
                """UPDATE transactions SET
                     original_minor_units = ?, reporting_minor_units = ?,
                     conversion_status = ?, conversion_rate = ?, conversion_source = ?
                   WHERE id = ?""",
                (result["original_minor_units"], result["reporting_minor_units"],
                 result["conversion_status"], result["conversion_rate"], result["conversion_source"],
                 row["id"]),
            )
            updated += 1

    if apply:
        conn.commit()

    return {
        "dry_run": not apply,
        "rows_scanned": len(rows),
        "updated": updated,
        "issues": dict(issues),
        "status_counts": dict(status_counts),
        "missing_date_count": missing_date_count,
    }


def backfill_sgd_minor_units(conn: sqlite3.Connection, table: str, amount_column: str, minor_column: str, apply: bool) -> dict:
    """Backfill a plain SGD-only integer minor-units mirror of `amount_column`.

    No FX involved — these tables have no currency column, so the amount is
    already implicitly SGD. NULL amounts (e.g. an unset upcoming charge) are
    never candidates; that's absence, not an issue.
    """
    rows = conn.execute(
        f"SELECT id, {amount_column} FROM {table} WHERE {minor_column} IS NULL AND {amount_column} IS NOT NULL"
    ).fetchall()

    issues: Counter = Counter()
    updated = 0
    for row_id, amount in rows:
        try:
            minor = to_minor_units(amount, "SGD")
        except ValueError:
            issues["invalid_amount"] += 1
            continue
        if apply:
            conn.execute(f"UPDATE {table} SET {minor_column} = ? WHERE id = ?", (minor, row_id))
            updated += 1

    if apply:
        conn.commit()

    return {
        "dry_run": not apply,
        "table": table,
        "column": minor_column,
        "rows_scanned": len(rows),
        "updated": updated,
        "issues": dict(issues),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--apply", action="store_true", help="Actually write; default is dry-run.")
    args = parser.parse_args(argv)

    conn = sqlite3.connect(args.database)
    conn.row_factory = sqlite3.Row
    try:
        report = {
            "dry_run": not args.apply,
            "transactions": backfill_transactions(conn, args.apply),
        }
        for table, amount_column, minor_column in _SGD_TARGETS:
            key = f"{table}.{minor_column}"
            report[key] = backfill_sgd_minor_units(conn, table, amount_column, minor_column, args.apply)
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
