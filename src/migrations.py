"""Ordered additive migrations, shared by production and tests.

The existing schema remains the baseline. Never edit a released migration;
append a new version instead. Source evidence deliberately survives deletion
of a transaction and is not exposed by ordinary transaction responses.
"""
import sqlite3


def _add_column_if_table_exists(table: str, column_def: str):
    """Statement factory for MIGRATIONS: ADD COLUMN only if `table` exists.

    Needed because some baseline tables (budgets, goals, ...) predate the
    migration system and aren't guaranteed present on every connection
    migrate() is exercised against (e.g. isolated migration tests).
    """
    def _apply(conn: sqlite3.Connection) -> None:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_def}")
    return _apply


def _create_index_if_table_exists(table: str, index_sql: str):
    """Statement factory for MIGRATIONS: run index_sql only if `table` exists
    (same reasoning as _add_column_if_table_exists — some connections
    migrate() runs against, including admin.db, never have every
    user-database table)."""
    def _apply(conn: sqlite3.Connection) -> None:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            conn.execute(index_sql)
    return _apply


def _backfill_upcoming_amount_basis(conn: sqlite3.Connection) -> None:
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='upcoming_transactions'"
    ).fetchone():
        return
    conn.execute(
        "UPDATE upcoming_transactions SET amount_basis = 'matched_charge' "
        "WHERE expected_amount IS NOT NULL AND amount_basis = 'unknown'"
    )


MIGRATIONS = (
    (1, (
        """CREATE TABLE source_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            parser_version TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'processed', 'failed', 'unrecognized')),
            transaction_id INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source, source_id)
        )""",
        """CREATE INDEX idx_source_events_pending
           ON source_events(source, status, attempts, id)""",
    )),
    (2, (
        """CREATE TABLE ingestion_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('trip', 'recurring', 'suggestion', 'notification')),
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'failed', 'done')),
            attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(transaction_id, kind)
        )""",
        "CREATE INDEX idx_ingestion_outbox_pending ON ingestion_outbox(status, attempts, id)",
    )),
    (3, (
        """ALTER TABLE source_events ADD COLUMN timestamp_precision TEXT NOT NULL DEFAULT 'unknown'
           CHECK(timestamp_precision IN ('unknown', 'date', 'minute', 'second'))""",
        "ALTER TABLE source_events ADD COLUMN payment_identity_kind TEXT",
        "ALTER TABLE source_events ADD COLUMN payment_identity TEXT",
    )),
    (4, (
        """CREATE TABLE transaction_requests (
            request_key TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            transaction_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (5, (
        """CREATE TABLE telegram_drafts (
            draft_id TEXT PRIMARY KEY,
            chat_id INTEGER NOT NULL UNIQUE,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )""",
    )),
    (6, (
        """CREATE TABLE telegram_draft_messages (
            message_key TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            draft_id TEXT NOT NULL
        )""",
    )),
    (7, (
        """CREATE TABLE capture_issue_resolutions (
            event_id INTEGER PRIMARY KEY REFERENCES source_events(id) ON DELETE CASCADE,
            handled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (8, (
        """CREATE TABLE subscription_confirmations (
            subscription_id INTEGER PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
            source TEXT NOT NULL CHECK(source IN ('user', 'recurring_suggestion')),
            confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (9, (
        """CREATE TABLE subscription_suggestion_acceptances (
            message_key TEXT PRIMARY KEY,
            merchant TEXT NOT NULL,
            frequency TEXT NOT NULL,
            subscription_id INTEGER NOT NULL,
            accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (10, (
        """CREATE TABLE recurring_suggestions (
            id TEXT PRIMARY KEY,
            chat_id INTEGER NOT NULL,
            merchant TEXT NOT NULL,
            frequency TEXT NOT NULL,
            avg_amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'dismissed')),
            subscription_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX idx_recurring_suggestions_pending ON recurring_suggestions(chat_id, merchant, frequency, status)",
    )),
    (11, (
        "ALTER TABLE recurring_suggestions RENAME TO recurring_suggestions_v10",
        """CREATE TABLE recurring_suggestions (
            id TEXT PRIMARY KEY, chat_id INTEGER, merchant TEXT NOT NULL,
            frequency TEXT NOT NULL, avg_amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'dismissed')),
            subscription_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "INSERT INTO recurring_suggestions SELECT * FROM recurring_suggestions_v10",
        "DROP TABLE recurring_suggestions_v10",
        "CREATE INDEX idx_recurring_suggestions_pending ON recurring_suggestions(chat_id, merchant, frequency, status)",
    )),
    (12, (
        # Canonical money columns (see docs/plans/2026-09-09-cashe-completion-
        # roadmap.md R02): additive and nullable only. Nothing is backfilled
        # here — a separate tool computes values via src/money.py — and no
        # reader/writer is switched to these columns by this migration.
        # Tables predate the migration system (created by init_db()'s
        # baseline executescript), so each ADD COLUMN tolerates a missing
        # table rather than assuming it exists.
        _add_column_if_table_exists("transactions", "original_minor_units INTEGER"),
        _add_column_if_table_exists("transactions", "reporting_minor_units INTEGER"),
        _add_column_if_table_exists(
            "transactions",
            "conversion_status TEXT CHECK(conversion_status IN ('native','resolved','indicative','unresolved'))",
        ),
        # Rate stored as decimal text, never float — avoids binary rounding drift.
        _add_column_if_table_exists("transactions", "conversion_rate TEXT"),
        _add_column_if_table_exists("transactions", "conversion_source TEXT"),
        _add_column_if_table_exists("transactions", "conversion_quoted_at TEXT"),
        # No FK yet: the settlement-evidence table doesn't exist until R07 (CSV import).
        _add_column_if_table_exists("transactions", "settlement_evidence_id INTEGER"),
        _add_column_if_table_exists("budgets", "amount_minor_units INTEGER"),
        _add_column_if_table_exists("goals", "target_minor_units INTEGER"),
        _add_column_if_table_exists("goals", "saved_minor_units INTEGER"),
        _add_column_if_table_exists("goal_contributions", "amount_minor_units INTEGER"),
        _add_column_if_table_exists("upcoming_transactions", "expected_minor_units INTEGER"),
    )),
    (13, (
        # R03: optimistic concurrency + retained mutation/deletion history.
        # revision starts at 1 (SQLite's ADD COLUMN default backfills existing
        # rows), and is bumped by Storage.update_transaction on every
        # successful correction.
        _add_column_if_table_exists("transactions", "revision INTEGER NOT NULL DEFAULT 1"),
        """CREATE TABLE IF NOT EXISTS transaction_mutations (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id   INTEGER NOT NULL,
            revision_before  INTEGER NOT NULL,
            revision_after   INTEGER NOT NULL,
            changed_fields   TEXT NOT NULL,
            mutated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX idx_transaction_mutations_tx ON transaction_mutations(transaction_id, id)",
        # Retains a snapshot at delete time — never resurrected under the same
        # id; a later create is always a new row. Gives a 409 conflict (the
        # transaction was deleted concurrently) a real current-state summary,
        # and is the evidence a future undo UI would restore from.
        """CREATE TABLE IF NOT EXISTS deleted_transactions (
            id                INTEGER PRIMARY KEY,
            source            TEXT NOT NULL,
            source_id         TEXT,
            amount            REAL NOT NULL,
            currency          TEXT,
            merchant          TEXT,
            category          TEXT,
            transaction_date  TEXT,
            type              TEXT,
            revision          INTEGER NOT NULL,
            deleted_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (14, (
        # R03: retain enough of the pre-deletion row to actually restore it —
        # migration 13's columns were only ever enough for a summary.
        _add_column_if_table_exists("deleted_transactions", "description TEXT"),
        _add_column_if_table_exists("deleted_transactions", "exchange_rate REAL"),
        _add_column_if_table_exists("deleted_transactions", "original_minor_units INTEGER"),
        _add_column_if_table_exists("deleted_transactions", "reporting_minor_units INTEGER"),
        _add_column_if_table_exists(
            "deleted_transactions",
            "conversion_status TEXT CHECK(conversion_status IN ('native','resolved','indicative','unresolved'))",
        ),
        _add_column_if_table_exists("deleted_transactions", "conversion_rate TEXT"),
        _add_column_if_table_exists("deleted_transactions", "conversion_source TEXT"),
        _add_column_if_table_exists("deleted_transactions", "conversion_quoted_at TEXT"),
    )),
    (15, (
        # R05 sub-project 2: evidence-only link from a refund to the purchase
        # it refunds. ON DELETE SET NULL — deleting the linked purchase clears
        # the link rather than blocking the deletion or corrupting the refund
        # row. Never affects any money total: netting already works from
        # type='refund' alone, independent of linkage.
        _add_column_if_table_exists(
            "transactions",
            "refund_of_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL",
        ),
        # Archival only (deleted_transactions.id is a retained snapshot id,
        # not a live FK target) — no REFERENCES, so a deleted refund's link
        # survives restore even if the linked purchase was deleted first.
        _add_column_if_table_exists("deleted_transactions", "refund_of_transaction_id INTEGER"),
    )),
    (16, (
        # R06: records a rejected auto-suggested refund->purchase match so it
        # doesn't reappear in the review list. Keyed by the refund alone (one
        # active dismissal per refund, regardless of which candidate purchase
        # was proposed) — reclassifying the refund away and back, or deleting
        # and restoring it as a new row, naturally starts it undismissed again.
        # ON DELETE CASCADE: a hard-deleted refund's dismissal is meaningless.
        """CREATE TABLE refund_match_dismissals (
            refund_transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
            dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (17, (
        # R06: a purely cosmetic display name for a merchant, keyed by the raw
        # merchant string — overlaid at read time onto merchant list/profile
        # responses. The raw `transactions.merchant` column, source evidence,
        # and every aggregation keyed by merchant are never rewritten; this is
        # presentation only, same boundary merchant_tags/merchant_overrides
        # already draw around the raw merchant string.
        """CREATE TABLE merchant_aliases (
            merchant TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    )),
    (18, (
        # R06: duplicate detection/merge. A dismissal records a candidate pair
        # the user explicitly kept separate, keyed with the smaller id first
        # so each unordered pair has exactly one row; ON DELETE CASCADE means
        # a hard-deleted transaction's dismissals are meaningless.
        """CREATE TABLE duplicate_dismissals (
            transaction_a_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            transaction_b_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (transaction_a_id, transaction_b_id)
        )""",
        # A merge record: everything moved from the loser (now only in
        # deleted_transactions) onto the surviving transaction, so an undo
        # can precisely reverse just what this merge actually touched rather
        # than guessing. loser_transaction_id has no live FK — the row it
        # names no longer exists in `transactions` once merged. undone_at
        # NULL means still in effect; a merge is undone at most once.
        """CREATE TABLE transaction_merges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survivor_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            loser_transaction_id INTEGER NOT NULL,
            moved_source_event_ids TEXT NOT NULL,
            moved_trip_ids TEXT NOT NULL,
            moved_upcoming_transaction_id INTEGER,
            moved_refund_ids TEXT NOT NULL,
            survivor_refund_of_changed INTEGER NOT NULL DEFAULT 0,
            survivor_refund_of_before INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            undone_at TEXT
        )""",
    )),
    (19, (
        # R11 sub-project 2: charge-level provenance. date_basis/amount_basis
        # record *why* a pending upcoming charge's expected_date/expected_amount
        # are what they are — 'schedule'/'matched_charge' for the ordinary
        # computed/inferred path (compute_next_billing_date,
        # SubscriptionMatcher._infer_expected_amount), 'user' when explicitly
        # corrected via update_planned_charge, 'unknown' only for an amount
        # with no matched charge yet to infer from. amount_basis_transaction_id
        # is the specific matched transaction an inferred amount came from —
        # ON DELETE SET NULL rather than blocking a deletion, matching every
        # other evidence-link column's degrade-gracefully precedent
        # (refund_of_transaction_id, matched_transaction_id itself).
        _add_column_if_table_exists(
            "upcoming_transactions",
            "date_basis TEXT NOT NULL DEFAULT 'schedule'",
        ),
        _add_column_if_table_exists(
            "upcoming_transactions",
            "amount_basis TEXT NOT NULL DEFAULT 'unknown'",
        ),
        _add_column_if_table_exists(
            "upcoming_transactions",
            "amount_basis_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL",
        ),
        # Best-effort backfill for pre-migration rows: expected_amount has
        # only ever been set by the inferred-from-last-match path or an
        # explicit user correction (update_planned_charge), and the two
        # can't be told apart retroactively without this migration's own
        # columns. Defaulting an existing non-null amount to
        # 'matched_charge' (the common path) is an imprecise label for the
        # rarer already-user-corrected row, not a wrong value — the stored
        # expected_amount itself is untouched either way.
        _backfill_upcoming_amount_basis,
    )),
    (20, (
        # R11 sub-project 3: horizon expansion. schedule_period_date is the
        # stable period identity a batch horizon-generation pass checks
        # against — set once at row creation and never touched by a later
        # expected_date correction, so a user moving a charge's date (an
        # "explicit exception") doesn't cause that period to be regenerated
        # at its original schedule position, or leave a gap the generator
        # thinks is still open. Backfilled to each existing row's current
        # expected_date: exact for every never-corrected row (the vast
        # majority), an imprecise-but-harmless label for the rarer
        # already-corrected row (same accepted trade-off as migration 19's
        # amount_basis backfill).
        _add_column_if_table_exists("upcoming_transactions", "schedule_period_date TEXT"),
        lambda conn: conn.execute(
            "UPDATE upcoming_transactions SET schedule_period_date = expected_date "
            "WHERE schedule_period_date IS NULL"
        ) if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='upcoming_transactions'"
        ).fetchone() else None,
    )),
    (21, (
        # R11 sub-project 5: one matched actual charge replaces at most one
        # forecast commitment — a transaction linked to more than one
        # upcoming_transactions row would double-count a single real
        # charge against two different subscriptions' predictions.
        # Storage.match_upcoming_transaction/link_transaction_to_subscription
        # already enforce this at the application level
        # (_require_unlinked_charge) under the same lock that serializes
        # every write, so this is defense-in-depth, not a fix for an
        # active bug. scripts/db_audit.py gained a
        # duplicate_matched_transactions check specifically so an operator
        # can verify none exist before this applies to a real database; if
        # any do, CREATE UNIQUE INDEX below fails loudly (rolling back
        # this migration's transaction) rather than silently repairing
        # them — per the roadmap's own instruction not to repair
        # duplicates silently during a migration.
        _create_index_if_table_exists(
            "upcoming_transactions",
            "CREATE UNIQUE INDEX idx_upcoming_matched_transaction_unique "
            "ON upcoming_transactions(matched_transaction_id) WHERE matched_transaction_id IS NOT NULL",
        ),
    )),
    (22, (
        # R13: explicit baseline-exclusion — a user can mark a purchase or an
        # entire trip as unusual, so forecast.py's weekday-median baseline and
        # spending_facts.weekday_pattern don't let it skew what "normal"
        # spending looks like. This never touches actual totals or evidence:
        # every existing money query keeps summing every transaction exactly
        # as before — only the two baseline-pattern computations added in
        # R10/R12 read this column at all. Deliberately not carried through
        # deleted_transactions/restore_deleted_transaction: it's a baseline
        # hint, not money truth, so a deleted-then-restored transaction
        # reverting to "not excluded" is an accepted narrow gap, not a
        # correctness bug — unlike refund_of_transaction_id or the
        # canonical-money columns, which are.
        _add_column_if_table_exists("transactions", "excluded_from_baseline INTEGER NOT NULL DEFAULT 0"),
    )),
)


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    for version, statements in MIGRATIONS:
        if conn.execute("SELECT 1 FROM schema_migrations WHERE version = ?", (version,)).fetchone():
            continue
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            for statement in statements:
                if callable(statement):
                    statement(conn)
                else:
                    conn.execute(statement)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
