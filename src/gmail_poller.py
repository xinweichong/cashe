import base64
import html
import json
from datetime import timedelta
from email.utils import parseaddr
import logging
import os
import re
import threading
import time
from typing import Callable, Optional

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from src.parsers.base import BankParser, ParseResult
from src.storage import Storage
from src.config import local_now

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def _now_iso() -> str:
    return local_now().strftime("%Y-%m-%dT%H:%M:%S")


class GmailPoller:
    def __init__(
        self,
        credentials_path: str,
        token_path: str,
        sender_filters: list[str],
        parsers: list[BankParser],
        storage: Storage,
        on_transaction: Optional[Callable[[dict], None]] = None,
        on_auth_error: Optional[Callable[[str], None]] = None,
        pipeline=None,
        poll_interval: int = 120,
    ):
        self.credentials_path = credentials_path
        self.token_path = token_path
        self.sender_filters = sender_filters
        self.parsers = parsers
        self.storage = storage
        self.on_transaction = on_transaction
        self.on_auth_error = on_auth_error
        self.pipeline = pipeline
        if pipeline is not None and on_transaction is not None:
            pipeline.on_transaction = on_transaction
        self._poll_interval = poll_interval
        self.service = None
        self._pending_flow = None
        self._pending_state = None
        self._stop_event: Optional[threading.Event] = None
        self._thread: Optional[threading.Thread] = None
        self._lifecycle_lock = threading.Lock()
        self._poll_lock = threading.Lock()
        # Error state — read by /api/status
        self.last_auth_error: Optional[str] = None
        self.last_poll_at: Optional[str] = None
        self._auth_error_notified: bool = False

    def authenticate(self) -> None:
        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(self.credentials_path):
                    msg = "Gmail credentials file not found and no valid token available"
                    logger.error(msg)
                    self.last_auth_error = msg
                    return
                msg = ("Gmail token is invalid and cannot refresh interactively in headless environment. "
                       "Use /reauth in Telegram to re-authorize.")
                logger.error(msg)
                self.last_auth_error = msg
                return
            with open(self.token_path, "w") as f:
                f.write(creds.to_json())

        self.service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        self.last_auth_error = None
        self._auth_error_notified = False
        logger.info("Gmail authenticated successfully")

    def _build_query(self) -> str:
        if not self.sender_filters:
            return ""
        senders = " OR ".join(f"from:{s}" for s in self.sender_filters)
        return f"({senders}) newer_than:90d"

    def _find_parser(self, sender: str, subject: str) -> Optional[BankParser]:
        for parser in self.parsers:
            if parser.can_parse(sender, subject):
                return parser
        return None

    def _process_message(self, msg: dict) -> Optional[ParseResult]:
        headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}
        sender = headers.get("from", "")
        subject = headers.get("subject", "")
        message_id = headers.get("message-id", msg["id"])

        parser = self._find_parser(sender, subject)
        if not parser:
            logger.debug("No parser for sender: %s", sender)
            return None

        body = self._extract_body(msg)
        if not body:
            logger.warning(f"Empty body for message: {message_id}")
            return None

        result = parser.parse(body)
        if result:
            result.source_id = message_id
        return result

    def _extract_body(self, msg: dict) -> str:
        payload = msg["payload"]

        # Try text/plain first
        if "parts" in payload:
            for part in payload["parts"]:
                if part["mimeType"] == "text/plain":
                    data = part["body"]["data"]
                    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

            # Fall back to text/html
            for part in payload["parts"]:
                if part["mimeType"] == "text/html":
                    data = part["body"]["data"]
                    raw_html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    return self._html_to_text(raw_html)

        # No parts at all — try top-level body
        if "body" in payload and "data" in payload["body"]:
            raw = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
            return self._html_to_text(raw)

        return ""

    def _html_to_text(self, html_str: str) -> str:
        # Strip <style> and <script> blocks
        text = re.sub(r"<style[^>]*>.*?</style>", "", html_str, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
        # Convert <br> to newlines
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        # Strip all remaining tags
        text = re.sub(r"<[^>]+>", "", text)
        # Decode HTML entities
        text = html.unescape(text)
        # Replace non-breaking spaces with regular spaces
        text = text.replace("\xa0", " ")
        # Collapse whitespace but preserve intentional newlines
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n+", "\n", text)
        return text.strip()

    def _capture_message(self, message_id: str, *, historical: bool = False) -> None:
        if self.storage.get_source_event("gmail", message_id):
            return
        try:
            msg = self.service.users().messages().get(
                userId="me", id=message_id, format="full"
            ).execute()
        except HttpError as exc:
            if exc.resp.status != 404:
                raise
            event = self.storage.record_source_event("gmail", message_id, "{}")
            self.storage.finish_source_event(event["id"], "unrecognized", error_code="message_deleted")
            return
        headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
        sender = parseaddr(headers.get("from", ""))[1].lower()
        # History covers the whole mailbox; never retain unrelated personal mail.
        if not any(sender == value.lower() or sender.endswith("@" + value.lower())
                   for value in self.sender_filters):
            return
        msg["_cashe_historical"] = historical
        self.storage.record_source_event("gmail", message_id, json.dumps(msg))

    def _synchronize(self) -> None:
        checkpoint = self.storage.get_setting("gmail_history_id")
        state = json.loads(self.storage.get_setting("gmail_sync_progress", "{}"))
        if not checkpoint and not state:
            state = {
                "history_id": self.service.users().getProfile(userId="me").execute()["historyId"],
                "query": self._build_query().replace(
                    "newer_than:90d", f"after:{int((local_now() - timedelta(days=90)).timestamp())}"
                ),
            }
            self.storage.set_setting("gmail_sync_progress", json.dumps(state))
        # Bound each cycle; the next poll resumes after the last durable page.
        for _ in range(10):
            try:
                if checkpoint:
                    page = self.service.users().history().list(
                        userId="me", startHistoryId=checkpoint, historyTypes=["messageAdded"],
                        **({"pageToken": state["page_token"]} if state.get("page_token") else {}),
                    ).execute()
                    ids = {item["message"]["id"] for entry in page.get("history", [])
                           for item in entry.get("messagesAdded", [])}
                else:
                    page = self.service.users().messages().list(
                        userId="me", q=state["query"], maxResults=100,
                        **({"pageToken": state["page_token"]} if state.get("page_token") else {}),
                    ).execute()
                    ids = [item["id"] for item in page.get("messages", [])]
            except HttpError as exc:
                if (checkpoint and exc.resp.status == 404) or (
                    state.get("page_token") and exc.resp.status == 400
                ):
                    self.storage.set_setting("gmail_sync_progress", "{}")
                    self.storage.set_setting("gmail_history_id", "")
                    return
                raise
            for message_id in ids:
                self._capture_message(message_id, historical=not bool(checkpoint))
            if page.get("nextPageToken"):
                state["page_token"] = page["nextPageToken"]
                self.storage.set_setting("gmail_sync_progress", json.dumps(state))
            else:
                self.storage.set_setting("gmail_sync_progress", "{}")
                self.storage.set_setting("gmail_history_id", str(
                    page["historyId"] if checkpoint else state["history_id"]
                ))
                self.storage.set_setting("gmail_last_sync_at", _now_iso())
                return

    def poll_once(self) -> list[dict]:
        """Persist source observations before advancing sync; retry stored failures.

        Inbox labels are user-owned. Reading a message never controls capture.
        """
        with self._poll_lock:
            if not self.service:
                raise RuntimeError("Not authenticated. Call authenticate() first.")
            if not self._build_query():
                return []
            # Retry already captured mail even when a later Gmail request fails.
            transactions = self._process_pending_events()
            self._synchronize()
            transactions.extend(self._process_pending_events())
            self.last_poll_at = _now_iso()
            return transactions

    def _process_pending_events(self) -> list[dict]:
        transactions = []
        if self.pipeline is None:
            return transactions
        for event in self.storage.pending_source_events("gmail", limit=100):
            try:
                message = json.loads(event["payload"])
                historical = message.get("_cashe_historical", False)
                result = self._process_message(message)
                if result is None:
                    self.storage.finish_source_event(event["id"], "unrecognized", error_code="no_parser_match")
                    continue
                tx = self.pipeline.ingest(result, historical=historical)
                evidence = self.storage.get_source_event(result.source, result.source_id)
                self.storage.finish_source_event(event["id"], "processed", evidence["transaction_id"])
            except Exception as exc:
                self.storage.finish_source_event(event["id"], "failed", error_code=type(exc).__name__)
                logger.warning("Gmail event processing failed: %s", type(exc).__name__)
                continue
            if tx is not None:
                transactions.append(tx)
        return transactions

    def force_poll(self) -> int:
        """Run a serialized capture/ingestion cycle, returning new transaction count."""
        return len(self.poll_once())

    def get_auth_url(self, redirect_uri: str, state: str) -> str:
        """Generate Google OAuth URL with an opaque, session-bound state token.
        Stores self._pending_flow so complete_reauth() can exchange the code.
        """
        flow = Flow.from_client_secrets_file(
            self.credentials_path,
            scopes=SCOPES,
            redirect_uri=redirect_uri,
        )
        url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
            state=state,
        )
        self._pending_flow = flow
        self._pending_state = state
        return url

    def start(self) -> None:
        """Start the poll_loop in a background daemon thread.
        Called by UserManager.start_poller() after Gmail OAuth completes.
        """
        with self._lifecycle_lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self.poll_loop, args=(self._poll_interval,), daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        """Signal the poll_loop to exit.
        Best-effort — if poll_loop is blocked in time.sleep(), it will exit on wake.
        """
        if self._stop_event:
            self._stop_event.set()

    def complete_reauth(self, code: str, state: str) -> None:
        """Exchange authorization code for tokens, save, and reinitialize the service."""
        if not self._pending_flow:
            raise RuntimeError("No pending OAuth flow. Call get_auth_url() first.")
        if state != self._pending_state:
            raise ValueError("OAuth state mismatch.")
        self._pending_flow.fetch_token(code=code)
        creds = self._pending_flow.credentials
        with open(self.token_path, "w") as f:
            f.write(creds.to_json())
        self._pending_flow = None
        self._pending_state = None
        self.authenticate()
        logger.info("Gmail re-authenticated via OAuth callback")

    def poll_loop(self, interval_seconds: int = 120) -> None:
        self._poll_interval = interval_seconds
        try:
            self.authenticate()
        except Exception as e:
            logger.error(f"Gmail initial authentication failed: {e}")
            self.last_auth_error = str(e)

        stop = getattr(self, "_stop_event", None)
        while not (stop and stop.is_set()):
            try:
                self.force_poll()
            except Exception as e:
                logger.error(f"Poll error: {e}")
                self.last_auth_error = str(e)
                if self.on_auth_error and not self._auth_error_notified:
                    _AUTH_KEYWORDS = ("invalid_grant", "not authenticated", "token", "expired", "revoked")
                    if any(kw in str(e).lower() for kw in _AUTH_KEYWORDS):
                        self._auth_error_notified = True
                        self.on_auth_error(str(e))
            if stop:
                stop.wait(timeout=interval_seconds)
                if stop.is_set():
                    break
            else:
                time.sleep(interval_seconds)
