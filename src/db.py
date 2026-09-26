"""Opening a user's expense_tracker.db and the shared app.db.

Each creates any missing baseline tables (the schema that predates
src/migrations.py), then applies the numbered migrations. Kept apart from
src/main.py so UserManager, scripts and tests can open a database without
importing the application entry point.
"""
import logging
import os
import sqlite3

from src.migrations import migrate

logger = logging.getLogger(__name__)


def _ensure_column(conn: sqlite3.Connection, table: str, column_def: str) -> None:
    """ALTER TABLE ... ADD COLUMN unless the column already exists."""
    column = column_def.split()[0]
    if column not in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_def}")


def init_db(db_path: str) -> sqlite3.Connection:
    logger.info("Database: %s (exists=%s)", db_path, os.path.exists(db_path))
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT UNIQUE,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'SGD',
            exchange_rate REAL DEFAULT 1.0,
            merchant TEXT,
            description TEXT,
            category TEXT,
            transaction_date DATETIME,
            ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            raw_data TEXT,
            type TEXT DEFAULT 'expense'
        );
        CREATE TABLE IF NOT EXISTS categories (
            name TEXT PRIMARY KEY,
            keywords TEXT,
            icon TEXT,
            color TEXT DEFAULT NULL,
            type TEXT DEFAULT 'neutral'
        );
        CREATE TABLE IF NOT EXISTS ingestion_state (
            source TEXT PRIMARY KEY,
            last_processed_id TEXT,
            last_processed_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS merchant_overrides (
            merchant TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            source TEXT DEFAULT 'manual',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recurring_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant TEXT NOT NULL,
            avg_amount REAL NOT NULL,
            frequency TEXT NOT NULL,
            category TEXT,
            first_seen DATETIME,
            last_seen DATETIME,
            occurrences INTEGER DEFAULT 2
        );
        CREATE TABLE IF NOT EXISTS merchant_tags (
            merchant   TEXT PRIMARY KEY,
            tags       TEXT DEFAULT '',
            notes      TEXT DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS budgets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            category   TEXT,
            period     TEXT NOT NULL DEFAULT 'monthly',
            amount     REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, period)
        );
        CREATE TABLE IF NOT EXISTS goals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            target_amount REAL NOT NULL,
            saved_amount  REAL NOT NULL DEFAULT 0,
            target_date   DATE,
            status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'paused')),
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS goal_contributions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id          INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
            amount           REAL NOT NULL,
            month            TEXT NOT NULL,
            contributed_date TEXT,
            source           TEXT NOT NULL DEFAULT 'auto',
            note             TEXT,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS trips (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            destination      TEXT,
            start_date       DATE NOT NULL,
            end_date         DATE,
            primary_currency TEXT DEFAULT 'SGD',
            status           TEXT NOT NULL DEFAULT 'inactive',
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS trip_transactions (
            trip_id        INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
            transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            added_by       TEXT DEFAULT 'auto',
            PRIMARY KEY (trip_id, transaction_id)
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant    TEXT NOT NULL,
            label       TEXT,
            frequency   TEXT NOT NULL,
            billing_day INTEGER,
            status      TEXT DEFAULT 'active',
            notes       TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS upcoming_transactions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id         INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
            expected_date           TEXT NOT NULL,
            expected_amount         REAL,
            matched_transaction_id  INTEGER REFERENCES transactions(id),
            status                  TEXT DEFAULT 'pending',
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    # Columns added to the baseline tables after they first shipped; a
    # database created before then gets them here.
    for table, column_def in (
        ("transactions", "exchange_rate REAL DEFAULT 1.0"),
        ("transactions", "type TEXT DEFAULT 'expense'"),
        ("categories", "color TEXT DEFAULT NULL"),
        ("categories", "type TEXT DEFAULT 'neutral'"),
        ("goal_contributions", "contributed_date TEXT"),
    ):
        _ensure_column(conn, table, column_def)
    conn.commit()
    # Create indexes for query performance (idempotent — IF NOT EXISTS)
    index_statements = [
        "CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(DATE(transaction_date))",
        "CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category)",
        "CREATE INDEX IF NOT EXISTS idx_tx_type     ON transactions(type)",
        "CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant)",
    ]
    for stmt in index_statements:
        conn.execute(stmt)
    conn.commit()
    # Seed default app settings (INSERT OR IGNORE — never overwrites user changes)
    defaults = [
        ("anomaly_multiplier", "2.0"),
        ("velocity_alert_threshold", "110"),
        ("budgets_enabled", "false"),
        ("goals_enabled", "false"),
        ("trips_enabled", "false"),
        ("subscriptions_enabled", "false"),
        ("recurring_enabled", "false"),
        ("llm_insight_content", ""),
        ("llm_insight_generated_at", ""),
        ("llm_weekly_insight_content", ""),
        ("llm_weekly_insight_generated_at", ""),
        ("llm_monthly_insight_content", ""),
        ("llm_monthly_insight_generated_at", ""),
    ]
    for key, value in defaults:
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", (key, value)
        )
    conn.commit()
    migrate(conn)
    return conn


def init_app_db(db_path: str) -> sqlite3.Connection:
    """Create or open app.db (the AdminStorage database) and apply its schema."""
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            username            TEXT UNIQUE NOT NULL,
            password_hash       TEXT NOT NULL,
            telegram_chat_id    TEXT,
            gmail_connected     INTEGER DEFAULT 0,
            wants_gmail         INTEGER DEFAULT 1,
            wants_apple_wallet  INTEGER DEFAULT 1,
            onboarding_complete   INTEGER DEFAULT 0,
            force_password_change INTEGER DEFAULT 0,
            created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token           TEXT PRIMARY KEY,
            username        TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            user_agent      TEXT,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token           TEXT PRIMARY KEY,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS telegram_link_tokens (
            token       TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            expires_at  DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name      TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed')),
            started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at   DATETIME,
            error_code    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_job_runs_job_name ON job_runs(job_name, id);
    """)
    _ensure_column(conn, "users", "force_password_change INTEGER DEFAULT 0")
    conn.commit()
    return conn
