import sqlite3

from src.migrations import migrate
from src.main import init_db


def test_migrations_preserve_old_transactions_and_are_idempotent():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE transactions(id INTEGER PRIMARY KEY, source_id TEXT, amount REAL, type TEXT)")
    conn.execute("INSERT INTO transactions VALUES (42, 'original-id', 1.25, NULL)")
    migrate(conn)
    migrate(conn)
    assert conn.execute("SELECT * FROM transactions").fetchall() == [
        (42, "original-id", 1.25, None, None, None, None, None, None, None, None)
    ]
    assert conn.execute("SELECT version FROM schema_migrations").fetchall() == [(1,), (2,), (3,), (4,), (5,), (6,), (7,), (8,), (9,), (10,), (11,), (12,)]
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


def test_subscription_confirmation_migration_does_not_backfill_legacy(monkeypatch):
    import src.migrations as migrations
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE subscriptions(id INTEGER PRIMARY KEY, merchant TEXT)')
    conn.execute("INSERT INTO subscriptions VALUES (1, 'Original')")
    released = migrations.MIGRATIONS
    monkeypatch.setattr(migrations, 'MIGRATIONS', released[:7])
    migrate(conn)
    monkeypatch.setattr(migrations, 'MIGRATIONS', released)
    migrate(conn)
    migrate(conn)
    assert conn.execute('SELECT * FROM subscriptions').fetchall() == [(1, 'Original')]
    assert conn.execute('SELECT * FROM subscription_confirmations').fetchall() == []
    assert conn.execute('SELECT * FROM subscription_suggestion_acceptances').fetchall() == []
    assert conn.execute('SELECT * FROM recurring_suggestions').fetchall() == []
    conn.close()


def test_unbound_suggestion_migration_preserves_old_chat_binding(monkeypatch):
    import src.migrations as migrations
    conn = sqlite3.connect(':memory:')
    released = migrations.MIGRATIONS
    monkeypatch.setattr(migrations, 'MIGRATIONS', released[:10])
    migrate(conn)
    conn.execute("""INSERT INTO recurring_suggestions(id, chat_id, merchant, frequency, avg_amount, status, subscription_id)
        VALUES ('retained', 123, 'Original', 'monthly', 12, 'accepted', 42)""")
    before = conn.execute('SELECT * FROM recurring_suggestions').fetchall()
    conn.commit()
    monkeypatch.setattr(migrations, 'MIGRATIONS', released)
    migrate(conn)
    migrate(conn)
    assert conn.execute('SELECT * FROM recurring_suggestions').fetchall() == before
    conn.execute("INSERT INTO recurring_suggestions(id, merchant, frequency, avg_amount) VALUES ('unbound', 'Web', 'weekly', 1)")
    assert conn.execute("SELECT chat_id FROM recurring_suggestions WHERE id='unbound'").fetchone()[0] is None
    conn.close()


def test_canonical_money_columns_are_added_nullable_and_idempotent(tmp_path):
    conn = init_db(str(tmp_path / 'user.db'))
    conn.execute(
        "INSERT INTO transactions(source, source_id, amount, currency, exchange_rate) "
        "VALUES ('manual', 'preserve-me', 12.5, 'USD', 1.34)"
    )
    conn.commit()
    before = conn.execute("SELECT source_id, amount, currency, exchange_rate FROM transactions").fetchall()

    migrate(conn)  # already applied by init_db(); re-running must be a no-op
    migrate(conn)

    assert conn.execute(
        "SELECT source_id, amount, currency, exchange_rate FROM transactions"
    ).fetchall() == before

    tx_columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
    assert {
        "original_minor_units", "reporting_minor_units", "conversion_status",
        "conversion_rate", "conversion_source", "conversion_quoted_at", "settlement_evidence_id",
    } <= tx_columns

    row = conn.execute(
        "SELECT original_minor_units, reporting_minor_units, conversion_status FROM transactions"
    ).fetchone()
    assert tuple(row) == (None, None, None)  # additive only — no backfill happens in the migration itself

    for table, column in [
        ("budgets", "amount_minor_units"),
        ("goals", "target_minor_units"),
        ("goals", "saved_minor_units"),
        ("goal_contributions", "amount_minor_units"),
        ("upcoming_transactions", "expected_minor_units"),
    ]:
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        assert column in columns, f"{table}.{column} missing"
    conn.close()


def test_canonical_money_migration_tolerates_a_missing_baseline_table(monkeypatch):
    """Several other migration tests call migrate() against a bare connection
    that never ran init_db()'s baseline executescript — migration 12 must not
    explode when budgets/goals/etc. don't exist."""
    import src.migrations as migrations
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE transactions(id INTEGER PRIMARY KEY, source_id TEXT, amount REAL, currency TEXT, exchange_rate REAL, type TEXT)")
    released = migrations.MIGRATIONS
    monkeypatch.setattr(migrations, 'MIGRATIONS', released)
    migrate(conn)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
    assert "original_minor_units" in columns
    assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='budgets'").fetchone() is None
    conn.close()
