import asyncio
import calendar
import functools
import json
import logging
import re
import secrets
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Optional

from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonCommands, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ConversationHandler, ContextTypes, MessageHandler, filters

from src.categorizer import Categorizer
from src.config import local_now
from src.exchange import ExchangeRateService
from src.storage import Storage, TransactionRequestConflict

logger = logging.getLogger(__name__)

EDIT_SELECT_FIELD = 0
EDIT_ENTER_VALUE = 1

SOURCE_LABELS: dict[str, str] = {
    "dbs_paylah":      "DBS PayLah!",
    "uob_paynow":      "UOB PayNow",
    "uob_paynow_sent": "UOB PayNow Sent",
    "uob_card":        "UOB Card",
    "uob_transfer":    "UOB Transfer",
    "uob_nets":        "UOB NETS QR",
    "apple_wallet":    "Apple Wallet",
    "manual":          "Manual",
    "cash":            "Cash",
}


def _fmt_tx_date(transaction_date) -> str:
    """Return YYYY-MM-DD for midnight/bare dates, YYYY-MM-DD HH:MM for real times."""
    s = str(transaction_date or "")
    if not s:
        return "—"
    date_part = s[:10]
    time_part = s[11:16] if len(s) > 10 else ""
    if time_part and time_part != "00:00":
        return f"{date_part} {time_part}"
    return date_part


def get_category_keyboard(tx_id: int, categories: list[str]) -> InlineKeyboardMarkup:
    """Create a 2-column grid of category buttons for recategorization."""
    buttons = []
    row = []
    for cat in categories:
        row.append(InlineKeyboardButton(cat, callback_data=f"recat:{tx_id}:{cat}"))
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return InlineKeyboardMarkup(buttons)


class _ReplyProxy:
    """Mimics a telegram.Message so handlers can call reply_text when the
    original callback message is inaccessible."""

    def __init__(self, bot, chat_id: int):
        self.bot = bot
        self.chat_id = chat_id

    async def reply_text(self, text: str, **kwargs):
        await self.bot.send_message(chat_id=self.chat_id, text=text, **kwargs)


def estimate_next_date(frequency: str, last_seen: str) -> str:
    """Estimate next occurrence date based on frequency."""
    last = datetime.strptime(last_seen[:10], "%Y-%m-%d")
    if frequency == "weekly":
        next_d = last + timedelta(weeks=1)
    elif frequency == "biweekly":
        next_d = last + timedelta(weeks=2)
    else:  # monthly
        next_month = last.month + 1 if last.month < 12 else 1
        next_year = last.year + 1 if last.month == 12 else last.year
        max_day = calendar.monthrange(next_year, next_month)[1]
        next_d = last.replace(year=next_year, month=next_month, day=min(last.day, max_day))
    return next_d.strftime("%d %b")


class TelegramBotService:
    def __init__(
        self,
        storage: Optional[Storage] = None,
        bot_token: str = "",
        categorizer: Optional[Categorizer] = None,
        exchange_service: Optional[ExchangeRateService] = None,
        dashboard_url: str = "",
        timezone: str = "Asia/Singapore",
        poller=None,
        oauth_redirect_uri: str = "",
        admin_storage=None,
        llm_service=None,
    ):
        self.storage = storage
        self.admin_storage = admin_storage
        self.user_manager = None    # set via back-reference after UserManager is constructed
        self.bot_token = bot_token
        self.categorizer = categorizer
        self.exchange_service = exchange_service
        self.dashboard_url = dashboard_url
        self.timezone = timezone
        self.poller = poller
        self.oauth_redirect_uri = oauth_redirect_uri
        self.app = None
        self.chat_id: Optional[int] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.llm_service = llm_service
        # Lifecycle state — read by /api/status
        self.is_running: bool = False
        self.last_error: Optional[str] = None
        # Restore persisted chat_id (single-user legacy mode only)
        if self.storage is not None:
            self._load_chat_id()

    def _resolve_chat_id(self, username: Optional[str] = None) -> Optional[int]:
        """Return the Telegram chat ID for a user (multi-user) or self.chat_id (legacy)."""
        if username and self.admin_storage:
            user = self.admin_storage.get_user(username)
            if user and user["telegram_chat_id"]:
                return int(user["telegram_chat_id"])
            return None
        return self.chat_id

    def _load_chat_id(self) -> None:
        if self.storage is None:
            return
        chat_id = self.storage.get_telegram_chat_id()
        if chat_id:
            self.chat_id = chat_id
            logger.info("Restored Telegram chat_id: %s", self.chat_id)

    def _save_chat_id(self, chat_id: int) -> None:
        if self.storage is not None:
            self.storage.set_telegram_chat_id(chat_id)

    def _get_chat_id(self, update) -> Optional[int]:
        """Extract chat_id from a real Update or the SimpleNamespace proxy used by _cmd_callback."""
        if hasattr(update, "effective_chat") and update.effective_chat:
            return update.effective_chat.id
        if hasattr(update, "message") and update.message and hasattr(update.message, "chat_id"):
            return update.message.chat_id
        return None

    async def _require_ctx(self, update):
        """Resolve UserContext for the calling chat.
        Multi-user mode: looks up via user_manager.get_by_chat_id().
        Legacy single-user mode (admin_storage is None): returns self so
          callers can use ctx.storage / ctx.categorizer transparently.
        Returns None (and sends an error reply) if the chat is not linked.
        """
        if self.admin_storage is None:
            # Legacy path — self.storage and self.categorizer are set directly
            return self
        chat_id = self._get_chat_id(update)
        ctx = self.user_manager.get_by_chat_id(chat_id) if (chat_id and self.user_manager) else None
        if ctx is None:
            try:
                await update.message.reply_text(
                    "Send `/start <code>` from the cashe onboarding page to link your account.",
                    parse_mode="Markdown",
                )
            except Exception:
                pass
        return ctx

    def _local_now(self) -> datetime:
        """Return current datetime in the configured local timezone."""
        return local_now(self.timezone)

    def parse_add_command(self, text: str) -> Optional[dict]:
        parts = text.strip().split()
        if len(parts) < 2:
            return None
        try:
            amount = float(parts[0])
        except ValueError:
            return None
        if amount <= 0:
            return None

        remaining = parts[1:]
        date = None
        category = None

        # Check last two tokens for "YYYY-MM-DD HH:MM" datetime
        if len(remaining) >= 3:
            try:
                datetime.strptime(f"{remaining[-2]} {remaining[-1]}", "%Y-%m-%d %H:%M")
                date = f"{remaining[-2]}T{remaining[-1]}:00"
                remaining = remaining[:-2]
            except ValueError:
                pass

        # Fall back: check last token for bare "YYYY-MM-DD" — store as midnight
        if date is None and len(remaining) >= 2:
            try:
                datetime.strptime(remaining[-1], "%Y-%m-%d")
                date = f"{remaining[-1]}T00:00:00"
                remaining = remaining[:-1]
            except ValueError:
                pass

        # Only extract category if a date was found — otherwise everything is the merchant
        if date is not None and len(remaining) >= 2:
            category = remaining[-1]
            merchant = " ".join(remaining[:-1])
        else:
            merchant = " ".join(remaining)

        return {
            "amount": amount,
            "merchant": merchant,
            "category": category,
            "date": date,
        }

    @staticmethod
    def _escape_md(text: str) -> str:
        """Strip Telegram Markdown special characters from user-provided text."""
        for ch in ("_", "*", "`", "["):
            text = text.replace(ch, "")
        return text

    def _format_tx_block(self, tx: dict, icon_map: dict[str, str] | None = None) -> str:
        if icon_map is None:
            icon_map = {}
        merchant  = self._escape_md(str(tx.get("merchant") or tx.get("description") or "Unknown"))
        category  = str(tx.get("category") or "Uncategorized")
        icon      = icon_map.get(category, "")
        cat_display = f"{icon} {self._escape_md(category)}" if icon else self._escape_md(category)
        amount    = float(tx.get("amount", 0))
        currency  = str(tx.get("currency", "SGD"))
        rate      = float(tx.get("exchange_rate") or 1.0)
        tx_date   = _fmt_tx_date(tx.get("transaction_date"))
        tx_id     = tx.get("id", "?")
        is_income = tx.get("type") == "income"
        raw_source = str(tx.get("source", "unknown"))
        if raw_source == "apple_wallet" and str(tx.get("description", "")).startswith("Apple Wallet"):
            source_label = self._escape_md(str(tx.get("description", "Apple Wallet")))
        else:
            source_label = self._escape_md(SOURCE_LABELS.get(raw_source, raw_source))

        row_prefix = "💰 " if is_income else ""
        amt_prefix = "+" if is_income else ""
        lines = [f"{row_prefix}*{merchant}* · {cat_display}"]
        if currency != "SGD" and rate != 1.0:
            sgd = amount * rate
            lines.append(f"`{amt_prefix}${sgd:.2f} SGD` `({currency} {amount:.2f})` · {source_label}")
        else:
            lines.append(f"`{amt_prefix}${amount:.2f} {currency}` · {source_label}")
        lines.append(f"_{tx_id} · {tx_date}_")
        return "\n".join(lines)

    async def _send_long_message(self, update: Update, text: str, parse_mode: str = "Markdown", reply_markup=None) -> None:
        limit = 3800

        async def _send(part: str, markup=None):
            try:
                await update.message.reply_text(part, parse_mode=parse_mode, reply_markup=markup)
            except Exception:
                await update.message.reply_text(part, reply_markup=markup)

        if len(text) <= limit:
            await _send(text, reply_markup)
            return
        parts = []
        while text:
            if len(text) <= limit:
                parts.append(text)
                break
            split_at = text.rfind("\n", 0, limit)
            if split_at == -1:
                split_at = limit
            parts.append(text[:split_at])
            text = text[split_at:].lstrip("\n")
        for i, part in enumerate(parts):
            markup = reply_markup if i == len(parts) - 1 else None
            await _send(part, markup)

    def _build_summary_with_transactions(self, header: str, summary: dict, start_date: str, end_date: str, storage=None) -> str:
        _storage = storage if storage is not None else self.storage
        icon_map = _storage.get_category_icon_map()
        lines = [header, f"Total: `${summary['total']:.2f}`", ""]
        for cat, total in sorted(summary["by_category"].items(), key=lambda x: -x[1]):
            icon = icon_map.get(cat, "")
            prefix = f"{icon} " if icon else ""
            lines.append(f"{prefix}{self._escape_md(cat)}: `${total:.2f}`")

        transactions = _storage.query_transactions(start_date=start_date, end_date=end_date, limit=200)
        if transactions:
            lines.append("")
            lines.append("*Transactions:*")
            for tx in transactions:
                lines.append("─────────")
                lines.append(self._format_tx_block(tx, icon_map))

        return "\n".join(lines)

    def format_daily_summary(self, date: str, storage=None) -> str:
        _storage = storage if storage is not None else self.storage
        summary = _storage.get_spending_summary(start_date=date, end_date=date)
        if summary["total"] == 0:
            return "Nothing logged yet."

        return self._build_summary_with_transactions(
            f"*Spending for {date}*", summary, date, date, storage=_storage
        )

    def format_weekly_summary(self, start_date: str, end_date: str, storage=None) -> str:
        _storage = storage if storage is not None else self.storage
        summary = _storage.get_spending_summary(start_date=start_date, end_date=end_date)
        if summary["total"] == 0:
            return "Nothing logged yet."

        return self._build_summary_with_transactions(
            f"*Weekly Summary ({start_date} to {end_date})*", summary, start_date, end_date, storage=_storage
        )

    def format_monthly_summary(self, start_date: str, end_date: str, storage=None) -> str:
        _storage = storage if storage is not None else self.storage
        summary = _storage.get_spending_summary(start_date=start_date, end_date=end_date)
        if summary["total"] == 0:
            return "Nothing logged yet."
        label = datetime.strptime(start_date, "%Y-%m-%d").strftime("%B %Y")
        return self._build_summary_with_transactions(
            f"*Monthly Summary — {label}*", summary, start_date, end_date, storage=_storage
        )

    async def _delete_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        args = context.args
        if not args or not args[0].isdigit():
            await update.message.reply_text("Usage: /delete <id>")
            return
        tx_id = int(args[0])
        tx = ctx.storage.get_transaction(tx_id)
        if not tx:
            await update.message.reply_text("Transaction not found.")
            return
        amount_sgd = tx["amount"] * tx.get("exchange_rate", 1.0)
        date_str = _fmt_tx_date(tx.get("transaction_date"))
        msg = (
            f"Delete this transaction?\n\n"
            f"*{tx.get('merchant', '—')}* — ${amount_sgd:.2f} SGD\n"
            f"Category: {tx.get('category', '—')}\n"
            f"Date: {date_str}\n"
            f"Source: {tx.get('source', '—')}"
        )
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("Confirm Delete", callback_data=f"confirm_delete_{tx_id}"),
            InlineKeyboardButton("Cancel", callback_data="cancel_delete"),
        ]])
        await update.message.reply_text(msg, reply_markup=keyboard, parse_mode="Markdown")

    async def _delete_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        data = query.data
        if data == "cancel_delete":
            await query.edit_message_text("Cancelled.")
            return
        if data.startswith("confirm_delete_"):
            tx_id = int(data.split("_")[-1])
            ctx = await self._require_ctx(update)
            if ctx is None:
                await query.edit_message_text("Account not linked.")
                return
            try:
                ctx.storage.delete_transaction(tx_id)
                await query.edit_message_text(f"Transaction #{tx_id} deleted.")
            except ValueError:
                await query.edit_message_text("Transaction not found (may have already been deleted).")

    async def _edit_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return ConversationHandler.END
        args = context.args
        if not args or not args[0].isdigit():
            await update.message.reply_text("Usage: /edit <id>")
            return ConversationHandler.END
        tx_id = int(args[0])
        tx = ctx.storage.get_transaction(tx_id)
        if not tx:
            await update.message.reply_text("Transaction not found.")
            return ConversationHandler.END
        context.user_data["edit_tx_id"] = tx_id
        amount_sgd = tx["amount"] * tx.get("exchange_rate", 1.0)
        date_str = _fmt_tx_date(tx.get("transaction_date"))
        msg = (
            f"*Transaction #{tx_id}*\n"
            f"Merchant: {tx.get('merchant', '—')}\n"
            f"Amount: {tx.get('currency', 'SGD')} {tx['amount']:.2f} (SGD {amount_sgd:.2f})\n"
            f"Category: {tx.get('category', '—')}\n"
            f"Date: {date_str}\n"
            f"Description: {tx.get('description', '—')}\n\n"
            "What would you like to edit?"
        )
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("Merchant", callback_data="ef_merchant"),
                InlineKeyboardButton("Amount", callback_data="ef_amount"),
            ],
            [
                InlineKeyboardButton("Category", callback_data="ef_category"),
                InlineKeyboardButton("Date", callback_data="ef_date"),
            ],
            [InlineKeyboardButton("Description", callback_data="ef_description")],
            [InlineKeyboardButton("Cancel", callback_data="ef_cancel")],
        ])
        await update.message.reply_text(msg, reply_markup=keyboard, parse_mode="Markdown")
        return EDIT_SELECT_FIELD

    async def _edit_field_selected(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
        query = update.callback_query
        await query.answer()
        field = query.data  # e.g. "ef_merchant"

        if field == "ef_cancel":
            await query.edit_message_text("Edit cancelled.")
            context.user_data.clear()
            return ConversationHandler.END

        field_name = field.split("_", 1)[1]  # "merchant", "amount", etc.
        context.user_data["edit_field"] = field_name

        if field_name == "category":
            edit_ctx = await self._require_ctx(update)
            if edit_ctx is None:
                await query.edit_message_text("Account not linked.")
                context.user_data.clear()
                return ConversationHandler.END
            cats = edit_ctx.storage.get_categories()
            buttons = []
            row = []
            for i, cat in enumerate(cats):
                icon = cat.get("icon", "") or ""
                label = f"{icon} {cat['name']}".strip()
                row.append(InlineKeyboardButton(label, callback_data=f"ec_{cat['name']}"))
                if len(row) == 2:
                    buttons.append(row)
                    row = []
            if row:
                buttons.append(row)
            buttons.append([InlineKeyboardButton("Cancel", callback_data="ef_cancel")])
            await query.edit_message_text("Select new category:", reply_markup=InlineKeyboardMarkup(buttons))
            return EDIT_SELECT_FIELD

        prompts = {
            "merchant": "Enter new merchant name:",
            "amount": "Enter new amount (numbers only, e.g. 12.50):",
            "date": "Enter new date (YYYY-MM-DD or DD/MM/YYYY):",
            "description": "Enter new description (or 'clear' to remove):",
        }
        await query.edit_message_text(prompts.get(field_name, "Enter value:"))
        return EDIT_ENTER_VALUE

    async def _edit_category_selected(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
        query = update.callback_query
        await query.answer()

        if query.data == "ef_cancel":
            await query.edit_message_text("Edit cancelled.")
            context.user_data.clear()
            return ConversationHandler.END

        category = query.data[3:]  # strip "ec_"
        tx_id = context.user_data.get("edit_tx_id")
        edit_ctx = await self._require_ctx(update)
        if edit_ctx is None:
            await query.edit_message_text("Account not linked.")
            context.user_data.clear()
            return ConversationHandler.END
        tx = edit_ctx.storage.get_transaction(tx_id)
        if not tx:
            await query.edit_message_text("Transaction no longer exists.")
            context.user_data.clear()
            return ConversationHandler.END

        edit_ctx.storage.update_transaction(tx_id, category=category)
        await query.edit_message_text(
            f"Category updated to {category} for this transaction only.\n"
            f"To remember its current category for future purchases: /recategorize {tx_id} --remember"
        )
        context.user_data.clear()
        return ConversationHandler.END

    async def _edit_value_entered(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
        tx_id = context.user_data.get("edit_tx_id")
        field = context.user_data.get("edit_field")
        text = update.message.text.strip()

        edit_ctx = await self._require_ctx(update)
        if edit_ctx is None:
            await update.message.reply_text("Account not linked.")
            context.user_data.clear()
            return ConversationHandler.END

        tx = edit_ctx.storage.get_transaction(tx_id)
        if not tx:
            await update.message.reply_text("Transaction no longer exists.")
            context.user_data.clear()
            return ConversationHandler.END

        if field == "amount":
            try:
                value = float(text.replace(",", ""))
            except ValueError:
                await update.message.reply_text("Invalid amount. Enter a number like 12.50:")
                return EDIT_ENTER_VALUE
            edit_ctx.storage.update_transaction(tx_id, amount=value)
            await update.message.reply_text(f"Amount updated to {value:.2f}.")

        elif field == "date":
            iso = None
            # Try YYYY-MM-DD
            try:
                datetime.strptime(text[:10], "%Y-%m-%d")
                iso = text[:10]
            except ValueError:
                pass
            # Try DD/MM/YYYY
            if iso is None and re.match(r"\d{2}/\d{2}/\d{4}", text):
                try:
                    d, m, y = text.split("/")
                    datetime.strptime(f"{y}-{m}-{d}", "%Y-%m-%d")
                    iso = f"{y}-{m}-{d}"
                except ValueError:
                    pass
            if iso is None:
                await update.message.reply_text("Invalid date. Use YYYY-MM-DD or DD/MM/YYYY:")
                return EDIT_ENTER_VALUE
            edit_ctx.storage.update_transaction(tx_id, transaction_date=f"{iso}T00:00:00")
            await update.message.reply_text(f"Date updated to {iso}.")

        elif field == "description":
            value = None if text.lower() == "clear" else text
            edit_ctx.storage.update_transaction(tx_id, description=value)
            await update.message.reply_text("Description updated." if value else "Description cleared.")

        elif field == "merchant":
            edit_ctx.storage.update_transaction(tx_id, merchant=text)
            await update.message.reply_text(f"Merchant updated to *{text}*.", parse_mode="Markdown")

        context.user_data.clear()
        return ConversationHandler.END

    def setup_handlers(self) -> None:
        async def _post_init(application: Application) -> None:
            await application.bot.set_my_commands([
                BotCommand("start",            "Initialize the bot"),
                BotCommand("today",            "Today's spending"),
                BotCommand("yesterday",        "Yesterday's spending"),
                BotCommand("week",             "This week's spending"),
                BotCommand("month",            "This month's breakdown"),
                BotCommand("add",              "Add an expense (supports multi-currency)"),
                BotCommand("cash",             "Quick cash expense entry"),
                BotCommand("income",           "Record income"),
                BotCommand("balance",          "Income vs expenses this month"),
                BotCommand("insights",         "Top merchants & daily average spend"),
                 BotCommand("subscriptions",    "Your subscriptions and monthly total"),
                BotCommand("recategorize",     "Reassign a transaction's category"),
                BotCommand("compare",          "This month vs last month"),
                BotCommand("merchants_report", "Top merchants this month"),
                BotCommand("velocity",         "Spending pace and projection"),
                BotCommand("summary",          "Monthly summary report"),
                BotCommand("dashboard",        "Open the web dashboard"),
                BotCommand("menu",             "Quick action buttons"),
                BotCommand("help",             "Show all commands"),
                BotCommand("delete",           "Delete a transaction"),
                BotCommand("edit",             "Edit a transaction field"),
                BotCommand("trip",             "Current trip summary (when trips active)"),
                BotCommand("reauth",           "Re-authorize Gmail access"),
                BotCommand("forcepoll",        "Force a Gmail poll for new emails"),
            ])
            await application.bot.set_chat_menu_button(menu_button=MenuButtonCommands())

        self.app = Application.builder().token(self.bot_token).post_init(_post_init).build()

        self.app.add_handler(CommandHandler("start", self._start))
        self.app.add_handler(CommandHandler("today", self._today))
        self.app.add_handler(CommandHandler("week", self._week))
        self.app.add_handler(CommandHandler("month", self._month))
        self.app.add_handler(CommandHandler("add", self._add))
        self.app.add_handler(CommandHandler("cash", self._cash))
        self.app.add_handler(CommandHandler("recategorize", self._recategorize))
        self.app.add_handler(CommandHandler("income", self._income))
        self.app.add_handler(CommandHandler("balance", self._balance))
        self.app.add_handler(CommandHandler("insights", self._insights))
        self.app.add_handler(CommandHandler("subscriptions", self._subscriptions))
        self.app.add_handler(CommandHandler("help", self._help))
        self.app.add_handler(CommandHandler("dashboard", self._dashboard))
        self.app.add_handler(CommandHandler("compare", self._compare))
        self.app.add_handler(CommandHandler("merchants_report", self._merchants))
        self.app.add_handler(CommandHandler("velocity", self._velocity))
        self.app.add_handler(CommandHandler("summary", self._summary))
        self.app.add_handler(CommandHandler("yesterday", self._yesterday))
        self.app.add_handler(CommandHandler("menu", self._menu))

        self.app.add_handler(CallbackQueryHandler(self._cmd_callback, pattern="^cmd_"))
        self.app.add_handler(CallbackQueryHandler(self._category_callback, pattern="^cat:"))
        self.app.add_handler(CallbackQueryHandler(self._recat_callback, pattern="^recat:"))
        self.app.add_handler(CallbackQueryHandler(self._handle_sub_suggest_callback, pattern="^sub_suggest_"))

        edit_conv = ConversationHandler(
            entry_points=[CommandHandler("edit", self._edit_start)],
            states={
                EDIT_SELECT_FIELD: [
                    CallbackQueryHandler(self._edit_category_selected, pattern=r"^ec_"),
                    CallbackQueryHandler(self._edit_field_selected, pattern=r"^ef_"),
                ],
                EDIT_ENTER_VALUE: [
                    MessageHandler(filters.TEXT & ~filters.COMMAND, self._edit_value_entered),
                ],
            },
            fallbacks=[CommandHandler("cancel", lambda u, c: ConversationHandler.END)],
            conversation_timeout=300,
        )
        self.app.add_handler(edit_conv)
        # NOTE (Task 16): "Budget exists for that category. /budgets to manage." was not
        # implemented because there is no /budget add bot command. Budget creation is
        # handled exclusively via the web API (/api/budgets POST), where a 409 HTTP response
        # is returned on duplicate. If a Telegram /budget command is added in the future,
        # catch ValueError from storage.create_budget and reply with that message.
        self.app.add_handler(CommandHandler("delete", self._delete_command))
        self.app.add_handler(CallbackQueryHandler(self._delete_callback, pattern=r"^(confirm_delete_\d+|cancel_delete)$"))
        self.app.add_handler(CommandHandler("trip", self._trip))
        self.app.add_handler(CommandHandler("reauth", self._reauth))
        self.app.add_handler(CommandHandler("forcepoll", self._forcepoll))

        # NL callback buttons (nl_confirm / nl_edit / nl_cancel)
        self.app.add_handler(CallbackQueryHandler(self._handle_nl_callback, pattern="^nl_"))

        # NL text handler — registered last (replaces _unknown_text)
        self.app.add_handler(MessageHandler(filters.COMMAND, self._unknown))
        self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_nl_message))

    async def _start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat_id = update.effective_chat.id
        args = context.args or []

        # Multi-user mode: token-based linking
        if self.admin_storage is not None:
            if args:
                token = args[0]
                username = self.admin_storage.consume_telegram_link_token(token)
                if not username:
                    await update.message.reply_text(
                        "Code invalid or expired. "
                        "Return to the cashe onboarding page to generate a new one."
                    )
                    return
                existing = self.admin_storage.get_user_by_chat_id(str(chat_id))
                if existing and existing["username"] != username:
                    await update.message.reply_text("This code belongs to a different account.")
                    return
                self.admin_storage.update_user(username, telegram_chat_id=str(chat_id))
                await update.message.reply_text("Linked. Your Telegram is connected to cashe.")
                return
            # /start with no args — check if already linked
            if self.user_manager:
                ctx = self.user_manager.get_by_chat_id(chat_id)
                if ctx:
                    await update.message.reply_text(
                        f"Linked as *{ctx.username}*.",
                        parse_mode="Markdown",
                    )
                    return
            await update.message.reply_text(
                "Send `/start <code>` from the cashe onboarding page to link your account.",
                parse_mode="Markdown",
            )
            return

        # Legacy single-user mode
        self.chat_id = chat_id
        self._save_chat_id(self.chat_id)
        await update.message.reply_text(
            "Ready. Use the menu button or /help to see all commands."
        )

    async def _today(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        today = self._local_now().strftime("%Y-%m-%d")
        text = self.format_daily_summary(today, storage=ctx.storage)
        # Append daily pace note if budget data is available
        try:
            summary = ctx.storage.get_spending_summary(start_date=today, end_date=today)
            total_spent = summary["total"]
            daily_budget = 0.0
            progress = ctx.storage.get_budget_progress()
            for b in progress:
                if b["category"] is None and b["period"] == "monthly" and b["budget_amount"] > 0:
                    days_in_month = self._local_now().replace(day=1)
                    import calendar as _cal
                    dim = _cal.monthrange(self._local_now().year, self._local_now().month)[1]
                    daily_budget = b["budget_amount"] / dim
                    break
            note = self._build_pace_note_daily(total_spent, daily_budget)
            if note:
                text = text + "\n\n" + note
        except Exception:
            pass
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📅 Yesterday", callback_data="cmd_yesterday"),
                InlineKeyboardButton("📊 Week", callback_data="cmd_week"),
            ],
            [
                InlineKeyboardButton("➕ Add Cash", callback_data="cmd_cash"),
            ],
        ])
        await self._send_long_message(update, text, reply_markup=keyboard)

    async def _yesterday(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        yesterday = (self._local_now() - timedelta(days=1)).strftime("%Y-%m-%d")
        text = self.format_daily_summary(yesterday, storage=ctx.storage)
        await self._send_long_message(update, text)

    async def _week(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        today = self._local_now()
        start = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
        end = today.strftime("%Y-%m-%d")
        text = self.format_weekly_summary(start, end, storage=ctx.storage)
        # Append weekly pace note if budget data is available
        try:
            summary = ctx.storage.get_spending_summary(start_date=start, end_date=end)
            total_spent = summary["total"]
            weekly_budget = 0.0
            progress = ctx.storage.get_budget_progress()
            for b in progress:
                if b["category"] is None and b["period"] == "monthly" and b["budget_amount"] > 0:
                    weekly_budget = b["budget_amount"] / 4.33
                    break
            days_elapsed = today.weekday() + 1  # Monday=0, so +1 for days elapsed
            note = self._build_pace_note_weekly(total_spent, weekly_budget, days_elapsed)
            if note:
                text = text + "\n\n" + note
        except Exception:
            pass
        await self._send_long_message(update, text)

    async def _month(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        today = self._local_now()
        start = f"{today.year}-{today.month:02d}-01"
        end = today.strftime("%Y-%m-%d")
        summary = ctx.storage.get_spending_summary(start_date=start, end_date=end)
        if summary["total"] == 0:
            await update.message.reply_text("Nothing logged yet.")
            return
        text = self._build_summary_with_transactions(
            f"*Monthly Summary ({start} to {end})*", summary, start, end, storage=ctx.storage
        )
        # Append monthly pace note if budget data is available
        try:
            import calendar as _cal
            total_spent = summary["total"]
            progress = ctx.storage.get_budget_progress()
            for b in progress:
                if b["category"] is None and b["period"] == "monthly" and b["budget_amount"] > 0:
                    monthly_budget = b["budget_amount"]
                    days_elapsed = today.day
                    dim = _cal.monthrange(today.year, today.month)[1]
                    daily_budget = monthly_budget / dim
                    note = self._build_pace_note_daily(total_spent / days_elapsed, daily_budget)
                    if note:
                        text = text + "\n\n" + note
                    break
        except Exception:
            pass
        await self._send_long_message(update, text)

    async def _save_manual_entry(self, ctx, reply, *, message=None, command=None, args=None,
                                 draft=None, **fields):
        replayed = False
        try:
            chat_id = getattr(message, "chat_id", None)
            message_id = getattr(message, "message_id", None)
            if draft is not None:
                tx_id, replayed = ctx.storage.confirm_telegram_draft(
                    draft["_id"], draft, exchange_rate=fields.get("exchange_rate"), chat_id=draft["_chat_id"],
                )
            elif type(chat_id) is int and type(message_id) is int:
                tx_id, replayed = ctx.storage.create_telegram_transaction(
                    chat_id=chat_id, message_id=message_id, command=command, args=list(args), **fields,
                )
            else:
                # Legacy/in-process direct callers have no Telegram message identity.
                tx_id = ctx.storage.create_manual_transaction(**fields)
        except TransactionRequestConflict:
            await reply("This message was already saved or its transaction was deleted. Check Activity to make corrections.")
            return None
        except ValueError as exc:
            message = "Already logged." if str(exc).startswith("duplicate source_id:") else "Couldn’t save. Check the amount, currency, exchange rate, and date."
            await reply(message)
            return None
        if fields.get("assign_to_active_trip"):
            from src.ingestion import IngestionPipeline
            pipeline = getattr(getattr(ctx, "poller", None), "pipeline", None)
            if pipeline is None:
                pipeline = IngestionPipeline(ctx.storage)
            pipeline.process_outbox(transaction_id=tx_id)
        if replayed:
            await reply(f"Already logged. Transaction {tx_id}.")
            return None
        return tx_id

    async def _add(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        if not context.args:
            await update.message.reply_text("Usage: /add <amount> [currency] <merchant> [category] [date]")
            return
        text = " ".join(context.args)

        # Detect currency in the amount portion
        currency = "SGD"
        exchange_rate = 1.0
        amount_text = context.args[0]
        if len(context.args) >= 2:
            # Check if second arg is a currency code
            from src.exchange import CURRENCY_CODES
            if context.args[1].upper() in CURRENCY_CODES:
                currency = context.args[1].upper()
                amount_text = f"{context.args[0]} {context.args[1]}"
                # Rebuild text without currency for parse_add_command
                text = " ".join([context.args[0]] + list(context.args[2:]))
                exchange_rate = self.exchange_service.get_rate(currency) if self.exchange_service else None

        parsed = self.parse_add_command(text)
        if not parsed:
            # Distinguish "bad number" from "no number at all"
            parts = text.strip().split()
            first = parts[0] if parts else ""
            first_stripped = first.lstrip("$")
            looks_like_amount = bool(first_stripped and re.match(r'^[\d.,]+$', first_stripped))
            if first.startswith("$") or looks_like_amount:
                await update.message.reply_text("That's not a number. /add $12.50 Coffee Starbucks")
            else:
                await update.message.reply_text("Amount missing. /add $12.50 Coffee Starbucks")
            return

        now = self._local_now()
        tx_date = parsed["date"] or now.strftime("%Y-%m-%dT%H:%M:%S")
        category = parsed["category"]
        if not category and ctx.categorizer:
            category, _ = ctx.categorizer.categorize(parsed["merchant"])

        tx_id = await self._save_manual_entry(ctx, update.message.reply_text,
            message=update.message, command="add", args=context.args,
            assign_to_active_trip=True,
            source="manual",
            source_id=f"manual-{now.strftime('%Y%m%d%H%M%S')}-{parsed['amount']}",
            amount=parsed["amount"],
            merchant=parsed["merchant"],
            category=category,
            currency=currency,
            exchange_rate=exchange_rate,
            transaction_date=tx_date,
        )
        if tx_id is None:
            return

        context_line = self._build_context_line(category, parsed["merchant"], parsed["amount"])
        msg = f"cash, caught. [${parsed['amount']:.2f} · {parsed['merchant']}]"
        if currency != "SGD":
            if exchange_rate is None or exchange_rate == 1:
                msg += "\nSGD conversion unresolved."
            else:
                sgd_equivalent = parsed["amount"] * exchange_rate
                msg += f"\n~ SGD ${sgd_equivalent:.2f} (indicative)"
        if context_line:
            msg += f"\n{context_line}"
        await update.message.reply_text(msg)

    async def _cash(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        if not context.args:
            await update.message.reply_text(
                "Usage: /cash <amount> <merchant> [category] [date]\n"
                "Example: /cash 12.50 Toast Box food"
            )
            return
        text = " ".join(context.args)
        parsed = self.parse_add_command(text)
        if not parsed:
            # Distinguish between bad amount and missing merchant
            parts = text.strip().split()
            try:
                amount = float(parts[0])
            except (ValueError, IndexError):
                await update.message.reply_text("Invalid amount. Usage: /cash <amount> <merchant> [category] [date]")
                return
            if amount <= 0:
                await update.message.reply_text("Amount must be positive. Usage: /cash <amount> <merchant> [category] [date]")
                return
            await update.message.reply_text("Missing merchant. Usage: /cash <amount> <merchant> [category] [date]")
            return

        now = self._local_now()
        tx_date = parsed["date"] or now.strftime("%Y-%m-%dT%H:%M:%S")
        category = parsed["category"]
        if not category and ctx.categorizer:
            category, _ = ctx.categorizer.categorize(parsed["merchant"])

        tx_id = await self._save_manual_entry(ctx, update.message.reply_text,
            message=update.message, command="cash", args=context.args,
            assign_to_active_trip=True,
            source="cash",
            source_id=f"cash-{now.strftime('%Y%m%d%H%M%S')}-{parsed['amount']}",
            amount=parsed["amount"],
            merchant=parsed["merchant"],
            category=category,
            transaction_date=tx_date,
        )
        if tx_id is None:
            return
        context_line = self._build_context_line(category, parsed["merchant"], parsed["amount"])
        msg = f"cash, caught. [${parsed['amount']:.2f} · {parsed['merchant']}]"
        if context_line:
            msg += f"\n{context_line}"
        await update.message.reply_text(msg)

    async def _recategorize(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        if not context.args:
            await update.message.reply_text("Usage: /recategorize <transaction_id> [category] [--remember]")
            return
        try:
            tx_id = int(context.args[0])
        except ValueError:
            await update.message.reply_text("Transaction ID must be a number")
            return

        tx = ctx.storage.get_transaction(tx_id)
        if not tx:
            await update.message.reply_text("Transaction not found.")
            return

        # If a category was provided, apply it directly
        if len(context.args) >= 2:
            remember = context.args[-1] == "--remember"
            category_args = context.args[1:-1] if remember else context.args[1:]
            new_category = " ".join(category_args) if category_args else tx["category"]
            valid_categories = [c["name"] for c in ctx.storage.get_categories()]
            if new_category not in valid_categories:
                await update.message.reply_text(
                    "Unknown category. /categories to see the list."
                )
                return

            old_category = tx["category"]
            try:
                ctx.storage.update_transaction(tx_id, category=new_category, remember_category=remember)
            except ValueError as exc:
                await update.message.reply_text(str(exc))
                return
            if remember and ctx.categorizer:
                ctx.categorizer.reload_overrides(ctx.storage.get_merchant_overrides())
            scope = "Remembered for future matching transactions." if remember else (
                f"This transaction only. To remember its current category for future purchases: /recategorize {tx_id} --remember"
            )
            await update.message.reply_text(f"Updated #{tx_id}: {old_category} -> {new_category}\n{scope}")
            return

        # No category provided — show a grid of category buttons
        categories = ctx.storage.get_categories()
        keyboard = get_category_keyboard(tx_id, [c["name"] for c in categories])
        merchant = tx["merchant"] or "Unknown"
        current_category = tx["category"] or "Other"
        await update.message.reply_text(
            f"Recategorize #{tx_id}: {merchant} (currently {current_category})",
            reply_markup=keyboard,
        )

    async def _income(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        if not context.args:
            await update.message.reply_text(
                "Usage: /income <amount> <description> [date]\nExample: /income 5000 salary"
            )
            return

        try:
            amount = float(context.args[0])
        except ValueError:
            await update.message.reply_text("Invalid amount. Usage: /income <amount> <description> [date]")
            return

        if amount <= 0:
            await update.message.reply_text("Amount must be positive.")
            return

        remaining = list(context.args[1:])
        tx_date = None

        # Check last two tokens for "YYYY-MM-DD HH:MM"
        if len(remaining) >= 2:
            try:
                datetime.strptime(f"{remaining[-2]} {remaining[-1]}", "%Y-%m-%d %H:%M")
                tx_date = f"{remaining[-2]}T{remaining[-1]}:00"
                remaining = remaining[:-2]
            except ValueError:
                pass

        # Fall back: bare "YYYY-MM-DD" → midnight
        if tx_date is None and remaining:
            try:
                datetime.strptime(remaining[-1], "%Y-%m-%d")
                tx_date = f"{remaining[-1]}T00:00:00"
                remaining = remaining[:-1]
            except ValueError:
                pass

        description = " ".join(remaining) if remaining else "Income"
        now = self._local_now()
        date_str = tx_date or now.strftime("%Y-%m-%dT%H:%M:%S")

        tx_id = await self._save_manual_entry(ctx, update.message.reply_text,
            message=update.message, command="income", args=context.args,
            source="manual",
            source_id=f"manual-{now.strftime('%Y%m%d%H%M%S')}-{amount}",
            amount=amount,
            merchant=description,
            category="Income",
            transaction_date=date_str,
            tx_type="income",
        )

        if tx_id is None:
            return

        msg = f"💰 Recorded. *{self._escape_md(description)}* · `+${amount:.2f} SGD` _{tx_id}_"
        await update.message.reply_text(msg, parse_mode="Markdown")

    async def _balance(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        today = self._local_now()
        start = f"{today.year}-{today.month:02d}-01"
        end = today.strftime("%Y-%m-%d")
        balance = ctx.storage.get_balance(start, end)

        if balance["income"] == 0 and balance["expenses"] == 0:
            await update.message.reply_text("Nothing logged yet.")
            return

        month_str = today.strftime("%B %Y")
        days_in_month = calendar.monthrange(today.year, today.month)[1]
        days_remaining = days_in_month - today.day

        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("📊 Insights", callback_data="cmd_insights"),
            InlineKeyboardButton("🏠 Menu", callback_data="cmd_menu"),
        ]])

        await update.message.reply_text(
            f"*Balance for {month_str}*\n\n"
            f"💸 Income: *${balance['income']:.2f}*\n"
            f"💵 Expenses: *${balance['expenses']:.2f}*\n"
            f"💳 Net: *${balance['net']:.2f}*\n\n"
            f"_{days_remaining} days remaining this month_",
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    async def _insights(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        today = self._local_now()
        start = f"{today.year}-{today.month:02d}-01"
        end = today.strftime("%Y-%m-%d")

        summary = ctx.storage.get_spending_summary(start, end)
        ranking = ctx.storage.get_merchant_ranking(start, end, limit=5)
        avg = ctx.storage.get_average_daily(start, end)

        if not summary["by_category"]:
            await update.message.reply_text("No spending data this month.")
            return

        lines = ["*Insights This Month*", ""]
        for cat, total in sorted(summary["by_category"].items(), key=lambda x: -x[1]):
            lines.append(f"  {self._escape_md(cat)}: *${total:.2f}*")
        lines.append("")
        lines.append(f"*Daily average:* ${avg:.2f}")
        lines.append("")
        if ranking:
            lines.append("*Top Merchants*")
            for i, r in enumerate(ranking[:3], 1):
                lines.append(f"  {i}. {self._escape_md(r['merchant'])} — ${r['total']:.2f}")

        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("📊 Compare", callback_data="cmd_compare"),
            InlineKeyboardButton("🏠 Menu", callback_data="cmd_menu"),
        ]])

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=keyboard)

    async def _subscriptions(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        loop = asyncio.get_running_loop()
        summary = await loop.run_in_executor(None, ctx.storage.get_subscription_summary)
        subs = await loop.run_in_executor(None, ctx.storage.list_subscriptions)
        upcoming_map: dict[int, str] = {}
        for sub in subs:
            rows = await loop.run_in_executor(None, ctx.storage.list_upcoming_transactions, sub["id"])
            pending = [u for u in rows if u["status"] == "pending"]
            if pending:
                upcoming_map[sub["id"]] = pending[0]["expected_date"]

        active_subs = [s for s in subs if s["status"] not in ("cancelled",)]
        if not active_subs:
            await update.message.reply_text(
                "No subscriptions yet. Add one via the app.",
            )
            return

        header = (
            f"*Subscriptions* · ${summary['total_monthly_sgd']:.2f}/mo · "
            f"{summary['active_count']} active"
        )
        lines = [header]
        for sub in active_subs:
            label = sub.get("label") or sub["merchant"]
            freq = sub["frequency"]
            amount_str = f"${sub['last_amount']:.2f}" if sub.get("last_amount") is not None else "—"
            next_date = upcoming_map.get(sub["id"], "—")
            status_tag = " ⚠" if sub["status"] == "possibly_cancelled" else ""
            lines.append(
                f"🔄 *{self._escape_md(label)}*{status_tag}\n"
                f"  {amount_str} · {freq} · Next: {next_date[:10] if next_date != '—' else '—'}"
            )
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _compare(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Compare this month vs last month."""
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        result = ctx.storage.comparison(period="month")
        overall = result["overall"]
        categories = result["categories"]

        lines = ["*This Month vs Last Month*\n"]
        if overall["previous_total"] > 0 and overall["change_percent"] is not None:
            arrow = "\u2191" if overall["change"] > 0 else "\u2193"
            lines.append(
                f"*Overall:* ${overall['current_total']:.2f} {arrow} ${abs(overall['change']):.2f} "
                f"({overall['change_percent']:+.1f}%)\n"
            )
        else:
            lines.append(f"*Overall:* ${overall['current_total']:.2f} (no prior data)\n")

        for cat in categories[:5]:
            arrow = "\u2191" if cat["change"] > 0 else "\u2193"
            lines.append(
                f"{cat['category']}: ${cat['current']:.2f} {arrow} ${abs(cat['change']):.2f}"
            )

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _merchants(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Show top 5 merchants this month."""
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        merchants = ctx.storage.top_merchants_by_period(limit=5)

        if not merchants:
            await update.message.reply_text("No merchant data this month.")
            return

        lines = ["*Top Merchants This Month*\n"]
        for i, m in enumerate(merchants, 1):
            lines.append(
                f"{i}. *{self._escape_md(m['merchant'])}* \u2014 ${m['total']:.2f} ({m['count']}x)"
            )

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _velocity(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Show spending velocity vs last month."""
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        v = ctx.storage.spending_velocity()

        emoji = "\u26a0" if v["status"] == "ahead" else "\u2705"
        lines = [
            f"{emoji} *Spending Velocity*\n",
            f"Spent MTD: *${v['current_mtd']:.2f}*",
            f"Last month: ${v['last_month_total']:.2f}",
            f"Projected: ${v['projected_total']:.2f}",
            f"Pace: {v['pace_percent']:.0f}% of last month",
        ]

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _summary(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Generate on-demand monthly summary report."""
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        report = ctx.storage.generate_digest(report_type="monthly")

        arrow = "\u2191" if report["change"] > 0 else "\u2193"

        lines = [
            "*Monthly Summary*\n",
            f"*Total spent:* ${report['total_spent']:.2f} ({report['transaction_count']} transactions)",
        ]

        if report["top_category"]:
            lines.append(f"*Top category:* {report['top_category']['category']} (${report['top_category']['total']:.2f})")

        if report["biggest_transaction"]:
            bt = report["biggest_transaction"]
            lines.append(f"*Biggest:* {bt['merchant']} \u2014 ${bt['amount']:.2f}")

        if report["previous_total"] > 0 and report["change_percent"] is not None:
            lines.append(f"*vs last month:* {arrow} ${abs(report['change']):.2f} ({report['change_percent']:+.1f}%)")

        if report["new_merchant_count"] > 0:
            lines.append(f"*New merchants:* {report['new_merchant_count']}")

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _trip(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        if ctx.storage.get_setting("trips_enabled", "false") != "true":
            await update.message.reply_text("Trips are not enabled. Enable in the dashboard Settings.")
            return

        active = ctx.storage.get_active_trip()
        if not active:
            await update.message.reply_text("No active trip. Activate one from the dashboard.")
            return

        summary = ctx.storage.get_trip_summary(active["id"])
        if not summary:
            await update.message.reply_text("Could not load trip summary.")
            return

        from datetime import datetime as _dt
        start_dt = _dt.strptime(active["start_date"], "%Y-%m-%d")
        now = self._local_now()
        days_elapsed = (now.date() - start_dt.date()).days + 1

        # Today's spend
        today_str = now.strftime("%Y-%m-%d")
        today_entry = next(
            (d for d in summary["by_day"] if d["date"] == today_str), None
        )
        today_amount = today_entry["amount_sgd"] if today_entry else 0.0

        dest = f" · {self._escape_md(active['destination'])}" if active.get("destination") else ""
        lines = [
            f"✈️ *{self._escape_md(active['name'])}*{dest} (Day {days_elapsed})",
        ]
        lines += [
            self._escape_md(f"Total: S${summary['total_sgd']:.2f} across {summary['transaction_count']} transactions"),
            self._escape_md(f"Daily avg: S${summary['daily_average_sgd']:.2f}"),
            self._escape_md(f"Today: S${today_amount:.2f}"),
        ]
        if summary["by_category"]:
            lines.append(self._escape_md("\nTop categories:"))
            for cat in summary["by_category"][:3]:
                lines.append(self._escape_md(f"  {cat['category']}: S${cat['amount_sgd']:.2f}"))

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    async def _help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        lines = [
            "*cashe commands*\n",
            "📋 *Viewing*",
            "  /today — Today's spending",
            "  /week — This week's spending",
            "  /month — This month's spending",
            "  /balance — Income vs expenses",
            "  /insights — Category breakdown + top merchants",
            "  /subscriptions — Your subscriptions and monthly total",
            "",
            "📊 *Analytics*",
            "  /compare — This month vs last month",
            "  /merchants_report — Top merchants by spend",
            "  /velocity — Spending pace analysis",
            "  /summary — Monthly summary report",
            "",
            "➕ *Adding*",
            "  /add \\[amount] \\[merchant] — Add expense",
            "  /cash \\[amount] \\[merchant] — Add cash expense",
            "  /income \\[amount] \\[desc] — Add income",
            "",
            "⚙ *Management*",
            "  /recategorize — Change transaction category",
            "  /delete <id> — Delete a transaction",
            "  /edit <id> — Edit a transaction field",
            "  /menu — Quick action buttons",
        ]
        text = "\n".join(lines)
        try:
            await update.message.reply_text(text, parse_mode="Markdown")
        except Exception:
            await update.message.reply_text(text)

    async def _dashboard(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if self.dashboard_url:
            await update.message.reply_text(f"Open dashboard: {self.dashboard_url}")
        else:
            await update.message.reply_text("Dashboard URL not configured.")

    async def _unknown(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_text(
            "Didn't catch that. Try /add $12.50 Coffee Starbucks or /help."
        )

    async def _handle_nl_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Reuse recorded drafts before optionally parsing new natural-language input."""
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        text = update.message.text.strip()
        chat_id = self._get_chat_id(update)
        message_id = getattr(update.message, "message_id", None)
        if type(message_id) is not int:
            message_id = None
        if message_id is not None:
            try:
                previous = ctx.storage.get_telegram_draft_for_message(chat_id, message_id, text)
            except TransactionRequestConflict:
                await update.message.reply_text("This message was already handled. Check Activity or send a new entry.")
                return
            if previous is not None:
                await self._send_nl_draft_card(update, previous)
                return
        if not self.llm_service:
            await update.message.reply_text(
                "Commands start with /.\n"
                "Type /help for a full list.\n"
                "Or use /add <amount> [currency] <merchant> [category] to log a transaction."
            )
            return

        categories = [c["name"] for c in ctx.storage.get_categories()]

        parsed = self.llm_service.parse_telegram_message(text, categories, self.timezone)
        if not parsed or parsed.get("confidence", 0) < 0.7:
            await update.message.reply_text(
                "Couldn't parse that as a transaction.\n"
                "Try: *15.90 SGD Starbucks Food* or use /add for full control.",
                parse_mode="Markdown",
            )
            return

        amount = parsed.get("amount")
        if amount is None:
            await update.message.reply_text("Couldn't determine the amount. Try /add.")
            return
        currency = parsed.get("currency", "SGD")
        merchant = parsed.get("merchant", "Unknown")
        date = parsed.get("date", self._local_now().strftime("%Y-%m-%d"))
        category = parsed.get("category_hint", "Other")

        try:
            draft = ctx.storage.save_telegram_draft(secrets.token_hex(16), chat_id, {
                "amount": amount, "currency": currency,
                "merchant": merchant, "date": date, "category": category,
            }, message_id=message_id, message_text=text)
        except TransactionRequestConflict:
            await update.message.reply_text("This message was already handled. Check Activity or send a new entry.")
            return
        await self._send_nl_draft_card(update, draft)

    async def _send_nl_draft_card(self, update, draft):
        draft_id = draft["_id"]
        amount, currency, merchant = draft["amount"], draft["currency"], draft["merchant"]
        category, date = draft["category"], draft["date"]
        summary = (
            f"*{self._escape_md(merchant)}* — {self._escape_md(currency)} {amount:.2f}\n"
            f"{self._escape_md(category)}  |  {self._escape_md(date)}\nThis draft expires 24 hours after it was created."
        )
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("Add", callback_data=f"nl_confirm:{draft_id}"),
            InlineKeyboardButton("Edit", callback_data=f"nl_edit:{draft_id}"),
            InlineKeyboardButton("Cancel", callback_data=f"nl_cancel:{draft_id}"),
        ]])
        await update.message.reply_text(summary, parse_mode="Markdown", reply_markup=keyboard)

    async def _handle_nl_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle inline button responses from the NL confirmation card."""
        query = update.callback_query
        await query.answer()
        action, _, draft_id = query.data.partition(":")
        ctx = await self._require_ctx(update)
        if ctx is None:
            return
        chat_id = self._get_chat_id(update)
        pending = ctx.storage.get_telegram_draft(draft_id, chat_id) if draft_id else None
        if pending is None:
            await query.edit_message_text("This draft is no longer available. Check Activity or send a new entry.")
            return

        if action == "nl_cancel":
            ctx.storage.discard_telegram_draft(draft_id, chat_id)
            await query.edit_message_text("Cancelled.")
            return

        if action == "nl_edit":
            ctx.storage.discard_telegram_draft(draft_id, chat_id)
            await query.edit_message_text(
                "Use /add to enter manually:\n"
                f"`/add {pending['amount']} {pending['currency']} {pending['merchant']} "
                f"{pending['category']} {pending['date']}`",
                parse_mode="Markdown",
            )
            return

        if action == "nl_confirm":
            exchange_rate = 1.0 if pending["currency"] == "SGD" else None
            if self.exchange_service and pending["currency"] != "SGD":
                exchange_rate = self.exchange_service.get_rate(pending["currency"])

            retry_markup = InlineKeyboardMarkup([[
                InlineKeyboardButton("Edit", callback_data=f"nl_edit:{draft_id}"),
                InlineKeyboardButton("Cancel", callback_data=f"nl_cancel:{draft_id}"),
            ]])
            tx_id = await self._save_manual_entry(ctx, functools.partial(query.edit_message_text, reply_markup=retry_markup),
                draft=pending, assign_to_active_trip=True,
                exchange_rate=exchange_rate,
            )
            if tx_id is None:
                return

            msg = f"Added: *{self._escape_md(pending['merchant'])}* {self._escape_md(pending['currency'])} {float(pending['amount']):.2f}"
            if pending["currency"] != "SGD":
                if exchange_rate is None or exchange_rate == 1:
                    msg += "\nSGD conversion unresolved."
                else:
                    sgd = float(pending["amount"]) * exchange_rate
                    msg += f"\n~ SGD `${sgd:.2f}` (indicative)"
            await query.edit_message_text(msg, parse_mode="Markdown")

    def notify_text(self, text: str, username: Optional[str] = None) -> None:
        """Send a plain text message. Called from background threads (e.g., APScheduler)."""
        chat_id = self._resolve_chat_id(username)
        if not chat_id:
            logger.info("Cannot send notification: no chat_id registered (user must send /start)")
            return
        if not self._loop or not self.app:
            logger.debug("Cannot send text: bot not started yet")
            return
        fut = asyncio.run_coroutine_threadsafe(
            self.app.bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown"),
            self._loop,
        )
        fut.add_done_callback(
            lambda f: logger.error("notify_text send failed: %s", f.exception()) if f.exception() else None
        )

    def notify_transaction(self, tx_id: int, amount: float, merchant: str, category: Optional[str], match_source: str, source: str, username: Optional[str] = None):
        """Send a transaction notification. Called from the Gmail poller thread."""
        chat_id = self._resolve_chat_id(username)
        if not chat_id:
            logger.info("Cannot send notification: no chat_id registered (user must send /start)")
            return
        if not self._loop or not self.app:
            raise RuntimeError("Telegram bot not started")
        # Resolve the correct storage for this notification
        storage = self.storage
        if username and self.user_manager:
            ctx = self.user_manager.get(username)
            if ctx:
                storage = ctx.storage
        fut = asyncio.run_coroutine_threadsafe(
            self._async_notify(tx_id, amount, merchant, category, match_source, source, chat_id, storage),
            self._loop,
        )
        return fut

    def notify_subscription_suggestion(self, username: str, merchant: str, frequency: str, avg_amount: float):
        """Suggest adding a detected recurring pattern as a subscription. Thread-safe bridge."""
        chat_id = self._resolve_chat_id(username)
        if not chat_id:
            return
        if not self._loop or not self.app:
            raise RuntimeError("Telegram bot not started")
        fut = asyncio.run_coroutine_threadsafe(
            self._async_notify_subscription_suggestion(chat_id, merchant, frequency, avg_amount),
            self._loop,
        )
        return fut

    async def _async_notify_subscription_suggestion(
        self, chat_id: int, merchant: str, frequency: str, avg_amount: float
    ) -> None:
        # Truncate merchant to stay within Telegram's 64-byte callback_data limit:
        # "sub_suggest_add|{frequency}|" is at most 30 chars, leaving 34 for merchant.
        merchant_trunc = merchant[:34]
        text = (
            f"🔄 Recurring pattern: *{self._escape_md(merchant)}* charged "
            f"~${avg_amount:.2f} ({frequency})\\. Add as subscription?"
        )
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("Add subscription", callback_data=f"sub_suggest_add|{frequency}|{merchant_trunc}"),
                InlineKeyboardButton("Dismiss", callback_data="sub_suggest_dismiss"),
            ]
        ])
        await self.app.bot.send_message(
            chat_id=chat_id,
            text=text,
            parse_mode="MarkdownV2",
            reply_markup=keyboard,
        )

    async def _handle_sub_suggest_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        data = query.data or ""

        if data == "sub_suggest_dismiss":
            await query.edit_message_text("Dismissed.")
            return

        if data.startswith("sub_suggest_add|"):
            parts = data.split("|", 2)
            if len(parts) < 3:
                await query.edit_message_text("Could not parse suggestion — please add manually via the app.")
                return
            _, frequency, merchant = parts
            ctx = await self._require_ctx(update)
            if ctx is None:
                return
            try:
                ctx.storage.create_subscription(merchant=merchant, frequency=frequency)
                await query.edit_message_text(
                    f"✅ Added *{self._escape_md(merchant)}* \\({frequency}\\) as a subscription\\. "
                    f"Open the app to set billing day and other details\\.",
                    parse_mode="MarkdownV2",
                )
            except Exception as e:
                logger.error("Failed to create subscription from suggestion: %s", e)
                await query.edit_message_text("Failed to add subscription — try adding it manually in the app.")

    async def _async_notify(self, tx_id: int, amount: float, merchant: str, category: Optional[str], match_source: str, source: str, chat_id: Optional[int] = None, storage=None) -> None:
        _chat_id = chat_id if chat_id is not None else self.chat_id
        _storage = storage if storage is not None else self.storage
        loop = asyncio.get_running_loop()
        icon_map = await loop.run_in_executor(None, _storage.get_category_icon_map)
        tx = await loop.run_in_executor(None, _storage.get_transaction, tx_id)
        # For Apple Wallet, show the card name stored in description
        if source == "apple_wallet":
            _desc = (tx.get("description") or "") if tx else ""
            source_label = _desc if _desc.startswith("Apple Wallet") else SOURCE_LABELS.get(source, source)
        else:
            source_label = SOURCE_LABELS.get(source, source)

        if tx and tx.get("type") == "income":
            # Income/credit: distinct "Received" notification, no category picker
            currency = str(tx.get("currency", "SGD"))
            rate = float(tx.get("exchange_rate") or 1.0)
            tx_date = _fmt_tx_date(tx.get("transaction_date"))
            lines = [f"💰 *Received* · {self._escape_md(merchant)}"]
            if currency != "SGD" and rate != 1.0:
                sgd = amount * rate
                lines.append(f"`+${sgd:.2f} SGD` `({currency} {amount:.2f})` · {self._escape_md(source_label)}")
            else:
                lines.append(f"`+${amount:.2f} {currency}` · {self._escape_md(source_label)}")
            lines.append(f"_{tx_id} · {tx_date}_")
            await self.app.bot.send_message(chat_id=_chat_id, text="\n".join(lines), parse_mode="Markdown")
        elif category and match_source != "default":
            text = self._format_tx_block(tx, icon_map)
            # Append trip context if trips are active
            if _storage.get_setting("trips_enabled", "false") == "true":
                active_trip = _storage.get_active_trip()
                if active_trip:
                    summary = _storage.get_trip_summary(active_trip["id"])
                    if summary:
                        from datetime import datetime as _dt
                        start_dt = _dt.strptime(active_trip["start_date"], "%Y-%m-%d")
                        day_num = (self._local_now().date() - start_dt.date()).days + 1
                        text += f"\n\n✈️ {active_trip['name']} · Trip total: S${summary['total_sgd']:.2f} (Day {day_num})"
            await self.app.bot.send_message(chat_id=_chat_id, text=text, parse_mode="Markdown")
        else:
            categories = _storage.get_categories()
            buttons = []
            row = []
            for cat in categories:
                row.append(InlineKeyboardButton(
                    f"{cat['icon']} {cat['name']}",
                    callback_data=f"cat:{tx_id}:{cat['name']}",
                ))
                if len(row) == 2:
                    buttons.append(row)
                    row = []
            if row:
                buttons.append(row)
            keyboard = InlineKeyboardMarkup(buttons)
            text = f"💸 *${amount:.2f}* at *{self._escape_md(merchant)}*\n{self._escape_md(source_label)} · Pick a category:"
            await self.app.bot.send_message(
                chat_id=_chat_id,
                text=text,
                parse_mode="Markdown",
                reply_markup=keyboard,
            )

        # Budget alert check — income transactions don't trigger budget alerts
        if tx and tx.get("type") != "income":
            try:
                _sgd = tx["amount"] * (tx.get("exchange_rate") or 1.0)
                await self._check_and_alert_budgets(category, _sgd, _storage, chat_id=_chat_id)
            except Exception as _e:
                logger.warning("Budget alert check failed: %s", _e)

    def _build_context_line(self, category: str, merchant: str, amount: float) -> str:
        """Returns a one-line contextual note for the post-add confirmation, or ''."""
        # 1. Budget threshold ≥ 75%
        try:
            progress = self.storage.get_budget_progress()
            for b in progress:
                if b["category"] == category:
                    pct = b["percent"]
                    if pct >= 100:
                        overage = b["spent"] - b["budget_amount"]
                        return f"Over budget by {overage:.0f}."
                    if pct >= 75:
                        remaining = b["remaining"]
                        return f"Budget {pct:.0f}% used — {remaining:.0f} left this month."
        except Exception:
            pass

        # 2. Repeat merchant ≥ 3 times this week (including this transaction)
        try:
            week_start = (self._local_now() - timedelta(days=7)).strftime("%Y-%m-%d")
            today = self._local_now().strftime("%Y-%m-%d")
            rows = self.storage.query_transactions(
                start_date=week_start,
                end_date=today,
                merchant_search=merchant,
                limit=1000,
            )
            # Exact merchant match (query_transactions uses LIKE; filter exactly)
            exact = [r for r in rows if r.get("merchant") == merchant]
            count = len(exact) + 1  # +1 for the current transaction
            if count >= 3:
                return f"{merchant} — {count}× this week."
        except Exception:
            pass

        # 3. Anomaly ≥ 2× category median (last 30 days, minimum 3 prior)
        try:
            thirty_days_ago = (self._local_now() - timedelta(days=30)).strftime("%Y-%m-%d")
            today = self._local_now().strftime("%Y-%m-%d")
            prior = self.storage.query_transactions(
                start_date=thirty_days_ago,
                end_date=today,
                category=category,
                limit=1000,
            )
            if len(prior) >= 3:
                amounts = sorted(r["amount"] * (r.get("exchange_rate") or 1.0) for r in prior)
                n = len(amounts)
                mid = n // 2
                median = amounts[mid] if n % 2 == 1 else (amounts[mid - 1] + amounts[mid]) / 2
                if median > 0 and amount >= 2 * median:
                    multiple = amount / median
                    return f"Unusual — {multiple:.1f}× the usual {category} spend."
        except Exception:
            pass

        return ""

    def _build_pace_note_daily(self, spent: float, daily_budget: float) -> str:
        if daily_budget <= 0:
            return ""
        pct = spent / daily_budget * 100
        if pct <= 50:
            return "On track."
        elif pct <= 90:
            return f"Pacing {pct:.0f}% of daily budget."
        elif pct <= 100:
            return "Nearly at daily limit."
        else:
            overage = spent - daily_budget
            return f"Over daily by ${overage:.2f}."

    def _build_pace_note_weekly(self, spent: float, weekly_budget: float, days_elapsed: int) -> str:
        if weekly_budget <= 0 or days_elapsed <= 0:
            return ""
        expected = (weekly_budget / 7) * days_elapsed
        pct = spent / expected * 100 if expected > 0 else 0
        if pct <= 90:
            return "On track for the week."
        elif pct <= 110:
            return "Tracking roughly on budget."
        else:
            return f"Running {pct:.0f}% of expected weekly pace."

    async def _check_and_alert_budgets(
        self, category: Optional[str], amount_sgd: float, storage=None, chat_id: Optional[int] = None
    ) -> None:
        """Check budget thresholds and send alerts if a 80% or 100% boundary was just crossed.

        Called at the end of _async_notify after every ingested transaction.
        """
        _storage = storage if storage is not None else self.storage
        if _storage.get_setting("budgets_enabled", "false") != "true":
            return
        _chat_id = chat_id if chat_id is not None else self.chat_id
        if not _chat_id or not self.app:
            return

        progress = _storage.get_budget_progress()
        for b in progress:
            # Only check the overall budget and the budget matching this transaction's category
            is_overall = b["category"] is None
            is_matching = b["category"] == category
            if not is_overall and not is_matching:
                continue

            current_pct = b["percent"]
            prior_spent = b["spent"] - amount_sgd
            prior_pct = (
                round(prior_spent / b["budget_amount"] * 100, 1)
                if b["budget_amount"] > 0
                else 0.0
            )

            # Derive current from prior + new amount in case tx not yet in DB
            current_spent = b["spent"] + amount_sgd
            current_pct_calc = (
                round(current_spent / b["budget_amount"] * 100, 1)
                if b["budget_amount"] > 0
                else 0.0
            )
            # Use whichever current is higher (covers both: tx in DB or not yet)
            effective_current = max(current_pct, current_pct_calc)
            effective_prior = min(prior_pct, b["percent"])

            label = b["label"]
            period_word = "month" if b["period"] == "monthly" else "week"

            if effective_prior < 100 <= effective_current:
                display_spent = max(b["spent"], current_spent)
                overage = display_spent - b["budget_amount"]
                msg = (
                    f"🚨 *Budget Exceeded — {label}*\n"
                    f"You've spent ${display_spent:.2f} of your ${b['budget_amount']:.2f} "
                    f"{b['period']} budget.\n"
                    f"${overage:.2f} over budget this {period_word}."
                )
                await self.app.bot.send_message(
                    chat_id=_chat_id, text=msg, parse_mode="Markdown"
                )
            elif effective_prior < 80 <= effective_current < 100:
                display_spent = max(b["spent"], current_spent)
                display_remaining = b["budget_amount"] - display_spent
                msg = (
                    f"⚠️ *Budget Alert — {label}*\n"
                    f"You've spent ${display_spent:.2f} of your ${b['budget_amount']:.2f} "
                    f"{b['period']} budget ({effective_current:.0f}%).\n"
                    f"${display_remaining:.2f} remaining for the rest of the {period_word}."
                )
                await self.app.bot.send_message(
                    chat_id=_chat_id, text=msg, parse_mode="Markdown"
                )

    async def _apply_category_update(self, tx_id: int, category: str, query, storage=None) -> None:
        """Update this transaction only; future matching requires explicit --remember."""
        _storage = storage if storage is not None else self.storage
        loop = asyncio.get_running_loop()
        tx = await loop.run_in_executor(None, _storage.get_transaction, tx_id)
        if not tx:
            await query.edit_message_text("Transaction not found.")
            return
        await loop.run_in_executor(None, functools.partial(_storage.update_transaction, tx_id, category=category))
        icon_map = await loop.run_in_executor(None, _storage.get_category_icon_map)
        updated_tx = await loop.run_in_executor(None, _storage.get_transaction, tx_id)
        await query.edit_message_text(
            self._format_tx_block(updated_tx, icon_map)
            + f"\n\nThis transaction only. To remember its current category for future purchases:\n/recategorize {tx_id} --remember",
            parse_mode="Markdown",
        )

    async def _category_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        if not query.data.startswith("cat:"):
            return
        _, tx_id_str, category = query.data.split(":", 2)
        cb_ctx = await self._require_ctx(update)
        storage = cb_ctx.storage if cb_ctx else None
        await self._apply_category_update(int(tx_id_str), category, query, storage=storage)

    async def _recat_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        if not query.data.startswith("recat:"):
            return
        _, tx_id_str, category = query.data.split(":", 2)
        cb_ctx = await self._require_ctx(update)
        storage = cb_ctx.storage if cb_ctx else None
        await self._apply_category_update(int(tx_id_str), category, query, storage=storage)

    async def _cmd_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        data = query.data

        if not data or not data.startswith("cmd_"):
            return

        handler_map = {
            "cmd_today": self._today,
            "cmd_yesterday": self._yesterday,
            "cmd_week": self._week,
            "cmd_insights": self._insights,
            "cmd_balance": self._balance,
            "cmd_compare": self._compare,
            "cmd_merchants": self._merchants,
            "cmd_velocity": self._velocity,
            "cmd_summary": self._summary,
            "cmd_menu": self._menu,
            "cmd_cash": self._cash,
            "cmd_subscriptions": self._subscriptions,
            "cmd_add": self._add,
            "cmd_income": self._income,
        }

        handler = handler_map.get(data)
        if not handler:
            return

        # Update is frozen in python-telegram-bot v21+ — build a lightweight
        # stand-in with a .message that supports reply_text via bot.send_message.
        chat_id = (
            query.message.chat_id
            if query.message and hasattr(query.message, "chat_id")
            else (self.chat_id or query.from_user.id)
        )
        proxy_update = SimpleNamespace(message=_ReplyProxy(context.bot, chat_id))
        try:
            await handler(proxy_update, context)
        except Exception as e:
            logger.error("Error handling callback %s: %s", data, e, exc_info=True)
            try:
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="Something went wrong processing that action. Try the command directly instead.",
                )
            except Exception:
                pass

    async def _menu(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📅 Today", callback_data="cmd_today"),
                InlineKeyboardButton("📆 Week", callback_data="cmd_week"),
            ],
            [
                InlineKeyboardButton("📊 Insights", callback_data="cmd_insights"),
                InlineKeyboardButton("📋 Balance", callback_data="cmd_balance"),
            ],
            [
                InlineKeyboardButton("🔄 Subscriptions", callback_data="cmd_subscriptions"),
                InlineKeyboardButton("📈 Compare", callback_data="cmd_compare"),
            ],
            [
                InlineKeyboardButton("➕ Add", callback_data="cmd_add"),
                InlineKeyboardButton("💰 Income", callback_data="cmd_income"),
            ],
        ])
        await update.message.reply_text(
            "*Quick Actions*",
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    async def _send_daily_digest(self, chat_id: Optional[int] = None, storage=None) -> None:
        """Send morning digest: yesterday's total, month-to-date, any alerts."""
        _chat_id = chat_id if chat_id is not None else self.chat_id
        _storage = storage if storage is not None else self.storage
        if not _chat_id:
            logger.debug("Cannot send daily digest: no chat_id")
            return

        _now = self._local_now()
        yesterday = (_now - timedelta(days=1)).strftime("%Y-%m-%d")
        today = _now.strftime("%Y-%m-%d")

        # Yesterday's total — use get_spending_summary to handle NULL-type rows correctly
        yesterday_summary = _storage.get_spending_summary(yesterday, yesterday)
        yesterday_total = yesterday_summary["total"]
        yesterday_count = len(_storage.query_transactions(start_date=yesterday, end_date=yesterday, limit=10_000))

        # Month to date
        month_start = _now.replace(day=1).strftime("%Y-%m-%d")
        month_total = _storage.get_spending_summary(month_start, today)["total"]

        # Velocity, new merchants, anomalies
        velocity = _storage.spending_velocity()
        new_merchants_list = _storage.new_merchants()
        anomaly_multiplier = float(_storage.get_setting("anomaly_multiplier", "2.0"))
        anomalies = _storage.spending_anomalies(multiplier=anomaly_multiplier)

        lines = [
            "*Morning Digest*\n",
            f"Yesterday: *${yesterday_total:.2f}* ({yesterday_count} transactions)",
            f"Month to date: *${month_total:.2f}*\n",
        ]

        velocity_threshold = float(_storage.get_setting("velocity_alert_threshold", "110"))
        if velocity["pace_percent"] > velocity_threshold:
            lines.append(f"⚠ Spending {velocity['pace_percent']:.0f}% of last month's pace")

        if new_merchants_list:
            lines.append(f"🛍 {len(new_merchants_list)} new merchant(s)")

        if anomalies:
            lines.append(f"⚠ {len(anomalies)} unusual transaction(s)")

        # LLM insight — append if cached and fresh
        insight_str = _storage.get_setting("llm_insight_content", "")
        if insight_str:
            try:
                insight = json.loads(insight_str)
                narrative = insight.get("narrative", "")
                nudges = insight.get("nudges", [])
                if narrative:
                    lines.append("\n*AI Insight*")
                    lines.append(narrative)
                    if nudges:
                        lines.append("\n" + "\n".join(f"• {n}" for n in nudges))
            except Exception:
                pass

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📊 Insights", callback_data="cmd_insights"),
                InlineKeyboardButton("📋 Balance", callback_data="cmd_balance"),
            ],
        ])

        await self.app.bot.send_message(
            chat_id=_chat_id,
            text="\n".join(lines),
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    def _resolve_poller(self, update):
        """Return the GmailPoller for the sending user (multi-user) or self.poller (legacy)."""
        if self.user_manager:
            chat_id = self._get_chat_id(update)
            ctx = self.user_manager.get_by_chat_id(chat_id) if chat_id else None
            return ctx.poller if ctx else None
        return self.poller

    async def _reauth(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        poller = self._resolve_poller(update)
        if not poller or not self.oauth_redirect_uri:
            await update.message.reply_text("Gmail not configured.")
            return
        settings_url = self.oauth_redirect_uri.rsplit("/oauth/callback", 1)[0] + "/settings"
        await update.message.reply_text(
            f"Reconnect Gmail from Connections in Settings (sign in first):\n{settings_url}",
            disable_web_page_preview=True,
        )

    async def _forcepoll(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        poller = self._resolve_poller(update)
        if not poller:
            await update.message.reply_text("Gmail not configured.")
            return
        if not poller.service:
            await update.message.reply_text("Gmail not authenticated. Use /reauth first.")
            return
        await update.message.reply_text("Checking Gmail for new emails.")
        try:
            count = poller.force_poll()
            if count == 0:
                await update.message.reply_text("No new transactions found.")
            else:
                await update.message.reply_text(f"{count} new transaction(s) captured.")
        except Exception as e:
            await update.message.reply_text(f"Poll failed: {e}")

    def notify_daily_digest(self, username: Optional[str] = None) -> None:
        """Schedule daily digest send. Called from APScheduler background thread."""
        chat_id = self._resolve_chat_id(username)
        if not chat_id:
            logger.info("Cannot send daily digest: no chat_id registered (user must send /start)")
            return
        if not self._loop or not self.app:
            logger.debug("Cannot send daily digest: bot not started")
            return
        # Resolve per-user storage if in multi-user mode
        storage = self.storage
        if username and self.user_manager:
            ctx = self.user_manager.get(username)
            if ctx:
                storage = ctx.storage
        if storage is None:
            logger.warning("Cannot send daily digest: no storage resolved for user %r", username)
            return
        fut = asyncio.run_coroutine_threadsafe(
            self._send_daily_digest(chat_id=chat_id, storage=storage),
            self._loop,
        )
        fut.add_done_callback(
            lambda f: logger.error("notify_daily_digest send failed: %s", f.exception()) if f.exception() else None
        )
