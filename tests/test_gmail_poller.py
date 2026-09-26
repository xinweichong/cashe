import base64
import sqlite3

import pytest

from src.storage import Storage
from src.parsers.base import ParseResult
from src.gmail_poller import GmailPoller


def _make_storage():
    from src.db import init_db
    return Storage(init_db(":memory:"))


def _make_poller():
    """Create a bare GmailPoller without calling __init__."""
    poller = GmailPoller.__new__(GmailPoller)
    return poller


class TestHtmlToText:
    def setup_method(self):
        self.poller = _make_poller()

    def test_html_to_text_strips_tags(self):
        html = "<p>Hello <b>world</b></p>"
        result = self.poller._html_to_text(html)
        assert "Hello" in result
        assert "world" in result
        assert "<p>" not in result
        assert "<b>" not in result

    def test_html_to_text_removes_style_tags(self):
        html = "<style>body { color: red; }</style><p>Hello</p>"
        result = self.poller._html_to_text(html)
        assert "color" not in result
        assert "Hello" in result

    def test_html_to_text_converts_br_to_newlines(self):
        html = "Line 1<br>Line 2<br/>Line 3"
        result = self.poller._html_to_text(html)
        lines = [line for line in result.split("\n") if line.strip()]
        assert len(lines) == 3

    def test_html_to_text_decodes_entities(self):
        html = "A&nbsp;B&amp;C&lt;D&gt;E"
        result = self.poller._html_to_text(html)
        assert "A B" in result
        assert "B&C" in result
        assert "C<D" in result
        assert "D>E" in result


class TestExtractBody:
    def setup_method(self):
        self.poller = _make_poller()

    def _encode(self, text: str) -> str:
        return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii")

    def test_extract_body_prefers_text_plain(self):
        msg = {
            "payload": {
                "parts": [
                    {
                        "mimeType": "text/plain",
                        "body": {"data": self._encode("plain text body")},
                    },
                    {
                        "mimeType": "text/html",
                        "body": {"data": self._encode("<p>html body</p>")},
                    },
                ]
            }
        }
        result = self.poller._extract_body(msg)
        assert result == "plain text body"

    def test_extract_body_falls_back_to_html(self):
        msg = {
            "payload": {
                "parts": [
                    {
                        "mimeType": "text/html",
                        "body": {"data": self._encode("<p>html body</p>")},
                    }
                ]
            }
        }
        result = self.poller._extract_body(msg)
        assert "html body" in result

    def test_extract_body_no_parts_falls_back_to_html(self):
        msg = {
            "payload": {
                "body": {"data": self._encode("<p>direct html body</p>")}
            }
        }
        result = self.poller._extract_body(msg)
        assert "direct html body" in result


class _StubParser:
    """Always parses; returns a fixed ParseResult. Used by poll_once tests."""

    def __init__(self, source: str = "uob_paynow_sent"):
        self._source = source

    @property
    def sender_domain(self) -> str:
        return "uobgroup.com"

    def can_parse(self, sender: str, subject: str) -> bool:
        return self.sender_domain in sender.lower()

    def parse(self, body: str):
        return ParseResult(
            source=self._source,
            source_id="",
            amount=14.79,
            merchant="FOMO PAY PTE. LTD.",
        )


class _FakeGmailService:
    """Minimal stub for the googleapiclient service used by GmailPoller.

    Records every modify() call so tests can assert on mark-as-read behaviour.
    """

    def __init__(self, msgs: list[dict]):
        self._msgs_by_id = {m["id"]: m for m in msgs}
        self._summary_list = [{"id": m["id"]} for m in msgs]
        self.modify_calls: list[dict] = []
        self._self = self

    def users(self):
        return self

    def messages(self):
        return self

    def getProfile(self, userId):
        return _FakeRequest({"historyId": "100"})

    def history(self):
        return self

    def list(self, userId: str, q: str = "", **kwargs):
        if "startHistoryId" in kwargs:
            return _FakeRequest({"historyId": "101"})
        return _FakeRequest({"messages": list(self._summary_list)})

    def get(self, userId: str, id: str, format: str):
        return _FakeRequest(self._msgs_by_id[id])

    def modify(self, userId: str, id: str, body: dict):
        self.modify_calls.append({"id": id, "body": body})
        return _FakeRequest({})


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


def _make_msg(msg_id: str, message_id_header: str, body_text: str) -> dict:
    return {
        "id": msg_id,
        "payload": {
            "headers": [
                {"name": "From", "value": "unialerts@uobgroup.com"},
                {"name": "Subject", "value": "UOB Alert"},
                {"name": "Message-ID", "value": message_id_header},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {
                        "data": base64.urlsafe_b64encode(body_text.encode()).decode("ascii")
                    },
                }
            ],
        },
    }


class TestDurableCapture:
    def _make_configured_poller(self, storage, service):
        from src.ingestion import IngestionPipeline
        poller = GmailPoller(
            "unused", "unused", ["unialerts@uobgroup.com"],
            [_StubParser()], storage, pipeline=IngestionPipeline(storage),
        )
        poller.service = service
        return poller

    def test_captures_without_changing_inbox_labels(self):
        storage = _make_storage()
        service = _FakeGmailService([_make_msg("gmail-1", "<MSG-1>", "body")])
        poller = self._make_configured_poller(storage, service)
        assert "is:unread" not in poller._build_query()
        assert len(poller.poll_once()) == 1
        assert service.modify_calls == []
        assert storage.get_source_event("gmail", "gmail-1")["status"] == "processed"
        assert storage.get_setting("gmail_history_id") == "100"
        assert poller.force_poll() == 0

    def test_existing_transaction_links_evidence(self):
        storage = _make_storage()
        tx_id = storage.insert_transaction(source="uob_paynow_sent", source_id="<MSG-1>", amount=14.79)
        service = _FakeGmailService([_make_msg("gmail-1", "<MSG-1>", "body")])
        poller = self._make_configured_poller(storage, service)
        assert poller.poll_once() == []
        assert storage.get_source_event("gmail", "gmail-1")["transaction_id"] == tx_id
        assert service.modify_calls == []

    def test_failure_retries_from_durable_payload(self, monkeypatch):
        storage = _make_storage()
        service = _FakeGmailService([_make_msg("gmail-1", "<MSG-1>", "body")])
        poller = self._make_configured_poller(storage, service)
        original = poller.pipeline.ingest
        def fail(result, **kwargs):
            raise RuntimeError("temporary failure")
        monkeypatch.setattr(poller.pipeline, "ingest", fail)
        assert poller.poll_once() == []
        assert storage.get_source_event("gmail", "gmail-1")["status"] == "failed"
        monkeypatch.setattr(poller.pipeline, "ingest", original)
        assert poller.force_poll() == 1
        assert storage.get_source_event("gmail", "gmail-1")["status"] == "processed"
        assert poller.force_poll() == 0

    def test_unrecognized_event_is_retained(self, monkeypatch):
        storage = _make_storage()
        service = _FakeGmailService([_make_msg("gmail-1", "<MSG-1>", "body")])
        poller = self._make_configured_poller(storage, service)
        monkeypatch.setattr(poller.parsers[0], "parse", lambda body: None)
        assert poller.poll_once() == []
        assert storage.get_source_event("gmail", "gmail-1")["status"] == "unrecognized"

    def test_paginated_sync_persists_before_checkpoint(self):
        storage = _make_storage()
        class Pages(_FakeGmailService):
            def list(self, userId, q="", **kwargs):
                if kwargs.get("pageToken"):
                    return _FakeRequest({"messages": [{"id": "gmail-2"}]})
                return _FakeRequest({"messages": [{"id": "gmail-1"}], "nextPageToken": "page2"})
        service = Pages([_make_msg("gmail-1", "<MSG-1>", "body"), _make_msg("gmail-2", "<MSG-2>", "body")])
        poller = self._make_configured_poller(storage, service)
        assert poller.force_poll() == 2
        assert storage.get_setting("gmail_sync_progress") == "{}"

    def test_start_is_idempotent(self, monkeypatch):
        from unittest.mock import MagicMock
        storage = _make_storage()
        poller = self._make_configured_poller(storage, _FakeGmailService([]))
        thread = MagicMock()
        monkeypatch.setattr("src.gmail_poller.threading.Thread", lambda **kwargs: thread)
        poller.start()
        poller.start()
        thread.start.assert_called_once()


def test_incremental_history_retains_only_configured_senders():
    storage = _make_storage()
    class History(_FakeGmailService):
        def list(self, **kwargs):
            assert kwargs['startHistoryId'] == '90'
            return _FakeRequest({'historyId': '100', 'history': [
                {'messagesAdded': [{'message': {'id': 'bank'}}, {'message': {'id': 'personal'}}]},
            ]})
    personal = _make_msg('personal', '<PERSONAL>', 'do not retain')
    personal['payload']['headers'][0]['value'] = 'friend@example.com'
    service = History([_make_msg('bank', '<BANK>', 'body'), personal])
    poller = TestDurableCapture()._make_configured_poller(storage, service)
    storage.set_setting('gmail_history_id', '90')
    assert poller.force_poll() == 1
    assert storage.get_source_event('gmail', 'personal') is None
    assert storage.get_setting('gmail_history_id') == '100'


def test_expired_history_restarts_bounded_sync():
    from googleapiclient.errors import HttpError
    from httplib2 import Response
    storage = _make_storage()
    class Expired(_FakeGmailService):
        def list(self, **kwargs):
            if 'startHistoryId' in kwargs:
                raise HttpError(Response({'status': '404'}), b'{}')
            assert 'is:unread' not in kwargs['q']
            assert 'after:' in kwargs['q']
            return _FakeRequest({'messages': []})
    poller = TestDurableCapture()._make_configured_poller(storage, Expired([]))
    storage.set_setting('gmail_history_id', '1')
    assert poller.force_poll() == 0
    assert storage.get_setting('gmail_history_id') == ''
    assert poller.force_poll() == 0
    assert storage.get_setting('gmail_history_id') == '100'


def test_page_failure_replays_without_skipping_messages():
    storage = _make_storage()
    class Interrupted(_FakeGmailService):
        fail = True
        def get(self, **kwargs):
            if kwargs['id'] == 'gmail-2' and self.fail:
                raise RuntimeError('connection lost')
            return super().get(**kwargs)
    service = Interrupted([_make_msg('gmail-1', '<ONE>', 'body'), _make_msg('gmail-2', '<TWO>', 'body')])
    poller = TestDurableCapture()._make_configured_poller(storage, service)
    with pytest.raises(RuntimeError):
        poller.force_poll()
    assert storage.get_setting('gmail_history_id') is None
    assert storage.get_source_event('gmail', 'gmail-1')['status'] == 'pending'
    service.fail = False
    assert poller.force_poll() == 2
    assert poller.force_poll() == 0
    assert storage._conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 2
