import json

import pytest

from scripts.repair_orphans import find_orphans, main
from src.main import init_db


def test_find_orphans_lists_row_ids_referencing_a_missing_parent(tmp_path):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 42.5, '2026-09')")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 10, '2026-08')")
    conn.commit()
    orphans = find_orphans(conn, "goal_contributions", "goal_id", "goals", "id")
    assert len(orphans) == 2
    conn.close()


def test_find_orphans_rejects_unrecognized_relationship(tmp_path):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    with pytest.raises(ValueError, match="not a recognized"):
        find_orphans(conn, "transactions", "id", "goals", "id")
    conn.close()


def test_cli_dry_run_reports_without_deleting(tmp_path, capsys):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 42.5, '2026-09')")
    conn.commit()
    conn.close()

    exit_code = main([str(path), "--table", "goal_contributions", "--column", "goal_id",
                      "--parent", "goals", "--target", "id"])
    assert exit_code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["orphan_count"] == 1
    assert report["deleted"] == 0

    conn = init_db(str(path))
    assert conn.execute("SELECT COUNT(*) FROM goal_contributions").fetchone()[0] == 1
    conn.close()


def test_cli_apply_deletes_only_the_orphaned_rows(tmp_path, capsys):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("INSERT INTO goals(id, name, target_amount) VALUES (1, 'Trip', 1000)")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (1, 100, '2026-09')")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 42.5, '2026-08')")
    conn.commit()
    conn.close()

    exit_code = main([str(path), "--table", "goal_contributions", "--column", "goal_id",
                      "--parent", "goals", "--target", "id", "--apply"])
    assert exit_code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is False
    assert report["deleted"] == 1

    conn = init_db(str(path))
    remaining = conn.execute("SELECT goal_id FROM goal_contributions").fetchall()
    assert [r[0] for r in remaining] == [1]
    conn.close()


def test_cli_never_prints_financial_values(tmp_path, capsys):
    path = tmp_path / "user.db"
    conn = init_db(str(path))
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month, note) VALUES (999, 1234.56, '2026-09', 'private note')")
    conn.commit()
    conn.close()

    main([str(path), "--table", "goal_contributions", "--column", "goal_id",
          "--parent", "goals", "--target", "id"])
    output = capsys.readouterr().out
    assert "1234.56" not in output
    assert "private note" not in output
