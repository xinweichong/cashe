import pytest
import pytest_asyncio
from unittest.mock import MagicMock
from httpx import AsyncClient, ASGITransport
from src.webhook import create_webhook_app
from src.storage import Storage

TEST_USER = "alice"


class FakeContext:
    def __init__(self, storage, categorizer=None, exchange_service=None, on_transaction=None):
        self.storage = storage
        self.poller = None
        self.categorizer = categorizer
        self.exchange_service = exchange_service
        self.on_transaction = on_transaction


class FakeUserManager:
    def __init__(self, ctx):
        self._ctx = ctx

    def get(self, username):
        return self._ctx if username == TEST_USER else None


def _url(path=""):
    return f"/webhook/apple-wallet/{TEST_USER}{path}"


@pytest.fixture
def webhook_app(in_memory_db):
    storage = Storage(connection=in_memory_db)
    ctx = FakeContext(storage)
    return create_webhook_app(FakeUserManager(ctx))


@pytest_asyncio.fixture
async def client(webhook_app):
    transport = ASGITransport(app=webhook_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestAppleWalletWebhook:
    @pytest.mark.asyncio
    async def test_valid_payload_returns_200(self, client, in_memory_db):
        response = await client.post(_url(), json={
            "amount": "-12.50",
            "merchant": "Toast Box",
            "card": "DBS Debit Mastercard",
            "date": "16/04/2026 12:30:00",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "transaction_id" in data

    @pytest.mark.asyncio
    async def test_unknown_user_returns_404(self, webhook_app):
        transport = ASGITransport(app=webhook_app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post("/webhook/apple-wallet/nobody", json={
                "amount": "-12.50",
                "merchant": "Toast Box",
                "card": "DBS Debit",
                "date": "16/04/2026 12:30:00",
            })
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_foreign_currency_payload(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        mock_exchange = MagicMock()
        mock_exchange.get_rate.return_value = 0.35
        ctx = FakeContext(storage, exchange_service=mock_exchange)
        app = create_webhook_app(FakeUserManager(ctx))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(_url(), json={
                "amount": "PLN 3.78",
                "merchant": "Zabka",
                "card": "Visa Signature",
                "date": "16/04/2026 12:30:00",
            })
        assert response.status_code == 200
        tx_id = response.json()["transaction_id"]
        tx = storage.get_transaction(tx_id)
        assert tx["currency"] == "PLN"
        assert tx["amount"] == pytest.approx(3.78)
        assert tx["exchange_rate"] == pytest.approx(0.35)
        mock_exchange.get_rate.assert_called_once_with("PLN")

    @pytest.mark.asyncio
    async def test_sgd_payload_skips_exchange_lookup(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        mock_exchange = MagicMock()
        ctx = FakeContext(storage, exchange_service=mock_exchange)
        app = create_webhook_app(FakeUserManager(ctx))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post(_url(), json={
                "amount": "12.50",
                "merchant": "Toast Box",
                "card": "DBS Debit",
                "date": "16/04/2026 12:30:00",
            })
        mock_exchange.get_rate.assert_not_called()

    @pytest.mark.asyncio
    async def test_categorizer_is_called(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        mock_cat = MagicMock()
        mock_cat.categorize.return_value = ("Food & Drink", "keyword:toast")
        ctx = FakeContext(storage, categorizer=mock_cat)
        app = create_webhook_app(FakeUserManager(ctx))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(_url(), json={
                "amount": "-12.50",
                "merchant": "Toast Box",
                "card": "DBS Debit",
                "date": "16/04/2026 12:30:00",
            })
        assert response.status_code == 200
        tx_id = response.json()["transaction_id"]
        tx = storage.get_transaction(tx_id)
        assert tx["category"] == "Food & Drink"
        mock_cat.categorize.assert_called_once_with("Toast Box")

    @pytest.mark.asyncio
    async def test_on_transaction_callback_fires(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        callback = MagicMock()
        ctx = FakeContext(storage, on_transaction=callback)
        app = create_webhook_app(FakeUserManager(ctx))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(_url(), json={
                "amount": "-12.50",
                "merchant": "Toast Box",
                "card": "DBS Debit",
                "date": "16/04/2026 12:30:00",
            })
        assert response.status_code == 200
        tx_id = response.json()["transaction_id"]
        callback.assert_called_once_with(tx_id, pytest.approx(12.50), "Toast Box", None, "default", "apple_wallet")

    @pytest.mark.asyncio
    async def test_card_name_stored_in_description(self, client, in_memory_db):
        storage = Storage(connection=in_memory_db)
        response = await client.post(_url(), json={
            "amount": "-12.50",
            "merchant": "Toast Box",
            "card": "Visa Signature",
            "date": "16/04/2026 12:30:00",
        })
        tx_id = response.json()["transaction_id"]
        tx = storage.get_transaction(tx_id)
        assert tx["description"] == "Apple Wallet - Visa Signature"

    @pytest.mark.asyncio
    async def test_numeric_amount_accepted(self, client):
        response = await client.post(_url(), json={
            "amount": 12.50,
            "merchant": "Toast Box",
            "card": "DBS Debit",
            "date": "16/04/2026 12:30:00",
        })
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_amount_returns_400(self, client):
        response = await client.post(_url(), json={
            "merchant": "Test",
            "card": "Visa",
            "date": "16/04/2026 12:00:00",
        })
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_missing_merchant_returns_400(self, client):
        response = await client.post(_url(), json={
            "amount": "-10.0",
            "card": "Visa",
            "date": "16/04/2026 12:00:00",
        })
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_duplicate_within_window_returns_200(self, client, in_memory_db):
        payload = {
            "amount": "-12.50",
            "merchant": "Toast Box",
            "card": "DBS Debit",
            "date": "16/04/2026 12:30:00",
        }
        r1 = await client.post(_url(), json=payload)
        assert r1.status_code == 200
        r2 = await client.post(_url(), json=payload)
        assert r2.status_code == 200
        assert r2.json()["status"] == "duplicate"


class TestWebhookDedup:
    @pytest.mark.asyncio
    async def test_cross_source_duplicate_detected(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        tx_id = storage.insert_transaction(
            source="dbs_paylah",
            source_id="email-123",
            amount=8.20,
            merchant="BAN MIAN",
            transaction_date="2026-04-16T12:00:00",
        )
        event = storage.record_source_event("dbs_paylah", "email-123", "{}", timestamp_precision="minute")
        storage.finish_source_event(event["id"], "processed", tx_id)
        ctx = FakeContext(storage)
        app = create_webhook_app(FakeUserManager(ctx))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(_url(), json={
                "amount": "-8.20",
                "merchant": "BAN MIAN",
                "card": "DBS Debit",
                "date": "2026-04-16T12:05:00",
            })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "duplicate"


@pytest.mark.asyncio
async def test_wallet_upgrade_rotation_and_revocation(client, in_memory_db):
    import hashlib
    storage = Storage(in_memory_db)
    payload = {"amount": "12.50", "merchant": "Test", "date": "2026-09-05T12:00:00"}
    storage.set_setting("wallet_credential_hash", hashlib.sha256(b"credential-one").hexdigest())
    # Keep the old Shortcut working until it has successfully sent its credential.
    assert (await client.post(_url(), json=payload)).status_code == 200
    assert (await client.post(_url(), json=payload, headers={"Authorization": "Bearer forged"})).status_code == 401
    response = await client.post(_url(), json=payload, headers={"Authorization": "Bearer credential-one"})
    assert response.status_code == 200
    assert response.json()["status"] == "duplicate"
    assert (await client.post(_url(), json=payload)).status_code == 401
    storage.set_setting("wallet_credential_hash", hashlib.sha256(b"credential-two").hexdigest())
    assert (await client.post(_url(), json=payload, headers={"Authorization": "Bearer credential-one"})).status_code == 401
    assert (await client.post(_url(), json=payload, headers={"Authorization": "Bearer credential-two"})).status_code == 200
    storage.revoke_wallet_credential()
    assert (await client.post(_url(), json=payload, headers={"Authorization": "Bearer credential-two"})).status_code == 401
    assert (await client.post(_url(), json=payload)).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(('body', 'status'), [
    (b'{"merchant":"Private Merchant"}', 400),
    (b'{"amount":12,"merchant":{}}', 422),
    (b'{"amount":"secret-invalid-amount","merchant":"Private Merchant"}', 400),
    (b'{"amount":"NaN","merchant":"Private Merchant"}', 400),
    (b'{"amount":12,"merchant":" "}', 400),
    (b'{broken-json', 422),
    (b'\xff', 422),
])
async def test_invalid_wallet_request_is_retained(client, in_memory_db, body, status):
    import base64
    from src.ingestion import IngestionPipeline

    response = await client.post(_url(), content=body)
    assert response.status_code == status
    assert 'secret-invalid-amount' not in response.text
    storage = Storage(in_memory_db)
    issues = storage.list_capture_issues()
    assert len(issues) == 1
    issue = issues[0]
    assert issue['source'] == 'wallet_request'
    assert issue['status'] == 'unrecognized'
    assert 'payload' not in issue and 'source_id' not in issue
    row = in_memory_db.execute('SELECT payload FROM source_events').fetchone()
    assert base64.b64decode(row['payload']) == body
    assert in_memory_db.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 0
    pipeline = IngestionPipeline(storage)
    pipeline.retry_pending()
    assert storage.list_capture_issues()[0]['attempts'] == 1
    storage.retry_source_event(issue['id'])
    pipeline.retry_pending()
    assert storage.list_capture_issues()[0]['status'] == 'unrecognized'


@pytest.mark.asyncio
async def test_unauthorized_invalid_wallet_body_is_not_retained(client, in_memory_db):
    storage = Storage(in_memory_db)
    storage.revoke_wallet_credential()
    response = await client.post(_url(), content=b'{broken')
    assert response.status_code == 401
    assert in_memory_db.execute('SELECT COUNT(*) FROM source_events').fetchone()[0] == 0


@pytest.mark.asyncio
async def test_wallet_raw_evidence_links_reformatted_duplicate(client, in_memory_db):
    import json
    payload = {'amount': 12.5, 'merchant': 'Cafe', 'date': '2026-09-06T12:00:00', 'extra': 'original evidence'}
    first = await client.post(_url(), json=payload)
    second = await client.post(_url(), content=json.dumps(payload, indent=2))
    assert first.json()['transaction_id'] == second.json()['transaction_id']
    assert second.json()['status'] == 'duplicate'
    rows = in_memory_db.execute("SELECT * FROM source_events WHERE source = 'wallet_request'").fetchall()
    assert len(rows) == 2
    assert all(row['status'] == 'processed' and row['transaction_id'] == first.json()['transaction_id'] for row in rows)
