"""Read-only pre-upgrade audit: python -m scripts.db_audit DATABASE."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3

from src.migrations import MIGRATIONS


RELATIONSHIPS = {
    "user": (
        ("goal_contributions", "goal_id", "goals", "id"),
        ("trip_transactions", "trip_id", "trips", "id"),
        ("trip_transactions", "transaction_id", "transactions", "id"),
        ("upcoming_transactions", "subscription_id", "subscriptions", "id"),
        ("upcoming_transactions", "matched_transaction_id", "transactions", "id"),
    ),
    "admin": (
        ("sessions", "username", "users", "username"),
        ("telegram_link_tokens", "username", "users", "username"),
    ),
}


def _identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _orphan_count(conn, child, column, parent, target) -> int:
    return conn.execute(
        f"""SELECT COUNT(*) FROM {_identifier(child)} c
            WHERE c.{_identifier(column)} IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM {_identifier(parent)} p
                WHERE p.{_identifier(target)} = c.{_identifier(column)})"""
    ).fetchone()[0]


def audit_database(path: Path) -> dict:
    """Inspect one existing DB in a consistent read transaction; never initialize it.

    Output contains schema identifiers and counts, never row IDs or stored values.
    Missing feature tables are listed separately for legacy-schema review.
    """
    conn = None
    try:
        conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
        conn.execute("PRAGMA query_only = ON")
        conn.execute("BEGIN")
        integrity_ok = conn.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")}
        kinds = [kind for kind, table in (("user", "transactions"), ("admin", "users")) if table in tables]
        if len(kinds) != 1:
            return {"status": "error", "error_code": "unrecognized_database_schema"}
        kind = kinds[0]

        violations = Counter((row[0], row[2], row[3]) for row in conn.execute("PRAGMA foreign_key_check"))
        foreign_keys = [
            {"table": table, "parent": parent, "foreign_key_id": key, "count": count}
            for (table, parent, key), count in sorted(violations.items())
        ]
        missing_constraints = []
        missing_tables = set()
        for child, column, parent, target in RELATIONSHIPS[kind]:
            if child not in tables:
                missing_tables.add(child)
                continue
            declared = conn.execute(f"PRAGMA foreign_key_list({_identifier(child)})").fetchall()
            primary_key = [row[1] for row in conn.execute(f"PRAGMA table_info({_identifier(parent)})") if row[5]]
            if any(row[2:4] == (parent, column)
                   and (row[4] == target or (row[4] is None and primary_key == [target]))
                   and sum(other[0] == row[0] for other in declared) == 1 for row in declared):
                continue
            missing_constraints.append({
                "table": child, "column": column, "parent": parent, "target": target,
                "orphan_count": _orphan_count(conn, child, column, parent, target) if parent in tables else None,
            })
            if parent not in tables:
                missing_tables.add(parent)

        # These links deliberately survive transaction deletion. They are not FKs.
        retained = {}
        # A suggestion/acceptance is provenance of what was suggested/accepted at
        # the time — its subscription_id is a historical pointer that deliberately
        # survives subscription deletion, not a strict current-state FK either.
        retained_subscription_links = {}
        if kind == "user":
            for table in ("source_events", "ingestion_outbox", "transaction_requests"):
                if table in tables:
                    retained[table] = _orphan_count(conn, table, "transaction_id", "transactions", "id")
            for table in ("recurring_suggestions", "subscription_suggestion_acceptances"):
                if table in tables:
                    retained_subscription_links[table] = _orphan_count(conn, table, "subscription_id", "subscriptions", "id")
        applied = []
        pending = []
        unknown = []
        if kind == "user":
            if "schema_migrations" in tables:
                applied = [row[0] for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
            supported = {version for version, _ in MIGRATIONS}
            pending = sorted(supported - set(applied))
            unknown = sorted(set(applied) - supported)

        return {
            "status": "issues" if not integrity_ok or foreign_keys or missing_constraints or missing_tables or unknown else "ok",
            "database_kind": kind,
            "integrity_ok": integrity_ok,
            "foreign_key_violations": foreign_keys,
            "missing_foreign_keys": missing_constraints,
            "absent_feature_tables": sorted(missing_tables),
            "retained_links_to_deleted_transactions": retained,
            "retained_links_to_deleted_subscriptions": retained_subscription_links,
            "applied_migrations": applied,
            "pending_migrations": pending,
            "unknown_migrations": unknown,
        }
    except sqlite3.Error as exc:
        return {"status": "error", "error_code": getattr(exc, "sqlite_errorname", "DatabaseError")}
    finally:
        if conn is not None:
            conn.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    args = parser.parse_args(argv)
    report = audit_database(args.database)
    print(json.dumps(report, indent=2, sort_keys=True))
    return {"ok": 0, "issues": 1, "error": 2}[report["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
