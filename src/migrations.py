"""Ordered additive migrations, shared by production and tests.

The existing schema remains the baseline. Never edit a released migration;
append a new version instead. Source evidence deliberately survives deletion
of a transaction and is not exposed by ordinary transaction responses.
"""
import sqlite3


MIGRATIONS = (
    (1, (
        """CREATE TABLE source_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            parser_version TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'processed', 'failed', 'unrecognized')),
            transaction_id INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source, source_id)
        )""",
        """CREATE INDEX idx_source_events_pending
           ON source_events(source, status, attempts, id)""",
    )),
    (2, (
        """CREATE TABLE ingestion_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('trip', 'recurring', 'suggestion', 'notification')),
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'failed', 'done')),
            attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(transaction_id, kind)
        )""",
        "CREATE INDEX idx_ingestion_outbox_pending ON ingestion_outbox(status, attempts, id)",
    )),
    (3, (
        """ALTER TABLE source_events ADD COLUMN timestamp_precision TEXT NOT NULL DEFAULT 'unknown'
           CHECK(timestamp_precision IN ('unknown', 'date', 'minute', 'second'))""",
        "ALTER TABLE source_events ADD COLUMN payment_identity_kind TEXT",
        "ALTER TABLE source_events ADD COLUMN payment_identity TEXT",
    )),
)


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    for version, statements in MIGRATIONS:
        if conn.execute("SELECT 1 FROM schema_migrations WHERE version = ?", (version,)).fetchone():
            continue
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            for statement in statements:
                conn.execute(statement)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
