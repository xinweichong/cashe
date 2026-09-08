"""UserManager — central registry for per-user service instances.

This is the only place Storage and GmailPoller are ever instantiated.
main.py and web/app.py never create them directly.
"""
import logging
import os
import sqlite3
from dataclasses import dataclass
from typing import Optional

from src.subscriptions import SubscriptionMatcher

logger = logging.getLogger(__name__)


@dataclass
class UserContext:
    username: str
    storage: object          # Storage instance
    categorizer: object      # Categorizer instance
    poller: object           # GmailPoller instance (not always running)
    db_path: str
    token_path: str


class UserManager:
    def __init__(
        self,
        data_dir: str,
        config: dict,
        exchange_service,
        parsers: list,
        scheduler,
        bot,
        admin_storage,
        llm_service=None,
    ):
        self._data_dir = data_dir
        self._config = config
        self._exchange_service = exchange_service
        self._parsers = parsers
        self._scheduler = scheduler
        self._bot = bot
        self._admin_storage = admin_storage
        self._llm_service = llm_service
        self._registry: dict[str, UserContext] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, username: str) -> Optional[UserContext]:
        """Return the live context for a user, or None if unknown."""
        return self._registry.get(username)

    def get_by_chat_id(self, chat_id: int) -> Optional[UserContext]:
        """Resolve a Telegram chat_id to a UserContext via admin_storage."""
        user = self._admin_storage.get_user_by_chat_id(str(chat_id))
        if user is None:
            return None
        return self._registry.get(user["username"])

    def load_all_users(self) -> None:
        """Called once at startup. For each user in app.db, construct their
        UserContext; if their DB file exists and Gmail is connected, start
        the poller thread.
        """
        for user in self._admin_storage.list_users():
            username = user["username"]
            db_path = self._user_db_path(username)
            if not os.path.exists(db_path):
                logger.warning("Skipping user %s — DB file missing: %s", username, db_path)
                continue
            try:
                ctx = self._build_context(username, db_path)
                self._registry[username] = ctx
                self._register_scheduler_jobs(username)
                if user["gmail_connected"]:
                    ctx.poller.start()
                logger.info(
                    "Loaded user %s: Gmail %s Telegram %s",
                    username,
                    "connected" if user["gmail_connected"] else "not connected",
                    "linked" if user["telegram_chat_id"] else "not linked",
                )
            except Exception as e:
                logger.error("Failed to load user %s: %s", username, e)

    def create_user(self, username: str, password_hash: str) -> UserContext:
        """Create a new user account, initialise their DB, and register them."""
        user_dir = os.path.join(self._data_dir, "users", username)
        os.makedirs(user_dir, exist_ok=True)

        db_path = os.path.join(user_dir, "expense_tracker.db")
        _init_user_db(db_path)

        # Record in admin DB (no-op if already exists)
        if self._admin_storage.get_user(username) is None:
            self._admin_storage.create_user(username, password_hash)

        ctx = self._build_context(username, db_path)
        self._registry[username] = ctx
        self._register_scheduler_jobs(username)
        return ctx

    def start_poller(self, username: str) -> None:
        """Start the already-constructed GmailPoller thread for a user.
        Called only after Gmail OAuth completes successfully.
        """
        ctx = self._registry[username]
        ctx.poller.start()

    def delete_user(self, username: str) -> None:
        """Remove a user from the registry and stop their services.
        Does NOT delete files on disk.
        """
        ctx = self._registry.pop(username, None)
        if ctx and ctx.poller:
            ctx.poller.stop()
        for job_id in [
            f"weekly_{username}",
            f"monthly_{username}",
            f"daily_{username}",
            f"subscription_matcher_{username}",
            f"capture_retry_{username}",
        ]:
            if self._scheduler is not None:
                try:
                    self._scheduler.remove_job(job_id)
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _user_db_path(self, username: str) -> str:
        return os.path.join(self._data_dir, "users", username, "expense_tracker.db")

    def _user_token_path(self, username: str) -> str:
        return os.path.join(self._data_dir, "users", username, "token.json")

    def _build_context(self, username: str, db_path: str) -> UserContext:
        """Construct Storage, Categorizer, and GmailPoller for one user."""
        from src.storage import Storage
        from src.categorizer import Categorizer
        from src.gmail_poller import GmailPoller
        from src.ingestion import IngestionPipeline

        from src.main import init_db
        conn = init_db(db_path)
        storage = Storage(conn)

        categories = self._config.get("categories", [])
        categorizer = Categorizer(categories)

        token_path = self._user_token_path(username)
        gmail_cfg = self._config.get("gmail", {})
        credentials_path = gmail_cfg.get("credentials_file", "credentials.json")
        poll_interval = int(gmail_cfg.get("poll_interval_seconds", 120))
        sender_filters = gmail_cfg.get("sender_filters", [])

        bot = self._bot

        def suggestion_callback(merchant, frequency, amount):
            if bot is not None:
                return bot.notify_subscription_suggestion(username, merchant, frequency, amount)

        poller = GmailPoller(
            credentials_path=credentials_path,
            token_path=token_path,
            sender_filters=sender_filters,
            parsers=self._parsers,
            storage=storage,
            on_transaction=self._make_on_transaction(username, storage, categorizer),
            on_auth_error=self._make_on_auth_error(username),
            pipeline=IngestionPipeline(
                storage=storage,
                categorizer=categorizer,
                exchange_service=self._exchange_service,
                on_recurring_pattern=suggestion_callback,
            ),
            poll_interval=poll_interval,
        )
        # Attach exchange_service and categorizer to context for webhook direct path
        ctx = UserContext(
            username=username,
            storage=storage,
            categorizer=categorizer,
            poller=poller,
            db_path=db_path,
            token_path=token_path,
        )
        # Back-reference so webhook can reach exchange_service
        ctx.exchange_service = self._exchange_service  # type: ignore[attr-defined]
        return ctx

    def _make_on_transaction(self, username: str, storage, categorizer):
        bot = self._bot

        def on_transaction(tx_dict: dict):
            if bot is None:
                return
            return bot.notify_transaction(
                tx_dict["id"], float(tx_dict["amount"]), tx_dict.get("merchant", ""),
                tx_dict.get("category"), tx_dict.get("_match_source", "ingest"),
                tx_dict.get("source", ""), username=username,
            )

        return on_transaction

    def _make_on_auth_error(self, username: str):
        bot = self._bot

        def on_auth_error(message: str) -> None:
            if bot is not None:
                try:
                    bot.notify_text(
                        f"Gmail authentication error — please re-connect via the Cashe onboarding page.\n`{message}`",
                        username,
                    )
                except Exception as e:
                    logger.warning("notify_text (auth_error) failed for %s: %s", username, e)

        return on_auth_error

    def _register_scheduler_jobs(self, username: str) -> None:
        """Register weekly/monthly/daily summary APScheduler jobs for one user."""
        if self._scheduler is None:
            return
        ctx = self.get(username)
        tz = self._config.get("timezone", "Asia/Singapore")
        bot = self._bot

        def weekly():
            if bot and ctx:
                bot.notify_text(_weekly_summary(ctx.storage, bot), username)

        def monthly():
            if bot and ctx:
                bot.notify_text(_monthly_summary(ctx.storage, bot), username)

        def daily():
            ctx = self.get(username)
            if ctx:
                if self._llm_service:
                    _generate_llm_insight(ctx.storage, self._llm_service)
                bot.notify_daily_digest(username)
                if bot and ctx:
                    _check_budget_alerts(ctx.storage, bot, username)

        def run_subscriptions():
            if ctx:
                SubscriptionMatcher(ctx.storage).run()

        self._scheduler.add_job(
            weekly, "cron", day_of_week="sun", hour=8, timezone=tz,
            id=f"weekly_{username}", replace_existing=True,
        )
        self._scheduler.add_job(
            monthly, "cron", day=1, hour=8, timezone=tz,
            id=f"monthly_{username}", replace_existing=True,
        )
        self._scheduler.add_job(
            daily, "cron", hour=8, minute=0, timezone=tz,
            id=f"daily_{username}", replace_existing=True,
        )
        self._scheduler.add_job(
            run_subscriptions, "cron", hour=6, minute=0, timezone=tz,
            id=f"subscription_matcher_{username}", replace_existing=True,
        )
        if ctx and ctx.poller and ctx.poller.pipeline:
            self._scheduler.add_job(
                ctx.poller.pipeline.retry_pending, "interval", seconds=120,
                id=f"capture_retry_{username}", replace_existing=True, max_instances=1,
            )



# ---------------------------------------------------------------------------
# DB initialisation (extracted so it can be called without a full UserManager)
# ---------------------------------------------------------------------------

def _init_user_db(db_path: str) -> sqlite3.Connection:
    """Initialise (or open) a user's expense_tracker.db with the full schema."""
    # Reuse the init_db logic from main.py by importing it at call time to
    # avoid circular imports (main.py imports UserManager).
    from src.main import init_db
    return init_db(db_path)


# ---------------------------------------------------------------------------
# Summary helpers (used by scheduler jobs)
# ---------------------------------------------------------------------------

def _weekly_summary(storage, bot) -> str:
    """Scheduled Sunday report: current Monday through the local send date."""
    return bot._format_spending_period(storage, "week", include_evidence=False)


def _monthly_summary(storage, bot) -> str:
    """Scheduled first-of-month report: the completed previous calendar month."""
    from datetime import timedelta
    previous_end = bot._local_now().date().replace(day=1) - timedelta(days=1)
    return bot._format_spending_period(storage, "month", as_of=previous_end, include_evidence=False)


def _check_budget_alerts(storage, bot, username) -> None:
    """Send Telegram alert for any budget at warning or over-budget status.
    Uses app_settings key budget_alert_sent_{id}_{date} to avoid repeat alerts per day.
    """
    from src.config import local_now
    today = local_now().strftime("%Y-%m-%d")
    try:
        budgets = storage.get_budget_progress()
    except Exception:
        return
    for b in budgets:
        if b["status"] not in ("warning", "over_budget"):
            continue
        dedup_key = f"budget_alert_sent_{b['id']}_{today}"
        if storage.get_setting(dedup_key, "") == "1":
            continue
        label = b.get("label", b.get("category") or "Overall")
        if b["status"] == "over_budget":
            msg = (
                f"⚠️ *Budget exceeded:* {label}\n"
                f"Spent *${b['spent']:.2f}* of *${b['budget_amount']:.2f}* "
                f"({b['percent']:.0f}%)"
            )
        else:
            msg = (
                f"⚡ *Budget warning:* {label}\n"
                f"Spent *${b['spent']:.2f}* of *${b['budget_amount']:.2f}* "
                f"({b['percent']:.0f}%) — approaching limit"
            )
        try:
            bot.notify_text(msg, username)
            storage.set_setting(dedup_key, "1")
        except Exception:
            pass


def _generate_llm_insight(storage, llm_service) -> None:
    """Generate LLM insight from current month summary and cache in app_settings.

    Called per-user by the daily APScheduler job. LLM never touches raw transactions —
    only a pre-computed summary dict is passed.
    """
    import json
    from src.analytics import get_period_comparison, get_category_comparison, get_spending_velocity
    from src.config import local_now

    logger.info("Generating LLM insight...")
    try:
        now = local_now()
        start = now.replace(day=1).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")

        comparison = get_period_comparison(storage._conn, period="month")
        categories = get_category_comparison(storage._conn, period="month")
        velocity = get_spending_velocity(storage._conn)

        balance_row = storage._conn.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN type='income' THEN amount*exchange_rate END), 0) AS income,
                 COALESCE(SUM(CASE WHEN (type IS NULL OR type='expense') THEN amount*exchange_rate END), 0) AS expenses
               FROM transactions
               WHERE DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()
        income = balance_row["income"]
        expenses = balance_row["expenses"]
        savings_rate = ((income - expenses) / income * 100) if income > 0 else 0

        top_cats = [
            {"name": c["category"], "amount": c["current"], "change_pct": c["change_percent"]}
            for c in categories[:5]
        ]

        summary_dict = {
            "period_label": now.strftime("%B %Y"),
            "total_expense": round(expenses, 2),
            "total_income": round(income, 2),
            "savings_rate": round(savings_rate, 1),
            "change_vs_last_month_pct": comparison.get("change_percent"),
            "top_categories": top_cats,
            "velocity_status": velocity.get("status"),
        }

        result = llm_service.generate_period_insight(summary_dict)
        storage.set_setting("llm_insight_content", json.dumps(result))
        storage.set_setting("llm_insight_generated_at", now.isoformat())
        logger.info("LLM insight cached successfully")
    except Exception as e:
        logger.warning("LLM insight generation failed: %s", e)
