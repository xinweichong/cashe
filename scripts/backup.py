"""Operator CLI: python -m scripts.backup --help."""
import argparse
from datetime import datetime
import hashlib
import os
from pathlib import Path
import secrets
import sqlite3

from cryptography.fernet import Fernet

from src.backups import MAX_SNAPSHOT_BYTES, create_snapshot, restore_snapshot
from src.config import local_now
from src.storage import AdminStorage


def upload_snapshot(client, bucket: str, snapshot: bytes, *, max_bytes: int) -> str:
    """Use a dedicated R2 bucket; verify the new object before pruning history.

    Retain the newest snapshot from 30 distinct days and 12 distinct months.
    The ceiling includes all bucket objects, including those outside our prefix.
    """
    objects = [obj for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket)
               for obj in page.get("Contents", [])]
    if sum(obj["Size"] for obj in objects) + len(snapshot) > max_bytes:
        raise ValueError("Backup storage ceiling reached; upload stopped")
    key = f"cashe/{local_now().strftime('%Y-%m-%dT%H%M%S')}-{secrets.token_hex(4)}.fernet"
    client.put_object(Bucket=bucket, Key=key, Body=snapshot, ContentType="application/octet-stream")
    response = client.get_object(Bucket=bucket, Key=key)
    try:
        downloaded = response["Body"].read(len(snapshot) + 1)
    finally:
        response["Body"].close()
    if hashlib.sha256(downloaded).digest() != hashlib.sha256(snapshot).digest():
        raise ValueError("Uploaded snapshot verification failed; prior backups retained")
    candidates = []
    for obj in [*objects, {"Key": key}]:
        name = obj["Key"]
        if name.startswith("cashe/") and name.endswith(".fernet"):
            try:
                datetime.strptime(name[6:16], "%Y-%m-%d")
            except ValueError:
                continue
            candidates.append(name)
    days, months = set(), set()
    for name in sorted(candidates, reverse=True):
        day, month = name[6:16], name[6:13]
        keep_day = day not in days and len(days) < 30
        keep_month = month not in months and len(months) < 12
        if keep_day or keep_month:
            days.add(day)
            months.add(month)
        else:
            client.delete_object(Bucket=bucket, Key=name)
    return key


def _write_private(path: Path, content: bytes) -> None:
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(content)


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["keygen", "create", "restore", "upload"])
    parser.add_argument("--key-file", required=True, type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--credentials", type=Path, default=Path("credentials.json"))
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--max-remote-bytes", type=int, default=8_000_000_000)
    args = parser.parse_args(argv)
    if args.command == "keygen":
        _write_private(args.key_file, Fernet.generate_key())
        print("Created private key file. Keep a separate off-host copy.")
        return
    key = args.key_file.read_bytes().strip()
    if args.command == "restore":
        if not args.snapshot or not args.destination:
            parser.error("restore requires --snapshot and --destination")
        if args.snapshot.stat().st_size > MAX_SNAPSHOT_BYTES * 2:
            parser.error("Snapshot exceeds size limit")
        manifest = restore_snapshot(args.snapshot.read_bytes(), args.destination, key)
        print(f"Restored {len(manifest['files'])} verified files into an isolated directory.")
        return

    # "create" and "upload" are the recurring backup job — record a bounded,
    # private-value-free run history in app.db's job_runs table if it already
    # exists (skip if the admin DB itself is missing; create_snapshot below
    # will raise its own clear error for that case). This is diagnostic only:
    # the backup running as a different host user than the app's Docker
    # container (a common permission split) must never block the actual
    # backup just because it can't write to app.db.
    admin_conn = None
    admin_store = None
    run_id = None
    if (args.data_dir / "app.db").is_file():
        try:
            from src.main import init_app_db
            admin_conn = init_app_db(str(args.data_dir / "app.db"))
            admin_store = AdminStorage(admin_conn)
            run_id = admin_store.record_job_start("backup")
        except sqlite3.Error as exc:
            print(f"Note: job-health tracking unavailable ({type(exc).__name__}); continuing without it.")
            if admin_conn is not None:
                admin_conn.close()
            admin_conn = admin_store = run_id = None
    try:
        protected = {"config.yaml": args.config, "credentials.json": args.credentials}
        if any(path.resolve() == args.key_file.resolve() for path in protected.values()):
            parser.error("Encryption key cannot be included in protected files")
        snapshot = create_snapshot(args.data_dir, protected, key)
        if args.command == "create":
            if not args.snapshot:
                parser.error("create requires --snapshot")
            _write_private(args.snapshot, snapshot)
            print("Created encrypted snapshot.")
        else:
            import boto3
            endpoint = os.environ["R2_ENDPOINT_URL"]
            if not endpoint.startswith("https://") or not endpoint.endswith(".r2.cloudflarestorage.com"):
                parser.error("Use the account's HTTPS R2 endpoint")
            client = boto3.client("s3", endpoint_url=endpoint, region_name="auto")
            object_key = upload_snapshot(client, os.environ["R2_BACKUP_BUCKET"], snapshot,
                                         max_bytes=args.max_remote_bytes)
            print(f"Uploaded and verified {object_key}")
        if run_id is not None:
            admin_store.record_job_success(run_id)
    except BaseException as exc:
        if run_id is not None:
            admin_store.record_job_failure(run_id, type(exc).__name__)
        raise
    finally:
        if admin_conn is not None:
            admin_conn.close()


if __name__ == "__main__":
    main()
