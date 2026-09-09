"""Integration tests for admin_app.py FastAPI routes."""
import sqlite3

import bcrypt
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import AdminStorage
from src.web.admin_app import create_admin_app


# ── Helpers ───────────────────────────────────────────────────────────────────

ADMIN_PASSWORD = "secret-admin"
ADMIN_HASH = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()


def _make_admin_db():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            telegram_chat_id TEXT,
            gmail_connected INTEGER DEFAULT 0,
            wants_gmail INTEGER DEFAULT 1,
            wants_apple_wallet INTEGER DEFAULT 1,
            onboarding_complete INTEGER DEFAULT 0,
            force_password_change INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE admin_sessions (
            token TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE telegram_link_tokens (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            expires_at DATETIME NOT NULL
        );
        CREATE TABLE job_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name      TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed')),
            started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at   DATETIME,
            error_code    TEXT
        );
    """)
    conn.row_factory = sqlite3.Row
    return conn


class FakeUserManager:
    """Minimal UserManager stub that records calls and delegates to AdminStorage."""

    def __init__(self, admin_storage):
        self._storage = admin_storage
        self.created = []
        self.deleted = []
        self.contexts = {}

    def create_user(self, username, password_hash):
        self._storage.create_user(username, password_hash)
        self.created.append(username)

    def delete_user(self, username):
        self.deleted.append(username)

    def get(self, username):
        return self.contexts.get(username)


@pytest.fixture
def admin_db():
    return _make_admin_db()


@pytest.fixture
def user_manager(admin_db):
    return FakeUserManager(AdminStorage(admin_db))


@pytest.fixture
def app(admin_db, user_manager):
    storage = AdminStorage(admin_db)
    return create_admin_app(storage, user_manager, ADMIN_HASH)


# ── Login ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_login_success(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
    assert resp.status_code == 200
    assert "token" in resp.json()
    assert "admin_session" not in resp.cookies


@pytest.mark.asyncio
async def test_admin_login_wrong_password(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/login", json={"password": "wrong"})
    assert resp.status_code == 401
    assert "token" not in resp.json()


@pytest.mark.asyncio
async def test_admin_login_rate_limit(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(5):
            await client.post("/api/login", json={"password": "wrong"})
        resp = await client.post("/api/login", json={"password": "wrong"})
    assert resp.status_code == 429


# ── Protected routes require auth ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_list_users_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/users")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_health_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/health")
    assert resp.status_code == 401


# ── Job health ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_health_reports_job_runs(app, admin_db):
    storage = AdminStorage(admin_db)
    run_id = storage.record_job_start("backup")
    storage.record_job_failure(run_id, "UploadError")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.get("/api/health", headers={"X-Admin-Token": token})
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["job_name"] == "backup"
    assert jobs[0]["status"] == "failed"
    assert jobs[0]["error_code"] == "UploadError"
    assert jobs[0]["consecutive_failures"] == 1


@pytest.mark.asyncio
async def test_admin_health_reports_per_user_capture_freshness(app, admin_db, user_manager):
    from types import SimpleNamespace
    from src.main import init_db
    from src.storage import Storage
    user_manager._storage.create_user("alice", bcrypt.hashpw(b"x", bcrypt.gensalt()).decode())
    alice_storage = Storage(init_db(":memory:"))
    alice_storage.record_source_event("apple_wallet", "evidence-1", "{}", timestamp_precision="second")
    user_manager.contexts["alice"] = SimpleNamespace(storage=alice_storage)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.get("/api/health", headers={"X-Admin-Token": token})
    capture = resp.json()["capture"]
    assert "alice" in capture
    assert capture["alice"]["oldest_queued_at"] is not None
    assert capture["alice"]["exhausted_retry_count"] == 0


# ── User CRUD ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_create_user(app, admin_db, user_manager):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.post("/api/users", json={"username": "alice"}, headers={"X-Admin-Token": token})
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "alice"
    # server-generated password returned once
    assert "password" in data and len(data["password"]) >= 12
    # UserManager.create_user was called
    assert "alice" in user_manager.created
    # user exists in AdminStorage with force_password_change=1
    storage = AdminStorage(admin_db)
    user = storage.get_user("alice")
    assert user is not None
    assert user["force_password_change"] == 1


@pytest.mark.asyncio
async def test_admin_create_user_duplicate(app, admin_db):
    storage = AdminStorage(admin_db)
    storage.create_user("alice", "hash")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.post("/api/users", json={"username": "alice", "password": "pass1234"}, headers={"X-Admin-Token": token})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_admin_delete_user(app, admin_db, user_manager):
    storage = AdminStorage(admin_db)
    storage.create_user("alice", "hash")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.delete("/api/users/alice", headers={"X-Admin-Token": token})
    assert resp.status_code == 200
    assert "alice" in user_manager.deleted
    assert storage.get_user("alice") is None


@pytest.mark.asyncio
async def test_admin_reset_password(app, admin_db):
    storage = AdminStorage(admin_db)
    storage.create_user("alice", "old_hash")
    old_session = storage.create_session("alice")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["token"]
        resp = await client.post(
            "/api/users/alice/reset-password",
            json={"new_password": "newpass12"},
            headers={"X-Admin-Token": token},
        )
    assert resp.status_code == 200
    user = storage.get_user("alice")
    assert bcrypt.checkpw(b"newpass12", user["password_hash"].encode())
    assert user["force_password_change"] == 1
    # All sessions invalidated
    assert storage.verify_session(old_session) is None


@pytest.mark.asyncio
async def test_admin_session_expires(app, admin_db):
    """Expired admin session → 401 on protected route."""
    from datetime import datetime, timedelta
    storage = AdminStorage(admin_db)
    token = storage.create_admin_session()
    old_time = (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
    admin_db.execute(
        "UPDATE admin_sessions SET last_used_at = ? WHERE token = ?", (old_time, token)
    )
    admin_db.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/users", headers={"X-Admin-Token": token})
    assert resp.status_code == 401
