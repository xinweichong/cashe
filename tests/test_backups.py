import os
from pathlib import Path
import sqlite3

import pytest
from cryptography.fernet import Fernet, InvalidToken

from src.backups import create_snapshot, restore_snapshot
from src.main import init_db, init_app_db


def test_encrypted_snapshot_restores_wal_databases_and_credentials(tmp_path):
    data = tmp_path / "data"
    user_dir = data / "users" / "alice"
    user_dir.mkdir(parents=True)
    admin = init_app_db(str(data / "app.db"))
    user = init_db(str(user_dir / "expense_tracker.db"))
    user.execute("INSERT INTO transactions(source, source_id, amount) VALUES ('manual', 'preserve-id', 12.5)")
    user.commit()
    (user_dir / "token.json").write_text('{"token":"synthetic-oauth-token"}')
    config = tmp_path / "config.yaml"
    config.write_text("synthetic: protected-config")
    key = Fernet.generate_key()
    snapshot = create_snapshot(data, {"config.yaml": config}, key)
    assert b"synthetic" not in snapshot
    destination = tmp_path / "restored"
    manifest = restore_snapshot(snapshot, destination, key)
    assert "data/users/alice/token.json" in manifest["files"]
    assert (destination / "protected/config.yaml").read_text() == config.read_text()
    restored = init_db(str(destination / "data/users/alice/expense_tracker.db"))
    assert restored.execute("SELECT source_id, amount FROM transactions").fetchone()[:] == ("preserve-id", 12.5)
    assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    restored.close()
    admin.close()
    user.close()
    with pytest.raises(ValueError, match="must not exist"):
        restore_snapshot(snapshot, destination, key)
    with pytest.raises(InvalidToken):
        restore_snapshot(snapshot, tmp_path / "wrong-key", Fernet.generate_key())
    with pytest.raises(InvalidToken):
        restore_snapshot(snapshot[:-10] + b"tampered!!", tmp_path / "tampered", key)


def test_snapshot_rejects_unsafe_paths_and_missing_admin(tmp_path):
    with pytest.raises(ValueError, match="missing"):
        create_snapshot(tmp_path, {}, Fernet.generate_key())
    conn = init_app_db(str(tmp_path / "app.db"))
    with pytest.raises(ValueError, match="Invalid snapshot path"):
        create_snapshot(tmp_path, {"../../escape": tmp_path / "app.db"}, Fernet.generate_key())
    conn.close()


def test_create_command_records_job_success(tmp_path):
    from scripts.backup import main
    data = tmp_path / "data"
    user_dir = data / "users" / "alice"
    user_dir.mkdir(parents=True)
    init_app_db(str(data / "app.db")).close()
    init_db(str(user_dir / "expense_tracker.db")).close()
    key_file = tmp_path / "key"
    key_file.write_bytes(Fernet.generate_key())
    config = tmp_path / "config.yaml"
    config.write_text("synthetic: config")
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    snapshot_path = tmp_path / "snapshot.fernet"
    main([
        "create", "--key-file", str(key_file), "--data-dir", str(data),
        "--config", str(config), "--credentials", str(creds), "--snapshot", str(snapshot_path),
    ])
    assert snapshot_path.exists()
    admin = sqlite3.connect(str(data / "app.db"))
    row = admin.execute("SELECT job_name, status, error_code FROM job_runs").fetchone()
    assert row == ("backup", "succeeded", None)
    admin.close()


def test_create_command_records_job_failure(tmp_path, monkeypatch):
    import scripts.backup as backup_module
    data = tmp_path / "data"
    user_dir = data / "users" / "alice"
    user_dir.mkdir(parents=True)
    init_app_db(str(data / "app.db")).close()
    init_db(str(user_dir / "expense_tracker.db")).close()
    key_file = tmp_path / "key"
    key_file.write_bytes(Fernet.generate_key())

    def _boom(*args, **kwargs):
        raise ValueError("synthetic failure")
    monkeypatch.setattr(backup_module, "create_snapshot", _boom)

    with pytest.raises(ValueError, match="synthetic failure"):
        backup_module.main([
            "create", "--key-file", str(key_file), "--data-dir", str(data),
            "--config", str(tmp_path / "config.yaml"), "--credentials", str(tmp_path / "credentials.json"),
            "--snapshot", str(tmp_path / "snapshot.fernet"),
        ])
    admin = sqlite3.connect(str(data / "app.db"))
    row = admin.execute("SELECT job_name, status, error_code FROM job_runs").fetchone()
    assert row == ("backup", "failed", "ValueError")
    admin.close()


def test_missing_admin_db_skips_job_tracking(tmp_path):
    from scripts.backup import main
    key_file = tmp_path / "key"
    key_file.write_bytes(Fernet.generate_key())
    with pytest.raises(ValueError, match="missing"):
        main([
            "create", "--key-file", str(key_file), "--data-dir", str(tmp_path / "data"),
            "--config", str(tmp_path / "config.yaml"), "--credentials", str(tmp_path / "credentials.json"),
            "--snapshot", str(tmp_path / "snapshot.fernet"),
        ])
    assert not (tmp_path / "data" / "app.db").exists()


def test_unwritable_admin_db_does_not_block_the_actual_backup(tmp_path):
    """The backup running as a host user distinct from the Docker container's
    user (e.g. app.db owned by root, backup run as an unprivileged operator)
    must still produce a snapshot — job-health tracking is a diagnostic
    nice-to-have, not on the critical path for data protection."""
    from scripts.backup import main
    data = tmp_path / "data"
    user_dir = data / "users" / "alice"
    user_dir.mkdir(parents=True)
    init_app_db(str(data / "app.db")).close()
    init_db(str(user_dir / "expense_tracker.db")).close()
    os.chmod(data / "app.db", 0o444)
    os.chmod(data, 0o555)  # also block creating app.db-wal/-journal in this dir
    key_file = tmp_path / "key"
    key_file.write_bytes(Fernet.generate_key())
    config = tmp_path / "config.yaml"
    config.write_text("synthetic: config")
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    snapshot_path = tmp_path / "snapshot.fernet"
    try:
        main([
            "create", "--key-file", str(key_file), "--data-dir", str(data),
            "--config", str(config), "--credentials", str(creds),
            "--snapshot", str(snapshot_path),
        ])
    finally:
        os.chmod(data, 0o755)
        os.chmod(data / "app.db", 0o644)
    assert snapshot_path.exists()


def test_remote_upload_verifies_before_retention_and_obeys_ceiling():
    from io import BytesIO
    from unittest.mock import MagicMock
    from scripts.backup import upload_snapshot
    client = MagicMock()
    objects = [{"Key": f"cashe/2020-01-{day:02d}T120000-aaaa.fernet", "Size": 100} for day in range(1, 32)]
    objects.append({"Key": "unrelated-object", "Size": 20})
    client.get_paginator.return_value.paginate.return_value = [{"Contents": objects}]
    with pytest.raises(ValueError, match="ceiling"):
        upload_snapshot(client, "test-bucket", b"encrypted", max_bytes=100)
    client.put_object.assert_not_called()
    client.get_object.return_value = {"Body": BytesIO(b"corrupted")}
    with pytest.raises(ValueError, match="verification failed"):
        upload_snapshot(client, "test-bucket", b"encrypted", max_bytes=10000)
    client.delete_object.assert_not_called()
    client.get_object.return_value = {"Body": BytesIO(b"encrypted")}
    upload_snapshot(client, "test-bucket", b"encrypted", max_bytes=10000)
    assert client.delete_object.call_count == 2
    assert all(call.kwargs["Key"].startswith("cashe/") for call in client.delete_object.call_args_list)
