import pytest
import sqlite3
import os
import sys
import bcrypt

# Make the tests/ directory importable so test files can do `from helpers import ...`
sys.path.insert(0, os.path.dirname(__file__))


@pytest.fixture(autouse=True)
def disable_secure_cookies(monkeypatch):
    """Disable Secure cookie flag in tests — httpx uses http:// transport."""
    monkeypatch.setenv("SECURE_COOKIES", "false")


@pytest.fixture
def in_memory_db():
    """Provide an in-memory SQLite connection with schema applied."""
    from src.main import init_db
    conn = init_db(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    yield conn
    conn.close()


@pytest.fixture
def in_memory_admin_db():
    """Provide an in-memory SQLite connection with the app.db schema applied."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE users (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            username              TEXT UNIQUE NOT NULL,
            password_hash         TEXT NOT NULL,
            telegram_chat_id      TEXT,
            gmail_connected       INTEGER DEFAULT 0,
            wants_gmail           INTEGER DEFAULT 1,
            wants_apple_wallet    INTEGER DEFAULT 1,
            onboarding_complete   INTEGER DEFAULT 0,
            force_password_change INTEGER DEFAULT 0,
            created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sessions (
            token           TEXT PRIMARY KEY,
            username        TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            user_agent      TEXT,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE admin_sessions (
            token           TEXT PRIMARY KEY,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE telegram_link_tokens (
            token       TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            expires_at  DATETIME NOT NULL
        );
        CREATE TABLE job_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name      TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed')),
            started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at   DATETIME,
            error_code    TEXT
        );
        CREATE INDEX idx_job_runs_job_name ON job_runs(job_name, id);
    """)
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def sample_categories():
    return [
        {"name": "Food", "keywords": "restaurant,cafe,food,kopitiam,toast box,ya kun", "icon": "🍜"},
        {"name": "Transport", "keywords": "grab,gojek,comfortdelgro,mrt,bus,taxi,cdg", "icon": "🚗"},
        {"name": "Shopping", "keywords": "shopee,lazada,fairprice,cold storage,ntuc", "icon": "🛒"},
        {"name": "Bills", "keywords": "sp services,singtel,starhub,m1", "icon": "📄"},
        {"name": "Entertainment", "keywords": "netflix,spotify", "icon": "🎬"},
        {"name": "Other", "keywords": "", "icon": "📌"},
    ]


@pytest.fixture
def sample_config():
    return {
        "gmail": {
            "credentials_file": "credentials.json",
            "poll_interval_seconds": 120,
            "sender_filters": ["notification@dbs.com", "notification@uob.com"],
        },
        "server": {
            "host": "0.0.0.0",
            "port": 8080,
            "webhook_base_url": "https://example.com",
        },
        "web": {
            "password_hash": "$2b$12$examplehashedpassword",
        },
        "telegram": {
            "bot_token": "test-token-123",
        },
        "categories": [
            {"name": "Food", "keywords": ["restaurant", "cafe", "food"], "icon": "🍜"},
            {"name": "Transport", "keywords": ["grab", "gojek"], "icon": "🚗"},
            {"name": "Other", "keywords": [], "icon": "📌"},
        ],
    }
