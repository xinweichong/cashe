import logging
import json
import base64
import hashlib
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
        on_recurring_pattern: Optional[Callable[[str, str, float], None]] = None,
    ):
        self.storage = storage
        self.categorizer = categorizer
        self.exchange_service = exchange_service
        self._on_recurring_pattern = on_recurring_pattern
        # Allow injection of a RecurringDetector (or mock) for testing
        if detector is not None:
            self._detector = detector
        else:
            from src.recurring import RecurringDetector
            self._detector = RecurringDetector(storage)

    def ingest(self, result: ParseResult, *, historical: bool = False) -> Optional[dict]:
        """Persist a ParseResult and return the stored transaction dict, or None on dedup."""
        with self.storage.reconciliation_lock():
            event = self.storage.record_source_event(
                result.source, result.source_id, json.dumps({**asdict(result), "_historical": historical}),
            )
            if event["status"] == "processed":
                return None
            try:
                return self._ingest(result, event["id"], historical=historical)
            except Exception as exc:
                self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                raise

    def ingest_wallet_request(self, body: bytes) -> tuple[Optional[dict], Optional[int]]:
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
                tx = self.ingest(result)
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
                    self.ingest_wallet_request(base64.b64decode(event["payload"], validate=True))
                    continue
                payload = json.loads(event["payload"])
                historical = payload.pop("_historical", False)
                self.ingest(ParseResult(**payload), historical=historical)
            except Exception as exc:
                # ingest records processing failures. Invalid persisted payloads
                # also need an attempt count so they cannot retry indefinitely.
                current = self.storage.get_source_event(event["source"], event["source_id"])
                if current["attempts"] == event["attempts"]:
                    self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                logger.warning("Source event retry failed: %s", type(exc).__name__)

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
            )
        except ValueError:
            existing = self.storage.get_transaction_by_source_id(result.source_id)
            if existing is None:
                raise
            self.storage.finish_source_event(event_id, "processed", existing["id"])
            return None

        self.storage.finish_source_event(event_id, "processed", tx_id)
        logger.info("Stored transaction id=%s", tx_id)

        try:
            if not historical:
                self.storage.auto_assign_to_active_trip(tx_id)
        except Exception as e:
            logger.warning("auto_assign_to_active_trip failed (best-effort): %s", e)

        try:
            rec = self._detector.detect_and_suggest(result.merchant, result.amount, tx_id)
            if rec and self._on_recurring_pattern and not historical:
                # Only suggest if no subscription already exists for this merchant
                if not self.storage.find_subscription_by_merchant(result.merchant):
                    self._on_recurring_pattern(
                        result.merchant, rec["frequency"], rec["avg_amount"]
                    )
        except Exception as e:
            logger.warning("Recurring suggestion failed (best-effort): %s", e)

        tx = self.storage.get_transaction(tx_id)
        if tx is not None:
            tx["_match_source"] = match_source
        return tx
