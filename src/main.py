"""Expense Tracker — main entry point. Starts all services."""
import base64
import logging
import logging.handlers
import os
import sys
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path

# Add project root to sys.path so `src.*` imports work when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import atexit

import uvicorn
from apscheduler.schedulers.background import BackgroundScheduler

from src.config import load_config
from src.storage import Storage, AdminStorage
from src.parsers.dbs_paylah import DbsPaylahParser
from src.parsers.uob import UobParser
from src.telegram_bot import TelegramBotService
from src.webhook import create_webhook_app
from src.web.app import create_dashboard_app
from src.exchange import ExchangeRateService
from src.migrations import migrate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path constants
# ---------------------------------------------------------------------------
DATA_DIR = "/data" if os.path.isdir("/data") else "data"
APP_DB_PATH = os.path.join(DATA_DIR, "app.db")
USERS_DIR = os.path.join(DATA_DIR, "users")

# Legacy single-DB path (still used by init_db, which is called by UserManager)
_db_env = os.environ.get("EXPENSE_DB_PATH", "")
DB_PATH = _db_env if _db_env else os.path.join(DATA_DIR, "expense_tracker.db")
TOKEN_PATH = os.path.join(DATA_DIR, "token.json")

CONFIG_PATH = os.environ.get("EXPENSE_CONFIG_PATH", "config.yaml")


def init_db(db_path: str) -> sqlite3.Connection:
    is_new = not os.path.exists(db_path)
    logger.info(f"Database: {db_path} (exists={not is_new})")
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
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
            icon TEXT
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
    # Migrate: add exchange_rate column if missing
    try:
        conn.execute("ALTER TABLE transactions ADD COLUMN exchange_rate REAL DEFAULT 1.0")
    except Exception:
        pass
    # Migrate: add type column if missing
    try:
        conn.execute("ALTER TABLE transactions ADD COLUMN type TEXT DEFAULT 'expense'")
    except Exception:
        pass
    # Migrate: add color column to categories if missing
    try:
        conn.execute("ALTER TABLE categories ADD COLUMN color TEXT DEFAULT NULL")
    except Exception:
        pass
    # Migrate: add contributed_date column to goal_contributions if missing
    try:
        conn.execute("ALTER TABLE goal_contributions ADD COLUMN contributed_date TEXT")
    except Exception:
        pass
    # Migrate: add type column to categories if missing
    try:
        conn.execute("ALTER TABLE categories ADD COLUMN type TEXT DEFAULT 'neutral'")
    except Exception:
        pass
    # Populate default type values for known categories
    type_defaults = [
        ("needs",  ("Transport", "Groceries", "Bills & Utilities", "Healthcare", "Housing", "Insurance")),
        ("wants",  ("Dining", "Entertainment", "Shopping", "Travel", "Subscriptions")),
        ("neutral", ("Other", "Transfers", "Income")),
    ]
    for type_val, names in type_defaults:
        placeholders = ",".join("?" * len(names))
        conn.execute(
            f"UPDATE categories SET type = ? WHERE name IN ({placeholders}) AND (type IS NULL OR type = 'neutral')",
            [type_val, *names],
        )
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
    tx_count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    cat_count = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    logger.info(f"Database ready: {tx_count} transactions, {cat_count} categories")
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
    # Migration: add force_password_change if missing (existing app.db)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    return conn


def seed_admin_if_needed(admin_storage: AdminStorage, config: dict, data_dir: str) -> None:
    """Run once on first boot. If app.db has no users, create the admin user from config.yaml.
    Also migrates the legacy telegram_chat_id from the per-user DB (if present).
    """
    if admin_storage.list_users():
        return   # already seeded

    web_cfg = config.get("web", {})
    username = web_cfg.get("admin_username") or web_cfg.get("username", "admin")
    password_hash = web_cfg.get("password_hash", "")
    if not password_hash:
        logger.warning("No password_hash in config — admin user cannot log in")
        return

    admin_storage.create_user(username, password_hash)

    # Migrate existing Telegram chat_id from legacy per-user DB (if it exists there)
    user_db_path = os.path.join(data_dir, "users", username, "expense_tracker.db")
    if os.path.exists(user_db_path):
        try:
            _conn = sqlite3.connect(user_db_path)
            row = _conn.execute(
                "SELECT last_processed_id FROM ingestion_state WHERE source = 'telegram_chat_id'"
            ).fetchone()
            _conn.close()
            if row and row[0]:
                admin_storage.update_user(username, telegram_chat_id=row[0])
                logger.info("Migrated Telegram chat_id for admin user '%s'", username)
        except Exception as e:
            logger.warning("Could not migrate telegram_chat_id for '%s': %s", username, e)

    admin_storage.update_user(
        username,
        gmail_connected=1,
        onboarding_complete=1,
        wants_gmail=1,
        wants_apple_wallet=1,
        force_password_change=0,
    )
    logger.info("Admin user '%s' seeded from config", username)


def _run_bot(bot: TelegramBotService) -> None:
    """Run the Telegram bot in a background thread using asyncio."""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    bot._loop = loop
    bot.is_running = True
    try:
        loop.run_until_complete(bot.app.initialize())
        loop.run_until_complete(bot.app.start())
        loop.run_until_complete(bot.app.post_init(bot.app))  # triggers set_my_commands + menu button
        loop.run_until_complete(bot.app.updater.start_polling())
        loop.run_forever()
    except Exception as e:
        logger.error(f"Telegram bot error: {e}")
        bot.is_running = False
        bot.last_error = str(e)


def main():
    # Ensure logs directory exists
    Path("logs").mkdir(exist_ok=True)

    # Add file handler after directory is created
    file_handler = logging.handlers.RotatingFileHandler("logs/app.log", maxBytes=10_000_000, backupCount=5)
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logging.getLogger().addHandler(file_handler)

    config = load_config(CONFIG_PATH)

    from src.llm_service import create_llm_service
    llm_service = create_llm_service(config)

    # Decode Gmail credentials from environment (for Docker/Railway deployments)
    gmail_config = config.get("gmail", {})
    if gmail_creds_b64 := os.environ.get("GMAIL_CREDENTIALS_JSON"):
        creds_path = gmail_config.get("credentials_file", "credentials.json")
        with open(creds_path, "w") as f:
            f.write(base64.b64decode(gmail_creds_b64).decode())
        os.chmod(creds_path, 0o600)
        logger.info("Decoded Gmail credentials from environment")

    # ---------------------------------------------------------------------------
    # Multi-user startup sequence
    # ---------------------------------------------------------------------------
    os.makedirs(USERS_DIR, exist_ok=True)

    app_conn = init_app_db(APP_DB_PATH)
    admin_storage = AdminStorage(app_conn)
    from src.web.auth import init_auth
    init_auth(admin_storage)

    bot_token = config.get("telegram", {}).get("bot_token", "")
    exchange_config = config.get("exchange_rates", {})
    exchange_service = ExchangeRateService(
        api_url=exchange_config.get("api_url"),
        cache_hours=exchange_config.get("cache_hours", 24),
    )
    server_config = config.get("server", {})
    dashboard_url = server_config.get("webhook_base_url", "")

    bot = TelegramBotService(
        admin_storage=admin_storage,
        bot_token=bot_token,
        exchange_service=exchange_service,
        dashboard_url=dashboard_url,
        oauth_redirect_uri=f"{dashboard_url.rstrip('/')}/oauth/callback",
        timezone=config.get("timezone", "Asia/Singapore"),
        llm_service=llm_service,
    )

    parsers = [DbsPaylahParser(), UobParser()]

    scheduler = BackgroundScheduler(timezone=config.get("timezone", "Asia/Singapore"))

    from src.user_manager import UserManager
    user_manager = UserManager(
        data_dir=DATA_DIR,
        config=config,
        exchange_service=exchange_service,
        parsers=parsers,
        scheduler=scheduler,
        bot=bot,
        admin_storage=admin_storage,
        llm_service=llm_service,
    )
    bot.user_manager = user_manager   # back-reference for per-user routing

    seed_admin_if_needed(admin_storage, config, DATA_DIR)
    user_manager.load_all_users()

    scheduler.start()
    atexit.register(lambda: scheduler.shutdown(wait=False))
    logger.info("APScheduler started")

    # ---------------------------------------------------------------------------
    # Build combined FastAPI app
    # ---------------------------------------------------------------------------
    from fastapi import FastAPI
    app = FastAPI()

    # Webhook routes (per-user: /webhook/apple-wallet/{username})
    webhook_app = create_webhook_app(user_manager=user_manager, bot=bot)
    for route in webhook_app.routes:
        app.routes.append(route)

    # Dashboard (per-user auth via user_manager)
    dashboard_app = create_dashboard_app(
        user_manager=user_manager,
        admin_storage=admin_storage,
        exchange_service=exchange_service,
        host_base_url=dashboard_url,
        llm_service=llm_service,
        timezone=config.get("timezone", "Asia/Singapore"),
    )

    # Admin app (user management)
    from src.web.admin_app import create_admin_app
    admin_password_hash = config.get("web", {}).get("admin_password_hash", "")
    admin_app = create_admin_app(
        admin_storage=admin_storage,
        user_manager=user_manager,
        admin_password_hash=admin_password_hash,
    )
    app.mount("/admin", admin_app)
    app.mount("/", dashboard_app)

    host = server_config.get("host", "0.0.0.0")
    port = int(os.environ.get("PORT", server_config.get("port", 8080)))

    # Start Telegram bot in background thread
    if bot_token:
        bot.setup_handlers()
        bot_thread = threading.Thread(target=lambda: _run_bot(bot), daemon=True)
        bot_thread.start()
        logger.info("Telegram bot started")
    else:
        logger.warning("No Telegram bot token — skipping bot")

    # Start web server (blocking)
    logger.info(f"Starting web server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, timeout_keep_alive=65)


if __name__ == "__main__":
    main()
