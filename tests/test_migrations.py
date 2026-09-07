import sqlite3

from src.migrations import migrate


def test_migrations_preserve_old_transactions_and_are_idempotent():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE transactions(id INTEGER PRIMARY KEY, source_id TEXT, amount REAL, type TEXT)")
    conn.execute("INSERT INTO transactions VALUES (42, 'original-id', 1.25, NULL)")
    migrate(conn)
    migrate(conn)
    assert conn.execute("SELECT * FROM transactions").fetchall() == [(42, "original-id", 1.25, None)]
    assert conn.execute("SELECT version FROM schema_migrations").fetchall() == [(1,), (2,), (3,), (4,), (5,)]
    assert conn.execute("SELECT COUNT(*) FROM source_events").fetchone()[0] == 0
    conn.close()


def test_failed_migration_rolls_back_schema_and_version(monkeypatch):
    import pytest
    import src.migrations as migrations
    conn = sqlite3.connect(":memory:")
    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, ("CREATE TABLE partial(id INTEGER)", "INVALID SQL")),))
    with pytest.raises(sqlite3.OperationalError):
        migrate(conn)
    assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'partial'").fetchone() is None
    assert conn.execute("SELECT * FROM schema_migrations").fetchall() == []
    conn.close()


def test_metadata_migration_preserves_legacy_evidence_as_unknown(monkeypatch):
    import src.migrations as migrations
    conn = sqlite3.connect(':memory:')
    released = migrations.MIGRATIONS
    monkeypatch.setattr(migrations, 'MIGRATIONS', released[:2])
    migrate(conn)
    conn.execute("INSERT INTO source_events(source, source_id, payload, parser_version) VALUES ('uob_card', 'old', 'original evidence', '1')")
    conn.commit()
    monkeypatch.setattr(migrations, 'MIGRATIONS', released)
    migrate(conn)
    assert conn.execute('SELECT payload, timestamp_precision, payment_identity_kind, payment_identity FROM source_events').fetchone() == ('original evidence', 'unknown', None, None)
    conn.close()
