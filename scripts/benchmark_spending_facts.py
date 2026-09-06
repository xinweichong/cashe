"""Benchmark synthetic spending facts without accessing real user databases."""
import argparse
from datetime import date, timedelta
import json
import logging
from pathlib import Path
import platform
import sqlite3
from statistics import median
from tempfile import TemporaryDirectory
from time import perf_counter

from src.main import init_db
from src.storage import Storage


def benchmark(row_count: int = 100_000, runs: int = 5, history_days: int = 240) -> dict:
    as_of = date(2026, 9, 6)
    categories = ("Food", "Transport", "Shopping", "Bills", "Other")
    with TemporaryDirectory(prefix="cashe-facts-benchmark-") as directory:
        conn = init_db(str(Path(directory) / "synthetic.db"))
        try:
            conn.executemany(
                """INSERT INTO transactions
                   (source, source_id, amount, currency, exchange_rate, merchant, category, type, transaction_date)
                   VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?)""",
                ((f"synthetic-{i}", (i % 10_000 + 1) / 100,
                  "USD" if i % 7 == 0 else "SGD", 1.34 if i % 7 == 0 else 1.0,
                  f"Merchant {i % 200}", categories[i % len(categories)],
                  "income" if i % 19 == 0 else "expense",
                  (as_of - timedelta(days=i % history_days)).isoformat() + "T12:00:00")
                 for i in range(row_count)),
            )
            conn.commit()
            storage = Storage(conn)
            output = {"rows": row_count, "history_days": history_days, "runs": runs,
                      "python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
                      "platform": platform.system(), "machine": platform.machine(),
                      "database": "temporary disk SQLite WAL; synthetic data only"}
            queries = {
                "month_facts": lambda: storage.get_month_spending_facts(as_of),
                "evidence_first_page": lambda: storage.get_spending_evidence(
                    date(2026, 9, 1), as_of, limit=50, offset=0),
                "evidence_later_page": lambda: storage.get_spending_evidence(
                    date(2026, 9, 1), as_of, limit=50, offset=500),
            }
            for name, query in queries.items():
                times = []
                for _ in range(runs):
                    started = perf_counter()
                    response = query()
                    times.append(round((perf_counter() - started) * 1000, 3))
                output[name] = {"milliseconds": times, "median_ms": median(times),
                                "json_bytes": len(json.dumps(response).encode())}
            return output
        finally:
            conn.close()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=positive_int, default=100_000)
    parser.add_argument("--runs", type=positive_int, default=5)
    parser.add_argument("--history-days", type=positive_int, default=240)
    args = parser.parse_args()
    logging.getLogger("src.main").setLevel(logging.WARNING)
    print(json.dumps(benchmark(args.rows, args.runs, args.history_days), indent=2))


if __name__ == "__main__":
    main()
