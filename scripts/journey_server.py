"""Isolated local server for authenticated browser journeys.

Runs the real dashboard FastAPI app (and the built SPA in src/web/dist, if
present) against a throwaway data directory with one synthetic user and
synthetic transactions. It never reads config.yaml and starts no Telegram
bot, Gmail poller or scheduler, so it cannot touch production data or
services.

    python3 -m scripts.journey_server --port 8765 --data-dir /tmp/cashe-journey
"""
import argparse
import os
import shutil
from datetime import timedelta

import bcrypt
import uvicorn

from src.config import local_now
from src.main import init_app_db, init_db
from src.storage import AdminStorage, Storage
from src.web import auth
from src.web.app import create_dashboard_app

USERNAME = "journey"
PASSWORD = "journey-password"

SYNTHETIC = [
    # (days ago, merchant, category, amount SGD)
    (1, "Synthetic Noodle House", "Food", 12.40),
    (2, "Synthetic Grocer", "Food", 58.10),
    (3, "Synthetic Transit", "Transport", 3.20),
    (5, "Synthetic Bookshop", "Shopping", 34.90),
    (6, "Synthetic Cafe", "Food", 6.80),
]


class _Context:
    def __init__(self, storage: Storage):
        self.storage = storage
        self.poller = None


class _UserManager:
    """Single synthetic user; no pollers or bots."""

    def __init__(self, storage: Storage):
        self._ctx = _Context(storage)

    def get(self, username):
        return self._ctx if username == USERNAME else None

    def start_poller(self, username):
        pass


def build(data_dir: str):
    shutil.rmtree(data_dir, ignore_errors=True)
    os.makedirs(data_dir)
    app_conn = init_app_db(os.path.join(data_dir, "app.db"))
    admin = AdminStorage(app_conn)
    admin.create_user(USERNAME, bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode())
    app_conn.execute(
        "UPDATE users SET onboarding_complete = 1, force_password_change = 0, wants_gmail = 0 WHERE username = ?",
        (USERNAME,),
    )
    app_conn.commit()
    auth.init_auth(admin)

    storage = Storage(connection=init_db(os.path.join(data_dir, "expense_tracker.db")))
    storage.set_setting("home_briefing_enabled", "true")
    for name, icon, cat_type in (("Food", "🍜", "needs"), ("Transport", "🚇", "needs"), ("Shopping", "🛍️", "wants")):
        storage.add_category(name, "", icon=icon, cat_type=cat_type)
    today = local_now()
    for i, (days_ago, merchant, category, amount) in enumerate(SYNTHETIC):
        when = (today - timedelta(days=days_ago)).replace(hour=12, minute=0, second=0, microsecond=0)
        storage.create_manual_transaction(
            source_id=f"manual_journey{i}", amount=amount,
            transaction_date=when.strftime("%Y-%m-%dT%H:%M:%S"),
            merchant=merchant, category=category,
        )
    return create_dashboard_app(_UserManager(storage), admin)


def main():
    # Plain-http local server: the session cookie cannot be Secure here.
    os.environ["SECURE_COOKIES"] = "false"
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", default="/tmp/cashe-journey")
    args = parser.parse_args()
    uvicorn.run(build(args.data_dir), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
