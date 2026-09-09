# Encrypted backup and restoration

The trust foundation adds `python -m scripts.backup`. Run from the repository root using Python 3.12. Install `requirements-backup.txt` in the operator environment. No cloud resources or credentials are created automatically.

Snapshots include `data/app.db`, every user database, per-user `token.json`, and the explicitly supplied `config.yaml` and `credentials.json`. Each database is captured through SQLite's backup API, checked for integrity, and packaged with SHA-256 checksums. The complete archive is authenticated and encrypted with Fernet. Snapshot creation is bounded to 128 MiB of uncompressed input; exceeding this stops the operation rather than creating an incomplete backup. Databases are individually consistent, not a global transaction across all user databases; avoid account creation/deletion during a snapshot.

## Configure once

Generate the key in a protected directory **outside the repository and data directory**. Keep an additional copy in an off-host password manager; losing it makes snapshots unrecoverable.

```sh
python -m scripts.backup keygen --key-file /secure/cashe-backup.key
```

For R2 uploads, configure a private, dedicated Standard bucket and bucket-scoped credentials using the operator's protected environment:

- `R2_ENDPOINT_URL`: `https://<account-id>.r2.cloudflarestorage.com`
- `R2_BACKUP_BUCKET`: dedicated backup bucket
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: R2 access credentials

The client configuration follows [Cloudflare's boto3 example](https://developers.cloudflare.com/r2/examples/aws/boto3/). Verify the account's actual storage allocation and other R2 usage before enabling the job. Never add real keys to these docs or commit them.

## Create or upload

```sh
python -m scripts.backup create --key-file /secure/cashe-backup.key --data-dir /path/to/data --config /path/to/config.yaml --credentials /path/to/credentials.json --snapshot /secure/cashe-snapshot.fernet
python -m scripts.backup upload --key-file /secure/cashe-backup.key --data-dir /path/to/data --config /path/to/config.yaml --credentials /path/to/credentials.json
```

Local output is created exclusively with mode 0600; an existing file is not overwritten. Only encrypted archives leave the machine. Run one upload job at a time, daily, from the OCI host scheduler. Check the exit status and alert externally on failure or an overdue snapshot; host scheduling and an external heartbeat still require deployment configuration.

Uploads stop if existing bucket bytes plus the new archive exceed `--max-remote-bytes` (default 8,000,000,000). The ceiling counts the entire bucket, but not unrelated buckets in the account. Successful uploads are downloaded and verified before retention removes older objects under `cashe/`. Retention keeps the newest snapshot for 30 distinct days plus 12 distinct months. Other object prefixes are never pruned. A failed verification retains prior snapshots. Do not run overlapping upload jobs against the same bucket.

## Restore drill

Download a selected encrypted archive from R2, then restore into a **new, isolated** directory:

```sh
python -m scripts.backup restore --key-file /secure/cashe-backup.key --snapshot /secure/cashe-snapshot.fernet --destination /secure/cashe-restore-drill
```

Restoration authenticates the archive, verifies every checksum and database, and rejects unsafe archive paths before publishing the directory. Restored files appear under `data/` and `protected/`. The test suite verifies restoration of committed WAL data and reopening through the current production migrations.

Before opening restored databases through application initialization, run the read-only audit against the admin database and each user database:

```sh
python -m scripts.db_audit /secure/cashe-restore-drill/data/app.db
python -m scripts.db_audit /secure/cashe-restore-drill/data/users/alice/expense_tracker.db
```

The audit opens an existing database with SQLite `mode=ro` and a consistent read transaction. It includes committed WAL data, runs integrity and declared foreign-key checks, and checks known application relationships whose constraints may be missing in older schemas. It never initializes the application schema, applies migrations, repairs rows, or enables foreign-key enforcement for application connections. SQLite may require access to WAL/shared-memory sidecars when inspecting a live database; an isolated restored copy is the preferred audit target.

The JSON report contains schema identifiers and counts, without row IDs, financial values, raw evidence, or credentials. Exit codes are:

- `0`: the implemented integrity/reference checks passed.
- `1`: integrity/reference problems, absent finance tables, missing constraints, or unknown migration versions require review.
- `2`: the database could not be read or its schema was not recognized. A mistyped path does not create a new database.

`pending_migrations` reports upgrades without applying them. `retained_links_to_deleted_transactions` counts source observations and outbox records whose transactions were deleted; `retained_links_to_deleted_subscriptions` counts recurring-suggestion/acceptance records whose subscription was deleted. Both intentionally survive deletion and are informational. Do not delete them merely to clear an audit report. A clean audit does not validate monetary semantics, capture completeness, or application boot behavior.

Review any issues against a representative isolated copy before planning repairs or consistently enabling foreign-key enforcement. Preserve the verified snapshot and record decisions about each orphan; the audit performs no automatic cleanup. Repeat the audit after an isolated upgrade and compare the results with the pre-upgrade report.

Before a production cutover, boot the restored copy in an isolated environment with pollers, Telegram, webhooks, and external AI disabled. Check users, transaction counts, source-event links, and key reports. Preserve the current production data directory and post-snapshot source evidence for replay. Do not point production services at the restored directory until those checks pass.

Automated tests use synthetic fixtures. A real OCI/R2 restore drill has not yet been performed by this implementation.

## Scheduling and health

`deploy/cashe-backup.service` and `deploy/cashe-backup.timer` are systemd unit templates for the daily upload job, defaulting to the paths from the Oracle Cloud Ubuntu deployment (`ubuntu@<vm>:~/expense-tracker`, app running via Docker Compose). Adjust them if the actual host differs.

The app's Docker image only installs `requirements.txt` (no `boto3`/`cryptography`), so the backup job runs in a **separate host-level venv**, not inside the app container — this also keeps the running app process from needing read access to every user's database and `credentials.json`. On a fresh Ubuntu 22.04 VM (ships with Python 3.10, not 3.12):

```sh
sudo apt update && sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt update
sudo apt install -y python3.12 python3.12-venv

cd ~/expense-tracker
python3.12 -m venv backup-venv
./backup-venv/bin/pip install -r requirements-backup.txt

python -m scripts.backup keygen --key-file /secure/cashe-backup.key   # once; back the key up off-host
```

Then install the timer:

```sh
sudo cp deploy/cashe-backup.service deploy/cashe-backup.timer /etc/systemd/system/
sudo mkdir -p /etc/cashe && sudo touch /etc/cashe/backup.env && sudo chmod 600 /etc/cashe/backup.env
# Put R2_ENDPOINT_URL, R2_BACKUP_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in that file.
sudo systemctl daemon-reload
sudo systemctl enable --now cashe-backup.timer
sudo systemctl start cashe-backup.service   # run once immediately to verify
sudo systemctl status cashe-backup.service
```

`Type=oneshot` means systemd will not start a second run of `cashe-backup.service` while one is already active, giving single-job execution without extra locking. Each run records a `job_runs` row (`job_name=backup`) in `app.db` if it already exists — see [job health](#job-health) below.

If a naive `cp`-based cron backup (copying the SQLite file unencrypted to a local directory) is already running on this host, this systemd timer is a stronger replacement — encrypted, integrity-checked, uploaded off-host, and retained on a schedule. Disable the old cron entry (`crontab -e`) once this timer is verified working, rather than running both indefinitely.

An **external** heartbeat/overdue-backup alert (e.g. a dead-man's-switch service the systemd unit pings on success, and that pages when no ping arrives) is not configured by this repository. That decision — which provider, what account, what alert channel — is an operator choice outside code scope; verify it independently before relying on it.

## Job health

`AdminStorage` persists a bounded run history in `app.db`'s `job_runs` table for the backup job, the per-user subscription matcher, and the per-user Gmail/Wallet capture retry job: last started/finished timestamp, status, a bounded error code (job/exception type name only — never a message or financial value), and how many runs in a row have failed. `GET /admin/api/health` (admin-session-protected, distinct from the public `/health` liveness check) returns this history plus, per registered user, `get_capture_health()`: the oldest still-retryable queued source/outbox item, how many rows exhausted their 5-attempt retry budget, and the last successful capture timestamp. This is a diagnostic view for the operator, not a dashboard exposed to end users, and it does not itself alert — pair it with the external heartbeat above or a manual check.
