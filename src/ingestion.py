import logging
import json
import base64
import hashlib
from concurrent.futures import Future
from dataclasses import asdict
from typing import Optional, Callable

from src.parsers.base import ParseResult
from src.storage import Storage
from src.wallet_capture import WalletPayloadError, parse_wallet_request

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """Centralised transaction ingestion: dedup → exchange → categorize → store → recurring."""

    def __init__(
        self,
        storage: Storage,
        categorizer=None,
        exchange_service=None,
        detector=None,
        on_recurring_pattern: Optional[Callable] = None,
        on_transaction: Optional[Callable] = None,
    ):
        self.storage = storage
        self.categorizer = categorizer
        self.exchange_service = exchange_service
        self._on_recurring_pattern = on_recurring_pattern
        self.on_transaction = on_transaction
        # Allow injection of a RecurringDetector (or mock) for testing
        if detector is not None:
            self._detector = detector
        else:
            from src.recurring import RecurringDetector
            self._detector = RecurringDetector(storage)

    def ingest(self, result: ParseResult, *, historical: bool = False) -> Optional[dict]:
        tx = self._capture_parsed(result, historical=historical)
        if tx is not None:
            self.process_outbox(transaction_id=tx["id"])
        return tx

    def _capture_parsed(self, result: ParseResult, *, historical: bool = False) -> Optional[dict]:
        """Persist a ParseResult and return the stored transaction dict, or None on dedup."""
        with self.storage.reconciliation_lock():
            event = self.storage.record_source_event(
                result.source, result.source_id, json.dumps({**asdict(result), "_historical": historical}),
                parser_version="2",
                timestamp_precision=result.timestamp_precision,
                payment_identity_kind=result.payment_identity_kind,
                payment_identity=result.payment_identity,
            )
            if event["status"] == "processed":
                return None
            try:
                return self._ingest(result, event["id"], historical=historical)
            except Exception as exc:
                self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                raise

    def ingest_wallet_request(self, body: bytes) -> tuple[Optional[dict], Optional[int]]:
        tx, tx_id = self._capture_wallet(body)
        if tx is not None:
            self.process_outbox(transaction_id=tx_id)
        return tx, tx_id

    def _capture_wallet(self, body: bytes) -> tuple[Optional[dict], Optional[int]]:
        """Retain authorized request bytes before validation; replay through ingestion."""
        with self.storage.reconciliation_lock():
            event = self.storage.record_source_event(
                "wallet_request", hashlib.sha256(body).hexdigest(),
                base64.b64encode(body).decode("ascii"),
            )
            if event["status"] == "processed":
                return None, event["transaction_id"]
            try:
                result = parse_wallet_request(body)
            except WalletPayloadError:
                self.storage.finish_source_event(event["id"], "unrecognized", error_code="WalletPayloadError")
                raise
            try:
                tx = self._capture_parsed(result)
                parsed_event = self.storage.get_source_event(result.source, result.source_id)
                tx_id = parsed_event["transaction_id"]
                self.storage.finish_source_event(event["id"], "processed", tx_id)
                return tx, tx_id
            except Exception as exc:
                self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                raise

    def retry_pending(self) -> None:
        """Bounded retries for parsed observations, including Wallet-only users."""
        for event in self.storage.pending_source_events(None, limit=100):
            current = self.storage.get_source_event(event["source"], event["source_id"])
            # Replaying a raw request may already have retried its parsed event.
            if current["status"] not in ("pending", "failed") or current["attempts"] != event["attempts"]:
                continue
            try:
                if event["source"] == "wallet_request":
                    self._capture_wallet(base64.b64decode(event["payload"], validate=True))
                    continue
                payload = json.loads(event["payload"])
                historical = payload.pop("_historical", False)
                self._capture_parsed(ParseResult(**payload), historical=historical)
            except Exception as exc:
                # ingest records processing failures. Invalid persisted payloads
                # also need an attempt count so they cannot retry indefinitely.
                current = self.storage.get_source_event(event["source"], event["source_id"])
                if current["attempts"] == event["attempts"]:
                    self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                logger.warning("Source event retry failed: %s", type(exc).__name__)
        self.process_outbox()

    def _ingest(self, result: ParseResult, event_id: int, *, historical: bool) -> Optional[dict]:
        # Same-source dedup (content-hash source_id)
        existing = self.storage.get_transaction_by_source_id(result.source_id)
        if existing:
            self.storage.finish_source_event(event_id, "processed", existing["id"])
            return None

        # Cross-source dedup (10-minute window)
        dup = self.storage.find_cross_source_duplicate(
            result.merchant, result.amount, result.source,
            currency=result.currency, transaction_date=result.transaction_date,
            tx_type=result.tx_type,
            timestamp_precision=result.timestamp_precision,
            payment_identity_kind=result.payment_identity_kind,
            payment_identity=result.payment_identity,
        )
        if dup:
            self.storage.finish_source_event(event_id, "processed", dup["id"])
            return None

        # Exchange rate
        exchange_rate = 1.0
        if self.exchange_service and result.currency != "SGD":
            exchange_rate = self.exchange_service.get_rate(result.currency)

        # Categorize — reload overrides from DB so web-dashboard changes are picked up
        category: Optional[str] = None
        match_source: str = "default"
        if self.categorizer:
            self.categorizer.reload_overrides(self.storage.get_merchant_overrides())
            category, match_source = self.categorizer.categorize(result.merchant)

        followups = []
        if not historical:
            if self.storage.get_setting("trips_enabled", "false") == "true":
                active = self.storage.get_active_trip()
                if active:
                    followups.append(("trip", {"trip_id": active["id"]}))
            followups.append(("recurring", {}))
            followups.append(("notification", {"match_source": match_source}))

        try:
            tx_id = self.storage.insert_transaction(
                source=result.source,
                source_id=result.source_id,
                amount=result.amount,
                merchant=result.merchant,
                description=result.description,
                transaction_date=result.transaction_date,
                raw_data=result.raw_data,
                currency=result.currency,
                exchange_rate=exchange_rate,
                category=category,
                tx_type=result.tx_type,
                followups=followups,
            )
        except ValueError:
            existing = self.storage.get_transaction_by_source_id(result.source_id)
            if existing is None:
                raise
            self.storage.finish_source_event(event_id, "processed", existing["id"])
            return None

        self.storage.finish_source_event(event_id, "processed", tx_id)
        logger.info("Stored transaction id=%s", tx_id)

        tx = self.storage.get_transaction(tx_id)
        if tx is not None:
            tx["_match_source"] = match_source
        return tx

    def process_outbox(self, transaction_id: Optional[int] = None) -> None:
        """Replay follow-ups outside the DB lock, with at-least-once delivery.

        A shared per-storage worker lock serializes this single-process service.
        Pending rows survive a crash, including a crash after remote delivery.
        """
        if not self.storage.outbox_dispatch_lock.acquire(blocking=False):
            return
        try:
            jobs = self.storage.pending_ingestion_effects(transaction_id, limit=100)
            for job in jobs:
                self._run_effect(job)
            # Recurring analysis persists its suggestion before any remote send.
            for job in self.storage.pending_ingestion_effects(transaction_id, limit=100):
                if job["kind"] == "suggestion" and job["attempts"] == 0:
                    self._run_effect(job)
        except Exception as exc:
            # An unavailable DB leaves the job pending; capture already committed.
            logger.warning("Ingestion outbox unavailable: %s", type(exc).__name__)
        finally:
            self.storage.outbox_dispatch_lock.release()

    def _run_effect(self, job: dict) -> None:
        try:
            tx = self.storage.get_transaction(job["transaction_id"])
            payload = json.loads(job["payload"])
            suggestion = None
            future = None
            if tx is not None:
                if job["kind"] == "trip":
                    if self.storage.get_trip(payload["trip_id"]) is not None:
                        self.storage.enlist_transaction(payload["trip_id"], tx["id"], added_by="auto")
                elif job["kind"] == "recurring":
                    rec = self._detector.detect(tx["merchant"], tx["amount"])
                    if rec and not self.storage.find_subscription_by_merchant(tx["merchant"]):
                        suggestion = {"merchant": tx["merchant"], "frequency": rec["frequency"],
                                      "avg_amount": rec["avg_amount"]}
                elif job["kind"] == "suggestion":
                    recorded = self.storage.prepare_ingestion_suggestion(job["id"])
                    if (recorded["status"] == "pending" and self._on_recurring_pattern is not None
                            and not self.storage.find_subscription_by_merchant(recorded["merchant"])):
                        future = self._on_recurring_pattern(
                            recorded["merchant"], recorded["frequency"], recorded["avg_amount"], recorded["id"],
                        )
                elif job["kind"] == "notification":
                    if self.on_transaction is None:
                        return
                    tx["_match_source"] = payload["match_source"]
                    future = self.on_transaction(tx)
            if isinstance(future, Future):
                try:
                    future.result(timeout=30)
                except TimeoutError:
                    future.cancel()
                    raise
            self.storage.finish_ingestion_effect(job["id"], suggestion=suggestion)
        except Exception as exc:
            self.storage.finish_ingestion_effect(job["id"], error_code=type(exc).__name__)
            logger.warning("Ingestion follow-up failed: %s", type(exc).__name__)
