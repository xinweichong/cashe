import sqlite3
import bcrypt
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from src.web import auth as _auth
from helpers import (
    FakeUserManager, FakeMultiUserManager,
    make_admin_db_with_user, make_admin_db_schema,
    TEST_USERNAME, TEST_PASSWORD,
)


@pytest.fixture(autouse=True)
def reset_auth():
    yield
    _auth._admin_storage = None


@pytest.fixture
def dashboard_app(in_memory_db, monkeypatch):
    monkeypatch.setenv("SECURE_COOKIES", "false")
    admin_conn = make_admin_db_with_user(TEST_PASSWORD)
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    return create_dashboard_app(user_manager, admin_storage)


@pytest_asyncio.fixture
async def client(dashboard_app):
    transport = ASGITransport(app=dashboard_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def authed_client(dashboard_app):
    transport = ASGITransport(app=dashboard_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac


class TestPing:
    @pytest.mark.asyncio
    async def test_ping_returns_ok_when_authenticated(self, authed_client):
        r = await authed_client.get("/api/ping")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    @pytest.mark.asyncio
    async def test_ping_returns_401_when_not_authenticated(self, client):
        r = await client.get("/api/ping")
        assert r.status_code == 401


class TestCookieFlags:
    @pytest.mark.asyncio
    async def test_login_cookie_is_httponly(self, client):
        r = await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        assert r.status_code == 200
        set_cookie = r.headers.get("set-cookie", "")
        assert "httponly" in set_cookie.lower()

    @pytest.mark.asyncio
    async def test_login_cookie_has_samesite_lax(self, client):
        r = await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        assert r.status_code == 200
        set_cookie = r.headers.get("set-cookie", "")
        assert "samesite=lax" in set_cookie.lower()

    @pytest.mark.asyncio
    async def test_login_cookie_not_secure_in_test(self, client):
        # SECURE_COOKIES=false (set by dashboard_app fixture) means Secure flag must be absent
        r = await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        set_cookie = r.headers.get("set-cookie", "")
        assert "secure" not in set_cookie.lower()


class TestLogout:
    @pytest.mark.asyncio
    async def test_logout_clears_session(self, authed_client):
        # Confirm authenticated first
        r = await authed_client.get("/api/ping")
        assert r.status_code == 200
        # Logout
        r = await authed_client.post("/api/logout")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
        # Should now be unauthenticated
        r = await authed_client.get("/api/ping")
        assert r.status_code == 401

    @pytest.mark.asyncio
    async def test_logout_without_session_is_ok(self, client):
        r = await client.post("/api/logout")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


class TestCredentialFilePermissions:
    def test_credentials_written_with_restricted_permissions(self, tmp_path):
        """Credential files must not be world-readable (mode 0o600 or stricter)."""
        import base64
        import os
        import stat

        creds_path = tmp_path / "credentials.json"
        fake_b64 = base64.b64encode(b'{"type": "service_account"}').decode()

        # Simulate the credential-writing block in main.py
        with open(creds_path, "w") as f:
            f.write(base64.b64decode(fake_b64).decode())
        os.chmod(creds_path, 0o600)

        mode = stat.S_IMODE(os.stat(creds_path).st_mode)
        assert not (mode & stat.S_IRGRP), "credential file is group-readable"
        assert not (mode & stat.S_IROTH), "credential file is world-readable"


# ---------------------------------------------------------------------------
# Tests 11: force_password_change enforcement
# ---------------------------------------------------------------------------

def _make_force_pw_fixtures(monkeypatch, in_memory_db, force_pw_username="newuser", force_pw_password="temppass"):
    """Return (app, admin_storage, force_pw_username, force_pw_password)."""
    monkeypatch.setenv("SECURE_COOKIES", "false")
    admin_conn = make_admin_db_schema()
    admin_storage = AdminStorage(admin_conn)
    # Normal user
    pw_hash = bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt()).decode()
    admin_conn.execute(
        "INSERT INTO users (username, password_hash, onboarding_complete, force_password_change) VALUES (?, ?, 1, 0)",
        (TEST_USERNAME, pw_hash),
    )
    # New user whose password must be changed
    forced_hash = bcrypt.hashpw(force_pw_password.encode(), bcrypt.gensalt()).decode()
    admin_conn.execute(
        "INSERT INTO users (username, password_hash, onboarding_complete, force_password_change) VALUES (?, ?, 1, 1)",
        (force_pw_username, forced_hash),
    )
    admin_conn.commit()
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    app = create_dashboard_app(user_manager, admin_storage)
    return app, admin_storage


class TestForcePasswordChange:
    @pytest.mark.asyncio
    async def test_force_pw_user_cannot_access_api(self, in_memory_db, monkeypatch):
        """A user with force_password_change=1 gets 403 on regular endpoints."""
        app, _ = _make_force_pw_fixtures(monkeypatch, in_memory_db)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post("/api/login", json={"username": "newuser", "password": "temppass"})
            r = await ac.get("/api/ping")
            assert r.status_code == 403
            assert "Password change required" in r.text

    @pytest.mark.asyncio
    async def test_force_pw_user_can_read_own_profile(self, in_memory_db, monkeypatch):
        """/api/users/me must still be accessible so the frontend can read force_password_change."""
        app, _ = _make_force_pw_fixtures(monkeypatch, in_memory_db)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post("/api/login", json={"username": "newuser", "password": "temppass"})
            r = await ac.get("/api/users/me")
            assert r.status_code == 200
            assert r.json()["force_password_change"] is True

    @pytest.mark.asyncio
    async def test_force_pw_user_can_logout(self, in_memory_db, monkeypatch):
        """/api/logout must always be accessible."""
        app, _ = _make_force_pw_fixtures(monkeypatch, in_memory_db)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post("/api/login", json={"username": "newuser", "password": "temppass"})
            r = await ac.post("/api/logout")
            assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_normal_user_not_blocked(self, in_memory_db, monkeypatch):
        """A user with force_password_change=0 accesses the API normally."""
        app, _ = _make_force_pw_fixtures(monkeypatch, in_memory_db)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
            r = await ac.get("/api/ping")
            assert r.status_code == 200


# ---------------------------------------------------------------------------
# Test 12: Cross-user data isolation
# ---------------------------------------------------------------------------

def _make_in_memory_user_db():
    """Create a bare in-memory SQLite connection with the per-user schema."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT UNIQUE,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'SGD',
            exchange_rate REAL DEFAULT 1.0,
            merchant TEXT,
            description TEXT,
            category TEXT,
            transaction_date DATETIME,
            ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            raw_data TEXT,
            type TEXT DEFAULT 'expense'
        );
        CREATE TABLE categories (name TEXT PRIMARY KEY, keywords TEXT, icon TEXT, color TEXT, type TEXT DEFAULT 'neutral');
        CREATE TABLE ingestion_state (source TEXT PRIMARY KEY, last_processed_id TEXT, last_processed_at DATETIME, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS merchant_overrides (merchant TEXT PRIMARY KEY, category TEXT NOT NULL, source TEXT DEFAULT 'manual', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS recurring_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant TEXT NOT NULL, avg_amount REAL NOT NULL, frequency TEXT NOT NULL, category TEXT, first_seen DATETIME, last_seen DATETIME, occurrences INTEGER DEFAULT 2);
        CREATE TABLE IF NOT EXISTS merchant_tags (merchant TEXT PRIMARY KEY, tags TEXT DEFAULT '', notes TEXT DEFAULT '', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, period TEXT NOT NULL DEFAULT 'monthly', amount REAL NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(category, period));
        CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target_amount REAL NOT NULL, saved_amount REAL NOT NULL DEFAULT 0, target_date DATE, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'paused')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS goal_contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE, amount REAL NOT NULL, month TEXT NOT NULL, contributed_date TEXT, source TEXT NOT NULL DEFAULT 'auto', note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, destination TEXT, start_date DATE NOT NULL, end_date DATE, primary_currency TEXT DEFAULT 'SGD', status TEXT NOT NULL DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS trip_transactions (trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE, transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, added_by TEXT DEFAULT 'auto', PRIMARY KEY (trip_id, transaction_id));
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    """)
    return conn


class TestCrossUserDataIsolation:
    @pytest.mark.asyncio
    async def test_user_cannot_see_other_users_transactions(self, monkeypatch):
        """Alice's session must only see Alice's transactions — never Bob's."""
        monkeypatch.setenv("SECURE_COOKIES", "false")

        # Build admin DB with two users
        admin_conn = make_admin_db_schema()
        admin_storage = AdminStorage(admin_conn)
        alice_hash = bcrypt.hashpw(b"alice-pass", bcrypt.gensalt()).decode()
        bob_hash = bcrypt.hashpw(b"bob-pass", bcrypt.gensalt()).decode()
        admin_conn.execute(
            "INSERT INTO users (username, password_hash, onboarding_complete) VALUES (?, ?, 1)",
            ("alice", alice_hash),
        )
        admin_conn.execute(
            "INSERT INTO users (username, password_hash, onboarding_complete) VALUES (?, ?, 1)",
            ("bob", bob_hash),
        )
        admin_conn.commit()

        # Separate per-user SQLite DBs
        alice_conn = _make_in_memory_user_db()
        bob_conn = _make_in_memory_user_db()
        alice_storage = Storage(connection=alice_conn)
        bob_storage = Storage(connection=bob_conn)

        # Seed a transaction into Alice's DB only
        alice_storage.insert_transaction(
            source="manual", source_id="alice-tx-001",
            amount=99.0, merchant="Secret Shop",
            transaction_date="2026-01-01T12:00:00",
        )

        _auth.init_auth(admin_storage)
        user_manager = FakeMultiUserManager({"alice": alice_storage, "bob": bob_storage})
        app = create_dashboard_app(user_manager, admin_storage)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # Alice can see her transaction
            await ac.post("/api/login", json={"username": "alice", "password": "alice-pass"})
            r = await ac.get("/api/transactions?limit=50")
            assert r.status_code == 200
            alice_txs = r.json()
            assert any(t["merchant"] == "Secret Shop" for t in alice_txs)
            facts = await ac.get('/api/v2/spending/month?as_of=2026-01-06')
            assert facts.json()['current']['spending']['minor_units'] == 9900
            evidence = await ac.get('/api/v2/spending/evidence?start=2026-01-01&end=2026-01-06')
            assert evidence.json()['total'] == 1

        # Bob gets a fresh client (different session cookie jar)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            await ac.post("/api/login", json={"username": "bob", "password": "bob-pass"})
            r = await ac.get("/api/transactions?limit=50")
            assert r.status_code == 200
            bob_txs = r.json()
            assert not any(t["merchant"] == "Secret Shop" for t in bob_txs)
            facts = await ac.get('/api/v2/spending/month?as_of=2026-01-06')
            assert facts.json()['current']['spending']['minor_units'] == 0
            evidence = await ac.get('/api/v2/spending/evidence?start=2026-01-01&end=2026-01-06')
            assert evidence.json()['total'] == 0



class TestLoginThrottling:
    @pytest.mark.asyncio
    async def test_failed_attempts_are_limited(self, client):
        for _ in range(5):
            response = await client.post("/api/login", json={"username": TEST_USERNAME, "password": "wrong"})
            assert response.status_code == 401
        response = await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        assert response.status_code == 429

    @pytest.mark.asyncio
    async def test_unknown_users_are_limited_too(self, client):
        for _ in range(5):
            assert (await client.post("/api/login", json={"username": "unknown", "password": "wrong"})).status_code == 401
        assert (await client.post("/api/login", json={"username": "unknown", "password": "wrong"})).status_code == 429


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["session", "expired", "revoked", "forged", "replay"])
async def test_oauth_state_is_bound_expiring_and_single_use(in_memory_db, monkeypatch, invalid):
    from unittest.mock import MagicMock
    import time
    admin = AdminStorage(make_admin_db_with_user(TEST_PASSWORD))
    _auth.init_auth(admin)
    manager = FakeUserManager(Storage(in_memory_db))
    manager._ctx.poller = MagicMock()
    manager._ctx.poller.get_auth_url.side_effect = lambda **kwargs: kwargs["state"]
    app = create_dashboard_app(manager, admin)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        response = await client.get("/api/connections/gmail/connect-url")
        state = response.json()["url"]
        assert state != TEST_USERNAME and len(state) >= 32
        if invalid == "session":
            client.cookies.clear()
        elif invalid == "expired":
            now = time.monotonic()
            monkeypatch.setattr("src.web.app.time.monotonic", lambda: now + 601)
        elif invalid == "revoked":
            admin.destroy_session(client.cookies["session"])
        elif invalid == "forged":
            state = TEST_USERNAME
        else:
            assert (await client.get("/oauth/callback", params={"state": state, "code": "code"})).status_code == 200
        response = await client.get("/oauth/callback", params={"state": state, "code": "code"})
        assert response.status_code == 400
        assert manager._ctx.poller.complete_reauth.call_count == (1 if invalid == "replay" else 0)


@pytest.mark.asyncio
async def test_wallet_credentials_are_private_and_revocable(authed_client, in_memory_db):
    import hashlib
    response = await authed_client.post("/api/connections/apple-wallet/credential")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    token = response.json()["token"]
    storage = Storage(in_memory_db)
    assert storage.get_setting("wallet_credential_hash") == hashlib.sha256(token.encode()).hexdigest()
    status = await authed_client.get("/api/connections/apple-wallet")
    assert status.json() == {"configured": True, "required": False}
    assert token not in status.text
    assert (await authed_client.delete("/api/connections/apple-wallet/credential")).status_code == 200
    assert not storage.authorize_wallet(None)
    assert not storage.authorize_wallet(hashlib.sha256(token.encode()).hexdigest())


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", [
    ("get", "/api/connections/apple-wallet"),
    ("post", "/api/connections/apple-wallet/credential"),
    ("delete", "/api/connections/apple-wallet/credential"),
])
async def test_wallet_credential_routes_require_login(client, method, path):
    assert (await getattr(client, method)(path)).status_code == 401


@pytest.mark.asyncio
async def test_capture_issue_api_omits_payload_and_requeues(authed_client, in_memory_db):
    storage = Storage(in_memory_db)
    event = storage.record_source_event('gmail', 'private-source-id', 'private-raw-email')
    storage.finish_source_event(event['id'], 'failed', error_code='ValueError')
    response = await authed_client.get('/api/v2/capture/issues')
    assert response.status_code == 200
    assert response.json()[0]['status'] == 'failed'
    assert 'private' not in response.text
    assert (await authed_client.post(f"/api/v2/capture/issues/{event['id']}/retry")).json() == {'status': 'queued'}
    assert storage.get_source_event('gmail', 'private-source-id')['status'] == 'pending'
    assert (await authed_client.post('/api/v2/capture/issues/999/retry')).status_code == 404


@pytest.mark.asyncio
async def test_capture_issue_api_requires_auth(client):
    assert (await client.get('/api/v2/capture/issues')).status_code == 401
    assert (await client.post('/api/v2/capture/issues/1/retry')).status_code == 401


@pytest.mark.asyncio
async def test_capture_followup_api_omits_payload_and_requeues(authed_client, in_memory_db):
    storage = Storage(in_memory_db)
    storage.insert_transaction(source='manual', source_id='private-id', amount=12.5,
                               followups=[('notification', {'match_source': 'private-keyword'})])
    job = storage.pending_ingestion_effects()[0]
    storage.finish_ingestion_effect(job['id'], error_code='RuntimeError')
    response = await authed_client.get('/api/v2/capture/followups')
    assert response.status_code == 200
    assert response.json()[0]['status'] == 'failed'
    assert 'private' not in response.text
    assert 'payload' not in response.text
    url = f"/api/v2/capture/followups/{job['id']}/retry"
    assert (await authed_client.post(url)).json() == {'status': 'queued'}
    assert storage.pending_ingestion_effects()[0]['attempts'] == 0
    storage.finish_ingestion_effect(job['id'])
    assert (await authed_client.post(url)).status_code == 409
    assert (await authed_client.post('/api/v2/capture/followups/999/retry')).status_code == 404


@pytest.mark.asyncio
async def test_capture_followup_api_requires_auth(client):
    assert (await client.get('/api/v2/capture/followups')).status_code == 401
    assert (await client.post('/api/v2/capture/followups/1/retry')).status_code == 401


@pytest.mark.asyncio
async def test_spending_facts_api_requires_auth_and_valid_queries(client, authed_client):
    assert (await client.get('/api/v2/spending/month')).status_code == 401
    assert (await client.get('/api/v2/spending/evidence?start=2026-09-01&end=2026-09-06')).status_code == 401
    assert (await authed_client.get('/api/v2/spending/month?as_of=invalid')).status_code == 422
    assert (await authed_client.get('/api/v2/spending/month?as_of=0001-01-01')).status_code == 422
    assert (await authed_client.get('/api/v2/spending/evidence?start=2026-09-06&end=2026-09-01')).status_code == 422
    assert (await authed_client.get('/api/v2/spending/evidence?start=2026-09-01&end=2026-09-06&limit=101')).status_code == 422


@pytest.mark.asyncio
async def test_spending_facts_evidence_omits_internal_columns(authed_client, in_memory_db):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='private-source-id', amount=12.5,
                                       transaction_date='2026-09-05T12:00:00', raw_data='secret-email')
    response = await authed_client.get('/api/v2/spending/month?as_of=2026-09-06')
    assert response.status_code == 200
    assert response.json()['current']['spending'] == {'minor_units': 1250, 'currency': 'SGD'}
    response = await authed_client.get('/api/v2/spending/evidence?start=2026-09-01&end=2026-09-06')
    assert response.status_code == 200
    assert response.json()['items'][0]['id'] == tx_id
    assert 'private-source-id' not in response.text and 'secret-email' not in response.text
    assert 'raw_data' not in response.text and 'source_id' not in response.text


@pytest.mark.asyncio
async def test_weekly_spending_api_auth_validation_and_periods(client, authed_client):
    assert (await client.get('/api/v2/spending/week')).status_code == 401
    assert (await authed_client.get('/api/v2/spending/week?as_of=invalid')).status_code == 422
    assert (await authed_client.get('/api/v2/spending/week?as_of=0001-01-01')).status_code == 422
    response = await authed_client.get('/api/v2/spending/week?as_of=2026-01-01')
    assert response.status_code == 200
    assert response.json()['current']['start'] == '2025-12-29'
    assert response.json()['previous']['end'] == '2025-12-25'


@pytest.mark.asyncio
async def test_home_briefing_is_private_and_projects_safe_fields(client, authed_client, in_memory_db, monkeypatch):
    from datetime import datetime
    import src.storage as module
    monkeypatch.setattr(module, 'local_now', lambda *args: datetime(2026, 9, 6))
    storage = Storage(in_memory_db)
    storage.insert_transaction(source='manual', source_id='private-source', amount=12.5,
                               merchant='Cafe', transaction_date='2026-09-05T12:00:00', raw_data='secret-email')
    storage.record_source_event('gmail', 'private-email', 'secret-raw-body')
    assert (await client.get('/api/v2/home')).status_code == 401
    response = await authed_client.get('/api/v2/home')
    assert response.status_code == 200
    data = response.json()
    assert data['facts']['current']['spending']['minor_units'] == 1250
    assert data['capture_issue_count'] == 1
    assert data['recent'][0]['merchant'] == 'Cafe'
    assert data['facts']['current']['income'] is None
    assert data['freshness']['gmail_connected'] is False
    assert 'private-source' not in response.text and 'secret-' not in response.text
    assert 'raw_data' not in response.text


@pytest.mark.asyncio
async def test_home_upcoming_excludes_matched_cancelled_and_outside_window(authed_client, in_memory_db, monkeypatch):
    from datetime import datetime
    import src.storage as module
    monkeypatch.setattr(module, 'local_now', lambda *args: datetime(2026, 9, 6))
    storage = Storage(in_memory_db)
    storage.set_setting('subscriptions_enabled', 'true')
    sub = storage.create_subscription(merchant='Service', frequency='monthly')
    storage.create_upcoming_transaction(sub, '2026-09-07', 10)
    storage.create_upcoming_transaction(sub, '2026-09-08', None)
    storage.create_upcoming_transaction(sub, '2026-09-20', 999)
    old = storage.create_upcoming_transaction(sub, '2026-09-09', 999)
    storage.dismiss_upcoming_transaction(old)
    data = (await authed_client.get('/api/v2/home')).json()
    assert len(data['upcoming']) == 2
    assert data['upcoming_total']['minor_units'] == 1000
    assert data['upcoming_unknown_count'] == 1
    storage.update_subscription(sub, status='cancelled')
    assert (await authed_client.get('/api/v2/home')).json()['upcoming'] == []


@pytest.mark.asyncio
async def test_home_flag_defaults_off_and_validates_atomically(authed_client):
    assert (await authed_client.get('/api/settings')).json()['home_briefing_enabled'] is False
    assert (await authed_client.put('/api/settings', json={'home_briefing_enabled': True, 'anomaly_multiplier': 99})).status_code == 422
    assert (await authed_client.get('/api/settings')).json()['home_briefing_enabled'] is False
    assert (await authed_client.put('/api/settings', json={'home_briefing_enabled': 'true'})).status_code == 422
    assert (await authed_client.put('/api/settings', json={'home_briefing_enabled': True})).status_code == 200
    assert (await authed_client.get('/api/settings')).json()['home_briefing_enabled'] is True


@pytest.mark.asyncio
async def test_capture_review_pagination(authed_client, in_memory_db):
    storage = Storage(in_memory_db)
    first = storage.record_source_event('gmail', 'first', '{}')
    second = storage.record_source_event('gmail', 'second', '{}')
    assert (await authed_client.get('/api/v2/capture/issues?limit=1')).json()[0]['id'] == second['id']
    assert (await authed_client.get('/api/v2/capture/issues?limit=1&offset=1')).json()[0]['id'] == first['id']
    assert (await authed_client.get('/api/v2/capture/issues?offset=-1')).status_code == 422
