import json

from src.main import init_db
from scripts.backfill_canonical_money import backfill_transactions, main


def _insert(conn, source_id, amount, currency="SGD", exchange_rate=1.0, transaction_date="2026-05-01"):
    conn.execute(
        "INSERT INTO transactions(source, source_id, amount, currency, exchange_rate, transaction_date) "
        "VALUES ('manual', ?, ?, ?, ?, ?)",
        (source_id, amount, currency, exchange_rate, transaction_date),
    )
    conn.commit()


def test_dry_run_reports_without_writing(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "sgd-1", 12.50, "SGD", 1.0)
    _insert(conn, "usd-1", 20.0, "USD", 1.34)

    report = backfill_transactions(conn, apply=False)

    assert report["dry_run"] is True
    assert report["rows_scanned"] == 2
    assert report["updated"] == 0
    assert report["status_counts"] == {"native": 1, "indicative": 1}
    row = conn.execute("SELECT original_minor_units FROM transactions WHERE source_id = 'sgd-1'").fetchone()
    assert row[0] is None  # nothing written in dry-run
    conn.close()


def test_apply_writes_canonical_columns_and_preserves_legacy_columns(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "usd-1", 20.0, "USD", 1.34)

    report = backfill_transactions(conn, apply=True)

    assert report["updated"] == 1
    row = conn.execute(
        "SELECT amount, currency, exchange_rate, original_minor_units, reporting_minor_units, "
        "conversion_status, conversion_rate, conversion_source FROM transactions WHERE source_id = 'usd-1'"
    ).fetchone()
    assert (row[0], row[1], row[2]) == (20.0, "USD", 1.34)  # legacy columns untouched
    assert row[3] == 2000
    assert row[4] == 2680
    assert row[5] == "indicative"
    assert row[6] == "1.34"
    assert row[7] == "legacy_backfill"
    conn.close()


def test_unresolved_legacy_rate_is_written_with_null_reporting(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "usd-unresolved", 20.0, "USD", 1.0)  # legacy silent-fallback rate

    backfill_transactions(conn, apply=True)

    row = conn.execute(
        "SELECT original_minor_units, reporting_minor_units, conversion_status FROM transactions WHERE source_id = 'usd-unresolved'"
    ).fetchone()
    assert tuple(row) == (2000, None, "unresolved")
    conn.close()


def test_unknown_currency_is_left_untouched_and_reported_as_an_issue(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "weird-1", 10.0, "XYZ", 1.0)

    report = backfill_transactions(conn, apply=True)

    assert report["issues"] == {"unknown_currency": 1}
    row = conn.execute("SELECT original_minor_units FROM transactions WHERE source_id = 'weird-1'").fetchone()
    assert row[0] is None
    conn.close()


def test_missing_date_is_counted_but_still_backfilled(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "no-date", 12.50, "SGD", 1.0, transaction_date=None)

    report = backfill_transactions(conn, apply=True)

    assert report["missing_date_count"] == 1
    row = conn.execute("SELECT original_minor_units FROM transactions WHERE source_id = 'no-date'").fetchone()
    assert row[0] == 1250
    conn.close()


def test_rerunning_only_touches_rows_not_yet_backfilled(tmp_path):
    conn = init_db(str(tmp_path / "user.db"))
    _insert(conn, "sgd-1", 12.50, "SGD", 1.0)
    backfill_transactions(conn, apply=True)
    _insert(conn, "sgd-2", 5.00, "SGD", 1.0)

    report = backfill_transactions(conn, apply=True)

    assert report["rows_scanned"] == 1  # only the new row
    assert report["updated"] == 1
    conn.close()


def test_cli_dry_run_then_apply(tmp_path, capsys):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    _insert(conn, "sgd-1", 12.50, "SGD", 1.0)
    conn.close()

    exit_code = main([str(path)])
    assert exit_code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["updated"] == 0

    exit_code = main([str(path), "--apply"])
    assert exit_code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is False
    assert report["updated"] == 1
