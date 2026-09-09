import json

from src.main import init_db
from scripts.backfill_canonical_money import backfill_sgd_minor_units, backfill_transactions, main


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
    assert report["transactions"]["updated"] == 0

    exit_code = main([str(path), "--apply"])
    assert exit_code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is False
    assert report["transactions"]["updated"] == 1


class TestBackfillSgdMinorUnits:
    def test_budgets(self, tmp_path):
        conn = init_db(str(tmp_path / "user.db"))
        conn.execute("INSERT INTO budgets(category, period, amount) VALUES ('Food', 'monthly', 500.0)")
        conn.commit()

        report = backfill_sgd_minor_units(conn, "budgets", "amount", "amount_minor_units", apply=True)

        assert report["updated"] == 1
        row = conn.execute("SELECT amount, amount_minor_units FROM budgets").fetchone()
        assert tuple(row) == (500.0, 50000)
        conn.close()

    def test_goals_target_and_saved_are_independent_columns(self, tmp_path):
        conn = init_db(str(tmp_path / "user.db"))
        conn.execute("INSERT INTO goals(name, target_amount, saved_amount) VALUES ('Trip', 1000.0, 250.5)")
        conn.commit()

        backfill_sgd_minor_units(conn, "goals", "target_amount", "target_minor_units", apply=True)
        backfill_sgd_minor_units(conn, "goals", "saved_amount", "saved_minor_units", apply=True)

        row = conn.execute("SELECT target_minor_units, saved_minor_units FROM goals").fetchone()
        assert tuple(row) == (100000, 25050)
        conn.close()

    def test_goal_contributions(self, tmp_path):
        conn = init_db(str(tmp_path / "user.db"))
        conn.execute("INSERT INTO goals(id, name, target_amount) VALUES (1, 'Trip', 1000.0)")
        conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (1, 42.5, '2026-09')")
        conn.commit()

        report = backfill_sgd_minor_units(conn, "goal_contributions", "amount", "amount_minor_units", apply=True)

        assert report["updated"] == 1
        row = conn.execute("SELECT amount_minor_units FROM goal_contributions").fetchone()
        assert row[0] == 4250
        conn.close()

    def test_upcoming_transactions_skips_null_expected_amount(self, tmp_path):
        conn = init_db(str(tmp_path / "user.db"))
        sub_id = conn.execute(
            "INSERT INTO subscriptions(merchant, frequency) VALUES ('Netflix', 'monthly')"
        ).lastrowid
        conn.execute(
            "INSERT INTO upcoming_transactions(subscription_id, expected_date, expected_amount) VALUES (?, '2026-10-01', NULL)",
            (sub_id,),
        )
        conn.execute(
            "INSERT INTO upcoming_transactions(subscription_id, expected_date, expected_amount) VALUES (?, '2026-10-01', 15.98)",
            (sub_id,),
        )
        conn.commit()

        report = backfill_sgd_minor_units(conn, "upcoming_transactions", "expected_amount", "expected_minor_units", apply=True)

        assert report["rows_scanned"] == 1  # the NULL row is never a candidate
        assert report["updated"] == 1
        rows = [r[0] for r in conn.execute("SELECT expected_minor_units FROM upcoming_transactions ORDER BY id")]
        assert rows == [None, 1598]
        conn.close()

    def test_invalid_amount_is_reported_as_an_issue(self, tmp_path):
        # SQLite's dynamic typing lets a non-numeric TEXT value sit in a
        # REAL-affinity column (legacy/corrupt-data scenario) — must be
        # reported as an issue, not raise an unhandled decimal error.
        conn = init_db(str(tmp_path / "user.db"))
        conn.execute("INSERT INTO budgets(category, period, amount) VALUES ('Food', 'monthly', 'not-a-number')")
        conn.commit()

        report = backfill_sgd_minor_units(conn, "budgets", "amount", "amount_minor_units", apply=True)

        assert report["issues"] == {"invalid_amount": 1}
        assert report["updated"] == 0
        conn.close()

    def test_dry_run_does_not_write(self, tmp_path):
        conn = init_db(str(tmp_path / "user.db"))
        conn.execute("INSERT INTO budgets(category, period, amount) VALUES ('Food', 'monthly', 500.0)")
        conn.commit()

        backfill_sgd_minor_units(conn, "budgets", "amount", "amount_minor_units", apply=False)

        row = conn.execute("SELECT amount_minor_units FROM budgets").fetchone()
        assert row[0] is None
        conn.close()
