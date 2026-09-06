import pytest
from httpx import ASGITransport, AsyncClient

from helpers import FakeMultiUserManager, TEST_USERNAME, make_admin_db_with_user
from src.ingestion import IngestionPipeline
from src.main import init_db
from src.parsers.base import ParseResult
from src.storage import AdminStorage, Storage
from src.web import auth
from src.web.app import create_dashboard_app


def capture(storage, source, source_id, precision="second"):
    return IngestionPipeline(storage).ingest(ParseResult(
        source=source, source_id=source_id, amount=12.50, merchant="Cafe",
        currency="SGD", transaction_date="2026-09-06T12:00:00",
        timestamp_precision=precision, raw_data="private payload",
    ))


def link(storage, source, tx_id, status="processed"):
    event = storage.record_source_event(
        source, "private-id", "private payload", payment_identity_kind="wallet_card_label",
        payment_identity="private card",
    )
    storage.finish_source_event(event["id"], status, tx_id)


def test_reconciled_purchase_groups_raw_and_parsed_evidence(in_memory_db):
    storage = Storage(in_memory_db)
    tx = capture(storage, "apple_wallet", "wallet")
    assert capture(storage, "dbs_paylah", "email") is None
    link(storage, "wallet_request", tx["id"])
    link(storage, "gmail", tx["id"])
    assert storage.get_transaction_provenance(tx["id"]) == {
        "transaction_id": tx["id"], "sources": [
            {"channel": "apple_wallet", "evidence_recorded": True},
            {"channel": "gmail", "evidence_recorded": True},
        ],
    }
    assert len(storage.query_transactions(limit=50)) == 1


def test_date_only_purchases_keep_separate_provenance(in_memory_db):
    storage = Storage(in_memory_db)
    wallet = capture(storage, "apple_wallet", "wallet")
    email = capture(storage, "uob_card", "email", precision="date")
    for tx, channel in ((wallet, "apple_wallet"), (email, "gmail")):
        assert storage.get_transaction_provenance(tx["id"])["sources"] == [
            {"channel": channel, "evidence_recorded": True},
        ]


@pytest.mark.parametrize("source,channel", [
    ("uob_nets", "gmail"), ("apple_wallet", "apple_wallet"),
    ("manual", "manual"), ("cash", "cash"), ("private-source", "other"),
])
def test_legacy_and_manual_sources_do_not_invent_evidence(in_memory_db, source, channel):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source=source, source_id="legacy", amount=12)
    assert storage.get_transaction_provenance(tx_id)["sources"] == [
        {"channel": channel, "evidence_recorded": False},
    ]


def test_failed_links_are_not_supporting_evidence_and_deleted_transactions_are_missing(in_memory_db):
    storage = Storage(in_memory_db)
    tx = capture(storage, "apple_wallet", "wallet")
    link(storage, "gmail", tx["id"], status="failed")
    assert len(storage.get_transaction_provenance(tx["id"])["sources"]) == 1
    storage.delete_transaction(tx["id"])
    with pytest.raises(ValueError, match="Transaction not found"):
        storage.get_transaction_provenance(tx["id"])


@pytest.mark.asyncio
async def test_api_auth_privacy_and_user_isolation(in_memory_db, monkeypatch):
    monkeypatch.setenv("SECURE_COOKIES", "false")
    admin_conn = make_admin_db_with_user()
    admin_conn.execute("INSERT INTO users(username, password_hash) SELECT 'other', password_hash FROM users")
    admin_conn.commit()
    admin = AdminStorage(admin_conn)
    monkeypatch.setattr(auth, "_admin_storage", admin)
    storage = Storage(in_memory_db)
    other_conn = init_db(":memory:")
    other = Storage(other_conn)
    try:
        tx = capture(storage, "apple_wallet", "private-wallet-id")
        link(storage, "gmail", tx["id"])
        other_id = other.insert_transaction(source="manual", source_id="private-other", amount=50)
        assert other_id == tx["id"]  # IDs overlap across isolated user databases.
        app = create_dashboard_app(FakeMultiUserManager({TEST_USERNAME: storage, "other": other}), admin)
        path = f'/api/v2/transactions/{tx["id"]}/provenance'
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get(path)).status_code == 401
            client.cookies.set("session", admin.create_session(TEST_USERNAME))
            response = await client.get(path)
            assert response.status_code == 200
            assert response.json() == storage.get_transaction_provenance(tx["id"])
            assert set(response.json()) == {"transaction_id", "sources"}
            assert all(set(item) == {"channel", "evidence_recorded"} for item in response.json()["sources"])
            assert "private" not in response.text
            client.cookies.set("session", admin.create_session("other"))
            assert (await client.get(path)).json()["sources"] == [{"channel": "manual", "evidence_recorded": False}]
            assert (await client.get('/api/v2/transactions/999/provenance')).status_code == 404
    finally:
        other_conn.close()
        admin_conn.close()
