"""Repair a single known orphaned relationship: python -m scripts.repair_orphans DATABASE --table ... [--apply]

Dry-run by default — reports how many rows would be deleted without touching
the database. Pass --apply to actually delete them, inside one transaction.
Only relationships already declared in scripts.db_audit.RELATIONSHIPS may be
repaired, so this cannot be pointed at an arbitrary table/column pair.
"""
import argparse
import json
from pathlib import Path
import sqlite3

from scripts.db_audit import RELATIONSHIPS


def _identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _is_recognized_relationship(table: str, column: str, parent: str, target: str) -> bool:
    return any(
        (table, column, parent, target) == relation
        for relations in RELATIONSHIPS.values()
        for relation in relations
    )


def find_orphans(conn: sqlite3.Connection, table: str, column: str, parent: str, target: str) -> list[int]:
    """Row ids in `table` whose `column` does not match any `parent`.`target`."""
    if not _is_recognized_relationship(table, column, parent, target):
        raise ValueError(f"{table}.{column} -> {parent}.{target} is not a recognized relationship")
    rows = conn.execute(
        f"""SELECT id FROM {_identifier(table)} c
            WHERE c.{_identifier(column)} IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM {_identifier(parent)} p
                WHERE p.{_identifier(target)} = c.{_identifier(column)})"""
    ).fetchall()
    return [row[0] for row in rows]


def delete_orphans(conn: sqlite3.Connection, table: str, row_ids: list[int]) -> int:
    if not row_ids:
        return 0
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        placeholders = ",".join("?" for _ in row_ids)
        conn.execute(f"DELETE FROM {_identifier(table)} WHERE id IN ({placeholders})", row_ids)
    return len(row_ids)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--table", required=True)
    parser.add_argument("--column", required=True)
    parser.add_argument("--parent", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--apply", action="store_true", help="Actually delete; default is dry-run.")
    args = parser.parse_args(argv)

    conn = sqlite3.connect(args.database)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            print(json.dumps({"status": "error", "error": "integrity_check failed; refusing to modify"}))
            return 2
        orphan_ids = find_orphans(conn, args.table, args.column, args.parent, args.target)
        deleted = delete_orphans(conn, args.table, orphan_ids) if args.apply else 0
        print(json.dumps({
            "dry_run": not args.apply,
            "table": args.table,
            "orphan_count": len(orphan_ids),
            "deleted": deleted,
        }, indent=2, sort_keys=True))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
