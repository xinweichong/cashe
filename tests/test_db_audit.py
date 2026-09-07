import hashlib
import json
import sqlite3

import pytest
from cryptography.fernet import Fernet

from scripts.db_audit import audit_database, main
from src.backups import create_snapshot, restore_snapshot
from src.main import init_app_db, init_db


@pytest.mark.parametrize('initialize,kind', [(init_db, 'user'), (init_app_db, 'admin')])
def test_current_database_is_clean_and_unchanged(tmp_path, initialize, kind):
    path = tmp_path / 'database #1?.db'
    conn = initialize(str(path))
    conn.close()
    before = hashlib.sha256(path.read_bytes()).digest()
    report = audit_database(path)
    assert report['status'] == 'ok'
    assert report['database_kind'] == kind
    assert report['foreign_key_violations'] == []
    assert report['missing_foreign_keys'] == []
    assert report['pending_migrations'] == []
    assert hashlib.sha256(path.read_bytes()).digest() == before


def test_audit_sees_committed_wal_orphans_without_exposing_records(tmp_path):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    conn.execute('PRAGMA foreign_keys = OFF')
    conn.execute('PRAGMA wal_autocheckpoint = 0')
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month, note) VALUES (987654, 42.5, '2026-09', 'private financial detail')")
    conn.execute("INSERT INTO trip_transactions(trip_id, transaction_id) VALUES (123456, 765432)")
    conn.commit()
    assert (tmp_path / 'user.db-wal').stat().st_size > 0
    report = audit_database(path)
    assert report['status'] == 'issues'
    assert sum(row['count'] for row in report['foreign_key_violations']) == 3
    encoded = json.dumps(report)
    assert 'private' not in encoded and '987654' not in encoded and '42.5' not in encoded
    assert conn.execute('SELECT COUNT(*) FROM goal_contributions').fetchone()[0] == 1
    conn.close()


def test_admin_orphan_sessions_are_reported_without_credentials(tmp_path):
    path = tmp_path / 'app.db'
    conn = init_app_db(str(path))
    conn.execute('PRAGMA foreign_keys = OFF')
    conn.execute("INSERT INTO sessions(token, username) VALUES ('secret-session', 'missing-person')")
    conn.commit()
    report = audit_database(path)
    assert report['status'] == 'issues'
    assert report['foreign_key_violations'][0]['table'] == 'sessions'
    assert 'secret-session' not in json.dumps(report)
    assert 'missing-person' not in json.dumps(report)
    conn.close()


def test_intentionally_retained_evidence_is_informational(tmp_path):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    conn.execute("INSERT INTO source_events(source, source_id, payload, parser_version, transaction_id) VALUES ('apple_wallet', 'secret-source', 'private-payload', '2', 999)")
    conn.execute("INSERT INTO ingestion_outbox(transaction_id, kind, payload) VALUES (999, 'notification', '{}')")
    conn.execute("INSERT INTO transaction_requests(request_key, fingerprint, transaction_id) VALUES ('private-key', 'private-fingerprint', 999)")
    conn.commit()
    report = audit_database(path)
    assert report['status'] == 'ok'
    assert report['retained_links_to_deleted_transactions'] == {'source_events': 1, 'ingestion_outbox': 1, 'transaction_requests': 1}
    assert report['foreign_key_violations'] == []
    assert 'private-payload' not in json.dumps(report)
    assert 'private-key' not in json.dumps(report)
    assert 'private-fingerprint' not in json.dumps(report)
    conn.close()


def test_missing_constraint_cannot_hide_orphans(tmp_path):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    conn.execute('DROP TABLE goal_contributions')
    conn.execute('CREATE TABLE goal_contributions(id INTEGER PRIMARY KEY, goal_id INTEGER)')
    conn.execute('INSERT INTO goal_contributions(goal_id) VALUES (999), (NULL)')
    conn.commit()
    report = audit_database(path)
    assert report['status'] == 'issues'
    assert report['missing_foreign_keys'] == [{'table': 'goal_contributions', 'column': 'goal_id',
                                              'parent': 'goals', 'target': 'id', 'orphan_count': 1}]
    conn.close()


def test_implicit_primary_key_reference_is_recognized(tmp_path):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    conn.execute('DROP TABLE goal_contributions')
    conn.execute('CREATE TABLE goal_contributions(id INTEGER PRIMARY KEY, goal_id INTEGER REFERENCES goals)')
    conn.commit()
    assert audit_database(path)['status'] == 'ok'
    conn.close()


def test_pending_and_unknown_migrations_are_reported_without_applying_them(tmp_path):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    conn.execute('DELETE FROM schema_migrations WHERE version = 3')
    conn.execute('INSERT INTO schema_migrations(version) VALUES (999)')
    conn.commit()
    report = audit_database(path)
    assert report['status'] == 'issues'
    assert report['pending_migrations'] == [3]
    assert report['unknown_migrations'] == [999]
    assert conn.execute('SELECT COUNT(*) FROM schema_migrations WHERE version = 3').fetchone()[0] == 0
    conn.close()


def test_partial_legacy_schema_is_not_a_clean_bill_of_health(tmp_path):
    path = tmp_path / 'legacy.db'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE transactions(id INTEGER PRIMARY KEY)')
    conn.close()
    report = audit_database(path)
    assert report['status'] == 'issues'
    assert report['absent_feature_tables'] == ['goal_contributions', 'trip_transactions', 'upcoming_transactions']
    assert report['pending_migrations'] == [1, 2, 3, 4]


def test_missing_file_is_not_created_and_corrupt_input_is_safe(tmp_path, capsys):
    missing = tmp_path / 'missing.db'
    assert main([str(missing)]) == 2
    assert not missing.exists()
    corrupt = tmp_path / 'corrupt.db'
    corrupt.write_bytes(b'private financial detail, not a database')
    assert main([str(corrupt)]) == 2
    output = capsys.readouterr().out
    assert 'private financial detail' not in output
    assert 'SQLITE_NOTADB' in output


def test_cli_exit_codes_and_json(tmp_path, capsys):
    path = tmp_path / 'user.db'
    conn = init_db(str(path))
    assert main([str(path)]) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'ok'
    conn.execute('PRAGMA foreign_keys = OFF')
    conn.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 1, '2026-09')")
    conn.commit()
    assert main([str(path)]) == 1
    assert json.loads(capsys.readouterr().out)['status'] == 'issues'
    conn.close()


def test_audit_restored_snapshot_before_production_initialization(tmp_path):
    data = tmp_path / 'data'
    user_dir = data / 'users' / 'alice'
    user_dir.mkdir(parents=True)
    admin = init_app_db(str(data / 'app.db'))
    user = init_db(str(user_dir / 'expense_tracker.db'))
    user.execute('PRAGMA foreign_keys = OFF')
    user.execute("INSERT INTO goal_contributions(goal_id, amount, month) VALUES (999, 1, '2026-09')")
    user.commit()
    key = Fernet.generate_key()
    destination = tmp_path / 'restored'
    restore_snapshot(create_snapshot(data, {}, key), destination, key)
    assert audit_database(destination / 'data/app.db')['status'] == 'ok'
    report = audit_database(destination / 'data/users/alice/expense_tracker.db')
    assert report['status'] == 'issues'
    assert report['foreign_key_violations'][0]['count'] == 1
    admin.close()
    user.close()
