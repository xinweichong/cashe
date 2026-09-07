import calendar
import functools
import hashlib
import re
import json
import sqlite3
import threading
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone, date
from typing import Optional

from src.config import local_now
from src.transaction_validation import normalize_transaction_fields

_VALID_TYPES: frozenset[str] = frozenset({"needs", "wants", "neutral"})


def _locked(method):
    """Serialize method calls on the instance's RLock to prevent concurrent SQLite access."""
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return wrapper


def _get_budget_period(period: str) -> tuple[str, str]:
    """Return (start_date, end_date) for the current budget period as ISO strings."""
    today = local_now().date()
    if period == "monthly":
        return today.replace(day=1).isoformat(), today.isoformat()
    elif period == "weekly":
        monday = today - timedelta(days=today.weekday())
        return monday.isoformat(), today.isoformat()
    raise ValueError(f"Unknown period '{period}'. Must be 'monthly' or 'weekly'.")


class TransactionRequestConflict(ValueError):
    """A creation key was already accepted for a different or deleted purchase."""


class Storage:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        # The service worker must not hold the DB lock while waiting on Telegram.
        self.outbox_dispatch_lock = threading.Lock()

    @_locked
    def get_month_spending_facts(self, as_of=None, timezone="Asia/Singapore") -> dict:
        from src.spending_facts import month_facts
        return month_facts(self._conn, as_of, timezone)

    @_locked
    def get_week_spending_facts(self, as_of=None, timezone="Asia/Singapore") -> dict:
        from src.spending_facts import week_facts
        return week_facts(self._conn, as_of, timezone)

    @_locked
    def get_spending_evidence(self, start, end, **filters) -> dict:
        from src.spending_facts import spending_evidence
        return spending_evidence(self._conn, start, end, **filters)

    @_locked
    def get_home_briefing(self, timezone="Asia/Singapore") -> dict:
        from src.spending_facts import convert_legacy_sgd, money
        today = local_now(timezone).date()
        facts = self.get_month_spending_facts(today, timezone)
        recent = []
        for row in self.query_transactions(limit=5):
            minor, status = convert_legacy_sgd(row)
            recent.append({
                "id": row["id"], "merchant": row["merchant"], "category": row["category"] or "Other",
                "type": row["type"] or "expense", "date": row["transaction_date"],
                "amount": money(minor) if minor is not None else None, "conversion_status": status,
            })
        upcoming = []
        if self.get_setting("subscriptions_enabled", "false") == "true":
            for row in self._conn.execute(
                """SELECT u.id, u.expected_date, u.expected_amount, s.id AS subscription_id,
                          COALESCE(s.label, s.merchant) AS label
                   FROM upcoming_transactions u JOIN subscriptions s ON s.id = u.subscription_id
                   WHERE u.status = 'pending' AND u.matched_transaction_id IS NULL
                   AND s.status IN ('active', 'possibly_cancelled')
                   AND DATE(u.expected_date) >= ? AND DATE(u.expected_date) <= ?
                   ORDER BY u.expected_date, u.id""",
                (today.isoformat(), (today + timedelta(days=13)).isoformat()),
            ):
                minor, _ = convert_legacy_sgd({"amount": row["expected_amount"], "currency": "SGD"})
                upcoming.append({"id": row["id"], "subscription_id": row["subscription_id"],
                                 "label": row["label"], "date": row["expected_date"],
                                 "amount": money(minor) if minor is not None else None})
        return {
            "facts": facts, "recent": recent, "upcoming": upcoming,
            "upcoming_total": money(sum(item["amount"]["minor_units"] for item in upcoming if item["amount"])),
            "upcoming_unknown_count": sum(item["amount"] is None for item in upcoming),
            "capture_issue_count": self._conn.execute("SELECT COUNT(*) FROM source_events WHERE status != 'processed'").fetchone()[0],
            "followup_issue_count": self._conn.execute("SELECT COUNT(*) FROM ingestion_outbox WHERE status != 'done'").fetchone()[0],
        }

    @_locked
    def get_spending_review(self, *, timezone="Asia/Singapore", limit=50, offset=0) -> dict:
        from src.spending_facts import spending_review
        return spending_review(self._conn, timezone=timezone, limit=limit, offset=offset)

    @contextmanager
    def reconciliation_lock(self):
        """Serialize check-and-insert across the user's Wallet and Gmail inputs."""
        with self._lock:
            yield

    @_locked
    def get_transaction_provenance(self, tx_id: int) -> dict:
        """Summarize retained evidence without exposing observation identifiers/payloads."""
        tx = self._conn.execute("SELECT source FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        if tx is None:
            raise ValueError("Transaction not found")

        def channel(source):
            if source in {"apple_wallet", "wallet_request"}:
                return "apple_wallet"
            if source in {"gmail", "dbs_paylah", "uob_card", "uob_paynow", "uob_paynow_sent",
                          "uob_transfer", "uob_nets"}:
                return "gmail"
            return source if source in {"manual", "cash"} else "other"

        # Raw and parsed observations describe the same input, not separate purchases.
        sources = {channel(tx["source"]): False}
        for row in self._conn.execute(
            "SELECT DISTINCT source FROM source_events WHERE transaction_id = ? AND status = 'processed'",
            (tx_id,),
        ):
            sources[channel(row["source"])] = True
        return {"transaction_id": tx_id, "sources": [
            {"channel": name, "evidence_recorded": recorded}
            for name, recorded in sorted(sources.items())
        ]}

    @_locked
    def record_source_event(self, source: str, source_id: str, payload: str,
                            parser_version: str = "1", *, timestamp_precision: str = "unknown",
                            payment_identity_kind: Optional[str] = None,
                            payment_identity: Optional[str] = None) -> dict:
        self._conn.execute(
            """INSERT OR IGNORE INTO source_events
               (source, source_id, payload, parser_version, timestamp_precision,
                payment_identity_kind, payment_identity) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (source, source_id, payload, parser_version, timestamp_precision,
             payment_identity_kind, payment_identity),
        )
        self._conn.commit()
        return self.get_source_event(source, source_id)

    @_locked
    def get_source_event(self, source: str, source_id: str) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM source_events WHERE source = ? AND source_id = ?",
            (source, source_id),
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def finish_source_event(self, event_id: int, status: str,
                            transaction_id: Optional[int] = None,
                            error_code: Optional[str] = None) -> None:
        self._conn.execute(
            """UPDATE source_events SET status = ?, transaction_id = ?, error_code = ?,
               attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (status, transaction_id, error_code, event_id),
        )
        self._conn.commit()

    @_locked
    def pending_source_events(self, source: Optional[str], limit: int = 100) -> list[dict]:
        return [dict(row) for row in self._conn.execute(
            """SELECT * FROM source_events WHERE (source = ? OR (? IS NULL AND source != 'gmail'))
               AND status IN ('pending', 'failed') AND attempts < 5
               ORDER BY attempts, id LIMIT ?""", (source, source, limit),
        ).fetchall()]

    @_locked
    def get_transaction_by_source_id(self, source_id: str) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM transactions WHERE source_id = ?", (source_id,),
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def authorize_wallet(self, token_digest: Optional[str]) -> bool:
        expected = self.get_setting("wallet_credential_hash", "")
        if token_digest is not None:
            if not expected or not secrets.compare_digest(expected, token_digest):
                return False
            # First successful authenticated request completes the guided upgrade.
            self.set_setting("wallet_auth_required", "true")
            return True
        return self.get_setting("wallet_auth_required", "false") != "true"

    @_locked
    def revoke_wallet_credential(self) -> None:
        with self._conn:
            for key, value in (("wallet_credential_hash", ""), ("wallet_auth_required", "true")):
                self._conn.execute(
                    """INSERT INTO app_settings(key, value) VALUES (?, ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value""", (key, value),
                )

    @_locked
    def list_capture_issues(self, limit: int = 50, offset: int = 0) -> list[dict]:
        return [dict(row) for row in self._conn.execute(
            """SELECT id, source, parser_version, status, transaction_id, attempts,
                      error_code, created_at, updated_at
               FROM source_events WHERE status != 'processed'
               ORDER BY id DESC LIMIT ? OFFSET ?""", (limit, offset),
        ).fetchall()]

    @_locked
    def retry_source_event(self, event_id: int) -> None:
        row = self._conn.execute("SELECT status FROM source_events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise ValueError("Source event not found")
        if row["status"] == "processed":
            raise ValueError("Source event already processed")
        self._conn.execute(
            """UPDATE source_events SET status = 'pending', attempts = 0, error_code = NULL,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?""", (event_id,),
        )
        self._conn.commit()

    @_locked
    def insert_transaction(
        self,
        source: str,
        source_id: str,
        amount: float,
        merchant: Optional[str] = None,
        description: Optional[str] = None,
        category: Optional[str] = None,
        currency: str = "SGD",
        exchange_rate: float = 1.0,
        transaction_date: Optional[str] = None,
        raw_data: Optional[str] = None,
        tx_type: str = "expense",
        followups: Optional[list[tuple[str, dict]]] = None,
        manual_evidence: Optional[str] = None,
        request_receipt: Optional[tuple[str, str]] = None,
    ) -> int:
        try:
            with self._conn:
                cursor = self._conn.execute(
                    """INSERT INTO transactions
                       (source, source_id, amount, currency, exchange_rate, merchant, description,
                        category, transaction_date, raw_data, type)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (source, source_id, amount, currency, exchange_rate, merchant, description,
                     category, transaction_date, raw_data, tx_type),
                )
                tx_id = cursor.lastrowid
                for kind, payload in followups or []:
                    self._conn.execute(
                        "INSERT INTO ingestion_outbox(transaction_id, kind, payload) VALUES (?, ?, ?)",
                        (tx_id, kind, json.dumps(payload)),
                    )
                if manual_evidence is not None:
                    # These processed snapshots are not replayable ParseResults.
                    # Keep default unknown precision: entry time may be generated.
                    self._conn.execute(
                        """INSERT INTO source_events
                           (source, source_id, payload, parser_version, status, transaction_id, attempts)
                           VALUES (?, ?, ?, 'manual:1', 'processed', ?, 1)""",
                        (source, source_id, manual_evidence, tx_id),
                    )
                if request_receipt is not None:
                    self._conn.execute(
                        "INSERT INTO transaction_requests(request_key, fingerprint, transaction_id) VALUES (?, ?, ?)",
                        (*request_receipt, tx_id),
                    )
            return tx_id
        except sqlite3.IntegrityError:
            if (self.get_transaction_by_source_id(source_id) is not None
                    or (manual_evidence is not None and self.get_source_event(source, source_id) is not None)):
                raise ValueError(f"duplicate source_id: {source_id}") from None
            raise

    @_locked
    def pending_ingestion_effects(self, transaction_id: Optional[int] = None, limit: int = 100) -> list[dict]:
        return [dict(row) for row in self._conn.execute(
            """SELECT * FROM ingestion_outbox WHERE status IN ('pending', 'failed') AND attempts < 5
               AND (? IS NULL OR transaction_id = ?) ORDER BY id LIMIT ?""",
            (transaction_id, transaction_id, limit),
        ).fetchall()]

    @_locked
    def list_ingestion_effects(self, limit: int = 50, offset: int = 0) -> list[dict]:
        return [dict(row) for row in self._conn.execute(
            """SELECT id, transaction_id, kind, status, attempts, error_code, created_at, updated_at
               FROM ingestion_outbox WHERE status != 'done' ORDER BY id DESC LIMIT ? OFFSET ?""", (limit, offset),
        ).fetchall()]

    @_locked
    def retry_ingestion_effect(self, effect_id: int) -> None:
        row = self._conn.execute("SELECT status FROM ingestion_outbox WHERE id = ?", (effect_id,)).fetchone()
        if row is None:
            raise ValueError("Follow-up not found")
        if row["status"] == 'done':
            raise ValueError("Follow-up already completed")
        self._conn.execute(
            """UPDATE ingestion_outbox SET status = 'pending', attempts = 0, error_code = NULL,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?""", (effect_id,),
        )
        self._conn.commit()

    @_locked
    def finish_ingestion_effect(self, effect_id: int, *, error_code: Optional[str] = None,
                                suggestion: Optional[dict] = None) -> None:
        with self._conn:
            if suggestion is not None:
                self._conn.execute(
                    """INSERT OR IGNORE INTO ingestion_outbox(transaction_id, kind, payload)
                       SELECT transaction_id, 'suggestion', ? FROM ingestion_outbox WHERE id = ?""",
                    (json.dumps(suggestion), effect_id),
                )
            self._conn.execute(
                """UPDATE ingestion_outbox SET status = ?, attempts = attempts + 1,
                   error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                ('failed' if error_code else 'done', error_code, effect_id),
            )

    @_locked
    def get_transaction(self, tx_id: int) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def create_web_transaction(self, body: dict, *, source_id: str, request_key=None,
                               timezone="Asia/Singapore") -> dict:
        # Fingerprint submitted fields before generating defaults (especially time).
        # Keys are scoped by the per-user database and retained after deletion.
        receipt = None
        if request_key is not None:
            if not isinstance(request_key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_key):
                raise ValueError("Invalid Idempotency-Key")
            receipt, previous = self._transaction_request(request_key, body)
            if previous is not None:
                return previous
        tx_id = self.create_manual_transaction(
            source_id=source_id, source=body.get("source", "manual"), amount=body.get("amount"),
            merchant=body.get("merchant"), description=body.get("description"), category=body.get("category"),
            currency=body.get("currency", "SGD"), exchange_rate=body.get("exchange_rate"),
            transaction_date=body.get("transaction_date", local_now(timezone).strftime("%Y-%m-%dT%H:%M:%S")),
            tx_type=body.get("type", "expense"), _request_receipt=receipt,
        )
        return self.get_transaction(tx_id)

    def _transaction_request(self, request_key: str, submitted):
        """Look up a receipt while the calling command holds the Storage lock."""
        fingerprint = hashlib.sha256(json.dumps(
            submitted, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        ).encode()).hexdigest()
        previous = self._conn.execute(
            "SELECT fingerprint, transaction_id FROM transaction_requests WHERE request_key = ?",
            (request_key,),
        ).fetchone()
        tx = None
        if previous:
            if previous["fingerprint"] != fingerprint:
                raise TransactionRequestConflict("This request key was already used with different fields")
            tx = self.get_transaction(previous["transaction_id"])
            if tx is None:
                raise TransactionRequestConflict("The transaction created by this request was deleted")
        return (request_key, fingerprint), tx

    @_locked
    def create_manual_transaction(self, *, source_id: str, amount, transaction_date,
                                  source="manual", currency="SGD", exchange_rate=None,
                                  merchant=None, description=None, category=None,
                                  tx_type="expense", assign_to_active_trip=False,
                                  _request_receipt=None) -> int:
        if source not in ("manual", "cash"):
            raise ValueError("Manual source must be manual or cash")
        if tx_type not in ("expense", "income"):
            raise ValueError("Manual type must be expense or income")
        for value in (merchant, description, category):
            if value is not None and not isinstance(value, str):
                raise ValueError("Merchant, description, and category must be text")
        fields = normalize_transaction_fields({
            "amount": amount, "currency": currency, "exchange_rate": exchange_rate,
            "transaction_date": transaction_date, "type": tx_type,
        })
        if fields["currency"] == "SGD":
            fields["exchange_rate"] = 1.0
        # Retain accepted command fields, not raw Telegram text or request headers.
        # Numeric strings preserve submitted representation before normalization.
        evidence = json.dumps({
            "kind": "manual_entry", "amount": str(amount), "currency": currency,
            "exchange_rate": str(exchange_rate) if exchange_rate is not None else None,
            "transaction_date": transaction_date, "merchant": merchant,
            "description": description, "category": category, "type": tx_type,
        })
        fields["tx_type"] = fields.pop("type")
        followups = []
        if assign_to_active_trip and self.get_setting("trips_enabled", "false") == "true":
            active = self.get_active_trip()
            if active:
                followups.append(("trip", {"trip_id": active["id"]}))
        return self.insert_transaction(source=source, source_id=source_id, merchant=merchant,
                                       description=description, category=category, followups=followups,
                                       manual_evidence=evidence, request_receipt=_request_receipt, **fields)

    @_locked
    def update_transaction(self, tx_id: int, *, remember_category: bool = False, **fields) -> None:
        if not fields:
            return
        tx = self.get_transaction(tx_id)
        if tx is None:
            raise ValueError(f"transaction {tx_id} not found")
        fields = normalize_transaction_fields(fields)
        if "currency" in fields:
            if fields["currency"] != tx["currency"]:
                if fields["currency"] == "SGD":
                    fields["exchange_rate"] = 1.0
                elif "exchange_rate" not in fields:
                    fields["exchange_rate"] = None
        merchant = fields.get("merchant", tx.get("merchant"))
        if remember_category and (
            not isinstance(merchant, str) or not merchant.strip()
            or not isinstance(fields.get("category"), str) or not fields["category"].strip()
        ):
            raise ValueError("Remembering a category requires a merchant and category")
        set_clauses = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [tx_id]
        with self._conn:
            self._conn.execute(
                f"UPDATE transactions SET {set_clauses} WHERE id = ?", values
            )
            if remember_category:
                self._conn.execute(
                    "INSERT OR REPLACE INTO merchant_overrides (merchant, category, updated_at) "
                    "VALUES (?, ?, CURRENT_TIMESTAMP)", (merchant, fields["category"]),
                )

    @_locked
    def delete_transaction(self, tx_id: int) -> None:
        if self.get_transaction(tx_id) is None:
            raise ValueError(f"transaction {tx_id} not found")
        self._conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        self._conn.commit()

    @_locked
    def query_transactions(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
        merchant_search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        conditions = []
        params = []
        if start_date:
            conditions.append("DATE(transaction_date) >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("DATE(transaction_date) <= ?")
            params.append(end_date)
        if category:
            conditions.append("category = ?")
            params.append(category)
        if source:
            conditions.append("source = ?")
            params.append(source)
        if merchant_search:
            conditions.append("merchant LIKE ?")
            params.append(f"%{merchant_search}%")
        where = " AND ".join(conditions) if conditions else "1=1"
        rows = self._conn.execute(
            f"SELECT * FROM transactions WHERE {where} "
            f"ORDER BY transaction_date DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_spending_summary(
        self, start_date: str, end_date: str
    ) -> dict:
        rows = self._conn.execute(
            """SELECT category, SUM(amount * exchange_rate) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense')
               GROUP BY category""",
            (start_date, end_date),
        ).fetchall()
        by_category = {r["category"] or "Uncategorized": r["total"] for r in rows}
        return {
            "total": sum(by_category.values()),
            "by_category": by_category,
        }

    @_locked
    def load_categories(self, categories: list[dict]) -> None:
        for cat in categories:
            self._conn.execute(
                """INSERT INTO categories (name, keywords, icon, color)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(name) DO UPDATE SET
                     keywords = excluded.keywords,
                     icon     = excluded.icon,
                     color    = excluded.color""",
                (cat["name"], cat["keywords"], cat["icon"], cat.get("color")),
            )
        self._conn.commit()

    @_locked
    def get_income_summary(self, start_date: str, end_date: str) -> dict:
        rows = self._conn.execute(
            """SELECT category, SUM(amount * exchange_rate) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND type = 'income'
               GROUP BY category""",
            (start_date, end_date),
        ).fetchall()
        by_category = {r["category"] or "Uncategorized": r["total"] for r in rows}
        return {"total": sum(by_category.values()), "by_category": by_category}

    @_locked
    def get_balance(self, start_date: str, end_date: str) -> dict:
        expenses = self.get_spending_summary(start_date, end_date)["total"]
        income = self.get_income_summary(start_date, end_date)["total"]
        return {"income": income, "expenses": expenses, "net": income - expenses}

    @_locked
    def get_merchant_ranking(self, start_date: str, end_date: str, limit: int = 10) -> list[dict]:
        rows = self._conn.execute(
            """SELECT merchant, COUNT(*) as visits, SUM(amount * exchange_rate) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND merchant IS NOT NULL AND (type IS NULL OR type = 'expense')
               GROUP BY merchant ORDER BY total DESC LIMIT ?""",
            (start_date, end_date, limit),
        ).fetchall()
        return [{"merchant": r["merchant"], "visits": r["visits"], "total": r["total"]} for r in rows]

    @_locked
    def get_average_daily(self, start_date: str, end_date: str) -> float:
        row = self._conn.execute(
            """SELECT COALESCE(SUM(amount * exchange_rate), 0) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense')""",
            (start_date, end_date),
        ).fetchone()
        total = row["total"]
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        days = max((end - start).days + 1, 1)
        return total / days

    @_locked
    def get_trend(self, start_date: str, end_date: str) -> list[dict]:
        rows = self._conn.execute(
            """SELECT DATE(transaction_date) as date, SUM(amount * exchange_rate) as amount
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense')
               GROUP BY DATE(transaction_date) ORDER BY date""",
            (start_date, end_date),
        ).fetchall()
        return [{"date": r["date"], "amount": r["amount"]} for r in rows]

    @_locked
    def get_trend_by_category(self, start_date: str, end_date: str) -> list[dict]:
        rows = self._conn.execute(
            """SELECT DATE(transaction_date) as date,
                      COALESCE(category, 'Other') as category,
                      SUM(amount * exchange_rate) as amount
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense')
               GROUP BY DATE(transaction_date), COALESCE(category, 'Other')
               ORDER BY date""",
            (start_date, end_date),
        ).fetchall()
        by_date: dict[str, dict] = {}
        all_categories: set[str] = set()
        for r in rows:
            d = r["date"]
            cat = r["category"]
            all_categories.add(cat)
            if d not in by_date:
                by_date[d] = {"date": d}
            by_date[d][cat] = round(r["amount"], 2)
        # Gap-fill: every date must have an explicit None for every category that
        # has no spend that day.  Recharts connectNulls only skips null values —
        # missing keys are treated as undefined/0 and break line continuity.
        for row in by_date.values():
            for cat in all_categories:
                if cat not in row:
                    row[cat] = None
        return list(by_date.values())

    @_locked
    def get_period_comparison(self, current_start: str, current_end: str, prev_start: str, prev_end: str) -> dict:
        curr_rows = self._conn.execute(
            """SELECT category, SUM(amount * exchange_rate) as total FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense') GROUP BY category""",
            (current_start, current_end),
        ).fetchall()
        prev_rows = self._conn.execute(
            """SELECT category, SUM(amount * exchange_rate) as total FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense') GROUP BY category""",
            (prev_start, prev_end),
        ).fetchall()
        curr_by_cat = {r["category"] or "Uncategorized": r["total"] for r in curr_rows}
        prev_by_cat = {r["category"] or "Uncategorized": r["total"] for r in prev_rows}
        return {
            "current": {"total": sum(curr_by_cat.values()), "by_category": curr_by_cat},
            "previous": {"total": sum(prev_by_cat.values()), "by_category": prev_by_cat},
        }

    @_locked
    def get_categories(self) -> list[dict]:
        rows = self._conn.execute("SELECT * FROM categories ORDER BY ROWID").fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_category_icon_map(self) -> dict[str, str]:
        """Returns {category_name: icon} for all categories that have an icon."""
        rows = self._conn.execute(
            "SELECT name, icon FROM categories WHERE icon IS NOT NULL"
        ).fetchall()
        return {row["name"]: row["icon"] for row in rows}

    @_locked
    def get_ingestion_state(self, source: str) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM ingestion_state WHERE source = ?", (source,)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def update_ingestion_state(
        self, source: str, last_id: str, last_at: str
    ) -> None:
        self._conn.execute(
            """INSERT OR REPLACE INTO ingestion_state
               (source, last_processed_id, last_processed_at, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)""",
            (source, last_id, last_at),
        )
        self._conn.commit()

    @_locked
    def is_duplicate(self, source: str, source_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM transactions WHERE source = ? AND source_id = ?",
            (source, source_id),
        ).fetchone()
        return row is not None

    @_locked
    def source_id_exists(self, source_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM transactions WHERE source_id = ?", (source_id,)
        ).fetchone()
        return row is not None

    @_locked
    def recent_transaction_exists(
        self, merchant: str, amount: float, minutes: int = 5
    ) -> bool:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
        row = self._conn.execute(
            """SELECT 1 FROM transactions
               WHERE merchant = ? AND amount = ? AND ingested_at >= ?""",
            (merchant, amount, cutoff_str),
        ).fetchone()
        return row is not None

    @_locked
    def add_category(self, name: str, keywords: str, icon: str = "📌", color: Optional[str] = None, cat_type: str = "neutral") -> None:
        existing = self._conn.execute("SELECT 1 FROM categories WHERE name = ?", (name,)).fetchone()
        if existing:
            raise ValueError(f"category '{name}' already exists")
        if color:
            clash = self._conn.execute("SELECT name FROM categories WHERE color = ? AND name != ?", (color, name)).fetchone()
            if clash:
                raise ValueError(f"color '{color}' is already used by category '{clash['name']}'")
        if cat_type not in _VALID_TYPES:
            raise ValueError(f"cat_type must be one of {set(_VALID_TYPES)}, got '{cat_type}'")
        self._conn.execute("INSERT INTO categories (name, keywords, icon, color, type) VALUES (?, ?, ?, ?, ?)", (name, keywords, icon, color, cat_type))
        self._conn.commit()

    @_locked
    def update_category(self, name: str, keywords: Optional[str] = None, icon: Optional[str] = None, color: Optional[str] = None, cat_type: Optional[str] = None) -> None:
        existing = self._conn.execute("SELECT 1 FROM categories WHERE name = ?", (name,)).fetchone()
        if not existing:
            raise ValueError(f"category '{name}' not found")
        if color:
            clash = self._conn.execute("SELECT name FROM categories WHERE color = ? AND name != ?", (color, name)).fetchone()
            if clash:
                raise ValueError(f"color '{color}' is already used by category '{clash['name']}'")
        updates = []
        params: list = []
        if keywords is not None:
            updates.append("keywords = ?")
            params.append(keywords)
        if icon is not None:
            updates.append("icon = ?")
            params.append(icon)
        if color is not None:
            updates.append("color = ?")
            params.append(color)
        if cat_type is not None:
            if cat_type not in _VALID_TYPES:
                raise ValueError(f"cat_type must be one of {set(_VALID_TYPES)}, got '{cat_type}'")
            updates.append("type = ?")
            params.append(cat_type)
        if not updates:
            return
        params.append(name)
        self._conn.execute(f"UPDATE categories SET {', '.join(updates)} WHERE name = ?", params)
        self._conn.commit()

    @_locked
    def delete_category(self, name: str) -> int:
        existing = self._conn.execute("SELECT 1 FROM categories WHERE name = ?", (name,)).fetchone()
        if not existing:
            raise ValueError(f"category '{name}' not found")
        count = self._conn.execute("UPDATE transactions SET category = 'Other' WHERE category = ?", (name,)).rowcount
        self._conn.execute("DELETE FROM merchant_overrides WHERE category = ?", (name,))
        self._conn.execute("DELETE FROM categories WHERE name = ?", (name,))
        self._conn.commit()
        return count

    @_locked
    def set_merchant_override(self, merchant: str, category: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO merchant_overrides (merchant, category, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (merchant, category),
        )
        self._conn.commit()

    @_locked
    def get_merchant_overrides(self) -> dict[str, str]:
        rows = self._conn.execute("SELECT merchant, category FROM merchant_overrides").fetchall()
        return {r["merchant"]: r["category"] for r in rows}

    @_locked
    def remove_merchant_override(self, merchant: str) -> None:
        self._conn.execute("DELETE FROM merchant_overrides WHERE merchant = ?", (merchant,))
        self._conn.commit()

    @_locked
    def find_cross_source_duplicate(
        self, merchant: str, amount: float, source: str, within_minutes: int = 10,
        *, currency: str = "SGD", transaction_date: Optional[str] = None,
        tx_type: str = "expense",
        timestamp_precision: str = "unknown",
        payment_identity_kind: Optional[str] = None,
        payment_identity: Optional[str] = None,
    ) -> Optional[dict]:
        """Match timed observations; ambiguous or date-only purchases stay separate."""
        if (timestamp_precision not in ("minute", "second") or not transaction_date
                or len(transaction_date) <= 10 or not merchant):
            return None
        rows = self._conn.execute(
            """SELECT * FROM transactions
               WHERE amount = ? AND source != ? AND currency = ?
               AND COALESCE(type, 'expense') = ?
               AND LOWER(TRIM(merchant)) = LOWER(TRIM(?))
               AND LENGTH(transaction_date) > 10
               AND EXISTS (SELECT 1 FROM source_events e
                   WHERE e.transaction_id = transactions.id AND e.status = 'processed'
                   AND e.timestamp_precision IN ('minute', 'second'))
               AND NOT EXISTS (SELECT 1 FROM source_events e
                   WHERE e.transaction_id = transactions.id AND e.status = 'processed'
                   AND e.payment_identity_kind = ? AND e.payment_identity IS NOT NULL
                   AND ? IS NOT NULL AND e.payment_identity != ?)
               AND NOT EXISTS (SELECT 1 FROM source_events e
                   WHERE e.transaction_id = transactions.id AND e.source = ?
                   AND e.status = 'processed')
               AND ABS(julianday(transaction_date) - julianday(?)) * 86400 <= ?
               LIMIT 2""",
            (amount, source, currency, tx_type, merchant,
             payment_identity_kind, payment_identity, payment_identity, source, transaction_date,
             within_minutes * 60 + 0.001),
        ).fetchall()
        return dict(rows[0]) if len(rows) == 1 else None

    @_locked
    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self._conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        if row is None:
            return default
        return row["value"]

    @_locked
    def set_setting(self, key: str, value: str) -> None:
        self._conn.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value,
               updated_at = excluded.updated_at""",
            (key, value),
        )
        self._conn.commit()

    @_locked
    def get_merchant_list(
        self,
        sort_by: str = "total_spent",
        tag_filter: str | None = None,
        category_filter: str | None = None,
        name_search: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> list[dict]:
        """Return paginated merchant list with computed stats and tags."""
        sort_map = {
            "total_spent":       "total_sgd DESC",
            "transaction_count": "transaction_count DESC",
            "last_seen":         "last_seen DESC",
            "merchant_name":     "ms.merchant ASC",
        }
        order = sort_map.get(sort_by, "total_sgd DESC")

        conditions = ["t.merchant IS NOT NULL", "(t.type IS NULL OR t.type = 'expense')"]
        params: list = []

        if name_search:
            conditions.append("t.merchant LIKE ?")
            params.append(f"%{name_search}%")
        if category_filter:
            conditions.append("t.category = ?")
            params.append(category_filter)

        where = " AND ".join(conditions)

        rows = self._conn.execute(
            f"""
            WITH merchant_stats AS (
                SELECT
                    t.merchant,
                    ROUND(SUM(t.amount * t.exchange_rate), 2) as total_sgd,
                    COUNT(*) as transaction_count,
                    ROUND(AVG(t.amount * t.exchange_rate), 2) as avg_amount_sgd,
                    DATE(MIN(t.transaction_date)) as first_seen,
                    DATE(MAX(t.transaction_date)) as last_seen
                FROM transactions t
                WHERE {where}
                GROUP BY t.merchant
            ),
            merchant_category AS (
                SELECT merchant, category,
                       ROW_NUMBER() OVER (PARTITION BY merchant ORDER BY COUNT(*) DESC) as rn
                FROM transactions
                WHERE merchant IS NOT NULL AND (type IS NULL OR type = 'expense') AND category IS NOT NULL
                GROUP BY merchant, category
            )
            SELECT
                ms.*,
                mc.category,
                COALESCE(mt.tags, '') as tags,
                COALESCE(mt.notes, '') as notes
            FROM merchant_stats ms
            LEFT JOIN merchant_category mc ON ms.merchant = mc.merchant AND mc.rn = 1
            LEFT JOIN merchant_tags mt ON ms.merchant = mt.merchant
            WHERE (? IS NULL OR ',' || COALESCE(mt.tags, '') || ',' LIKE '%,' || ? || ',%')
            ORDER BY {order}
            LIMIT ? OFFSET ?
            """,
            params + [tag_filter, tag_filter, limit, offset],
        ).fetchall()

        result = []
        for r in rows:
            d = dict(r)
            d["tags"] = [t.strip() for t in d["tags"].split(",") if t.strip()]
            result.append(d)
        return result

    @_locked
    def get_merchant_profile(self, merchant: str) -> dict | None:
        """Return full stats for a single merchant, or None if merchant has no transactions."""
        row = self._conn.execute(
            """
            SELECT
                t.merchant,
                ROUND(SUM(t.amount * t.exchange_rate), 2) as total_sgd,
                COUNT(*) as transaction_count,
                ROUND(AVG(t.amount * t.exchange_rate), 2) as avg_amount_sgd,
                DATE(MIN(t.transaction_date)) as first_seen,
                DATE(MAX(t.transaction_date)) as last_seen
            FROM transactions t
            WHERE t.merchant = ? AND (t.type IS NULL OR t.type = 'expense')
            """,
            (merchant,),
        ).fetchone()

        if not row or row["transaction_count"] == 0:
            return None

        profile = dict(row)
        tags_row = self._conn.execute(
            "SELECT tags, notes FROM merchant_tags WHERE merchant = ?", (merchant,)
        ).fetchone()
        profile["tags"] = []
        profile["notes"] = ""
        if tags_row:
            profile["tags"] = [t.strip() for t in (tags_row["tags"] or "").split(",") if t.strip()]
            profile["notes"] = tags_row["notes"] or ""
        return profile

    @_locked
    def get_merchant_tags(self, merchant: str) -> dict:
        """Return tags and notes for a merchant (empty defaults if not set)."""
        row = self._conn.execute(
            "SELECT tags, notes FROM merchant_tags WHERE merchant = ?", (merchant,)
        ).fetchone()
        if not row:
            return {"merchant": merchant, "tags": [], "notes": ""}
        return {
            "merchant": merchant,
            "tags": [t.strip() for t in (row["tags"] or "").split(",") if t.strip()],
            "notes": row["notes"] or "",
        }

    @_locked
    def set_merchant_tags(self, merchant: str, tags: list[str]) -> None:
        """Upsert tags for a merchant (does not touch notes)."""
        tags_str = ",".join(tags)
        self._conn.execute(
            """INSERT INTO merchant_tags (merchant, tags, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(merchant) DO UPDATE SET
                   tags = excluded.tags,
                   updated_at = excluded.updated_at""",
            (merchant, tags_str),
        )
        self._conn.commit()

    @_locked
    def set_merchant_notes(self, merchant: str, notes: str) -> None:
        """Upsert notes for a merchant (does not touch tags)."""
        self._conn.execute(
            """INSERT INTO merchant_tags (merchant, notes, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(merchant) DO UPDATE SET
                   notes = excluded.notes,
                   updated_at = excluded.updated_at""",
            (merchant, notes),
        )
        self._conn.commit()

    @_locked
    def get_merchant_trend(self, merchant: str, months: int = 6) -> dict:
        """Return monthly spend totals for a merchant over the last N months."""
        rows = self._conn.execute(
            """
            SELECT strftime('%Y-%m', transaction_date) as month,
                   ROUND(SUM(amount * exchange_rate), 2) as total,
                   COUNT(*) as count
            FROM transactions
            WHERE merchant = ?
              AND (type IS NULL OR type = 'expense')
              AND transaction_date >= date('now', ? || ' months')
            GROUP BY month
            ORDER BY month ASC
            """,
            (merchant, f"-{months}"),
        ).fetchall()
        month_data = [dict(r) for r in rows]
        totals = [m["total"] for m in month_data]
        current = totals[-1] if totals else 0
        previous = totals[-2] if len(totals) >= 2 else 0
        if current > previous * 1.1:
            trend = "up"
        elif current < previous * 0.9:
            trend = "down"
        else:
            trend = "stable"
        return {
            "merchant": merchant,
            "months": month_data,
            "current_month": current,
            "previous_month": previous,
            "trend": trend,
        }

    # ── Budgets ────────────────────────────────────────────────────────────

    @_locked
    def create_budget(self, category: Optional[str], amount: float, period: str) -> int:
        if period not in ("monthly", "weekly"):
            raise ValueError(f"period must be 'monthly' or 'weekly', got '{period}'")
        # SQLite UNIQUE constraint doesn't fire for two NULLs, so check manually
        if category is None:
            existing = self._conn.execute(
                "SELECT 1 FROM budgets WHERE category IS NULL AND period = ?", (period,)
            ).fetchone()
            if existing:
                raise ValueError(f"Budget for 'Overall' ({period}) already exists")
        try:
            cursor = self._conn.execute(
                """INSERT INTO budgets (category, period, amount)
                   VALUES (?, ?, ?)""",
                (category, period, amount),
            )
            self._conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            label = category if category else "Overall"
            raise ValueError(f"Budget for '{label}' ({period}) already exists")

    @_locked
    def get_budgets(self) -> list[dict]:
        rows = self._conn.execute("SELECT * FROM budgets ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    @_locked
    def update_budget(self, budget_id: int, amount: float) -> None:
        row = self._conn.execute("SELECT 1 FROM budgets WHERE id = ?", (budget_id,)).fetchone()
        if not row:
            raise ValueError(f"Budget {budget_id} not found")
        self._conn.execute(
            "UPDATE budgets SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (amount, budget_id),
        )
        self._conn.commit()

    @_locked
    def delete_budget(self, budget_id: int) -> None:
        row = self._conn.execute("SELECT 1 FROM budgets WHERE id = ?", (budget_id,)).fetchone()
        if not row:
            raise ValueError(f"Budget {budget_id} not found")
        self._conn.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
        self._conn.commit()

    @_locked
    def get_budget_progress(self) -> list[dict]:
        """Return all budgets with current-period spending stats."""
        budgets = self._conn.execute("SELECT * FROM budgets ORDER BY id").fetchall()
        results = []
        today = local_now().date()

        for b in budgets:
            start, end = _get_budget_period(b["period"])

            if b["category"] is None:
                spent_row = self._conn.execute(
                    """SELECT COALESCE(SUM(amount * exchange_rate), 0) as total
                       FROM transactions
                       WHERE (type IS NULL OR type = 'expense')
                         AND DATE(transaction_date) BETWEEN ? AND ?""",
                    (start, end),
                ).fetchone()
            else:
                spent_row = self._conn.execute(
                    """SELECT COALESCE(SUM(amount * exchange_rate), 0) as total
                       FROM transactions
                       WHERE (type IS NULL OR type = 'expense') AND category = ?
                         AND DATE(transaction_date) BETWEEN ? AND ?""",
                    (b["category"], start, end),
                ).fetchone()

            spent = spent_row["total"]
            budget_amount = b["amount"]
            remaining = budget_amount - spent
            percent = round(spent / budget_amount * 100, 1) if budget_amount > 0 else 0.0

            if b["period"] == "monthly":
                days_in_month = calendar.monthrange(today.year, today.month)[1]
                projected = round(spent / today.day * days_in_month, 2) if today.day > 0 else 0.0
            else:  # weekly
                weekday = today.weekday() + 1  # Mon = 1
                projected = round(spent / weekday * 7, 2) if weekday > 0 else 0.0

            status = (
                "over_budget" if percent >= 100
                else "warning" if percent >= 80
                else "on_track"
            )

            results.append({
                "id": b["id"],
                "category": b["category"],
                "label": b["category"] if b["category"] else "Overall",
                "period": b["period"],
                "budget_amount": budget_amount,
                "spent": round(spent, 2),
                "remaining": round(remaining, 2),
                "percent": percent,
                "projected": projected,
                "status": status,
                "period_start": start,
                "period_end": end,
            })
        return results

    # ── Goals ──────────────────────────────────────────────────────────────

    @_locked
    def create_goal(
        self,
        name: str,
        target_amount: float,
        target_date: Optional[str] = None,
    ) -> int:
        cursor = self._conn.execute(
            """INSERT INTO goals (name, target_amount, target_date)
               VALUES (?, ?, ?)""",
            (name, target_amount, target_date),
        )
        self._conn.commit()
        return cursor.lastrowid

    @_locked
    def get_goals(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM goals ORDER BY created_at ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def update_goal(self, goal_id: int, **fields) -> None:
        allowed = {"name", "target_amount", "target_date", "status"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        row = self._conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if not row:
            raise ValueError(f"Goal {goal_id} not found")
        set_clauses = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [goal_id]
        self._conn.execute(
            f"UPDATE goals SET {set_clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values,
        )
        self._conn.commit()

    @_locked
    def delete_goal(self, goal_id: int) -> None:
        row = self._conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if not row:
            raise ValueError(f"Goal {goal_id} not found")
        # ON DELETE CASCADE removes contributions automatically
        self._conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
        self._conn.commit()

    @_locked
    def add_contribution(
        self,
        goal_id: int,
        amount: float,
        month: str,
        source: str = "auto",
        note: Optional[str] = None,
        contributed_date: Optional[str] = None,
    ) -> int:
        if contributed_date is None:
            contributed_date = local_now().strftime("%Y-%m-%d")
        row = self._conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if not row:
            raise ValueError(f"Goal {goal_id} not found")
        cursor = self._conn.execute(
            """INSERT INTO goal_contributions (goal_id, amount, month, contributed_date, source, note)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (goal_id, amount, month, contributed_date, source, note),
        )
        # Update saved_amount on the goal
        self._conn.execute(
            "UPDATE goals SET saved_amount = saved_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (amount, goal_id),
        )
        # Auto-complete goal when saved_amount reaches or exceeds target_amount
        updated = self._conn.execute(
            "SELECT saved_amount, target_amount, status FROM goals WHERE id = ?", (goal_id,)
        ).fetchone()
        if updated and updated["saved_amount"] >= updated["target_amount"] and updated["status"] == "active":
            self._conn.execute(
                "UPDATE goals SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (goal_id,),
            )
        self._conn.commit()
        return cursor.lastrowid

    @_locked
    def get_contributions(self, goal_id: int) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY contributed_date ASC, month ASC",
            (goal_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def update_contribution(self, contribution_id: int, **fields) -> None:
        allowed = {"amount", "note", "contributed_date"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        row = self._conn.execute(
            "SELECT * FROM goal_contributions WHERE id = ?", (contribution_id,)
        ).fetchone()
        if not row:
            raise ValueError("Contribution not found")
        # If amount is changing, adjust the goal's saved_amount by the delta
        if "amount" in updates:
            delta = updates["amount"] - row["amount"]
            self._conn.execute(
                "UPDATE goals SET saved_amount = saved_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (delta, row["goal_id"]),
            )
            # Re-evaluate completion status
            goal = self._conn.execute(
                "SELECT saved_amount, target_amount, status FROM goals WHERE id = ?", (row["goal_id"],)
            ).fetchone()
            if goal:
                if goal["saved_amount"] >= goal["target_amount"] and goal["status"] == "active":
                    self._conn.execute(
                        "UPDATE goals SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (row["goal_id"],),
                    )
                elif goal["saved_amount"] < goal["target_amount"] and goal["status"] == "completed":
                    self._conn.execute(
                        "UPDATE goals SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (row["goal_id"],),
                    )
        # Derive month from contributed_date if date is being updated
        if "contributed_date" in updates and updates["contributed_date"]:
            updates["month"] = updates["contributed_date"][:7]
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        self._conn.execute(
            f"UPDATE goal_contributions SET {set_clause} WHERE id = ?",
            (*updates.values(), contribution_id),
        )
        self._conn.commit()

    @_locked
    def delete_contribution(self, contribution_id: int) -> None:
        row = self._conn.execute(
            "SELECT * FROM goal_contributions WHERE id = ?", (contribution_id,)
        ).fetchone()
        if not row:
            raise ValueError("Contribution not found")
        self._conn.execute("DELETE FROM goal_contributions WHERE id = ?", (contribution_id,))
        self._conn.execute(
            "UPDATE goals SET saved_amount = MAX(0, saved_amount - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (row["amount"], row["goal_id"]),
        )
        # If goal was completed but saved_amount now falls below target, revert to active
        goal = self._conn.execute(
            "SELECT saved_amount, target_amount, status FROM goals WHERE id = ?", (row["goal_id"],)
        ).fetchone()
        if goal and goal["saved_amount"] < goal["target_amount"] and goal["status"] == "completed":
            self._conn.execute(
                "UPDATE goals SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (row["goal_id"],),
            )
        self._conn.commit()

    @_locked
    def get_goal_progress(self, goal_id: int) -> Optional[dict]:
        row = self._conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if not row:
            return None
        goal = dict(row)
        contributions = self.get_contributions(goal_id)

        # Monthly rate: average of last 3 contributions
        recent = [c["amount"] for c in contributions[-3:]]
        monthly_rate = sum(recent) / len(recent) if recent else 0.0

        saved = goal["saved_amount"]
        target = goal["target_amount"]
        percent = round(saved / target * 100, 1) if target > 0 else 0.0
        remaining = target - saved
        months_to_target = round(remaining / monthly_rate, 1) if monthly_rate > 0 else None

        on_track = None
        if goal["target_date"] and months_to_target is not None:
            target_dt = datetime.strptime(goal["target_date"], "%Y-%m-%d")
            now = local_now()
            months_remaining = (target_dt.year - now.year) * 12 + (target_dt.month - now.month)
            if months_to_target < months_remaining * 0.9:
                on_track = "ahead"
            elif months_to_target <= months_remaining:
                on_track = "on_track"
            else:
                on_track = "behind"

        return {
            **goal,
            "percent": percent,
            "monthly_rate": round(monthly_rate, 2),
            "months_to_target": months_to_target,
            "on_track": on_track,
            "contributions": contributions,
        }

    @_locked
    def get_savings_overview(self, month: str) -> dict:
        """Return income, expenses, savings, and how much has been manually allocated to goals for the given month."""
        import calendar as _cal
        year, mon = int(month[:4]), int(month[5:7])
        last_day = _cal.monthrange(year, mon)[1]
        start = f"{month}-01"
        end = f"{month}-{last_day:02d}"

        income = self._conn.execute(
            """SELECT COALESCE(SUM(amount * exchange_rate), 0) as total
               FROM transactions WHERE type = 'income'
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()["total"]
        expenses = self._conn.execute(
            """SELECT COALESCE(SUM(amount * exchange_rate), 0) as total
               FROM transactions WHERE (type IS NULL OR type = 'expense')
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()["total"]
        savings = max(0.0, income - expenses)
        allocated = self._conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM goal_contributions WHERE month = ?",
            (month,),
        ).fetchone()["total"]
        return {
            "month": month,
            "income": income,
            "expenses": expenses,
            "savings": savings,
            "allocated_to_goals": allocated,
            "unallocated": max(0.0, savings - allocated),
        }

    # ── Financial Health Score ──────────────────────────────────────────────

    @_locked
    def get_health_score(self, months: int = 1) -> dict:
        """Compute 0-100 financial health score using the 50/30/20 rule.

        Components (max pts):
          savings_rate      40  — min(savings_rate / 0.20, 1.0) × 40
          needs_ratio       20  — max(0, 1 − (needs_ratio − 0.50) / 0.50) × 20
          wants_ratio       20  — max(0, 1 − (wants_ratio − 0.30) / 0.30) × 20
          budget_adherence  10  — (budgets_within_limit / total_budgets) × 10
          anomaly_frequency 10  — max(0, 1 − anomaly_count / 5) × 10
        """
        from src.config import local_now

        now = local_now()
        period = now.strftime("%Y-%m")

        # Compute start date: first day N months back (months=1 → start of current month)
        year, month = now.year, now.month
        month -= months - 1
        while month <= 0:
            month += 12
            year -= 1
        start = f"{year}-{month:02d}-01"
        end = now.strftime("%Y-%m-%d")

        # ── Income ──────────────────────────────────────────────────────────
        income = self._conn.execute(
            """SELECT COALESCE(SUM(amount * exchange_rate), 0.0)
               FROM transactions WHERE type = 'income'
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        if income == 0:
            return {
                "has_income_data": False,
                "score": None,
                "grade": None,
                "components": {},
                "period": period,
            }

        # ── Total expenses ───────────────────────────────────────────────────
        total_expense = self._conn.execute(
            """SELECT COALESCE(SUM(amount * exchange_rate), 0.0)
               FROM transactions WHERE (type IS NULL OR type = 'expense')
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        # ── Needs (expenses in categories with type='needs') ─────────────────
        needs = self._conn.execute(
            """SELECT COALESCE(SUM(t.amount * t.exchange_rate), 0.0)
               FROM transactions t
               LEFT JOIN categories c ON t.category = c.name
               WHERE (t.type IS NULL OR t.type = 'expense')
               AND COALESCE(c.type, 'neutral') = 'needs'
               AND DATE(t.transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        # ── Wants (expenses in categories with type='wants') ─────────────────
        wants = self._conn.execute(
            """SELECT COALESCE(SUM(t.amount * t.exchange_rate), 0.0)
               FROM transactions t
               LEFT JOIN categories c ON t.category = c.name
               WHERE (t.type IS NULL OR t.type = 'expense')
               AND COALESCE(c.type, 'neutral') = 'wants'
               AND DATE(t.transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        savings = income - total_expense
        savings_rate = savings / income
        needs_ratio = needs / income
        wants_ratio = wants / income

        # ── Component scores ────────────────────────────────────────────────
        savings_score = round(min(max(savings_rate, 0.0) / 0.20, 1.0) * 40, 1)
        needs_score = round(max(0.0, 1.0 - max(0.0, needs_ratio - 0.50) / 0.50) * 20, 1)
        wants_score = round(max(0.0, 1.0 - max(0.0, wants_ratio - 0.30) / 0.30) * 20, 1)

        # ── Budget adherence ────────────────────────────────────────────────
        budgets = self.get_budget_progress()
        if budgets:
            within = sum(1 for b in budgets if b["percent"] <= 100)
            budget_score = round((within / len(budgets)) * 10, 1)
            budget_adherence_value = round(within / len(budgets), 2)
        else:
            budget_score = 0.0
            budget_adherence_value = 0.0

        # ── Anomaly frequency ───────────────────────────────────────────────
        multiplier = float(self.get_setting("anomaly_multiplier", "2.0"))

        # Historical average per merchant (excluding current scoring period)
        merchant_avgs = {
            row["merchant"]: row["avg_amt"]
            for row in self._conn.execute(
                """SELECT merchant, AVG(amount * exchange_rate) as avg_amt
                   FROM transactions WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
                   AND DATE(transaction_date) < ?
                   GROUP BY merchant""",
                (start,),
            ).fetchall()
        }

        # Period transactions
        period_txs = self._conn.execute(
            """SELECT merchant, amount * exchange_rate as amt_sgd
               FROM transactions WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchall()

        anomaly_count = sum(
            1
            for r in period_txs
            if r["merchant"] in merchant_avgs
            and merchant_avgs[r["merchant"]] > 0
            and r["amt_sgd"] > multiplier * merchant_avgs[r["merchant"]]
        )
        anomaly_score = round(max(0.0, 1.0 - anomaly_count / 5.0) * 10, 1)

        # ── Total and grade ─────────────────────────────────────────────────
        total_score = round(
            savings_score + needs_score + wants_score + budget_score + anomaly_score
        )
        grade = (
            "Excellent"       if total_score >= 80 else
            "Good"            if total_score >= 60 else
            "Fair"            if total_score >= 40 else
            "Needs Attention"
        )

        return {
            "score": total_score,
            "grade": grade,
            "has_income_data": True,
            "period": period,
            "components": {
                "savings_rate": {
                    "score": savings_score,
                    "max": 40,
                    "value": round(savings_rate, 3),
                    "benchmark": 0.20,
                    "label": "Savings Rate",
                    "description": "Percentage of income saved after all expenses",
                },
                "needs_ratio": {
                    "score": needs_score,
                    "max": 20,
                    "value": round(needs_ratio, 3),
                    "benchmark": 0.50,
                    "label": "Needs Ratio",
                    "description": "Essential spending (transport, groceries, bills) as % of income",
                },
                "wants_ratio": {
                    "score": wants_score,
                    "max": 20,
                    "value": round(wants_ratio, 3),
                    "benchmark": 0.30,
                    "label": "Wants Ratio",
                    "description": "Discretionary spending (dining, entertainment, shopping) as % of income",
                },
                "budget_adherence": {
                    "score": budget_score,
                    "max": 10,
                    "value": budget_adherence_value,
                    "label": "Budget Adherence",
                    "description": "Fraction of active budgets that are within their limit",
                },
                "anomaly_frequency": {
                    "score": anomaly_score,
                    "max": 10,
                    "value": anomaly_count,
                    "label": "Spending Anomalies",
                    "description": "Transactions significantly above your typical spend for that merchant",
                },
            },
        }

    # ── Trips ───────────────────────────────────────────────────────────────

    @_locked
    def create_trip(
        self,
        name: str,
        start_date: str,
        destination: Optional[str] = None,
        primary_currency: str = "SGD",
    ) -> int:
        cursor = self._conn.execute(
            """INSERT INTO trips (name, destination, start_date, primary_currency)
               VALUES (?, ?, ?, ?)""",
            (name, destination, start_date, primary_currency),
        )
        self._conn.commit()
        return cursor.lastrowid

    @_locked
    def get_trips(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM trips ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_trip(self, trip_id: int) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM trips WHERE id = ?", (trip_id,)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def update_trip(self, trip_id: int, **fields) -> None:
        allowed = {"name", "destination", "start_date", "end_date", "primary_currency"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        row = self._conn.execute("SELECT 1 FROM trips WHERE id = ?", (trip_id,)).fetchone()
        if not row:
            raise ValueError(f"Trip {trip_id} not found")
        set_clauses = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [trip_id]
        self._conn.execute(
            f"UPDATE trips SET {set_clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values,
        )
        self._conn.commit()

    @_locked
    def delete_trip(self, trip_id: int) -> None:
        row = self._conn.execute("SELECT 1 FROM trips WHERE id = ?", (trip_id,)).fetchone()
        if not row:
            raise ValueError(f"Trip {trip_id} not found")
        self._conn.execute("DELETE FROM trip_transactions WHERE trip_id = ?", (trip_id,))
        self._conn.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
        self._conn.commit()

    @_locked
    def activate_trip(self, trip_id: int) -> None:
        row = self._conn.execute("SELECT 1 FROM trips WHERE id = ?", (trip_id,)).fetchone()
        if not row:
            raise ValueError(f"Trip {trip_id} not found")
        self._conn.execute(
            "UPDATE trips SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id != ?",
            (trip_id,),
        )
        self._conn.execute(
            "UPDATE trips SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trip_id,),
        )
        self._conn.commit()

    @_locked
    def deactivate_trip(self, trip_id: int) -> None:
        row = self._conn.execute("SELECT 1 FROM trips WHERE id = ?", (trip_id,)).fetchone()
        if not row:
            raise ValueError(f"Trip {trip_id} not found")
        self._conn.execute(
            "UPDATE trips SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trip_id,),
        )
        self._conn.commit()

    @_locked
    def get_active_trip(self) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM trips WHERE status = 'active' LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def enlist_transaction(self, trip_id: int, tx_id: int, added_by: str = "auto") -> None:
        """Add a transaction to a trip. Idempotent — does nothing if already enlisted."""
        self._conn.execute(
            """INSERT OR IGNORE INTO trip_transactions (trip_id, transaction_id, added_by)
               VALUES (?, ?, ?)""",
            (trip_id, tx_id, added_by),
        )
        self._conn.commit()

    @_locked
    def delist_transaction(self, trip_id: int, tx_id: int) -> None:
        """Remove a transaction from a trip. No-op if not enlisted."""
        self._conn.execute(
            "DELETE FROM trip_transactions WHERE trip_id = ? AND transaction_id = ?",
            (trip_id, tx_id),
        )
        self._conn.commit()

    @_locked
    def get_trip_transactions(
        self,
        trip_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        rows = self._conn.execute(
            """SELECT t.*, tt.added_by
               FROM transactions t
               JOIN trip_transactions tt ON tt.transaction_id = t.id
               WHERE tt.trip_id = ?
               ORDER BY t.transaction_date DESC
               LIMIT ? OFFSET ?""",
            (trip_id, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def auto_assign_to_active_trip(self, tx_id: int) -> None:
        """If trips_enabled and an active trip exists, add tx_id to it. No-op otherwise."""
        if self.get_setting("trips_enabled", "false") != "true":
            return
        active = self.get_active_trip()
        if not active:
            return
        self.enlist_transaction(active["id"], tx_id, added_by="auto")

    @_locked
    def is_in_trip(self, trip_id: int, tx_id: int) -> bool:
        """Return True if transaction tx_id is enlisted in trip trip_id."""
        row = self._conn.execute(
            "SELECT 1 FROM trip_transactions WHERE trip_id = ? AND transaction_id = ?",
            (trip_id, tx_id),
        ).fetchone()
        return row is not None

    @_locked
    def get_trip_summary(self, trip_id: int) -> Optional[dict]:
        """Full analytics for a trip: total, count, days, daily average, by category, by day."""
        trip = self.get_trip(trip_id)
        if not trip:
            return None

        rows = self._conn.execute(
            """SELECT t.amount * t.exchange_rate as amt_sgd,
                      t.category,
                      DATE(t.transaction_date) as tx_date,
                      t.currency
               FROM transactions t
               JOIN trip_transactions tt ON tt.transaction_id = t.id
               WHERE tt.trip_id = ? AND (t.type IS NULL OR t.type = 'expense')
               ORDER BY t.transaction_date ASC""",
            (trip_id,),
        ).fetchall()

        total_sgd = sum(r["amt_sgd"] for r in rows)
        count = len(rows)

        start_dt = datetime.strptime(trip["start_date"], "%Y-%m-%d")
        end_str = trip.get("end_date") or local_now().strftime("%Y-%m-%d")
        end_dt = datetime.strptime(end_str, "%Y-%m-%d")
        days = max(1, (end_dt - start_dt).days + 1)

        daily_avg = round(total_sgd / days, 2) if total_sgd > 0 else 0.0

        cat_totals: dict[str, dict] = {}
        for r in rows:
            cat = r["category"] or "Other"
            if cat not in cat_totals:
                cat_totals[cat] = {"category": cat, "amount_sgd": 0.0, "count": 0}
            cat_totals[cat]["amount_sgd"] = round(cat_totals[cat]["amount_sgd"] + r["amt_sgd"], 2)
            cat_totals[cat]["count"] += 1
        by_category = sorted(cat_totals.values(), key=lambda x: x["amount_sgd"], reverse=True)

        day_totals: dict[str, float] = {}
        for r in rows:
            d = r["tx_date"] or "unknown"
            day_totals[d] = round(day_totals.get(d, 0.0) + r["amt_sgd"], 2)
        by_day = [{"date": d, "amount_sgd": v} for d, v in sorted(day_totals.items())]

        currencies = list({r["currency"] for r in rows if r["currency"]})

        return {
            "trip": dict(trip),
            "total_sgd": round(total_sgd, 2),
            "transaction_count": count,
            "days": days,
            "daily_average_sgd": daily_avg,
            "currencies_used": currencies,
            "by_category": by_category,
            "by_day": by_day,
        }

    # ── Subscriptions ──────────────────────────────────────────────

    @_locked
    def create_subscription(
        self, merchant: str, frequency: str,
        billing_day: int | None = None, label: str | None = None, notes: str | None = None
    ) -> int:
        cur = self._conn.execute(
            """INSERT INTO subscriptions (merchant, frequency, billing_day, label, notes)
               VALUES (?, ?, ?, ?, ?)""",
            (merchant, frequency, billing_day, label, notes),
        )
        self._conn.commit()
        return cur.lastrowid

    @_locked
    def get_subscription(self, sub_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM subscriptions WHERE id = ?", (sub_id,)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def list_subscriptions(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM subscriptions ORDER BY status, merchant"
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def update_subscription(self, sub_id: int, **fields) -> None:
        if not self.get_subscription(sub_id):
            raise ValueError("subscription not found")
        allowed = {"merchant", "label", "frequency", "billing_day", "status", "notes"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        self._conn.execute(
            f"UPDATE subscriptions SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (*updates.values(), sub_id),
        )
        self._conn.commit()

    @_locked
    def delete_subscription(self, sub_id: int) -> None:
        if not self.get_subscription(sub_id):
            raise ValueError("subscription not found")
        self._conn.execute("DELETE FROM upcoming_transactions WHERE subscription_id = ?", (sub_id,))
        self._conn.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
        self._conn.commit()

    @_locked
    def get_subscription_matched_transactions(self, sub_id: int, limit: int = 50) -> list[dict]:
        """Return transactions linked to this subscription via upcoming_transactions."""
        rows = self._conn.execute(
            """SELECT t.* FROM transactions t
               JOIN upcoming_transactions u ON u.matched_transaction_id = t.id
               WHERE u.subscription_id = ? AND u.status = 'matched'
               ORDER BY t.transaction_date DESC
               LIMIT ?""",
            (sub_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_subscription_summary(self) -> dict:
        """Return {total_monthly_sgd, active_count, possibly_cancelled_count}."""
        rows = self._conn.execute(
            "SELECT id, frequency, status FROM subscriptions WHERE status NOT IN ('cancelled')"
        ).fetchall()
        monthly_total = 0.0
        active = 0
        possibly_cancelled = 0
        for row in rows:
            last_amount = self._get_subscription_last_amount(row["id"])
            if row["status"] == "active":
                active += 1
                monthly_total += _to_monthly(last_amount or 0.0, row["frequency"])
            elif row["status"] == "possibly_cancelled":
                possibly_cancelled += 1
        return {
            "total_monthly_sgd": round(monthly_total, 2),
            "active_count": active,
            "possibly_cancelled_count": possibly_cancelled,
        }

    def _get_subscription_last_amount(self, sub_id: int) -> float | None:
        """Not locked — only called from within locked methods."""
        row = self._conn.execute(
            """SELECT t.amount * t.exchange_rate AS sgd_amount
               FROM upcoming_transactions u
               JOIN transactions t ON t.id = u.matched_transaction_id
               WHERE u.subscription_id = ? AND u.status = 'matched'
               ORDER BY t.transaction_date DESC
               LIMIT 1""",
            (sub_id,),
        ).fetchone()
        return row["sgd_amount"] if row else None

    @_locked
    def get_subscription_last_amount(self, sub_id: int) -> float | None:
        """Public accessor for the most recent matched SGD amount."""
        return self._get_subscription_last_amount(sub_id)

    # ── Upcoming Transactions ──────────────────────────────────────

    @_locked
    def create_upcoming_transaction(
        self, subscription_id: int, expected_date: str, expected_amount: float | None = None
    ) -> int:
        cur = self._conn.execute(
            """INSERT INTO upcoming_transactions (subscription_id, expected_date, expected_amount)
               VALUES (?, ?, ?)""",
            (subscription_id, expected_date, expected_amount),
        )
        self._conn.commit()
        return cur.lastrowid

    @_locked
    def list_upcoming_transactions(self, subscription_id: int) -> list[dict]:
        rows = self._conn.execute(
            """SELECT * FROM upcoming_transactions
               WHERE subscription_id = ?
               ORDER BY expected_date ASC""",
            (subscription_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def upcoming_exists_for_period(self, subscription_id: int, expected_date: str, window_days: int = 5) -> bool:
        """Return True if an upcoming transaction already exists near expected_date."""
        from datetime import datetime, timedelta
        d = datetime.strptime(expected_date, "%Y-%m-%d")
        lo = (d - timedelta(days=window_days)).strftime("%Y-%m-%d")
        hi = (d + timedelta(days=window_days)).strftime("%Y-%m-%d")
        row = self._conn.execute(
            """SELECT 1 FROM upcoming_transactions
               WHERE subscription_id = ? AND expected_date BETWEEN ? AND ?
               AND status IN ('pending', 'matched')""",
            (subscription_id, lo, hi),
        ).fetchone()
        return row is not None

    @_locked
    def find_subscription_match(
        self, merchant: str, expected_date: str, expected_amount: float | None,
        date_window_days: int = 5, amount_tolerance: float = 0.10
    ) -> dict | None:
        """Find a transaction matching subscription criteria for auto-linking.

        Exact merchant name match within ±date_window_days days.
        If expected_amount provided: amount within ±amount_tolerance (10%).
        If expected_amount is None: first merchant hit in window wins.
        Excludes transactions already linked to another upcoming transaction.
        """
        from datetime import datetime, timedelta
        d = datetime.strptime(expected_date, "%Y-%m-%d")
        lo = (d - timedelta(days=date_window_days)).strftime("%Y-%m-%d")
        hi = (d + timedelta(days=date_window_days)).strftime("%Y-%m-%d")

        candidates = self._conn.execute(
            """SELECT * FROM transactions
               WHERE merchant = ?
                 AND DATE(transaction_date) BETWEEN ? AND ?
                 AND (type IS NULL OR type = 'expense')
                 AND id NOT IN (
                     SELECT matched_transaction_id FROM upcoming_transactions
                     WHERE matched_transaction_id IS NOT NULL
                 )
               ORDER BY transaction_date DESC""",
            (merchant, lo, hi),
        ).fetchall()

        for row in candidates:
            tx = dict(row)
            if expected_amount is None:
                return tx
            actual = tx["amount"] * tx["exchange_rate"]
            if abs(actual - expected_amount) / max(expected_amount, 0.01) <= amount_tolerance:
                return tx
        return None

    @_locked
    def find_subscription_by_merchant(self, merchant: str) -> dict | None:
        """Return the first non-cancelled subscription matching merchant (case-insensitive), or None."""
        row = self._conn.execute(
            """SELECT * FROM subscriptions
               WHERE LOWER(merchant) = LOWER(?)
                 AND status NOT IN ('cancelled')
               LIMIT 1""",
            (merchant,),
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def match_upcoming_transaction(self, upcoming_id: int, transaction_id: int) -> None:
        self._conn.execute(
            """UPDATE upcoming_transactions
               SET status = 'matched', matched_transaction_id = ?
               WHERE id = ?""",
            (transaction_id, upcoming_id),
        )
        self._conn.commit()

    @_locked
    def link_transaction_to_subscription(self, sub_id: int, tx_id: int) -> None:
        """Directly link a past transaction to a subscription.

        Creates a matched upcoming_transactions row (idempotent — no-op if
        the transaction is already linked to this subscription).
        Raises ValueError if the subscription or transaction is not found.
        """
        if not self.get_subscription(sub_id):
            raise ValueError("subscription not found")
        tx = self._conn.execute(
            "SELECT transaction_date, amount, exchange_rate FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if not tx:
            raise ValueError("transaction not found")
        existing = self._conn.execute(
            "SELECT id FROM upcoming_transactions WHERE subscription_id = ? AND matched_transaction_id = ?",
            (sub_id, tx_id),
        ).fetchone()
        if existing:
            return
        expected_date = dict(tx)["transaction_date"][:10]
        expected_amount = round(dict(tx)["amount"] * (dict(tx)["exchange_rate"] or 1.0), 2)
        self._conn.execute(
            """INSERT INTO upcoming_transactions
                   (subscription_id, expected_date, expected_amount, matched_transaction_id, status)
               VALUES (?, ?, ?, ?, 'matched')""",
            (sub_id, expected_date, expected_amount, tx_id),
        )
        self._conn.commit()

    @_locked
    def dismiss_upcoming_transaction(self, upcoming_id: int) -> None:
        self._conn.execute(
            "UPDATE upcoming_transactions SET status = 'dismissed' WHERE id = ?",
            (upcoming_id,),
        )
        self._conn.commit()

    @_locked
    def get_upcoming_transaction(self, upcoming_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM upcoming_transactions WHERE id = ?", (upcoming_id,)
        ).fetchone()
        return dict(row) if row else None

    # ── Recurring ─────────────────────────────────────────────────────────────

    @_locked
    def get_merchant_history(self, merchant: str, days: int = 90) -> list[dict]:
        """Return expense transactions for a merchant within the past *days* days."""
        rows = self._conn.execute(
            """SELECT amount, transaction_date FROM transactions
               WHERE merchant = ? AND transaction_date >= date('now', ? || ' days')
               AND (type IS NULL OR type = 'expense')
               ORDER BY transaction_date DESC""",
            (merchant, f"-{days}"),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_recurring_transactions(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM recurring_transactions ORDER BY last_seen DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Telegram chat ID ──────────────────────────────────────────────────────

    @_locked
    def get_telegram_chat_id(self) -> Optional[int]:
        value = self.get_setting("telegram_chat_id")
        if value:
            return int(value)
        # One-time migration: pre-1af83a7 deployments stored chat_id in ingestion_state
        row = self._conn.execute(
            "SELECT last_processed_id FROM ingestion_state WHERE source = 'telegram_chat_id'"
        ).fetchone()
        if row:
            chat_id = int(row["last_processed_id"])
            self.set_telegram_chat_id(chat_id)
            return chat_id
        return None

    @_locked
    def set_telegram_chat_id(self, chat_id: int) -> None:
        self.set_setting("telegram_chat_id", str(chat_id))

    # ── Apple Wallet cards ────────────────────────────────────────────────────

    @_locked
    def get_apple_wallet_cards(self) -> list[str]:
        rows = self._conn.execute(
            """SELECT DISTINCT description FROM transactions
               WHERE source = 'apple_wallet' AND description LIKE 'Apple Wallet - _%'
               ORDER BY description"""
        ).fetchall()
        return [r["description"] for r in rows]

    # ── Merchant list helper ──────────────────────────────────────────────────

    @_locked
    def get_merchants_in_range(self, start: str, end: str) -> list[str]:
        """Return distinct merchant names with transactions in [start, end]."""
        rows = self._conn.execute(
            """SELECT DISTINCT merchant FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND merchant IS NOT NULL
               ORDER BY merchant""",
            (start, end),
        ).fetchall()
        return [r["merchant"] for r in rows]

    # ── Budget / Goal single-row fetch ────────────────────────────────────────

    @_locked
    def get_budget(self, budget_id: int) -> Optional[dict]:
        row = self._conn.execute("SELECT * FROM budgets WHERE id = ?", (budget_id,)).fetchone()
        return dict(row) if row else None

    @_locked
    def get_goal(self, goal_id: int) -> Optional[dict]:
        row = self._conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
        return dict(row) if row else None

    # ── Analytics wrappers ────────────────────────────────────────────────────

    @_locked
    def comparison(self, period: str = "month", date: Optional[str] = None) -> dict:
        """Return overall + per-category period comparison delegating to analytics."""
        from src.analytics import get_period_comparison, get_category_comparison
        return {
            "overall": get_period_comparison(self._conn, period, date),
            "categories": get_category_comparison(self._conn, period, date),
        }

    @_locked
    def top_merchants_by_period(
        self, limit: int = 10, period: str = "month", date: Optional[str] = None
    ) -> list[dict]:
        from src.analytics import get_top_merchants
        return get_top_merchants(self._conn, limit, period, date)

    @_locked
    def merchant_trend_chart(self, merchant: str) -> dict:
        from src.analytics import get_merchant_trend
        return get_merchant_trend(self._conn, merchant)

    @_locked
    def spending_velocity(self) -> dict:
        from src.analytics import get_spending_velocity
        return get_spending_velocity(self._conn)

    @_locked
    def spending_anomalies(self, multiplier: float = 2.0) -> list[dict]:
        from src.analytics import get_anomalies
        return get_anomalies(self._conn, multiplier)

    @_locked
    def new_merchants(self) -> list[dict]:
        from src.analytics import check_new_merchants
        return check_new_merchants(self._conn)

    @_locked
    def generate_digest(self, report_type: str = "monthly") -> dict:
        from src.analytics import generate_summary
        return generate_summary(self._conn, report_type)


import secrets
import random
import string


class AdminStorage:
    """Manages users, sessions, admin sessions, and Telegram link tokens in app.db.

    Takes a sqlite3.Connection; caller owns the connection lifecycle.
    """

    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()

    # ── Users ──────────────────────────────────────────────────────────────────

    @_locked
    def create_user(self, username: str, password_hash: str) -> None:
        """Insert a new user row. Raises ValueError if username already exists.
        Sets force_password_change=1 so the user must set their own password on first login.
        """
        try:
            self._conn.execute(
                "INSERT INTO users (username, password_hash, force_password_change) VALUES (?, ?, 1)",
                (username, password_hash),
            )
            self._conn.commit()
        except sqlite3.IntegrityError:
            raise ValueError(f"user '{username}' already exists")

    @_locked
    def get_user(self, username: str) -> dict | None:
        """Returns full user row as dict, or None if not found."""
        row = self._conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def get_user_by_chat_id(self, chat_id: str) -> dict | None:
        """Lookup user by Telegram chat_id."""
        row = self._conn.execute(
            "SELECT * FROM users WHERE telegram_chat_id = ?", (str(chat_id),)
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def list_users(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM users ORDER BY created_at ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def delete_user(self, username: str) -> None:
        """Delete user row. ON DELETE CASCADE removes sessions and telegram_link_tokens."""
        self._conn.execute("DELETE FROM users WHERE username = ?", (username,))
        self._conn.commit()

    @_locked
    def update_user(self, username: str, **fields) -> None:
        """Update one or more fields on a user row.
        Allowed fields: gmail_connected, telegram_chat_id, wants_gmail,
                        wants_apple_wallet, onboarding_complete, password_hash
        Raises ValueError for disallowed fields.
        """
        allowed = {
            "gmail_connected", "telegram_chat_id", "wants_gmail",
            "wants_apple_wallet", "onboarding_complete", "password_hash",
            "force_password_change",
        }
        invalid = set(fields) - allowed
        if invalid:
            raise ValueError(f"disallowed update fields: {invalid}")
        if not fields:
            return
        set_clauses = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [username]
        self._conn.execute(
            f"UPDATE users SET {set_clauses} WHERE username = ?", params
        )
        self._conn.commit()

    # ── User sessions (30-day sliding window) ─────────────────────────────────

    @_locked
    def create_session(self, username: str, user_agent: str = "") -> str:
        """Create a session token for a user. Returns the session token."""
        token = secrets.token_hex(32)
        self._conn.execute(
            "INSERT INTO sessions (token, username, user_agent) VALUES (?, ?, ?)",
            (token, username, user_agent),
        )
        self._conn.commit()
        return token

    @_locked
    def verify_session(self, token: str) -> str | None:
        """Returns username if session is valid and within 30-day sliding window.
        Updates last_used_at on every successful verify.
        Returns None if token not found or expired.
        """
        row = self._conn.execute(
            "SELECT username, last_used_at FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        last_used = datetime.fromisoformat(row["last_used_at"])
        if datetime.now(timezone.utc).replace(tzinfo=None) - last_used > timedelta(days=30):
            self._conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self._conn.commit()
            return None
        self._conn.execute(
            "UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?",
            (token,),
        )
        self._conn.commit()
        return row["username"]

    @_locked
    def destroy_session(self, token: str) -> None:
        self._conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self._conn.commit()

    @_locked
    def destroy_all_sessions(self, username: str, except_token: str | None = None) -> None:
        """Delete all sessions for a user, optionally keeping one (the current session)."""
        if except_token:
            self._conn.execute(
                "DELETE FROM sessions WHERE username = ? AND token != ?",
                (username, except_token),
            )
        else:
            self._conn.execute(
                "DELETE FROM sessions WHERE username = ?", (username,)
            )
        self._conn.commit()

    @_locked
    def list_sessions(self, username: str) -> list[dict]:
        """Return all sessions for a user, newest first."""
        rows = self._conn.execute(
            """SELECT token, user_agent, created_at, last_used_at
               FROM sessions WHERE username = ?
               ORDER BY last_used_at DESC""",
            (username,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Admin sessions (2-hour sliding window) ─────────────────────────────────

    @_locked
    def create_admin_session(self) -> str:
        token = secrets.token_hex(32)
        self._conn.execute(
            "INSERT INTO admin_sessions (token) VALUES (?)", (token,)
        )
        self._conn.commit()
        return token

    @_locked
    def verify_admin_session(self, token: str) -> bool:
        """Returns True if token exists and last_used_at is within 2 hours."""
        row = self._conn.execute(
            "SELECT last_used_at FROM admin_sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return False
        last_used = datetime.fromisoformat(row["last_used_at"])
        if datetime.now(timezone.utc).replace(tzinfo=None) - last_used > timedelta(hours=2):
            self._conn.execute(
                "DELETE FROM admin_sessions WHERE token = ?", (token,)
            )
            self._conn.commit()
            return False
        self._conn.execute(
            "UPDATE admin_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?",
            (token,),
        )
        self._conn.commit()
        return True

    @_locked
    def destroy_admin_session(self, token: str) -> None:
        self._conn.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
        self._conn.commit()

    # ── Telegram link tokens ──────────────────────────────────────────────────

    @_locked
    def create_telegram_link_token(self, username: str) -> str:
        """Generate a CASHE-XXXXXX one-time code. Stores with 24h expiry.
        Deletes any existing tokens for this user before creating a new one.
        """
        self._conn.execute(
            "DELETE FROM telegram_link_tokens WHERE username = ?", (username,)
        )
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        token = f"CASHE-{suffix}"
        expires_at = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        self._conn.execute(
            "INSERT INTO telegram_link_tokens (token, username, expires_at) VALUES (?, ?, ?)",
            (token, username, expires_at),
        )
        self._conn.commit()
        return token

    @_locked
    def consume_telegram_link_token(self, token: str) -> str | None:
        """Validate and consume a Telegram link token.
        Returns the associated username if valid and not expired.
        Deletes the token (one-time use) on success.
        Returns None if token not found or expired.
        """
        row = self._conn.execute(
            "SELECT username, expires_at FROM telegram_link_tokens WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        if datetime.now(timezone.utc).replace(tzinfo=None) > datetime.fromisoformat(row["expires_at"]):
            self._conn.execute(
                "DELETE FROM telegram_link_tokens WHERE token = ?", (token,)
            )
            self._conn.commit()
            return None
        self._conn.execute(
            "DELETE FROM telegram_link_tokens WHERE token = ?", (token,)
        )
        self._conn.commit()
        return row["username"]


def _to_monthly(amount: float, frequency: str) -> float:
    """Normalise an amount to monthly SGD equivalent."""
    if frequency == "weekly":
        return amount * 4.33
    if frequency == "annual":
        return amount / 12
    if frequency == "quarterly":
        return amount / 3
    if frequency == "biweekly":
        return amount * 2.17
    return amount  # monthly fallthrough
