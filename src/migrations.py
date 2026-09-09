"""Ordered additive migrations, shared by production and tests.

The existing schema remains the baseline. Never edit a released migration;
append a new version instead. Source evidence deliberately survives deletion
of a transaction and is not exposed by ordinary transaction responses.
"""
import sqlite3


def _add_column_if_table_exists(table: str, column_def: str):
    """Statement factory for MIGRATIONS: ADD COLUMN only if `table` exists.

    Needed because some baseline tables (budgets, goals, ...) predate the
    migration system and aren't guaranteed present on every connection
    migrate() is exercised against (e.g. isolated migration tests).
    """
    def _apply(conn: sqlite3.Connection) -> None:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_def}")
    return _apply


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
    (4, (
        """CREATE TABLE transaction_requests (
            request_key TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            transaction_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (5, (
        """CREATE TABLE telegram_drafts (
            draft_id TEXT PRIMARY KEY,
            chat_id INTEGER NOT NULL UNIQUE,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )""",
    )),
    (6, (
        """CREATE TABLE telegram_draft_messages (
            message_key TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            draft_id TEXT NOT NULL
        )""",
    )),
    (7, (
        """CREATE TABLE capture_issue_resolutions (
            event_id INTEGER PRIMARY KEY REFERENCES source_events(id) ON DELETE CASCADE,
            handled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (8, (
        """CREATE TABLE subscription_confirmations (
            subscription_id INTEGER PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
            source TEXT NOT NULL CHECK(source IN ('user', 'recurring_suggestion')),
            confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (9, (
        """CREATE TABLE subscription_suggestion_acceptances (
            message_key TEXT PRIMARY KEY,
            merchant TEXT NOT NULL,
            frequency TEXT NOT NULL,
            subscription_id INTEGER NOT NULL,
            accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (10, (
        """CREATE TABLE recurring_suggestions (
            id TEXT PRIMARY KEY,
            chat_id INTEGER NOT NULL,
            merchant TEXT NOT NULL,
            frequency TEXT NOT NULL,
            avg_amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'dismissed')),
            subscription_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX idx_recurring_suggestions_pending ON recurring_suggestions(chat_id, merchant, frequency, status)",
    )),
    (11, (
        "ALTER TABLE recurring_suggestions RENAME TO recurring_suggestions_v10",
        """CREATE TABLE recurring_suggestions (
            id TEXT PRIMARY KEY, chat_id INTEGER, merchant TEXT NOT NULL,
            frequency TEXT NOT NULL, avg_amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'dismissed')),
            subscription_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "INSERT INTO recurring_suggestions SELECT * FROM recurring_suggestions_v10",
        "DROP TABLE recurring_suggestions_v10",
        "CREATE INDEX idx_recurring_suggestions_pending ON recurring_suggestions(chat_id, merchant, frequency, status)",
    )),
    (12, (
        # Canonical money columns (see docs/plans/2026-09-09-cashe-completion-
        # roadmap.md R02): additive and nullable only. Nothing is backfilled
        # here — a separate tool computes values via src/money.py — and no
        # reader/writer is switched to these columns by this migration.
        # Tables predate the migration system (created by init_db()'s
        # baseline executescript), so each ADD COLUMN tolerates a missing
        # table rather than assuming it exists.
        _add_column_if_table_exists("transactions", "original_minor_units INTEGER"),
        _add_column_if_table_exists("transactions", "reporting_minor_units INTEGER"),
        _add_column_if_table_exists(
            "transactions",
            "conversion_status TEXT CHECK(conversion_status IN ('native','resolved','indicative','unresolved'))",
        ),
        # Rate stored as decimal text, never float — avoids binary rounding drift.
        _add_column_if_table_exists("transactions", "conversion_rate TEXT"),
        _add_column_if_table_exists("transactions", "conversion_source TEXT"),
        _add_column_if_table_exists("transactions", "conversion_quoted_at TEXT"),
        # No FK yet: the settlement-evidence table doesn't exist until R07 (CSV import).
        _add_column_if_table_exists("transactions", "settlement_evidence_id INTEGER"),
        _add_column_if_table_exists("budgets", "amount_minor_units INTEGER"),
        _add_column_if_table_exists("goals", "target_minor_units INTEGER"),
        _add_column_if_table_exists("goals", "saved_minor_units INTEGER"),
        _add_column_if_table_exists("goal_contributions", "amount_minor_units INTEGER"),
        _add_column_if_table_exists("upcoming_transactions", "expected_minor_units INTEGER"),
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
                if callable(statement):
                    statement(conn)
                else:
                    conn.execute(statement)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
