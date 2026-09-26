"""Tests for AdminStorage — the auth/user/session layer in app.db."""
import sqlite3
from datetime import datetime, timedelta

import pytest

from src.storage import AdminStorage


# ── Users ─────────────────────────────────────────────────────────────────────

def test_create_and_get_user(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash123")
    user = store.get_user("alice")
    assert user is not None
    assert user["username"] == "alice"
    assert user["password_hash"] == "hash123"
    assert user["gmail_connected"] == 0
    assert user["telegram_chat_id"] is None
    assert user["onboarding_complete"] == 0
    assert user["wants_gmail"] == 1
    assert user["wants_apple_wallet"] == 1
    assert user["force_password_change"] == 1


def test_get_user_not_found(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.get_user("nobody") is None


def test_create_user_duplicate_raises(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash1")
    with pytest.raises(ValueError, match="already exists"):
        store.create_user("alice", "hash2")


def test_get_user_by_chat_id(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash123")
    store.update_user("alice", telegram_chat_id="12345")
    user = store.get_user_by_chat_id("12345")
    assert user is not None
    assert user["username"] == "alice"


def test_get_user_by_chat_id_not_found(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.get_user_by_chat_id("99999") is None


def test_delete_user_cascades_sessions(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_session("alice")
    assert store.verify_session(token) == "alice"
    store.delete_user("alice")
    assert store.get_user("alice") is None
    # session cascade: token no longer valid
    assert store.verify_session(token) is None


def test_update_user_allowed_fields(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "old_hash")
    store.update_user(
        "alice",
        gmail_connected=1,
        telegram_chat_id="99",
        wants_gmail=0,
        wants_apple_wallet=0,
        onboarding_complete=1,
        password_hash="new_hash",
    )
    user = store.get_user("alice")
    assert user["gmail_connected"] == 1
    assert user["telegram_chat_id"] == "99"
    assert user["wants_gmail"] == 0
    assert user["wants_apple_wallet"] == 0
    assert user["onboarding_complete"] == 1
    assert user["password_hash"] == "new_hash"


def test_update_user_disallowed_field(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    with pytest.raises(ValueError, match="disallowed"):
        store.update_user("alice", is_admin=1)


def test_list_users(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "h1")
    store.create_user("bob", "h2")
    users = store.list_users()
    assert len(users) == 2
    usernames = [u["username"] for u in users]
    assert "alice" in usernames
    assert "bob" in usernames


# ── User sessions ─────────────────────────────────────────────────────────────

def test_session_create_and_verify(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_session("alice")
    assert len(token) == 64  # 32 bytes hex
    assert store.verify_session(token) == "alice"


def test_session_verify_invalid_token(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.verify_session("nonexistent") is None


def test_session_sliding_window_updates_last_used(in_memory_admin_db):
    """verify_session updates last_used_at on each call."""
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_session("alice")
    # Get initial last_used_at
    row_before = in_memory_admin_db.execute(
        "SELECT last_used_at FROM sessions WHERE token = ?", (token,)
    ).fetchone()
    import time; time.sleep(1.01)
    store.verify_session(token)
    row_after = in_memory_admin_db.execute(
        "SELECT last_used_at FROM sessions WHERE token = ?", (token,)
    ).fetchone()
    assert row_after["last_used_at"] >= row_before["last_used_at"]


def test_session_expired_returns_none(in_memory_admin_db):
    """Session older than 30 days is rejected and deleted."""
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_session("alice")
    # Back-date last_used_at by 31 days
    old_time = (datetime.utcnow() - timedelta(days=31)).strftime("%Y-%m-%d %H:%M:%S")
    in_memory_admin_db.execute(
        "UPDATE sessions SET last_used_at = ? WHERE token = ?", (old_time, token)
    )
    in_memory_admin_db.commit()
    result = store.verify_session(token)
    assert result is None
    # Token should be deleted
    row = in_memory_admin_db.execute(
        "SELECT 1 FROM sessions WHERE token = ?", (token,)
    ).fetchone()
    assert row is None


def test_session_user_agent_stored(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    store.create_session("alice", user_agent="Mozilla/5.0 Safari/537")
    sessions = store.list_sessions("alice")
    assert len(sessions) == 1
    assert "Safari" in sessions[0]["user_agent"]


def test_destroy_session(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_session("alice")
    store.destroy_session(token)
    assert store.verify_session(token) is None


def test_destroy_all_sessions_except_current(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    keep = store.create_session("alice", user_agent="Safari")
    store.create_session("alice", user_agent="Chrome")
    store.create_session("alice", user_agent="Firefox")
    store.destroy_all_sessions("alice", except_token=keep)
    sessions = store.list_sessions("alice")
    assert len(sessions) == 1
    assert sessions[0]["token"] == keep


def test_destroy_all_sessions_no_except(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    store.create_session("alice")
    store.create_session("alice")
    store.destroy_all_sessions("alice")
    assert store.list_sessions("alice") == []


def test_list_sessions_ordered_newest_first(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    t1 = store.create_session("alice", user_agent="old")
    import time; time.sleep(1.01)
    t2 = store.create_session("alice", user_agent="new")
    sessions = store.list_sessions("alice")
    assert sessions[0]["token"] == t2  # newest first
    assert sessions[1]["token"] == t1


# ── Admin sessions ─────────────────────────────────────────────────────────────

def test_admin_session_create_and_verify(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    token = store.create_admin_session()
    assert store.verify_admin_session(token) is True


def test_admin_session_invalid_token(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.verify_admin_session("bad-token") is False


def test_admin_session_2hr_window(in_memory_admin_db):
    """Admin session expires after 2 hours of inactivity."""
    store = AdminStorage(in_memory_admin_db)
    token = store.create_admin_session()
    # Back-date last_used_at by 3 hours
    old_time = (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
    in_memory_admin_db.execute(
        "UPDATE admin_sessions SET last_used_at = ? WHERE token = ?", (old_time, token)
    )
    in_memory_admin_db.commit()
    assert store.verify_admin_session(token) is False
    # Token should be deleted
    row = in_memory_admin_db.execute(
        "SELECT 1 FROM admin_sessions WHERE token = ?", (token,)
    ).fetchone()
    assert row is None


def test_admin_session_sliding_window(in_memory_admin_db):
    """verify_admin_session updates last_used_at on each call."""
    store = AdminStorage(in_memory_admin_db)
    token = store.create_admin_session()
    row_before = in_memory_admin_db.execute(
        "SELECT last_used_at FROM admin_sessions WHERE token = ?", (token,)
    ).fetchone()
    import time; time.sleep(1.01)
    store.verify_admin_session(token)
    row_after = in_memory_admin_db.execute(
        "SELECT last_used_at FROM admin_sessions WHERE token = ?", (token,)
    ).fetchone()
    assert row_after["last_used_at"] >= row_before["last_used_at"]


def test_destroy_admin_session(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    token = store.create_admin_session()
    store.destroy_admin_session(token)
    assert store.verify_admin_session(token) is False


# ── Telegram link tokens ──────────────────────────────────────────────────────

def test_telegram_link_token_consume(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_telegram_link_token("alice")
    assert token.startswith("CASHE-")
    assert len(token) == 12  # "CASHE-" (6) + 6 chars
    username = store.consume_telegram_link_token(token)
    assert username == "alice"
    # One-time use: second consume returns None
    assert store.consume_telegram_link_token(token) is None


def test_telegram_link_token_expired(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    token = store.create_telegram_link_token("alice")
    # Back-date expires_at by 25 hours
    old_time = (datetime.utcnow() - timedelta(hours=25)).strftime("%Y-%m-%d %H:%M:%S")
    in_memory_admin_db.execute(
        "UPDATE telegram_link_tokens SET expires_at = ? WHERE token = ?", (old_time, token)
    )
    in_memory_admin_db.commit()
    assert store.consume_telegram_link_token(token) is None
    # Expired token is deleted
    row = in_memory_admin_db.execute(
        "SELECT 1 FROM telegram_link_tokens WHERE token = ?", (token,)
    ).fetchone()
    assert row is None


def test_telegram_link_token_invalid(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.consume_telegram_link_token("CASHE-BADVAL") is None


def test_telegram_link_token_replaces_existing(in_memory_admin_db):
    """create_telegram_link_token replaces any existing token for the same user."""
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "hash")
    old_token = store.create_telegram_link_token("alice")
    new_token = store.create_telegram_link_token("alice")
    assert old_token != new_token
    # Old token is gone
    assert store.consume_telegram_link_token(old_token) is None
    # New token works
    assert store.consume_telegram_link_token(new_token) == "alice"


def test_password_hash_update(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    store.create_user("alice", "old_hash")
    store.update_user("alice", password_hash="new_hash")
    user = store.get_user("alice")
    assert user["password_hash"] == "new_hash"


# ── Job health ──────────────────────────────────────────────────────────────

def test_job_run_records_start_and_success(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    run_id = store.record_job_start("backup")
    store.record_job_success(run_id)
    health = store.get_job_health()
    assert len(health) == 1
    assert health[0]["job_name"] == "backup"
    assert health[0]["status"] == "succeeded"
    assert health[0]["started_at"] is not None
    assert health[0]["finished_at"] is not None
    assert health[0]["error_code"] is None
    assert health[0]["consecutive_failures"] == 0


def test_job_run_records_failure_with_bounded_error_code(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    run_id = store.record_job_start("backup")
    store.record_job_failure(run_id, "SQLITE_BUSY: " + "x" * 500)
    health = store.get_job_health()
    assert health[0]["status"] == "failed"
    assert len(health[0]["error_code"]) <= 200


def test_job_health_reports_latest_run_per_job(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    first = store.record_job_start("backup")
    store.record_job_success(first)
    second = store.record_job_start("backup")
    store.record_job_failure(second, "UploadError")
    health = store.get_job_health()
    assert len(health) == 1
    assert health[0]["status"] == "failed"
    assert health[0]["error_code"] == "UploadError"


def test_job_health_counts_consecutive_failures(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    ok = store.record_job_start("capture_retry")
    store.record_job_success(ok)
    for _ in range(3):
        run_id = store.record_job_start("capture_retry")
        store.record_job_failure(run_id, "Timeout")
    health = store.get_job_health()
    assert health[0]["consecutive_failures"] == 3


def test_job_health_tracks_jobs_independently(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    backup_run = store.record_job_start("backup")
    store.record_job_success(backup_run)
    retry_run = store.record_job_start("capture_retry")
    store.record_job_failure(retry_run, "Timeout")
    health = {row["job_name"]: row for row in store.get_job_health()}
    assert health["backup"]["status"] == "succeeded"
    assert health["capture_retry"]["status"] == "failed"


def test_job_health_empty_when_no_runs(in_memory_admin_db):
    store = AdminStorage(in_memory_admin_db)
    assert store.get_job_health() == []
