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


class SubscriptionMatchConflict(ValueError):
    """A prediction or transaction already has an incompatible disposition."""


class RevisionConflict(ValueError):
    """expected_revision did not match the transaction's current revision."""

    def __init__(self, current: dict):
        self.current = current
        super().__init__(f"Expected revision does not match current revision {current['revision']}")


class Storage:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        # The service worker must not hold the DB lock while waiting on Telegram.
        self.outbox_dispatch_lock = threading.Lock()

    @_locked
    def get_day_spending_facts(self, as_of=None, timezone="Asia/Singapore") -> dict:
        from src.spending_facts import day_facts
        return day_facts(self._conn, as_of, timezone)

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
    def get_daily_totals(self, start, end, timezone="Asia/Singapore") -> list[dict]:
        from src.spending_facts import daily_totals
        return daily_totals(self._conn, start, end, timezone)

    @_locked
    def get_transactions_v2(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
        merchant_search: Optional[str] = None,
        type: Optional[str] = None,
        trip_id: Optional[int] = None,
        needs_review: Optional[bool] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Same date/category/source filters as query_transactions, with a
        stable `id DESC` tiebreak so same-timestamp rows keep a fixed order
        across requests — infinite-scroll pagination over query_transactions'
        bare `transaction_date DESC` order can otherwise reshuffle ties
        between pages, duplicating or dropping a row at the boundary.
        query_transactions itself (v1) is left as-is rather than changed
        underneath existing callers.

        R09 sub-project 2 additions: merchant_search widened to also match a
        merchant's display alias (R06), description, category, and amount;
        `type` (a legacy NULL type is always an expense, matching every
        other type filter in this codebase); `trip_id` (via trip_transactions,
        R05's trip linkage); `needs_review` (a SQL approximation of
        spending_facts._needs_review/_missing_data for filtering purposes —
        same narrower, currency-code-unvalidated CASE fallback storage.py's
        money aggregates already use for rows without canonical columns;
        the Review page itself remains the source of truth for the full
        reason-coded list)."""
        conditions = []
        params: list = []
        joins = ""
        if start_date:
            conditions.append("DATE(transactions.transaction_date) >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("DATE(transactions.transaction_date) <= ?")
            params.append(end_date)
        if category:
            conditions.append("transactions.category = ?")
            params.append(category)
        if source:
            conditions.append("transactions.source = ?")
            params.append(source)
        if type:
            if type == "expense":
                conditions.append("(transactions.type = 'expense' OR transactions.type IS NULL)")
            else:
                conditions.append("transactions.type = ?")
                params.append(type)
        if trip_id is not None:
            joins += " JOIN trip_transactions tt ON tt.transaction_id = transactions.id"
            conditions.append("tt.trip_id = ?")
            params.append(trip_id)
        if needs_review:
            conditions.append(
                """(DATE(transactions.transaction_date) IS NULL
                    OR (CASE WHEN transactions.reporting_minor_units IS NOT NULL THEN transactions.reporting_minor_units
                             WHEN transactions.currency = 'SGD' OR transactions.currency IS NULL THEN CAST(ROUND(transactions.amount * 100) AS INTEGER)
                             WHEN transactions.exchange_rate IS NOT NULL AND transactions.exchange_rate > 0 AND transactions.exchange_rate != 1
                                  THEN CAST(ROUND(transactions.amount * transactions.exchange_rate * 100) AS INTEGER)
                             ELSE NULL END) IS NULL
                    OR COALESCE(transactions.type, 'expense') NOT IN ('expense', 'refund', 'income')
                    OR transactions.merchant IS NULL OR transactions.category IS NULL)"""
            )
        if merchant_search:
            joins += " LEFT JOIN merchant_aliases ma ON ma.merchant = transactions.merchant"
            term = f"%{merchant_search}%"
            conditions.append(
                "(transactions.merchant LIKE ? OR ma.display_name LIKE ? OR transactions.description LIKE ? "
                "OR transactions.category LIKE ? OR CAST(transactions.amount AS TEXT) LIKE ?)"
            )
            params.extend([term, term, term, term, term])
        where = " AND ".join(conditions) if conditions else "1=1"
        rows = self._conn.execute(
            f"SELECT transactions.* FROM transactions{joins} WHERE {where} "
            f"ORDER BY transactions.transaction_date DESC, transactions.id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_upcoming_plan(self, days=30, timezone="Asia/Singapore", limit=50, offset=0) -> dict:
        from src.spending_facts import convert_legacy_sgd, money
        if not 1 <= days <= 90 or not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid upcoming query")
        start = local_now(timezone).date()
        end = start + timedelta(days=days - 1)
        items = []
        for row in self._conn.execute(
            """SELECT u.id, u.expected_date, u.expected_amount, u.date_basis, u.amount_basis,
                      u.amount_basis_transaction_id, s.id AS subscription_id,
                      COALESCE(s.label, s.merchant) AS label, s.frequency, s.status, COALESCE(c.source, 'unknown') AS confirmation_source
               FROM upcoming_transactions u JOIN subscriptions s ON s.id = u.subscription_id
               LEFT JOIN subscription_confirmations c ON c.subscription_id = s.id
               WHERE u.status = 'pending' AND u.matched_transaction_id IS NULL
               AND s.status IN ('active', 'possibly_cancelled')
               AND DATE(u.expected_date) >= ? AND DATE(u.expected_date) <= ?
               ORDER BY DATE(u.expected_date), u.id""", (start.isoformat(), end.isoformat()),
        ):
            minor, _ = convert_legacy_sgd({"amount": row["expected_amount"], "currency": "SGD"})
            items.append({"id": row["id"], "subscription_id": row["subscription_id"],
                          "label": row["label"], "date": row["expected_date"],
                          "frequency": row["frequency"], "schedule_status": row["status"],
                          "confirmation_source": row["confirmation_source"],
                          "date_basis": row["date_basis"], "amount_basis": row["amount_basis"],
                          "amount_basis_transaction_id": row["amount_basis_transaction_id"],
                          "amount": money(minor) if minor is not None else None})
        unknown = sum(item["amount"] is None for item in items)
        return {"start": start.isoformat(), "end": end.isoformat(), "timezone": timezone,
                "enabled": self.get_setting("subscriptions_enabled", "false") == "true",
                "items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset,
                "known_total": money(sum(item["amount"]["minor_units"] for item in items if item["amount"])),
                "unknown_count": unknown, "status": "partial" if unknown else "estimated"}

    @_locked
    def get_home_briefing(self, timezone="Asia/Singapore") -> dict:
        from src.spending_facts import convert_legacy_sgd, money, resolve_money
        today = local_now(timezone).date()
        facts = self.get_month_spending_facts(today, timezone)
        recent = []
        for row in self.query_transactions(limit=5):
            minor, status = resolve_money(row)
            recent.append({
                "id": row["id"], "merchant": row["merchant"], "category": row["category"] or "Other",
                "type": row["type"] or "expense", "date": row["transaction_date"],
                "amount": money(minor) if minor is not None else None, "conversion_status": status,
            })
        upcoming = []
        if self.get_setting("subscriptions_enabled", "false") == "true":
            for row in self._conn.execute(
                """SELECT u.id, u.expected_date, u.expected_amount, u.date_basis, u.amount_basis,
                          u.amount_basis_transaction_id, s.id AS subscription_id,
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
                                 "date_basis": row["date_basis"], "amount_basis": row["amount_basis"],
                                 "amount_basis_transaction_id": row["amount_basis_transaction_id"],
                                 "amount": money(minor) if minor is not None else None})
        return {
            "facts": facts, "recent": recent, "upcoming": upcoming,
            "upcoming_total": money(sum(item["amount"]["minor_units"] for item in upcoming if item["amount"])),
            "upcoming_unknown_count": sum(item["amount"] is None for item in upcoming),
            "capture_issue_count": self._conn.execute("""SELECT COUNT(*) FROM source_events e WHERE status != 'processed'
                AND NOT EXISTS (SELECT 1 FROM capture_issue_resolutions r WHERE r.event_id = e.id)""").fetchone()[0],
            "followup_issue_count": self._conn.execute("SELECT COUNT(*) FROM ingestion_outbox WHERE status != 'done'").fetchone()[0],
            # R06: all-history counts for Home/Activity's review summary — each is
            # already a distinct-transaction/suggestion total regardless of the
            # limit passed, since spending_review/get_recurring_review count before
            # paginating.
            "review_count": self.get_spending_review(timezone=timezone, limit=1)["total"],
            "recurring_suggestion_count": self.get_recurring_review(limit=1)["total"],
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
            if source == "telegram_nl":
                return "manual"
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
            """SELECT * FROM source_events WHERE (source = ? OR (? IS NULL AND source NOT IN ('gmail', 'telegram_nl')))
               AND status IN ('pending', 'failed') AND attempts < 5
               ORDER BY attempts, id LIMIT ?""", (source, source, limit),
        ).fetchall()]

    @_locked
    def get_capture_health(self) -> dict:
        """Bounded operational signal for this user's capture pipeline: never
        exposes payloads, source identifiers, or financial values."""
        oldest_queued_at = self._conn.execute(
            """SELECT MIN(created_at) FROM (
                 SELECT created_at FROM source_events WHERE status IN ('pending', 'failed') AND attempts < 5
                 UNION ALL
                 SELECT created_at FROM ingestion_outbox WHERE status IN ('pending', 'failed') AND attempts < 5
               )"""
        ).fetchone()[0]
        exhausted_retry_count = (
            self._conn.execute(
                "SELECT COUNT(*) FROM source_events WHERE attempts >= 5 AND status != 'processed'"
            ).fetchone()[0]
            + self._conn.execute(
                "SELECT COUNT(*) FROM ingestion_outbox WHERE attempts >= 5 AND status != 'done'"
            ).fetchone()[0]
        )
        last_capture_processed_at = self._conn.execute(
            "SELECT MAX(updated_at) FROM source_events WHERE status = 'processed'"
        ).fetchone()[0]
        return {
            "oldest_queued_at": oldest_queued_at,
            "exhausted_retry_count": exhausted_retry_count,
            "last_capture_processed_at": last_capture_processed_at,
        }

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
    def list_capture_issues(self, limit: int = 50, offset: int = 0, include_handled: bool = False) -> list[dict]:
        return [dict(row) for row in self._conn.execute(
            """SELECT e.id, source, parser_version, status, transaction_id, attempts,
                      error_code, created_at, updated_at, r.event_id IS NOT NULL AS handled
               FROM source_events e LEFT JOIN capture_issue_resolutions r ON r.event_id = e.id
               WHERE status != 'processed' AND (? OR r.event_id IS NULL)
               ORDER BY e.id DESC LIMIT ? OFFSET ?""", (include_handled, limit, offset),
        ).fetchall()]

    @_locked
    def set_capture_issue_handled(self, event_id: int, handled: bool) -> dict:
        row = self._conn.execute("SELECT source, status FROM source_events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise ValueError("Source event not found")
        if row["source"] != "telegram_nl" or row["status"] == "processed":
            raise ValueError("Only unfinished Telegram input can be marked handled or returned to Review")
        with self._conn:
            if handled:
                self._conn.execute("INSERT OR IGNORE INTO capture_issue_resolutions(event_id) VALUES (?)", (event_id,))
            else:
                self._conn.execute("DELETE FROM capture_issue_resolutions WHERE event_id = ?", (event_id,))
        return {"id": event_id, "handled": handled}

    @_locked
    def retry_source_event(self, event_id: int) -> None:
        row = self._conn.execute("SELECT status, source FROM source_events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise ValueError("Source event not found")
        if row["source"] == "telegram_nl":
            raise ValueError("Use Telegram /add or send a new entry to recover this input")
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
        consumed_draft_id: Optional[str] = None,
        rate_result=None,  # Optional[src.exchange.RateResult] — a fresh get_rate() call
    ) -> int:
        from src.canonical_money import compute_transaction_canonical
        canonical = compute_transaction_canonical(
            {"amount": amount, "currency": currency, "exchange_rate": exchange_rate},
            rate_override=rate_result,
            quoted_at=local_now().isoformat() if rate_result is not None and rate_result.status != "unresolved" else None,
        )
        try:
            with self._conn:
                cursor = self._conn.execute(
                    """INSERT INTO transactions
                       (source, source_id, amount, currency, exchange_rate, merchant, description,
                        category, transaction_date, raw_data, type,
                        original_minor_units, reporting_minor_units, conversion_status,
                        conversion_rate, conversion_source, conversion_quoted_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (source, source_id, amount, currency, exchange_rate, merchant, description,
                     category, transaction_date, raw_data, tx_type,
                     canonical["original_minor_units"], canonical["reporting_minor_units"],
                     canonical["conversion_status"], canonical["conversion_rate"],
                     canonical["conversion_source"], canonical["conversion_quoted_at"]),
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
                if consumed_draft_id is not None:
                    self._conn.execute(
                        """UPDATE source_events SET transaction_id = ?, updated_at = CURRENT_TIMESTAMP
                           WHERE source = 'telegram_nl' AND status = 'processed' AND source_id IN
                           (SELECT message_key FROM telegram_draft_messages WHERE draft_id = ?)""",
                        (tx_id, consumed_draft_id),
                    )
                    self._conn.execute("DELETE FROM telegram_drafts WHERE draft_id = ?", (consumed_draft_id,))
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
                existing = self._conn.execute(
                    """SELECT 1 FROM ingestion_outbox WHERE kind = 'suggestion' AND transaction_id =
                       (SELECT transaction_id FROM ingestion_outbox WHERE id = ?)""", (effect_id,),
                ).fetchone()
                if not existing:
                    recorded = self._prepare_recurring_suggestion(None, suggestion["merchant"], suggestion["frequency"], suggestion["avg_amount"])
                    suggestion = {**suggestion, "suggestion_id": recorded["id"]}
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
    def get_refunds_of(self, tx_id: int) -> list[dict]:
        """Reverse lookup: every refund currently linked to `tx_id` as its
        original purchase (evidence only, R05 sub-project 2)."""
        rows = self._conn.execute(
            "SELECT * FROM transactions WHERE refund_of_transaction_id = ? ORDER BY transaction_date",
            (tx_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def get_refund_match_review(self, limit: int = 50, offset: int = 0) -> dict:
        from src.spending_facts import refund_match_review
        return refund_match_review(self._conn, limit=limit, offset=offset)

    @_locked
    def resolve_refund_match(self, refund_transaction_id: int, action: str) -> None:
        if action not in ("accept", "dismiss"):
            raise ValueError("Invalid refund match action")
        if action == "dismiss":
            self._conn.execute(
                "INSERT OR IGNORE INTO refund_match_dismissals(refund_transaction_id) VALUES (?)",
                (refund_transaction_id,),
            )
            self._conn.commit()
            return
        from src.spending_facts import refund_match_candidate
        refund = self.get_transaction(refund_transaction_id)
        if refund is None:
            raise ValueError(f"transaction {refund_transaction_id} not found")
        candidate = refund_match_candidate(self._conn, refund)
        if candidate is None:
            raise ValueError("No refund match proposal for this transaction")
        self.update_transaction(refund_transaction_id, refund_of_transaction_id=candidate["id"])

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
    def create_telegram_transaction(self, *, chat_id: int, message_id: int,
                                    command: str, args: list[str], **fields) -> tuple[int, bool]:
        """Return (transaction ID, replayed) for a direct Telegram entry command."""
        if type(chat_id) is not int or type(message_id) is not int or message_id <= 0:
            raise ValueError("Invalid Telegram message identity")
        if command not in ("add", "cash", "income"):
            raise ValueError("Invalid Telegram entry command")
        # ':' cannot appear in a web request key. The command is in the hash,
        # not the key: editing /add into /income must not create another row.
        request_key = f"telegram:{chat_id}:{message_id}"
        receipt, previous = self._transaction_request(request_key, {"command": command, "args": args})
        if previous is not None:
            return previous["id"], True
        # Distinct messages can arrive in the same second with the same amount.
        # Existing source IDs remain untouched; only new identified commands use this format.
        fields["source_id"] = "telegram-" + hashlib.sha256(request_key.encode()).hexdigest()
        tx_id = self.create_manual_transaction(_request_receipt=receipt, **fields)
        return tx_id, False

    @staticmethod
    def _telegram_draft_message_identity(chat_id: int, message_id: int, text: str) -> tuple[str, str]:
        if type(chat_id) is not int or type(message_id) is not int or message_id <= 0 or not isinstance(text, str):
            raise ValueError("Invalid Telegram message identity")
        return (hashlib.sha256(f"{chat_id}:{message_id}".encode()).hexdigest(),
                hashlib.sha256(text.encode()).hexdigest())

    @_locked
    def begin_telegram_nl_input(self, chat_id: int, message_id: int, raw_text: str) -> Optional[dict]:
        key, _ = self._telegram_draft_message_identity(chat_id, message_id, raw_text)
        event = self.get_source_event("telegram_nl", key)
        if event is None:
            event = self.record_source_event("telegram_nl", key, json.dumps({"text": raw_text}), "telegram-nl:1")
        elif json.loads(event["payload"])["text"].strip() != raw_text.strip():
            raise TransactionRequestConflict("This Telegram message was already received with different text")
        if (event["status"] == "processed" or event["attempts"] >= 5
                or self._conn.execute("SELECT 1 FROM capture_issue_resolutions WHERE event_id = ?", (event["id"],)).fetchone()):
            return None
        with self._conn:
            self._conn.execute(
                """UPDATE source_events SET status = 'pending', attempts = attempts + 1,
                   error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?""", (event["id"],),
            )
        return self.get_source_event("telegram_nl", key)

    @_locked
    def fail_telegram_nl_input(self, event_id: int, *, unrecognized=False) -> None:
        with self._conn:
            self._conn.execute(
                """UPDATE source_events SET status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND source = 'telegram_nl' AND status != 'processed'""",
                ("unrecognized" if unrecognized else "failed", "nl_unrecognized" if unrecognized else "nl_processing_failed", event_id),
            )

    @_locked
    def get_telegram_draft_for_message(self, chat_id: int, message_id: int, text: str) -> Optional[dict]:
        message_key, fingerprint = self._telegram_draft_message_identity(chat_id, message_id, text)
        receipt = self._conn.execute(
            "SELECT fingerprint, draft_id FROM telegram_draft_messages WHERE message_key = ?", (message_key,),
        ).fetchone()
        if receipt is None:
            return None
        if receipt["fingerprint"] != fingerprint:
            raise TransactionRequestConflict("This Telegram message was already handled")
        draft = self.get_telegram_draft(receipt["draft_id"], chat_id)
        if draft is None:
            # Retained links prevent canceled, replaced, expired, or accepted drafts
            # from being revived by redelivery. They deliberately are not foreign keys.
            raise TransactionRequestConflict("This Telegram message was already handled")
        return draft

    @_locked
    def save_telegram_draft(self, draft_id: str, chat_id: int, draft: dict, *,
                            message_id=None, message_text=None) -> dict:
        if not isinstance(draft_id, str) or not re.fullmatch(r"[a-f0-9]{32}", draft_id):
            raise ValueError("Invalid Telegram draft identity")
        if type(chat_id) is not int:
            raise ValueError("Invalid Telegram chat identity")
        message_receipt = None
        if message_id is not None:
            previous = self.get_telegram_draft_for_message(chat_id, message_id, message_text)
            if previous is not None:
                return previous
            message_receipt = self._telegram_draft_message_identity(chat_id, message_id, message_text)
            if self._conn.execute(
                """SELECT 1 FROM capture_issue_resolutions r JOIN source_events e ON e.id = r.event_id
                   WHERE e.source = 'telegram_nl' AND e.source_id = ?""", (message_receipt[0],),
            ).fetchone():
                raise TransactionRequestConflict("This Telegram message was already handled")
        payload = json.dumps({key: draft[key] for key in ("amount", "currency", "merchant", "category", "date")})
        now = int(local_now().timestamp())
        with self._conn:
            self._conn.execute("DELETE FROM telegram_drafts WHERE chat_id = ? OR expires_at <= ?", (chat_id, now))
            self._conn.execute(
                "INSERT INTO telegram_drafts(draft_id, chat_id, payload, expires_at) VALUES (?, ?, ?, ?)",
                (draft_id, chat_id, payload, now + 24 * 60 * 60),
            )
            if message_receipt is not None:
                self._conn.execute(
                    "INSERT INTO telegram_draft_messages(message_key, fingerprint, draft_id) VALUES (?, ?, ?)",
                    (*message_receipt, draft_id),
                )
                self._conn.execute(
                    """UPDATE source_events SET status = 'processed', error_code = NULL,
                       updated_at = CURRENT_TIMESTAMP WHERE source = 'telegram_nl' AND source_id = ?""",
                    (message_receipt[0],),
                )
        return {**json.loads(payload), "_id": draft_id, "_chat_id": chat_id}

    @_locked
    def get_telegram_draft(self, draft_id: str, chat_id: int) -> Optional[dict]:
        with self._conn:
            self._conn.execute("DELETE FROM telegram_drafts WHERE expires_at <= ?", (int(local_now().timestamp()),))
        row = self._conn.execute(
            "SELECT * FROM telegram_drafts WHERE draft_id = ? AND chat_id = ?", (draft_id, chat_id),
        ).fetchone()
        if row is None:
            return None
        return {**json.loads(row["payload"]), "_id": row["draft_id"], "_chat_id": row["chat_id"]}

    @_locked
    def discard_telegram_draft(self, draft_id: str, chat_id: int) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM telegram_drafts WHERE draft_id = ? AND chat_id = ?", (draft_id, chat_id))

    @_locked
    def confirm_telegram_draft(self, draft_id: str, draft: dict, exchange_rate=None, *, chat_id=None) -> tuple[int, bool]:
        """Accept one confirmed NL draft, excluding fetched FX from replay identity."""
        if not isinstance(draft_id, str) or not re.fullmatch(r"[a-f0-9]{32}", draft_id):
            raise ValueError("Invalid Telegram draft identity")
        if chat_id is not None:
            draft = self.get_telegram_draft(draft_id, chat_id)
            if draft is None:
                raise ValueError("Telegram draft expired or unavailable")
        submitted = {key: draft[key] for key in ("amount", "currency", "merchant", "category", "date")}
        receipt, previous = self._transaction_request(f"telegram-nl:{draft_id}", submitted)
        if previous is not None:
            if chat_id is not None:
                self.discard_telegram_draft(draft_id, chat_id)
            return previous["id"], True
        tx_id = self.create_manual_transaction(
            source_id=f"telegram-nl-{draft_id}", amount=submitted["amount"],
            currency=submitted["currency"], merchant=submitted["merchant"],
            category=submitted["category"], transaction_date=submitted["date"],
            exchange_rate=exchange_rate, assign_to_active_trip=True, _request_receipt=receipt,
            _consumed_draft_id=draft_id if chat_id is not None else None,
        )
        return tx_id, False

    @_locked
    def create_manual_transaction(self, *, source_id: str, amount, transaction_date,
                                  source="manual", currency="SGD", exchange_rate=None,
                                  merchant=None, description=None, category=None,
                                  tx_type="expense", assign_to_active_trip=False,
                                  _request_receipt=None, _consumed_draft_id=None) -> int:
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
                                       manual_evidence=evidence, request_receipt=_request_receipt,
                                       consumed_draft_id=_consumed_draft_id, **fields)

    @_locked
    def update_transaction(
        self, tx_id: int, *, remember_category: bool = False,
        expected_revision: Optional[int] = None, **fields,
    ) -> None:
        if not fields:
            return
        tx = self.get_transaction(tx_id)
        if tx is None:
            raise ValueError(f"transaction {tx_id} not found")
        if expected_revision is not None and expected_revision != tx["revision"]:
            raise RevisionConflict(tx)
        fields = normalize_transaction_fields(fields)
        if "refund_of_transaction_id" in fields and fields["refund_of_transaction_id"] is not None:
            target_id = fields["refund_of_transaction_id"]
            if target_id == tx_id:
                raise ValueError("A refund cannot link to itself")
            effective_type = fields.get("type", tx["type"])
            if effective_type != "refund":
                raise ValueError("Only a refund transaction can link to a purchase")
            target = self.get_transaction(target_id)
            if target is None:
                raise ValueError(f"transaction {target_id} not found")
            if target["type"] not in (None, "expense"):
                raise ValueError("A refund can only link to an expense transaction")
        elif (
            "type" in fields and fields["type"] != "refund"
            and tx.get("refund_of_transaction_id") is not None
            and "refund_of_transaction_id" not in fields
        ):
            # Reclassifying away from 'refund' without explicitly touching the
            # link would otherwise leave a non-refund row carrying one,
            # violating the "only a refund carries a link" invariant.
            fields["refund_of_transaction_id"] = None
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

        # A correction to any legacy money input must recompute the canonical
        # columns too — otherwise they'd silently go stale relative to the
        # edited amount/currency/exchange_rate.
        if fields.keys() & {"amount", "currency", "exchange_rate"}:
            from src.canonical_money import compute_transaction_canonical
            canonical = compute_transaction_canonical({
                "amount": fields.get("amount", tx["amount"]),
                "currency": fields.get("currency", tx["currency"]),
                "exchange_rate": fields.get("exchange_rate", tx["exchange_rate"]),
            })
            fields["original_minor_units"] = canonical["original_minor_units"]
            fields["reporting_minor_units"] = canonical["reporting_minor_units"]
            fields["conversion_status"] = canonical["conversion_status"]
            fields["conversion_rate"] = canonical["conversion_rate"]
            fields["conversion_source"] = canonical["conversion_source"]
            fields["conversion_quoted_at"] = canonical["conversion_quoted_at"]

        changed_fields = {
            key: {"old": tx.get(key), "new": value}
            for key, value in fields.items()
            if key in tx and tx[key] != value
        }
        new_revision = tx["revision"] + 1
        fields["revision"] = new_revision
        set_clauses = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [tx_id]
        with self._conn:
            self._conn.execute(
                f"UPDATE transactions SET {set_clauses} WHERE id = ?", values
            )
            if changed_fields:
                self._conn.execute(
                    "INSERT INTO transaction_mutations"
                    "(transaction_id, revision_before, revision_after, changed_fields) VALUES (?, ?, ?, ?)",
                    (tx_id, tx["revision"], new_revision, json.dumps(changed_fields)),
                )
            if remember_category:
                self._conn.execute(
                    "INSERT OR REPLACE INTO merchant_overrides (merchant, category, updated_at) "
                    "VALUES (?, ?, CURRENT_TIMESTAMP)", (merchant, fields["category"]),
                )

    @_locked
    def undo_last_mutation(self, tx_id: int, *, expected_revision: Optional[int] = None) -> None:
        """Revert the most recent recorded correction to `tx_id`.

        Always targets the mutation whose revision_after equals the
        transaction's current revision — i.e. "undo the last thing that
        happened", not a specific past edit. An intervening edit since the
        caller last saw the transaction changes what gets undone rather than
        blocking it; expected_revision lets a caller detect that and re-fetch.
        The undo itself is appended as a new mutation (old/new swapped), so
        the history stays append-only and undoing twice redoes the edit.
        """
        tx = self.get_transaction(tx_id)
        if tx is None:
            raise ValueError(f"transaction {tx_id} not found")
        if expected_revision is not None and expected_revision != tx["revision"]:
            raise RevisionConflict(tx)
        mutation = self._conn.execute(
            "SELECT * FROM transaction_mutations WHERE transaction_id = ? AND revision_after = ? "
            "ORDER BY id DESC LIMIT 1",
            (tx_id, tx["revision"]),
        ).fetchone()
        if mutation is None:
            raise ValueError(f"transaction {tx_id} has no correction to undo")
        changed = json.loads(mutation["changed_fields"])
        revert_fields = {key: entry["old"] for key, entry in changed.items()}
        new_revision = tx["revision"] + 1
        revert_fields["revision"] = new_revision
        set_clauses = ", ".join(f"{k} = ?" for k in revert_fields)
        values = list(revert_fields.values()) + [tx_id]
        with self._conn:
            self._conn.execute(f"UPDATE transactions SET {set_clauses} WHERE id = ?", values)
            undo_changed = {
                key: {"old": entry["new"], "new": entry["old"]} for key, entry in changed.items()
            }
            self._conn.execute(
                "INSERT INTO transaction_mutations"
                "(transaction_id, revision_before, revision_after, changed_fields) VALUES (?, ?, ?, ?)",
                (tx_id, tx["revision"], new_revision, json.dumps(undo_changed)),
            )

    @_locked
    def bulk_correct(
        self, transaction_ids: list[int], *,
        category: Optional[str] = None, type: Optional[str] = None,
        remember_category: bool = False,
        expected_revisions: Optional[dict[int, int]] = None,
    ) -> list[dict]:
        """R09: apply the same category and/or type correction to several
        transactions in one call. Each row goes through the ordinary
        update_transaction path — same mutation-history/undo/revision-
        conflict machinery as any other correction, per row, not a bespoke
        bulk write — matching apply_category_rule_to_existing's (R06)
        precedent for exactly this reason: an ordinary per-transaction undo
        keeps working for free, and a row's failure never blocks the rest
        of the batch. Only category/type are ever touched, so every other
        field (description, source evidence, and everything R05's relation
        machinery already validates on a type change, e.g. clearing a stale
        refund_of_transaction_id) is preserved exactly as update_transaction
        already handles it for a single correction."""
        fields: dict = {}
        if category is not None:
            fields["category"] = category
        if type is not None:
            fields["type"] = type
        results = []
        for tx_id in transaction_ids:
            expected = (expected_revisions or {}).get(tx_id)
            try:
                self.update_transaction(
                    tx_id, remember_category=remember_category,
                    expected_revision=expected, **fields,
                )
                tx = self.get_transaction(tx_id)
                results.append({"id": tx_id, "status": "ok", "revision": tx["revision"]})
            except RevisionConflict as exc:
                results.append({"id": tx_id, "status": "conflict", "current_revision": exc.current["revision"]})
            except ValueError as exc:
                results.append({"id": tx_id, "status": "error", "detail": str(exc)})
        return results

    @_locked
    def bulk_undo(
        self, transaction_ids: list[int],
        expected_revisions: Optional[dict[int, int]] = None,
    ) -> list[dict]:
        """R09: undo_last_mutation over several transactions, one call per
        row — same reasoning as bulk_correct. Each row targets whichever
        correction is currently its own most recent one, so this is exactly
        equivalent to a user hitting undo on each row individually; it does
        not track "the set of rows this particular bulk_correct touched"
        as a first-class batch."""
        results = []
        for tx_id in transaction_ids:
            expected = (expected_revisions or {}).get(tx_id)
            try:
                self.undo_last_mutation(tx_id, expected_revision=expected)
                tx = self.get_transaction(tx_id)
                results.append({"id": tx_id, "status": "ok", "revision": tx["revision"]})
            except RevisionConflict as exc:
                results.append({"id": tx_id, "status": "conflict", "current_revision": exc.current["revision"]})
            except ValueError as exc:
                results.append({"id": tx_id, "status": "error", "detail": str(exc)})
        return results

    @_locked
    def delete_transaction(self, tx_id: int) -> str:
        tx = self.get_transaction(tx_id)
        if tx is None:
            raise ValueError(f"transaction {tx_id} not found")
        # Revert any upcoming_transactions row this actual charge was matched
        # to back to a pending forecast, rather than leaving it (or a FK
        # constraint) pointing at a row that's about to be deleted.
        self._conn.execute(
            "UPDATE upcoming_transactions SET status = 'pending', matched_transaction_id = NULL "
            "WHERE matched_transaction_id = ?",
            (tx_id,),
        )
        # Retained snapshot: gives a future 409 (someone deleted this
        # concurrently) a real current-state summary, and is the evidence
        # restore_deleted_transaction restores from. The id is never reused
        # for a new row. Carries the canonical-money columns too, not just
        # the legacy amount/currency, so a restore doesn't need to recompute
        # (and can't silently diverge from) what the row had when deleted.
        self._conn.execute(
            """INSERT INTO deleted_transactions
               (id, source, source_id, amount, currency, exchange_rate, merchant, description,
                category, transaction_date, type, revision, original_minor_units,
                reporting_minor_units, conversion_status, conversion_rate, conversion_source,
                conversion_quoted_at, refund_of_transaction_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tx["id"], tx["source"], tx["source_id"], tx["amount"], tx["currency"], tx["exchange_rate"],
             tx["merchant"], tx["description"], tx["category"], tx["transaction_date"], tx["type"],
             tx["revision"], tx.get("original_minor_units"), tx.get("reporting_minor_units"),
             tx.get("conversion_status"), tx.get("conversion_rate"), tx.get("conversion_source"),
             tx.get("conversion_quoted_at"), tx.get("refund_of_transaction_id")),
        )
        self._conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        deleted_at = self._conn.execute(
            "SELECT deleted_at FROM deleted_transactions WHERE id = ?", (tx_id,)
        ).fetchone()["deleted_at"]
        self._conn.commit()
        return deleted_at

    @_locked
    def restore_deleted_transaction(self, tx_id: int) -> int:
        """Restore a transaction deleted via delete_transaction, using its
        retained snapshot. Not itself logged to transaction_mutations —
        that table's changed_fields are applied as literal column names by
        undo_last_mutation, and "was deleted" isn't a real transactions
        column. Returns the restored row's new (bumped) revision.
        """
        if self.get_transaction(tx_id) is not None:
            raise ValueError(f"transaction {tx_id} already exists")
        snapshot = self._conn.execute(
            "SELECT * FROM deleted_transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if snapshot is None:
            raise ValueError(f"transaction {tx_id} has no deletion record")
        if snapshot["original_minor_units"] is None:
            raise ValueError(
                f"transaction {tx_id} deletion predates full snapshot retention and cannot be restored"
            )
        new_revision = snapshot["revision"] + 1
        # The live column has a real FK (ON DELETE SET NULL) — restoring with
        # a link to a purchase that's gone for good (deleted and never
        # restored) would otherwise violate that constraint at INSERT time.
        # Degrade gracefully to no link, same as if the purchase had been
        # deleted after this refund was restored.
        refund_of = snapshot["refund_of_transaction_id"]
        if refund_of is not None and self.get_transaction(refund_of) is None:
            refund_of = None
        with self._conn:
            self._conn.execute(
                """INSERT INTO transactions
                   (id, source, source_id, amount, currency, exchange_rate, merchant, description,
                    category, transaction_date, type, revision, original_minor_units,
                    reporting_minor_units, conversion_status, conversion_rate, conversion_source,
                    conversion_quoted_at, refund_of_transaction_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (snapshot["id"], snapshot["source"], snapshot["source_id"], snapshot["amount"],
                 snapshot["currency"], snapshot["exchange_rate"], snapshot["merchant"], snapshot["description"],
                 snapshot["category"], snapshot["transaction_date"], snapshot["type"], new_revision,
                 snapshot["original_minor_units"], snapshot["reporting_minor_units"],
                 snapshot["conversion_status"], snapshot["conversion_rate"], snapshot["conversion_source"],
                 snapshot["conversion_quoted_at"], refund_of),
            )
            self._conn.execute("DELETE FROM deleted_transactions WHERE id = ?", (tx_id,))
        return new_revision

    _DUPLICATE_PAIR_QUERY = """
        SELECT t1.id AS a_id, t2.id AS b_id FROM transactions t1
        JOIN transactions t2 ON t1.id < t2.id
        WHERE t1.amount = t2.amount AND t1.currency = t2.currency
        AND COALESCE(t1.type, 'expense') = COALESCE(t2.type, 'expense')
        AND t1.merchant IS NOT NULL AND t2.merchant IS NOT NULL
        AND LOWER(TRIM(t1.merchant)) = LOWER(TRIM(t2.merchant))
        AND t1.source != t2.source
        AND LENGTH(t1.transaction_date) > 10 AND LENGTH(t2.transaction_date) > 10
        AND EXISTS (SELECT 1 FROM source_events e WHERE e.transaction_id = t1.id
            AND e.status = 'processed' AND e.timestamp_precision IN ('minute', 'second'))
        AND EXISTS (SELECT 1 FROM source_events e WHERE e.transaction_id = t2.id
            AND e.status = 'processed' AND e.timestamp_precision IN ('minute', 'second'))
        AND ABS(julianday(t1.transaction_date) - julianday(t2.transaction_date)) * 86400 <= ?
        AND NOT EXISTS (SELECT 1 FROM duplicate_dismissals d
            WHERE d.transaction_a_id = t1.id AND d.transaction_b_id = t2.id)
        ORDER BY t1.transaction_date DESC, t1.id, t2.id
    """

    @_locked
    def get_duplicate_review(self, limit: int = 50, offset: int = 0, within_seconds: int = 600) -> dict:
        """Retroactive candidate duplicates among already-recorded transactions,
        using the same conservative criteria capture-time reconciliation
        (find_cross_source_duplicate) already applies: same amount/currency/
        type/merchant, different sources, both backed by minute/second-
        precision evidence, and close together in time. Ambiguous
        same-amount pairs and date-only evidence never qualify."""
        from src.spending_facts import money, resolve_money
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid duplicate review query")
        pairs = self._conn.execute(self._DUPLICATE_PAIR_QUERY, (within_seconds,)).fetchall()

        def side(tx: dict) -> dict:
            minor, status = resolve_money(tx)
            return {"id": tx["id"], "merchant": tx["merchant"], "date": tx["transaction_date"],
                   "source": tx["source"], "amount": money(minor) if minor is not None else None,
                   "conversion_status": status}

        items = []
        for row in pairs[offset:offset + limit]:
            items.append({
                "transaction_a": side(self.get_transaction(row["a_id"])),
                "transaction_b": side(self.get_transaction(row["b_id"])),
                "reason": "same_merchant_amount_time_cross_source",
            })
        return {"items": items, "total": len(pairs), "limit": limit, "offset": offset}

    @_locked
    def dismiss_duplicate(self, transaction_a_id: int, transaction_b_id: int) -> None:
        a_id, b_id = sorted((transaction_a_id, transaction_b_id))
        if a_id == b_id:
            raise ValueError("A transaction cannot be a duplicate of itself")
        if self.get_transaction(a_id) is None or self.get_transaction(b_id) is None:
            raise ValueError("Both transactions must exist")
        self._conn.execute(
            "INSERT OR IGNORE INTO duplicate_dismissals (transaction_a_id, transaction_b_id) VALUES (?, ?)",
            (a_id, b_id),
        )
        self._conn.commit()

    @_locked
    def merge_transactions(self, survivor_id: int, loser_id: int) -> int:
        """Merge loser_id into survivor_id: the loser's evidence, trip link,
        and any upcoming-charge match move onto the survivor, refunds that
        pointed at the loser get repointed, and the loser is then removed via
        the existing delete_transaction/restore_deleted_transaction
        machinery — preserving its source id/evidence as a retained snapshot
        and making undo possible without any bespoke restore path. Everything
        actually moved is recorded so undo_transaction_merge can reverse
        precisely this merge, not guess at it."""
        if survivor_id == loser_id:
            raise ValueError("A transaction cannot be merged with itself")
        survivor = self.get_transaction(survivor_id)
        loser = self.get_transaction(loser_id)
        if survivor is None or loser is None:
            raise ValueError("Both transactions must exist")

        moved_events = [r["id"] for r in self._conn.execute(
            "SELECT id FROM source_events WHERE transaction_id = ?", (loser_id,)).fetchall()]
        if moved_events:
            self._conn.execute(
                f"UPDATE source_events SET transaction_id = ? WHERE id IN ({','.join('?' * len(moved_events))})",
                [survivor_id, *moved_events],
            )

        loser_trips = [r["trip_id"] for r in self._conn.execute(
            "SELECT trip_id FROM trip_transactions WHERE transaction_id = ?", (loser_id,)).fetchall()]
        moved_trips = []
        for trip_id in loser_trips:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO trip_transactions (trip_id, transaction_id) VALUES (?, ?)",
                (trip_id, survivor_id),
            )
            if cur.rowcount:
                moved_trips.append(trip_id)

        upcoming_row = self._conn.execute(
            "SELECT id FROM upcoming_transactions WHERE matched_transaction_id = ?", (loser_id,)).fetchone()
        moved_upcoming = None
        if upcoming_row is not None and not self._conn.execute(
                "SELECT 1 FROM upcoming_transactions WHERE matched_transaction_id = ?", (survivor_id,)).fetchone():
            self._conn.execute(
                "UPDATE upcoming_transactions SET matched_transaction_id = ? WHERE id = ?",
                (survivor_id, upcoming_row["id"]),
            )
            moved_upcoming = upcoming_row["id"]

        # Only repoint refunds if the survivor can legally carry a link
        # (update_transaction's own linking validation) — otherwise leave
        # them for the FK's ON DELETE SET NULL to clear when the loser row
        # is deleted below, same degrade-to-no-link precedent
        # restore_deleted_transaction already uses.
        moved_refunds = []
        if survivor["type"] in (None, "expense"):
            moved_refunds = [r["id"] for r in self._conn.execute(
                "SELECT id FROM transactions WHERE refund_of_transaction_id = ?", (loser_id,)).fetchall()]
            if moved_refunds:
                self._conn.execute(
                    f"UPDATE transactions SET refund_of_transaction_id = ? "
                    f"WHERE id IN ({','.join('?' * len(moved_refunds))})",
                    [survivor_id, *moved_refunds],
                )

        survivor_refund_of_changed = False
        survivor_refund_of_before = survivor.get("refund_of_transaction_id")
        if (survivor["type"] == "refund" and survivor_refund_of_before is None
                and loser.get("refund_of_transaction_id") is not None):
            self.update_transaction(survivor_id, refund_of_transaction_id=loser["refund_of_transaction_id"])
            survivor_refund_of_changed = True

        self.delete_transaction(loser_id)

        cursor = self._conn.execute(
            """INSERT INTO transaction_merges
               (survivor_transaction_id, loser_transaction_id, moved_source_event_ids, moved_trip_ids,
                moved_upcoming_transaction_id, moved_refund_ids, survivor_refund_of_changed,
                survivor_refund_of_before)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (survivor_id, loser_id, json.dumps(moved_events), json.dumps(moved_trips),
             moved_upcoming, json.dumps(moved_refunds), int(survivor_refund_of_changed),
             survivor_refund_of_before),
        )
        self._conn.commit()
        return cursor.lastrowid

    @_locked
    def undo_transaction_merge(self, merge_id: int) -> None:
        row = self._conn.execute("SELECT * FROM transaction_merges WHERE id = ?", (merge_id,)).fetchone()
        if row is None:
            raise ValueError(f"merge {merge_id} not found")
        if row["undone_at"] is not None:
            raise ValueError(f"merge {merge_id} was already undone")
        survivor_id = row["survivor_transaction_id"]
        loser_id = row["loser_transaction_id"]

        self.restore_deleted_transaction(loser_id)

        moved_events = json.loads(row["moved_source_event_ids"])
        if moved_events:
            self._conn.execute(
                f"UPDATE source_events SET transaction_id = ? WHERE id IN ({','.join('?' * len(moved_events))})",
                [loser_id, *moved_events],
            )

        for trip_id in json.loads(row["moved_trip_ids"]):
            self._conn.execute(
                "DELETE FROM trip_transactions WHERE trip_id = ? AND transaction_id = ?", (trip_id, survivor_id))
            self._conn.execute(
                "INSERT OR IGNORE INTO trip_transactions (trip_id, transaction_id) VALUES (?, ?)",
                (trip_id, loser_id),
            )

        if row["moved_upcoming_transaction_id"] is not None:
            current = self._conn.execute(
                "SELECT matched_transaction_id FROM upcoming_transactions WHERE id = ?",
                (row["moved_upcoming_transaction_id"],),
            ).fetchone()
            # Only reclaim it if it's still matched to the survivor — a later,
            # unrelated re-match must never be clobbered by this undo.
            if current is not None and current["matched_transaction_id"] == survivor_id:
                self._conn.execute(
                    "UPDATE upcoming_transactions SET matched_transaction_id = ? WHERE id = ?",
                    (loser_id, row["moved_upcoming_transaction_id"]),
                )

        moved_refunds = json.loads(row["moved_refund_ids"])
        if moved_refunds:
            self._conn.execute(
                f"UPDATE transactions SET refund_of_transaction_id = ? "
                f"WHERE id IN ({','.join('?' * len(moved_refunds))}) AND refund_of_transaction_id = ?",
                [loser_id, *moved_refunds, survivor_id],
            )

        if row["survivor_refund_of_changed"]:
            self.update_transaction(survivor_id, refund_of_transaction_id=row["survivor_refund_of_before"])

        self._conn.execute(
            "UPDATE transaction_merges SET undone_at = CURRENT_TIMESTAMP WHERE id = ?", (merge_id,))
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
            """SELECT category, SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund')
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
            """SELECT category, SUM((CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as total
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
            """SELECT merchant, COUNT(*) FILTER (WHERE type IS NULL OR type = 'expense') as visits,
                      SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND merchant IS NOT NULL AND (type IS NULL OR type = 'expense' OR type = 'refund')
               GROUP BY merchant ORDER BY total DESC LIMIT ?""",
            (start_date, end_date, limit),
        ).fetchall()
        return [{"merchant": r["merchant"], "visits": r["visits"], "total": r["total"]} for r in rows]

    @_locked
    def get_average_daily(self, start_date: str, end_date: str) -> float:
        row = self._conn.execute(
            """SELECT COALESCE(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0) as total
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund')""",
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
            """SELECT DATE(transaction_date) as date, SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as amount
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund')
               GROUP BY DATE(transaction_date) ORDER BY date""",
            (start_date, end_date),
        ).fetchall()
        return [{"date": r["date"], "amount": r["amount"]} for r in rows]

    @_locked
    def get_trend_by_category(self, start_date: str, end_date: str) -> list[dict]:
        rows = self._conn.execute(
            """SELECT DATE(transaction_date) as date,
                      COALESCE(category, 'Other') as category,
                      SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as amount
               FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund')
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
        # reporting_minor_units (R02 canonical money) rather than amount *
        # exchange_rate — see src.analytics._query_total for why: a legacy
        # exchange_rate of 1.0 is a silent unresolved fallback, not real
        # conversion evidence.
        curr_rows = self._conn.execute(
            """SELECT category, COALESCE(SUM(CASE WHEN type = 'refund' THEN -reporting_minor_units ELSE reporting_minor_units END), 0) / 100.0 as total FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund') GROUP BY category""",
            (current_start, current_end),
        ).fetchall()
        prev_rows = self._conn.execute(
            """SELECT category, COALESCE(SUM(CASE WHEN type = 'refund' THEN -reporting_minor_units ELSE reporting_minor_units END), 0) / 100.0 as total FROM transactions
               WHERE DATE(transaction_date) >= ? AND DATE(transaction_date) <= ?
               AND (type IS NULL OR type = 'expense' OR type = 'refund') GROUP BY category""",
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

        conditions = ["t.merchant IS NOT NULL", "(t.type IS NULL OR t.type = 'expense' OR t.type = 'refund')"]
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
                    ROUND(SUM((CASE WHEN t.type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)), 2) as total_sgd,
                    COUNT(*) FILTER (WHERE t.type IS NULL OR t.type = 'expense') as transaction_count,
                    ROUND(AVG((CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)) FILTER (WHERE t.type IS NULL OR t.type = 'expense'), 2) as avg_amount_sgd,
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
                COALESCE(mt.notes, '') as notes,
                COALESCE(ma.display_name, ms.merchant) as display_name
            FROM merchant_stats ms
            LEFT JOIN merchant_category mc ON ms.merchant = mc.merchant AND mc.rn = 1
            LEFT JOIN merchant_tags mt ON ms.merchant = mt.merchant
            LEFT JOIN merchant_aliases ma ON ms.merchant = ma.merchant
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
                ROUND(SUM((CASE WHEN t.type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)), 2) as total_sgd,
                COUNT(*) as row_count,
                COUNT(*) FILTER (WHERE t.type IS NULL OR t.type = 'expense') as transaction_count,
                ROUND(AVG((CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)) FILTER (WHERE t.type IS NULL OR t.type = 'expense'), 2) as avg_amount_sgd,
                DATE(MIN(t.transaction_date)) as first_seen,
                DATE(MAX(t.transaction_date)) as last_seen
            FROM transactions t
            WHERE t.merchant = ? AND (t.type IS NULL OR t.type = 'expense' OR t.type = 'refund')
            """,
            (merchant,),
        ).fetchone()

        # row_count (unconditional) detects "merchant not found" — a merchant
        # whose only recorded transaction is a refund must still resolve to a
        # profile, even though transaction_count (expense-only, for display)
        # would otherwise read 0 and look indistinguishable from "not found".
        if not row or row["row_count"] == 0:
            return None

        profile = dict(row)
        del profile["row_count"]
        tags_row = self._conn.execute(
            "SELECT tags, notes FROM merchant_tags WHERE merchant = ?", (merchant,)
        ).fetchone()
        profile["tags"] = []
        profile["notes"] = ""
        if tags_row:
            profile["tags"] = [t.strip() for t in (tags_row["tags"] or "").split(",") if t.strip()]
            profile["notes"] = tags_row["notes"] or ""
        alias_row = self._conn.execute(
            "SELECT display_name FROM merchant_aliases WHERE merchant = ?", (merchant,)
        ).fetchone()
        profile["display_name"] = alias_row["display_name"] if alias_row else merchant
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
    def set_merchant_alias(self, merchant: str, display_name: str) -> None:
        """Upsert a purely cosmetic display name for `merchant`. A blank
        display_name deletes the alias — display_name then falls back to the
        raw merchant string everywhere it's read, same as never having set
        one. The raw transactions.merchant column is never touched."""
        display_name = display_name.strip()
        if not display_name:
            self._conn.execute("DELETE FROM merchant_aliases WHERE merchant = ?", (merchant,))
        else:
            self._conn.execute(
                """INSERT INTO merchant_aliases (merchant, display_name, updated_at)
                   VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(merchant) DO UPDATE SET
                       display_name = excluded.display_name,
                       updated_at = excluded.updated_at""",
                (merchant, display_name),
            )
        self._conn.commit()

    @_locked
    def get_merchant_aliases(self) -> dict[str, str]:
        rows = self._conn.execute("SELECT merchant, display_name FROM merchant_aliases").fetchall()
        return {r["merchant"]: r["display_name"] for r in rows}

    @_locked
    def get_category_rule_impact(self, merchant: str, category: str) -> int:
        """How many existing expense/refund transactions for `merchant`
        currently have a category other than `category` (including no
        category at all) — the count a "apply this rule to existing
        transactions" prompt would actually change. Legacy NULL type counts
        as expense, same scope update_transaction/categorizer already treat
        a merchant rule as applying to; transfers/income never qualify."""
        return self._conn.execute(
            """SELECT COUNT(*) FROM transactions
               WHERE merchant = ? AND (type IS NULL OR type IN ('expense', 'refund'))
               AND (category IS NULL OR category != ?)""",
            (merchant, category),
        ).fetchone()[0]

    @_locked
    def apply_category_rule_to_existing(self, merchant: str, category: str) -> int:
        """Explicit, one-time bulk backfill: sets `category` on every existing
        expense/refund transaction for `merchant` that doesn't already have
        it. Reuses update_transaction per row rather than a bespoke bulk
        write, so each change gets its own mutation-history entry and
        ordinary per-transaction undo keeps working exactly as before —
        undoing one row here never touches the rule or any other row."""
        ids = [r["id"] for r in self._conn.execute(
            """SELECT id FROM transactions
               WHERE merchant = ? AND (type IS NULL OR type IN ('expense', 'refund'))
               AND (category IS NULL OR category != ?)""",
            (merchant, category),
        ).fetchall()]
        for tx_id in ids:
            self.update_transaction(tx_id, category=category)
        return len(ids)

    @_locked
    def get_merchant_trend(self, merchant: str, months: int = 6) -> dict:
        """Return monthly spend totals for a merchant over the last N months."""
        rows = self._conn.execute(
            """
            SELECT strftime('%Y-%m', transaction_date) as month,
                   ROUND(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 2) as total,
                   COUNT(*) FILTER (WHERE type IS NULL OR type = 'expense') as count
            FROM transactions
            WHERE merchant = ?
              AND (type IS NULL OR type = 'expense' OR type = 'refund')
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
                    """SELECT COALESCE(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0) as total
                       FROM transactions
                       WHERE (type IS NULL OR type = 'expense' OR type = 'refund')
                         AND DATE(transaction_date) BETWEEN ? AND ?""",
                    (start, end),
                ).fetchone()
            else:
                spent_row = self._conn.execute(
                    """SELECT COALESCE(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0) as total
                       FROM transactions
                       WHERE (type IS NULL OR type = 'expense' OR type = 'refund') AND category = ?
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
            """SELECT COALESCE(SUM((CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0) as total
               FROM transactions WHERE type = 'income'
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()["total"]
        expenses = self._conn.execute(
            """SELECT COALESCE(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0) as total
               FROM transactions WHERE (type IS NULL OR type = 'expense' OR type = 'refund')
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
            """SELECT COALESCE(SUM((CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0.0)
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

        # ── Total expenses (nets refunds in their own period/category) ───────
        total_expense = self._conn.execute(
            """SELECT COALESCE(SUM((CASE WHEN type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)), 0.0)
               FROM transactions WHERE (type IS NULL OR type = 'expense' OR type = 'refund')
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        # ── Needs (expenses in categories with type='needs') ─────────────────
        needs = self._conn.execute(
            """SELECT COALESCE(SUM((CASE WHEN t.type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)), 0.0)
               FROM transactions t
               LEFT JOIN categories c ON t.category = c.name
               WHERE (t.type IS NULL OR t.type = 'expense' OR t.type = 'refund')
               AND COALESCE(c.type, 'neutral') = 'needs'
               AND DATE(t.transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchone()[0]

        # ── Wants (expenses in categories with type='wants') ─────────────────
        wants = self._conn.execute(
            """SELECT COALESCE(SUM((CASE WHEN t.type = 'refund' THEN -1 ELSE 1 END) * (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END)), 0.0)
               FROM transactions t
               LEFT JOIN categories c ON t.category = c.name
               WHERE (t.type IS NULL OR t.type = 'expense' OR t.type = 'refund')
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
                """SELECT merchant, AVG((CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END)) as avg_amt
                   FROM transactions WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
                   AND DATE(transaction_date) < ?
                   GROUP BY merchant""",
                (start,),
            ).fetchall()
        }

        # Period transactions
        period_txs = self._conn.execute(
            """SELECT merchant, (CASE WHEN reporting_minor_units IS NOT NULL THEN reporting_minor_units / 100.0 WHEN currency = 'SGD' OR currency IS NULL THEN amount WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate != 1 THEN amount * exchange_rate ELSE NULL END) as amt_sgd
               FROM transactions WHERE (type IS NULL OR type = 'expense') AND merchant IS NOT NULL
               AND DATE(transaction_date) BETWEEN ? AND ?""",
            (start, end),
        ).fetchall()

        anomaly_count = sum(
            1
            for r in period_txs
            if r["amt_sgd"] is not None
            and merchant_avgs.get(r["merchant"]) is not None
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
            """SELECT (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END) as amt_sgd,
                      t.category,
                      DATE(t.transaction_date) as tx_date,
                      t.currency,
                      t.type
               FROM transactions t
               JOIN trip_transactions tt ON tt.transaction_id = t.id
               WHERE tt.trip_id = ? AND (t.type IS NULL OR t.type = 'expense' OR t.type = 'refund')
               ORDER BY t.transaction_date ASC""",
            (trip_id,),
        ).fetchall()

        # An unresolved conversion (amt_sgd is None) excludes that transaction
        # from the SGD totals below rather than crashing — same "unresolved
        # is excluded, not fabricated" rule as spending_facts/analytics. A
        # refund nets against the total but isn't itself "a transaction" for
        # count purposes, same reasoning as the merchant/summary functions.
        def _signed(r):
            amt = r["amt_sgd"]
            if amt is None:
                return 0
            return -amt if r["type"] == "refund" else amt

        total_sgd = sum(_signed(r) for r in rows)
        count = sum(1 for r in rows if r["type"] != "refund")

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
            cat_totals[cat]["amount_sgd"] = round(cat_totals[cat]["amount_sgd"] + _signed(r), 2)
            if r["type"] != "refund":
                cat_totals[cat]["count"] += 1
        by_category = sorted(cat_totals.values(), key=lambda x: x["amount_sgd"], reverse=True)

        day_totals: dict[str, float] = {}
        for r in rows:
            d = r["tx_date"] or "unknown"
            day_totals[d] = round(day_totals.get(d, 0.0) + _signed(r), 2)
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
        billing_day: int | None = None, label: str | None = None, notes: str | None = None,
        *, confirmation_source: str = "unknown",
    ) -> int:
        if confirmation_source not in ("unknown", "user", "recurring_suggestion"):
            raise ValueError("Invalid confirmation source")
        with self._conn:
            cur = self._conn.execute(
                """INSERT INTO subscriptions (merchant, frequency, billing_day, label, notes)
                   VALUES (?, ?, ?, ?, ?)""",
                (merchant, frequency, billing_day, label, notes),
            )
            sub_id = cur.lastrowid
            if confirmation_source != "unknown":
                self._conn.execute(
                    "INSERT INTO subscription_confirmations(subscription_id, source) VALUES (?, ?)",
                    (sub_id, confirmation_source),
                )
        return sub_id

    @_locked
    def accept_subscription_suggestion(self, chat_id: int, message_id: int, merchant: str, frequency: str) -> int:
        """Accept once per Telegram message, retaining the receipt after deletion."""
        if type(chat_id) is not int or chat_id == 0 or type(message_id) is not int or message_id <= 0:
            raise ValueError("Suggestion needs a Telegram message identity")
        if not isinstance(merchant, str) or not merchant.strip() or frequency not in ("weekly", "biweekly", "monthly"):
            raise ValueError("Invalid recurring suggestion")
        message_key = f"telegram:{chat_id}:{message_id}"
        accepted = self._conn.execute(
            "SELECT * FROM subscription_suggestion_acceptances WHERE message_key = ?", (message_key,),
        ).fetchone()
        if accepted:
            if (accepted["merchant"], accepted["frequency"]) != (merchant, frequency):
                raise SubscriptionMatchConflict("This suggestion was already accepted with different fields")
            if not self.get_subscription(accepted["subscription_id"]):
                raise SubscriptionMatchConflict("The schedule from this suggestion was deleted; add it manually if needed")
            return accepted["subscription_id"]
        with self._conn:
            sub_id = self._subscription_from_suggestion(merchant, frequency)
            self._conn.execute(
                """INSERT INTO subscription_suggestion_acceptances(message_key, merchant, frequency, subscription_id)
                   VALUES (?, ?, ?, ?)""", (message_key, merchant, frequency, sub_id),
            )
        return sub_id

    def _subscription_from_suggestion(self, merchant: str, frequency: str) -> int:
        """Caller holds the Storage lock and owns the acceptance transaction."""
        matches = self._conn.execute(
            "SELECT id FROM subscriptions WHERE merchant = ? AND frequency = ? ORDER BY id LIMIT 2",
            (merchant, frequency),
        ).fetchall()
        if len(matches) > 1:
            raise SubscriptionMatchConflict("Several schedules match this suggestion; review them in the app")
        if matches:
            sub_id = matches[0]["id"]
        else:
            sub_id = self._conn.execute(
                "INSERT INTO subscriptions(merchant, frequency) VALUES (?, ?)", (merchant, frequency),
            ).lastrowid
        self._conn.execute(
            """INSERT OR IGNORE INTO subscription_confirmations(subscription_id, source)
               VALUES (?, 'recurring_suggestion')""", (sub_id,),
        )
        return sub_id

    @_locked
    def prepare_recurring_suggestion(self, chat_id: int | None, merchant: str, frequency: str, avg_amount: float) -> dict:
        with self._conn:
            return self._prepare_recurring_suggestion(chat_id, merchant, frequency, avg_amount)

    def _prepare_recurring_suggestion(self, chat_id, merchant, frequency, avg_amount) -> dict:
        """Caller owns the Storage lock and transaction."""
        if chat_id is not None and (type(chat_id) is not int or chat_id == 0):
            raise ValueError("Suggestion needs a Telegram chat identity")
        if not isinstance(merchant, str) or not merchant.strip() or frequency not in ("weekly", "biweekly", "monthly"):
            raise ValueError("Invalid recurring suggestion")
        amount = normalize_transaction_fields({"amount": avg_amount})["amount"]
        row = self._conn.execute(
            """SELECT * FROM recurring_suggestions WHERE (chat_id IS ? OR ? IS NULL) AND merchant = ? AND frequency = ?
               AND avg_amount = ? AND status = 'pending' ORDER BY created_at, id LIMIT 1""",
            (chat_id, chat_id, merchant, frequency, amount),
        ).fetchone()
        if row:
            return dict(row)
        suggestion_id = secrets.token_hex(16)
        self._conn.execute(
            "INSERT INTO recurring_suggestions(id, chat_id, merchant, frequency, avg_amount) VALUES (?, ?, ?, ?, ?)",
            (suggestion_id, chat_id, merchant, frequency, amount),
        )
        return dict(self._conn.execute("SELECT * FROM recurring_suggestions WHERE id = ?", (suggestion_id,)).fetchone())

    @_locked
    def prepare_ingestion_suggestion(self, effect_id: int) -> dict:
        """Upgrade old pending outbox payloads once, before optional delivery."""
        job = self._conn.execute("SELECT payload FROM ingestion_outbox WHERE id = ? AND kind = 'suggestion'", (effect_id,)).fetchone()
        if job is None:
            raise ValueError("Suggestion follow-up not found")
        payload = json.loads(job["payload"])
        with self._conn:
            if "suggestion_id" not in payload:
                recorded = self._prepare_recurring_suggestion(None, payload["merchant"], payload["frequency"], payload["avg_amount"])
                payload["suggestion_id"] = recorded["id"]
                self._conn.execute("UPDATE ingestion_outbox SET payload = ? WHERE id = ?", (json.dumps(payload), effect_id))
            row = self._conn.execute("SELECT * FROM recurring_suggestions WHERE id = ?", (payload["suggestion_id"],)).fetchone()
            if row is None:
                raise ValueError("Recorded suggestion not found")
        return dict(row)

    @_locked
    def bind_recurring_suggestion(self, suggestion_id: str, chat_id: int) -> dict | None:
        if type(chat_id) is not int or chat_id == 0:
            raise ValueError("Suggestion needs a Telegram chat identity")
        row = self._conn.execute("SELECT * FROM recurring_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        if row is None:
            raise ValueError("Suggestion not found")
        if row["status"] != "pending":
            return None
        if row["chat_id"] not in (None, chat_id):
            raise SubscriptionMatchConflict("Suggestion belongs to another chat")
        with self._conn:
            self._conn.execute("UPDATE recurring_suggestions SET chat_id = ? WHERE id = ?", (chat_id, suggestion_id))
        return {**dict(row), "chat_id": chat_id}

    @_locked
    def get_recurring_review(self, limit=50, offset=0) -> dict:
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid recurring review query")
        rows = self._conn.execute(
            """SELECT id, merchant, frequency FROM recurring_suggestions WHERE status = 'pending'
               ORDER BY created_at, id LIMIT ? OFFSET ?""", (limit, offset),
        ).fetchall()
        total = self._conn.execute("SELECT COUNT(*) FROM recurring_suggestions WHERE status = 'pending'").fetchone()[0]
        return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}

    @_locked
    def resolve_recurring_review(self, suggestion_id: str, action: str) -> int | None:
        """Authenticated web callers already resolve the owning user's Storage."""
        row = self._conn.execute("SELECT chat_id FROM recurring_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        if row is None:
            raise ValueError("Suggestion not found")
        return self.resolve_recurring_suggestion(suggestion_id, row["chat_id"], action)

    @_locked
    def resolve_recurring_suggestion(self, suggestion_id: str, chat_id: int | None, action: str) -> int | None:
        if action not in ("accept", "dismiss"):
            raise ValueError("Invalid suggestion action")
        row = self._conn.execute(
            "SELECT * FROM recurring_suggestions WHERE id = ? AND chat_id IS ?", (suggestion_id, chat_id),
        ).fetchone()
        if row is None:
            raise ValueError("Suggestion not found; review subscriptions in the app")
        target = "accepted" if action == "accept" else "dismissed"
        if row["status"] != "pending":
            if row["status"] != target:
                raise SubscriptionMatchConflict("This suggestion was already handled differently")
            if target == "accepted" and not self.get_subscription(row["subscription_id"]):
                raise SubscriptionMatchConflict("The schedule from this suggestion was deleted; add it manually if needed")
            return row["subscription_id"]
        with self._conn:
            sub_id = self._subscription_from_suggestion(row["merchant"], row["frequency"]) if action == "accept" else None
            self._conn.execute(
                "UPDATE recurring_suggestions SET status = ?, subscription_id = ? WHERE id = ?",
                (target, sub_id, suggestion_id),
            )
        return sub_id

    @_locked
    def confirm_subscription(self, sub_id: int) -> None:
        if not self.get_subscription(sub_id):
            raise ValueError("Subscription not found")
        with self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO subscription_confirmations(subscription_id, source) VALUES (?, 'user')",
                (sub_id,),
            )

    @_locked
    def get_subscription(self, sub_id: int) -> dict | None:
        row = self._conn.execute(
            """SELECT s.*, COALESCE(c.source, 'unknown') AS confirmation_source
               FROM subscriptions s LEFT JOIN subscription_confirmations c ON c.subscription_id = s.id
               WHERE s.id = ?""", (sub_id,),
        ).fetchone()
        return dict(row) if row else None

    @_locked
    def list_subscriptions(self) -> list[dict]:
        rows = self._conn.execute(
            """SELECT s.*, COALESCE(c.source, 'unknown') AS confirmation_source
               FROM subscriptions s LEFT JOIN subscription_confirmations c ON c.subscription_id = s.id
               ORDER BY s.status, s.merchant"""
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
        if "status" in updates and updates["status"] not in ("active", "possibly_cancelled", "paused", "cancelled"):
            raise ValueError("Invalid subscription status")
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
        self._conn.execute("DELETE FROM subscription_confirmations WHERE subscription_id = ?", (sub_id,))
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
            """SELECT (CASE WHEN t.reporting_minor_units IS NOT NULL THEN t.reporting_minor_units / 100.0 WHEN t.currency = 'SGD' OR t.currency IS NULL THEN t.amount WHEN t.exchange_rate IS NOT NULL AND t.exchange_rate > 0 AND t.exchange_rate != 1 THEN t.amount * t.exchange_rate ELSE NULL END) AS sgd_amount
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
        self, subscription_id: int, expected_date: str, expected_amount: float | None = None,
        *, amount_basis_transaction_id: int | None = None,
    ) -> int:
        # R11: date_basis is always 'schedule' here — the only other way an
        # upcoming's date is set is update_planned_charge's explicit user
        # correction, on an already-existing row. amount_basis follows from
        # whether a specific matched charge backs the inferred amount.
        amount_basis = "matched_charge" if amount_basis_transaction_id is not None else "unknown"
        cur = self._conn.execute(
            """INSERT INTO upcoming_transactions
               (subscription_id, expected_date, expected_amount, date_basis, amount_basis, amount_basis_transaction_id)
               VALUES (?, ?, ?, 'schedule', ?, ?)""",
            (subscription_id, expected_date, expected_amount, amount_basis, amount_basis_transaction_id),
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

    def _subscription_expense(self, transaction_id: int) -> dict:
        """Validate an actual charge while the caller holds the Storage lock."""
        if type(transaction_id) is not int or transaction_id <= 0:
            raise ValueError("transaction_id must be a positive integer")
        tx = self.get_transaction(transaction_id)
        if tx is None:
            raise ValueError("Transaction not found")
        if tx["type"] not in (None, "expense"):
            raise ValueError("Only expense transactions can match a charge")
        return tx

    def _require_unlinked_charge(self, transaction_id: int) -> None:
        if self._conn.execute(
            "SELECT 1 FROM upcoming_transactions WHERE matched_transaction_id = ? LIMIT 1",
            (transaction_id,),
        ).fetchone():
            raise SubscriptionMatchConflict("Transaction is already linked to a charge")

    @_locked
    def match_upcoming_transaction(self, upcoming_id: int, transaction_id: int) -> None:
        self._subscription_expense(transaction_id)
        upcoming = self.get_upcoming_transaction(upcoming_id)
        if upcoming is None:
            raise ValueError("Charge not found")
        if upcoming["status"] == "matched" and upcoming["matched_transaction_id"] == transaction_id:
            return
        self._pending_planned_charge(upcoming_id)
        self._require_unlinked_charge(transaction_id)
        with self._conn:
            self._conn.execute(
                "UPDATE upcoming_transactions SET status = 'matched', matched_transaction_id = ? WHERE id = ?",
                (transaction_id, upcoming_id),
            )

    @_locked
    def link_transaction_to_subscription(self, sub_id: int, tx_id: int) -> None:
        """Link an actual expense once; replaying the same subscription link is harmless."""
        if not self.get_subscription(sub_id):
            raise ValueError("Subscription not found")
        tx = self._subscription_expense(tx_id)
        existing = self._conn.execute(
            "SELECT 1 FROM upcoming_transactions WHERE subscription_id = ? AND matched_transaction_id = ? AND status = 'matched'",
            (sub_id, tx_id),
        ).fetchone()
        if existing:
            return
        self._require_unlinked_charge(tx_id)
        try:
            expected_date = datetime.fromisoformat(tx["transaction_date"]).date().isoformat()
        except (ValueError, TypeError):
            raise ValueError("Transaction needs a valid date before linking") from None
        from src.spending_facts import resolve_money
        minor, _ = resolve_money(tx)
        expected_amount = minor / 100 if minor is not None else None
        with self._conn:
            self._conn.execute(
                """INSERT INTO upcoming_transactions
                       (subscription_id, expected_date, expected_amount, matched_transaction_id, status)
                   VALUES (?, ?, ?, ?, 'matched')""",
                (sub_id, expected_date, expected_amount, tx_id),
            )

    def _pending_planned_charge(self, upcoming_id: int):
        """Called only by locked plan commands."""
        row = self._conn.execute(
            """SELECT u.*, s.status AS schedule_status FROM upcoming_transactions u
               JOIN subscriptions s ON s.id = u.subscription_id WHERE u.id = ?""", (upcoming_id,),
        ).fetchone()
        if row is None:
            raise ValueError("Charge not found")
        if (row["status"] != "pending" or row["matched_transaction_id"] is not None
                or row["schedule_status"] not in ("active", "possibly_cancelled")):
            raise SubscriptionMatchConflict("Charge is no longer pending")
        return row

    @_locked
    def update_planned_charge(self, upcoming_id: int, fields: dict) -> None:
        self._pending_planned_charge(upcoming_id)
        if not fields or set(fields) - {"expected_date", "expected_amount"}:
            raise ValueError("Provide an expected date or amount only")
        accepted = dict(fields)
        if "expected_date" in accepted:
            value = accepted["expected_date"]
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError("Expected date must be YYYY-MM-DD")
            try:
                accepted["expected_date"] = date.fromisoformat(value).isoformat()
            except ValueError:
                raise ValueError("Expected date must be a valid calendar date") from None
        if "expected_amount" in accepted and accepted["expected_amount"] is not None:
            accepted["expected_amount"] = normalize_transaction_fields({"amount": accepted["expected_amount"]})["amount"]
        # R11: an explicit user correction is its own provenance, distinct
        # from the ordinary computed-schedule/inferred-from-last-charge
        # path — a corrected amount also has no single matched transaction
        # backing it any more, even if one existed before.
        if "expected_date" in accepted:
            accepted["date_basis"] = "user"
        if "expected_amount" in accepted:
            accepted["amount_basis"] = "user" if accepted["expected_amount"] is not None else "unknown"
            accepted["amount_basis_transaction_id"] = None
        with self._conn:
            self._conn.execute(
                f"UPDATE upcoming_transactions SET {', '.join(key + ' = ?' for key in accepted)} WHERE id = ?",
                (*accepted.values(), upcoming_id),
            )

    @_locked
    def dismiss_planned_charge(self, upcoming_id: int) -> None:
        self._pending_planned_charge(upcoming_id)
        with self._conn:
            self._conn.execute("UPDATE upcoming_transactions SET status = 'dismissed' WHERE id = ?", (upcoming_id,))

    @_locked
    def dismiss_upcoming_transaction(self, upcoming_id: int) -> None:
        self.dismiss_planned_charge(upcoming_id)

    @_locked
    def get_upcoming_transaction(self, upcoming_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM upcoming_transactions WHERE id = ?", (upcoming_id,)
        ).fetchone()
        return dict(row) if row else None

    # ── Recurring ─────────────────────────────────────────────────────────────

    @_locked
    def get_merchant_history(self, merchant: str, days: int = 90) -> list[dict]:
        """Return expense transactions for a merchant within the past *days*
        days. Selects the canonical-money columns (not just amount) so
        callers can resolve real SGD value via resolve_money rather than
        averaging raw face-value amounts across possibly different
        currencies (R11)."""
        rows = self._conn.execute(
            """SELECT amount, currency, exchange_rate, reporting_minor_units,
                      conversion_status, transaction_date FROM transactions
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

    # ── Job health ────────────────────────────────────────────────────────────

    _ERROR_CODE_MAX_LEN = 200

    @_locked
    def record_job_start(self, job_name: str) -> int:
        """Record that a named job (scheduler job, backup, capture retry, ...)
        has started. Returns a run_id to pass to record_job_success/_failure."""
        cursor = self._conn.execute(
            "INSERT INTO job_runs (job_name, status) VALUES (?, 'running')", (job_name,)
        )
        self._conn.commit()
        return cursor.lastrowid

    @_locked
    def record_job_success(self, run_id: int) -> None:
        self._conn.execute(
            "UPDATE job_runs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = ?",
            (run_id,),
        )
        self._conn.commit()

    @_locked
    def record_job_failure(self, run_id: int, error_code: str) -> None:
        """error_code is bounded and must never contain private financial values."""
        self._conn.execute(
            "UPDATE job_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_code = ? WHERE id = ?",
            (error_code[: self._ERROR_CODE_MAX_LEN], run_id),
        )
        self._conn.commit()

    @_locked
    def get_job_health(self) -> list[dict]:
        """Latest run per job_name, plus how many runs in a row have failed
        (0 if the latest run succeeded)."""
        job_names = [
            row["job_name"] for row in
            self._conn.execute("SELECT DISTINCT job_name FROM job_runs")
        ]
        results = []
        for job_name in sorted(job_names):
            runs = [
                dict(row) for row in self._conn.execute(
                    "SELECT * FROM job_runs WHERE job_name = ? ORDER BY id DESC LIMIT 50",
                    (job_name,),
                )
            ]
            latest = dict(runs[0])
            consecutive_failures = 0
            for run in runs:
                if run["status"] != "failed":
                    break
                consecutive_failures += 1
            latest["consecutive_failures"] = consecutive_failures
            results.append(latest)
        return results


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
