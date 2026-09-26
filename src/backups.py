"""Encrypted, bounded SQLite snapshots and isolated restoration.

Snapshots use SQLite's backup API, including committed WAL contents. The
encryption key is supplied separately and must never live inside a snapshot.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import tarfile
import tempfile

from cryptography.fernet import Fernet

from src.config import local_now

MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024


def _database_bytes(path: Path) -> bytes:
    source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        # A disk-backed destination lets SQLite normalize the WAL header before
        # serialization; deserializing a WAL-mode image in memory is invalid.
        with tempfile.TemporaryDirectory() as staging:
            target = sqlite3.connect(str(Path(staging) / "snapshot.db"))
            try:
                source.backup(target)
                target.execute("PRAGMA journal_mode=DELETE")
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Database integrity check failed")
                return target.serialize()
            finally:
                target.close()
    finally:
        source.close()


def create_snapshot(data_dir: Path, protected_files: dict[str, Path], key: bytes) -> bytes:
    """Collect all databases and per-user OAuth tokens, then authenticate/encrypt."""
    cipher = Fernet(key)
    data_dir = data_dir.resolve()
    if not (data_dir / "app.db").is_file():
        raise ValueError("Admin database is missing")
    paths = {"data/" + path.relative_to(data_dir).as_posix(): path
             for pattern in ("*.db", "token.json") for path in data_dir.rglob(pattern)}
    paths.update({"protected/" + name: path for name, path in protected_files.items()})
    archive = io.BytesIO()
    manifest = {"version": 1, "created_at": local_now().isoformat(), "files": {}}
    total = 0
    with tarfile.open(fileobj=archive, mode="w:gz") as bundle:
        for name, path in sorted(paths.items()):
            _validate_name(name)
            if path.is_symlink() or not path.is_file():
                raise ValueError("Snapshot input must be a regular file")
            if path.stat().st_size + total > MAX_SNAPSHOT_BYTES:
                raise ValueError("Snapshot exceeds size limit")
            content = _database_bytes(path) if name.endswith(".db") else path.read_bytes()
            total += len(content)
            if total > MAX_SNAPSHOT_BYTES:
                raise ValueError("Snapshot exceeds size limit")
            manifest["files"][name] = hashlib.sha256(content).hexdigest()
            _add_file(bundle, name, content)
        _add_file(bundle, "manifest.json", json.dumps(manifest).encode())
    return cipher.encrypt(archive.getvalue())


def _add_file(bundle: tarfile.TarFile, name: str, content: bytes) -> None:
    entry = tarfile.TarInfo(name)
    entry.size = len(content)
    entry.mode = 0o600
    bundle.addfile(entry, io.BytesIO(content))


def _validate_name(name: str) -> None:
    path = PurePosixPath(name)
    if (path.is_absolute() or ".." in path.parts or "\\" in name
            or len(path.parts) < 2 or path.parts[0] not in {"data", "protected"}):
        raise ValueError("Invalid snapshot path")


def restore_snapshot(snapshot: bytes, destination: Path, key: bytes) -> dict:
    """Validate before publishing to a new directory; never overwrite live data."""
    if destination.exists():
        raise ValueError("Restore destination must not exist")
    if len(snapshot) > MAX_SNAPSHOT_BYTES * 2:
        raise ValueError("Snapshot exceeds size limit")
    plaintext = Fernet(key).decrypt(snapshot)
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:gz") as bundle:
        for entry in bundle:
            total += entry.size
            if not entry.isfile() or total > MAX_SNAPSHOT_BYTES + 1024 * 1024:
                raise ValueError("Invalid snapshot member or size")
            if entry.name in files:
                raise ValueError("Duplicate snapshot member")
            if entry.name != "manifest.json":
                _validate_name(entry.name)
            files[entry.name] = bundle.extractfile(entry).read()
    manifest = json.loads(files.pop("manifest.json"))
    if manifest["version"] != 1 or set(manifest["files"]) != set(files) or "data/app.db" not in files:
        raise ValueError("Invalid snapshot manifest")
    for name, content in files.items():
        if hashlib.sha256(content).hexdigest() != manifest["files"][name]:
            raise ValueError("Snapshot checksum mismatch")
        if name.endswith(".db"):
            conn = sqlite3.connect(":memory:")
            try:
                conn.deserialize(content)
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Restored database integrity check failed")
            finally:
                conn.close()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as staging:
        root = Path(staging) / "restore"
        root.mkdir(mode=0o700)
        for name, content in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with path.open("xb") as output:
                os.chmod(path, 0o600)
                output.write(content)
        root.rename(destination)
    return manifest
