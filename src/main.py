"""Expense Tracker — main entry point. Starts all services."""
import base64
import logging
import logging.handlers
import os
import sys
import sqlite3
import threading
from pathlib import Path

# Add project root to sys.path so `src.*` imports work when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import atexit

import uvicorn
from apscheduler.schedulers.background import BackgroundScheduler

from src.config import DEFAULT_TIMEZONE, load_config
from src.storage import AdminStorage
from src.parsers.dbs_paylah import DbsPaylahParser
from src.parsers.uob import UobParser
from src.telegram_bot import TelegramBotService
from src.webhook import create_webhook_app
from src.web.app import create_dashboard_app
from src.exchange import ExchangeRateService
from src.db import init_app_db

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
        timezone=config.get("timezone", DEFAULT_TIMEZONE),
        llm_service=llm_service,
    )

    parsers = [DbsPaylahParser(), UobParser()]

    scheduler = BackgroundScheduler(timezone=config.get("timezone", DEFAULT_TIMEZONE))

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
        timezone=config.get("timezone", DEFAULT_TIMEZONE),
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
