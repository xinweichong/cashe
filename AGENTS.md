# AGENTS.md — AI Agent Context

## Project Overview

Cashe — a privacy-first Python service that ingests transaction data from Gmail (DBS PayLah!, UOB alerts) and Apple Wallet push notifications, stores them in SQLite, and provides interaction via Telegram bot and a web dashboard. Supports multi-user accounts, budgets, savings goals, and trip tracking.

## Architecture

Single Python monolith, one process, eight subsystems:
1. **Gmail Poller** — scheduled polling of Gmail API for transaction emails, HTML body extraction fallback
2. **Webhook Receiver** — FastAPI endpoint receiving Apple Wallet data from iOS Shortcuts (`/webhook/apple-wallet/{username}`), cross-source dedup
3. **Parser Engine** — plugin-based bank/payment parsers (one class per source)
4. **Ingestion Pipeline** — centralised dedup → exchange rate → categorize → store → recurring detect → trip auto-assign
5. **Interaction Layer** — Telegram bot (commands + notifications + guided UX) + Web dashboard (dark fintech theme, Recharts)
6. **Categorization** — keyword matching + learned merchant overrides, with match source tracking
7. **Intelligence** — recurring transaction detection, spending insights, multi-currency exchange rates, analytics
8. **Finance System** — budgets (monthly/weekly), savings goals with contributions, trip expense tracking, subscriptions with upcoming-transaction tracking
9. **LLM Intelligence** — optional Gemini Flash layer for anomaly explanations, natural-language Telegram parsing, and weekly/monthly AI insights; `None` when `gemini_api_key` is absent

All data in SQLite with WAL mode. Multi-user system with per-user expense DBs and a shared admin DB. Supports income and expense tracking.

## Deployment

**Oracle Cloud** — self-hosted on an OCI instance using Docker Compose. Public HTTPS exposure via **Cloudflare Tunnel** (no open inbound ports required).

```
docker-compose.yml:
  app:        python src/main.py (FastAPI + bot + scheduler)
  cloudflared: cloudflare/cloudflared tunnel — forwards public HTTPS to app:8080
```

**Local volumes:**
- `./config.yaml` → `/app/config.yaml:ro` — all sensitive config (gitignored)
- `./credentials.json` → `/app/credentials.json:ro` — Gmail OAuth credentials (gitignored)
- `./data` → `/data` — persistent SQLite databases and logs

**Key env vars:**
- `TUNNEL_TOKEN` — Cloudflare tunnel token (set in shell/`.env` on the OCI instance)
- `PORT` — overrides the port in config.yaml (defaults to 8080)
- `EXPENSE_DB_PATH` — override per-user DB path (rarely used)
- `EXPENSE_CONFIG_PATH` — override config file path (defaults to `config.yaml`)
- `GMAIL_CREDENTIALS_JSON` — base64-encoded credentials.json (alternative to volume mount)
- `GEMINI_API_KEY` — Google Gemini API key; enables LLM Intelligence when set (overrides `gemini_api_key` in config.yaml)

**No Railway.** All previous AGENTS.md references to Railway, Railway volumes, and base64 env vars for credentials are obsolete. The `/data/` volume is a local bind mount.

## Agent Instructions

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Key Design Decisions

- `source_id` UNIQUE constraint prevents duplicate transactions
- Cross-source dedup: a unique candidate with matching merchant, amount, currency, type, and transaction time within 10 minutes links both source events to one record. Date-only/missing times and ambiguous candidates remain separate. Never compare ingestion time.
- `raw_data` column stores original payloads for re-parsing
- Categories auto-assigned via keyword matching, overridable via `/recategorize` (transaction-only by default; `--remember` explicitly learns future merchant overrides)
- `type` column distinguishes `expense` (default) from `income` transactions
- `exchange_rate` column normalizes foreign currency to SGD; all summaries use `amount * exchange_rate`
- Categorizer returns `(category, match_source)` tuple — match_source is `"learned"`, `"keyword:<kw>"`, or `"default"`
- Merchant overrides stored in `merchant_overrides` table, hot-reloadable via `categorizer.reload_overrides()`
- Recurring transactions detected by consistent amounts (±10%) and intervals (monthly 25-35 days, weekly 6-8 days)
- Exchange rates cached for 24 hours with fallback hardcoded rates when API unreachable
- All sensitive config in `config.yaml` (gitignored) — mounted as a read-only volume in Docker
- Categories have a `type` column (`needs`/`wants`/`neutral`) used for financial health scoring
- Active trip auto-assigns new transactions via `storage.auto_assign_to_active_trip(tx_id)` — one active trip at a time
- `IngestionPipeline` is the single path for all transaction ingestion (Gmail and Webhook) — never bypass it

## Multi-User System

The system supports multiple users. Each user has:
- A row in `app.db` (`users` table) managed by `AdminStorage`
- An isolated SQLite database at `/data/users/<username>/expense_tracker.db`
- A per-user Gmail OAuth token at `/data/users/<username>/token.json`
- A `GmailPoller` and `Categorizer` instance managed by `UserManager`

**`AdminStorage`** (in `src/storage.py`) operates on `app.db` (at `/data/app.db`). Manages users, web sessions (30-day sliding window), admin sessions, and Telegram link tokens.

**`UserManager`** (in `src/user_manager.py`) is the central registry. It constructs and holds `UserContext` objects (Storage + Categorizer + GmailPoller per user). `main.py` and `web/app.py` never instantiate `Storage` or `GmailPoller` directly.

**`UserContext`** fields: `username`, `storage`, `categorizer`, `poller`, `db_path`, `token_path`, `exchange_service`.

**Admin panel** at `/admin` — separate `FastAPI` app mounted on the main app. Uses a separate admin session (not a user session). IP-based login lockout after 5 failures.

**Seeding:** On first boot, if `app.db` has no users, the admin user is created from `config.yaml` (`web.admin_username` / `web.password_hash`). Existing Telegram `chat_id` from a legacy single-user DB is migrated automatically.

**Webhook routing:** Apple Wallet webhooks are per-user: `POST /webhook/apple-wallet/{username}`. The username in the URL is used to resolve the `UserContext`.

**Telegram routing:** `TelegramBotService` holds a reference to `UserManager`. Incoming messages are resolved to a `UserContext` via `user_manager.get_by_chat_id(chat_id)`.

## Backend Conventions

### Storage Layer

- Every expense-only query uses `(type IS NULL OR type = 'expense')` — never just `type = 'expense'`. Pre-migration rows have a NULL type and are silently dropped otherwise.
- All mutating methods (`update_transaction`, `delete_transaction`, `update_category`, `delete_category`) pre-check existence and raise `ValueError("<entity> not found")` on miss. The API layer catches `ValueError` and returns HTTP 404. Never raise `HTTPException` from Storage.
- `delete_category` cascades: reassigns all affected transactions to `'Other'` and deletes matching `merchant_overrides`. Returns the reassigned count, surfaced as `{"status": "ok", "reassigned": count}` in the API.
- `app_settings` stores all values as `TEXT`. Always cast to `float`/`int` at the call site. `set_setting` always receives `str(val)`.
- `ingestion_state` is dual-purpose: Gmail poller state (keyed by source name, e.g. `"dbs_paylah"`) and the Telegram chat ID (stored under `source='telegram_chat_id'`, value in `last_processed_id`). Note: Telegram chat IDs have moved to `app.db users.telegram_chat_id` for new users — the `ingestion_state` approach is legacy.
- `get_categories` orders by `ROWID` (insertion order) — this controls the Telegram inline keyboard order and dashboard dropdown order.
- Default settings use `INSERT OR IGNORE` (preserved after first write). Categories use `INSERT OR REPLACE` on every startup — user-modified keywords in the DB are reset on restart.
- `get_trend_by_category` explicitly sets missing-category keys to `None` (not `0` or absent) for Recharts `connectNulls`. Do not substitute `0` or omit the key.
- The allowed-field whitelist for `update_transaction` is enforced in `web/app.py`, not in `Storage`. Add new editable columns to the `allowed` set in `app.py`.
- `query_transactions` default limit is 100; the API layer defaults to 50; CSV export hard-codes 50,000. Always pass explicit limits in new callers.
- `Storage` uses a `threading.RLock` (via `@_locked` decorator) to serialize all DB calls — safe for concurrent access from web and bot threads.
- `Storage` has no `logging` import — it is a pure data layer. All logging lives in the service layer.

### API Layer

- `require_auth` is `Depends(require_auth)` added to each route individually — there is no global auth middleware. Forgetting it on a new route silently makes it public.
- All responses are raw `dict`/`list` — no Pydantic response models. All DB columns including `raw_data` and `ingested_at` are returned to the client.
- `PUT /api/transactions/{id}` changes only that transaction unless `remember_category: true` is explicit. Storage commits the correction and remembered merchant rule atomically. Existing rules stay unchanged for transaction-only edits. Ingestion reloads overrides before future matching. Telegram category callbacks/editing use the same transaction-only default; `/recategorize <id> [category] --remember` explicitly saves a rule.
- Date/type corrections are validated by `Storage.update_transaction` before any write. Dates accept extended ISO dates/timestamps and retain supplied offsets; explicit invalid/null dates or unknown types are rejected. The web detail editor submits date/type only when changed, so legacy NULL types and original timestamps survive unrelated edits. Source observations and their timestamp precision remain unchanged by corrections.
- Monetary corrections use the same atomic Storage path: amounts must be finite/non-negative; rates finite/positive or explicitly NULL for unknown; currencies normalize three alphabetic characters to uppercase (format validation, not a currency registry). Changing to a foreign currency clears the previous rate unless a replacement is supplied; changing to SGD sets 1. Unchanged monetary fields are omitted by the editor. Foreign legacy 1 rates remain unresolved in shared facts; these checks do not migrate float storage or automated capture paths.
- Web manual creation and Telegram `/add`, `/cash`, `/income`, and confirmed NL drafts use `Storage.create_manual_transaction`, sharing `src/transaction_validation.py` with corrections. Missing foreign rates remain NULL; SGD uses 1. Only manual/cash sources and expense/income creation are accepted. Web IDs remain generated by the caller; Telegram commands and NL confirmations use the durable identities below. Telegram `/add`, `/cash`, and confirmed NL entry request `assign_to_active_trip=True`: transaction and capture-time trip job commit atomically, then dispatch outside the Storage lock through the shared outbox. Web entry and `/income` retain their existing no-auto-trip behavior. Validation/duplicate failures create no follow-ups. Web and direct Telegram request idempotency are described below; durable raw Telegram update capture and full ingestion/command unification remain pending.
- Web `POST /api/transactions` accepts an optional `Idempotency-Key` (1–128 ASCII letters/digits/underscore/hyphen). `Storage.create_web_transaction` serializes lookup/create and atomically retains a request fingerprint with the transaction/evidence. Exact submitted JSON fields (ignoring property order) define replay identity before generated date/source defaults. Same-key replay returns the current transaction; changed fields or a deleted transaction return 409. Request records survive deletion and are informational in the audit. Legacy callers without a key retain existing behavior. The web form retains a key only while mounted; offline/reload persistence remains pending.
- Direct Telegram `/add`, `/cash`, and `/income` use `Storage.create_telegram_transaction` when chat/message IDs are available. The private key is `telegram:<chat_id>:<message_id>` (separate from web keys); command plus submitted argument tokens define its fingerprint before generated dates, categories, or rates. Receipt, transaction, evidence, and requested trip job commit atomically. Replays report the existing ID, retain corrections/capture-time trip, and dispatch only existing pending jobs. Changed messages/commands and deleted transactions require correction in Activity. New source IDs are `telegram-` plus a full SHA-256 of the private key, preventing same-second collisions without exposing chat/message IDs. Legacy IDs are retained; in-process direct-command callers without IDs retain existing behavior. NL confirmation uses the separate draft identity below.
- NL confirmation buttons carry a random 32-hex draft token (`nl_confirm:<token>`, `nl_edit:<token>`, `nl_cancel:<token>`). Migration 5 stores one active draft per chat in the per-user `telegram_drafts` table, before card delivery. It holds only proposed amount/currency/merchant/category/date fields, has a fixed 24-hour expiry, and survives restart. Expiry is enforced on reads/confirmation; expired payloads are lazily deleted on the next draft read/save. User isolation comes from the resolved per-user Storage, and reads/discards also require the originating chat ID. Replacing/canceling/manual Edit invalidates only the matching card. Production confirmation passes `chat_id` to `Storage.confirm_telegram_draft`, which re-reads the stored fields and atomically deletes the draft with the request receipt, evidence, transaction, and requested confirmation-time trip job. Validation/write failures retain the draft. Existing internal accepted-draft callers without `chat_id` keep their receipt replay interface. New source IDs use `telegram-nl-<token>`; generated FX is excluded from replay identity. Stale/legacy/wrong-owner/expired cards cannot save newer drafts. `context.user_data` is no longer the draft authority. Raw NL-message persistence before parsing and full command unification remain pending.
- Migration 6 retains `telegram_draft_messages`: a hash of chat/message identity, a fingerprint of trimmed message text, and the original draft token. The message link and draft save atomically. NL redelivery checks this before any model call: active drafts reuse their original fields/token/deadline; changed messages or consumed/canceled/replaced/expired drafts direct the user to Activity or a new entry. Recheck on save prevents concurrent proposals from replacing the accepted one. Retained links intentionally survive draft deletion and must not be treated as orphaned foreign keys. Raw text is not stored in this table. Unrecognized input and failures before draft persistence leave no link, so durable pre-parse receipt/recovery is still open. Legacy/in-process callers without message IDs retain their prior behavior.
- `PUT /api/settings` is all-or-nothing: validates all fields, collects errors into a dict, raises HTTP 422 with the errors dict, or writes all values atomically. Never writes a partial update.
- Manual transactions via the web API use `source_id = f"manual_{uuid4().hex[:12]}"`. Identified Telegram `/add` uses the hashed message identity described above; legacy entries use `f"manual-{timestamp}-{amount}"`. Both use `source="manual"` and coexist in the DB.
- The SPA catch-all `/{full_path:path}` is only registered at startup if `src/web/dist/` exists. If the frontend is not built, all non-API paths return 404.
- All DB calls in the web layer go through `await _db(fn, *args)` — a single-worker `ThreadPoolExecutor` that serialises DB work off the event loop.
- Finance features (budgets, goals, trips) are gated by `app_settings` flags: `budgets_enabled`, `goals_enabled`, `trips_enabled`. The API does not gate them — gating is UI-only.

### Ingestion Pipeline

All transaction ingestion (Gmail and Webhook) goes through `IngestionPipeline` (`src/ingestion.py`). Never bypass it.

Steps in order:
1. Same-source dedup (`source_id_exists`)
2. Cross-source dedup (`find_cross_source_duplicate` — 10-minute window)
3. Exchange rate lookup (skipped if currency is SGD)
4. Categorization (`categorizer.reload_overrides()` then `categorizer.categorize()`)
5. `storage.insert_transaction()`
6. Commit trip, recurring-analysis, and transaction-notification jobs in `ingestion_outbox` atomically with the transaction. Historical capture creates no follow-up jobs; trip jobs retain the trip active at capture time.
7. Dispatch follow-ups outside the reconciliation/DB lock. `RecurringDetector.detect()` errors remain retryable; successful detection atomically queues a suggestion. Telegram callbacks return the send Future, which must complete before acknowledgement.
8. Return the stored transaction dict with `_match_source` key added. Follow-up failures do not undo capture. The existing 120-second capture worker also retries outbox jobs, stopping after five recorded failures. Authenticated `/api/v2/capture/followups` list/retry endpoints expose no payloads.

Outbox workers serialize per `Storage` in this single-process service. Delivery is at least once: a crash after Telegram accepts a message but before local acknowledgement can repeat the message. Never hold the storage reconciliation lock while dispatching follow-ups.

The `IngestionPipeline` is instantiated per-user inside `UserManager._build_context()`.

### Capture trust foundation

- Authenticated `/api/v2/transactions/{id}/provenance` exposes only the transaction ID and grouped input channels with `evidence_recorded`. Group raw/parsed Wallet observations together and Gmail/bank observations together; only processed events linked to that transaction establish retained evidence. A legacy/manual recorded source alone is not retained capture evidence. Never expose payloads, source IDs, or payment identifiers through this interface.
- Accepted manual/cash entries now commit a `source_events` snapshot atomically with the transaction and requested trip job. `parser_version='manual:1'` snapshots contain accepted command fields after caller parsing/categorization, with numeric representations stored as strings. They are processed-only, retain unknown timestamp precision, and are not replayable `ParseResult` payloads. Do not enqueue them in the generic capture retry path or infer automatic cross-source matching eligibility from their timestamp strings. Corrections/deletion retain the snapshot; legacy manual records are not backfilled.
- `source_events` retains the original observation, parser version, status, attempts, linked transaction, timestamp precision, and namespaced payment identity. Raw payloads and payment metadata stay server-side.
- Cross-source reconciliation requires explicit `minute`/`second` precision on both observations. `date` and `unknown` observations, including legacy evidence, remain separate even when transaction strings contain midnight. UOB card/transit date-only alerts retain their existing `T00:00:00` storage format but declare `date` precision.
- Payment identity conflicts exclude a candidate only within the same namespace. `wallet_card_label`, `uob_card_last4`, and `uob_account_suffix` are different evidence types; never equate a Wallet label/device identity with a bank card suffix. Matching identifiers supplement the time/merchant/amount/currency/type checks, never replace them.
- Gmail persists source events before advancing checkpoints. It captures configured senders independent of read status and never changes inbox labels.
- Initial/resync history is bounded to 90 days, paginated with persisted progress. Expired history restarts bounded synchronization. Automatic processing retries stop after five failures; unrecognized events remain recorded.
- Historical Gmail capture does not notify or join the currently active trip.
- `GmailPoller.poll_once()` now returns stored transaction dictionaries. `force_poll()` and the background loop use this same path; concurrent cycles and repeated starts are serialized.
- Wallet always uses `IngestionPipeline`, including contexts without a configured poller pipeline.
- Wallet credential hashes live in per-user settings. First valid Bearer request makes credentials mandatory. Revocation keeps intake closed. Never put credentials in URL query parameters or ordinary status responses.
- OAuth state is opaque, single-use, expires after ten minutes, and is bound to the initiating web session. Telegram `/reauth` links to authenticated Settings.
- Recovery CLI: `python -m scripts.backup --help`; see `docs/operations/backups.md`. Never copy live SQLite files for backup.
- Pre-upgrade audit: `python -m scripts.db_audit DATABASE` opens an existing database read-only and reports integrity, foreign-key, missing-constraint, and migration findings. Run it on isolated restored copies before initialization. Retained source-event/outbox links to deleted transactions are informational, not orphans to clean up automatically. It never migrates or repairs data.

### Shared spending facts

- `/api/v2/spending/review` lists all-history unresolved spending records using the same selection/conversion rules as evidence. Reason codes distinguish missing dates, unresolved money, and unknown classification; transfers and usable indicative FX are excluded. The read-only list resolves membership from current data, not dismissals. Invalidate `spending-review` after transaction mutations and preserve `/review?spending_offset=...` when closing details.
- Opt-in Home: `home_briefing_enabled` defaults off in Settings. `/api/v2/home` composes shared facts and sanitized capture freshness; `/home`, `/evidence`, and `/review` are lazy-loaded authenticated screens. Keep failed/stale/partial states explicit and invalidate Home/evidence queries after transaction mutations. Capture list APIs support `limit` and `offset`.

- New reporting uses `src/spending_facts.py` through locked Storage wrappers. The additive authenticated `/api/v2/spending/month`, `/api/v2/spending/week`, and `/api/v2/spending/evidence` endpoints share classification, Decimal rounding, timezone projection, and evidence selection. See `docs/operations/spending-facts.md` for compatibility limits.
- Report SGD integer minor units rounded per transaction; storage remains legacy floats until the audited migration. Never describe this compatibility calculation as a completed money migration.
- Always expose partial/indicative status with known subtotals. Legacy foreign `1.0` rates are unresolved, not proof of conversion. Undated observations make comparisons unavailable. Missing income is absent, and negative recorded net flow is retained.
- Weekly facts compare Monday through the requested weekday with the same weekdays seven days earlier. Both monthly and weekly facts share monetary and evidence calculations.
- Use the response's separate comparison periods for evidence drill-downs: short previous months truncate the comparable current window, not the main month-to-date total.

### Parser System

- Email parsers return `None` on non-match. `AppleWalletParser.parse()` raises `ValueError` on missing required fields (caught by the webhook route and converted to HTTP 400). The Gmail poller does not expect parser exceptions.
- `source_id` construction strategy per parser:

| Parser | Strategy |
|--------|----------|
| Email parsers (`dbs_paylah`, `uob_card`, `uob_paynow`, `uob_transfer`, `uob_nets`, `uob_paynow_sent`) | Gmail RFC822 `Message-ID` header (falls back to `msg["id"]`). Assigned in `GmailPoller._parse_message` — overwrites whatever `source_id` the parser returned (e.g. DBS Transaction Ref is discarded). Email parsers therefore set `source_id=""` or `None`. |
| `apple_wallet` | `sha256(merchant:amount::date)[:16]` — double colon is intentional (empty card-field slot for backward compat). Set by the parser, not overwritten. |
| web manual | `manual_{uuid4().hex[:12]}` |
| bot `/add`, `/cash`, `/income` | New identified messages: `telegram-` + SHA-256(`telegram:<chat_id>:<message_id>`). Legacy/in-process callers retain timestamp/amount IDs (`manual-` or `cash-` prefix). |
| confirmed NL draft | `telegram-nl-<32-hex draft token>`; legacy records retain their IDs. |

- Apple Wallet hash uses `f"{merchant}:{amount}::{date}"` — the double colon is a deliberate empty card-field slot for backward compatibility with pre-card-name records. Do not add the card field into this hash.
- Currency parsing precedence: ISO code prefix (`PLN 3.78`) → multi-char symbols (`S$`, `A$`, `HK$`, `RM`...) → single-char symbols (`£`, `€`...) → bare number defaults to SGD. Multi-char must be checked before single-char to avoid `S$` matching as `$`.
- DBS PayLah! infers `local_now().year` because the email format omits the year. A December email processed in January will have the wrong year — this is a known limitation.
- `UobParser` handles all UOB email formats in a single class (card purchase, accumulated transit, card reversal, PayNow received, one-time transfer, NETS QR payment, PayNow transfer sent). Source values: `uob_card`, `uob_paynow`, `uob_transfer`, `uob_nets`, `uob_paynow_sent`. Card reversals emit `tx_type="income"`. `uob_paynow` is incoming PayNow (income); `uob_paynow_sent` is outbound PayNow transfer (expense).

### Telegram Bot

- The bot silently drops all outbound notifications until a user's Telegram is linked (chat ID stored in `app.db users.telegram_chat_id`).
- `notify_transaction` and `notify_text` use `asyncio.run_coroutine_threadsafe(..., self._loop)` to bridge from the Gmail/APScheduler threads into the bot's asyncio event loop. Never use `await` or `asyncio.run()` in these methods.
- Callback data is namespaced by prefix: `cat:` (new tx category pick), `recat:` (recategorize), `ef_` (edit field), `ec_` (edit category), `cmd_` (menu actions), `confirm_delete_` / `cancel_delete`. Handler registration order matters.
- `/add` and `/cash` only extract a category if a date is also present. Format: `<amount> [currency] <merchant> [category] <date>`.
- `/income` stores the description in the `merchant` column (not `description`), hard-codes `category="Income"` and `type="income"`, and skips the categorizer.
- `_cmd_callback` uses a `SimpleNamespace` / `_ReplyProxy` to let inline button presses re-use existing command handlers without modification.
- All bot commands are routed to the correct user's `UserContext` by resolving the Telegram `chat_id` via `user_manager.get_by_chat_id()`.
- Scheduled summaries per user: weekly (Sunday 8AM), monthly (1st 8AM), daily digest (8AM). Registered in `UserManager._register_scheduler_jobs()`.

### Cross-Cutting Rules

- Always use `local_now()` from `src/config.py` for wall-clock dates. Never use `datetime.now()` or `datetime.utcnow()` — the OCI instance runs UTC and this caused `/today` to show the wrong day for SGT users. `local_now()` defaults to `Asia/Singapore`; configurable via `timezone:` in `config.yaml` or `TIMEZONE` env var.
- `transaction_date` is stored as ISO 8601 string `"YYYY-MM-DDTHH:MM:SS"`. Range queries must use `DATE(transaction_date) >= ?`. Display truncates to `[:10]`.
- `raw_data` for Apple Wallet transactions is `str(dict)` (Python `repr`), not valid JSON. Re-parsing requires `ast.literal_eval`, not `json.loads`.
- DB path resolution: `DATA_DIR = "/data" if os.path.isdir("/data") else "data"`. Per-user DB: `{DATA_DIR}/users/{username}/expense_tracker.db`. Admin DB: `{DATA_DIR}/app.db`. The `EXPENSE_DB_PATH` env var overrides only the legacy single-user path, not per-user paths.
- Legacy baseline migrations remain in `init_db`. New schema changes use ordered, transactional migrations in `src/migrations.py`; do not add new swallowed migration errors.
- `RecurringDetector.detect()` runs through the ingestion outbox (both Gmail and Webhook paths). It looks back 90 days and is instantiated per-`UserContext` (stateful — reused across ingestion calls for the same user).
- The `source` column has no `CHECK` constraint — invalid values insert silently. Valid values: `dbs_paylah`, `uob_card`, `uob_paynow`, `uob_paynow_sent`, `uob_transfer`, `uob_nets`, `apple_wallet`, `manual`, `cash`.

### Testing Conventions

- The `in_memory_db` fixture calls production `main.init_db(":memory:")`. New additive migrations live in ordered `src/migrations.py` and run in production and tests. Append migrations; never edit released versions.
- There is no shared `Storage` or `Categorizer` fixture — tests instantiate them inline: `Storage(in_memory_db)`.
- `sample_categories` fixture uses comma-separated string keywords (`"restaurant,cafe,food"`). `sample_config` uses Python lists. Both mirror real usage: Storage receives the comma-separated string form; Categorizer receives the list form from YAML.

## File Responsibilities

| File | Purpose |
|------|---------|
| `src/main.py` | Entry point — starts all services, creates DB schema with migrations, seeds admin user |
| `src/config.py` | Loads `config.yaml` + environment variable overrides, exposes `local_now()` |
| `src/storage.py` | `Storage`: all SQLite CRUD for per-user DBs. `AdminStorage`: users, sessions, admin sessions, Telegram link tokens in `app.db` |
| `src/categorizer.py` | Matches merchant names to categories via keywords + learned overrides, returns match source |
| `src/ingestion.py` | `IngestionPipeline`: single ingestion path for all sources (dedup → exchange → categorize → store → trip → recurring) |
| `src/analytics.py` | Pure analytics functions — health score, comparisons, velocity, alerts — run against a sqlite3.Connection |
| `src/user_manager.py` | `UserManager`: central registry of per-user `UserContext` objects (Storage + Categorizer + GmailPoller) |
| `src/gmail_poller.py` | Scheduled Gmail API polling with HTML body extraction and per-bank dispatch |
| `src/webhook.py` | FastAPI POST endpoint for Apple Wallet payloads with per-user routing |
| `src/exchange.py` | Exchange rate service with API fetching, 24h caching, and fallback rates |
| `src/recurring.py` | Recurring transaction detection from spending patterns |
| `src/subscriptions.py` | `SubscriptionMatcher`: daily job — generates upcoming charges, auto-matches transactions, flags possibly-cancelled subscriptions |
| `src/llm_service.py` | `LLMService`: thin Gemini Flash wrapper for anomaly explanations, Telegram NL parsing, and weekly/monthly insights; `create_llm_service(config)` returns `None` when `gemini_api_key` is absent |
| `src/parsers/base.py` | Abstract `BankParser` — defines `can_parse()` / `parse()`, `ParseResult` dataclass |
| `src/parsers/dbs_paylah.py` | DBS PayLah! email → Transaction (SGD prefix, To: merchant, Transaction Ref) |
| `src/parsers/uob.py` | All UOB alert email formats → Transaction (card purchase, transit, reversal, PayNow, transfer) |
| `src/parsers/apple_wallet.py` | Apple Wallet shortcut payload → Transaction |
| `src/telegram_bot.py` | Telegram bot: all commands, guided UX, merchant override learning, per-user routing |
| `src/web/app.py` | FastAPI dashboard app: all API endpoints + SPA serving. Per-user auth. |
| `src/web/admin_app.py` | FastAPI admin app (mounted at `/admin`): user CRUD, password reset |
| `src/web/auth.py` | Thin shim: delegates to `AdminStorage` for session create/verify/destroy |
| `scripts/gmail_auth.py` | One-time Gmail OAuth browser flow |
| `Dockerfile` | Multi-stage build: Node.js frontend build → Python runtime |
| `docker-compose.yml` | Oracle Cloud deployment: `app` + `cloudflared` services |

## Frontend UI Design System

### Tech Stack

React 19 + TypeScript + Vite. Tailwind CSS v4 (`@theme` block in `index.css` — no config file). Recharts for all charts. Radix UI primitives (Dialog, Select, DropdownMenu, Tabs, Separator, Slot). shadcn/ui component patterns with CVA (class-variance-authority). lucide-react for all icons. TanStack Query for server state. Frontend root: `src/web/frontend/src/`.

### Color Tokens

Defined in `src/web/frontend/src/index.css` under `@theme`. These become both CSS custom properties and Tailwind utility classes.

| Token | Hex | Role |
|---|---|---|
| `--color-background` | `#0B0B14` | Page background |
| `--color-card` | `#161624` | Card surfaces, tooltip background |
| `--color-card-elev` | `#1B1B2C` | Elevated surfaces (dialogs, dropdowns, toasts) |
| `--color-card-hover` | `#1C1C22` | Bar chart hover cursor (Radix compat) |
| `--color-border` | `#2A2A3F` | All borders and dividers |
| `--color-foreground` | `#EEEAF5` | Primary text |
| `--color-muted` | `#7A7488` | Secondary text, axis ticks, labels |
| `--color-teal` / `--color-ring` | `#00D4AA` | CTAs, active states, trend lines, focus ring |
| `--color-accent` | `#EEEAF5` | Radix UI compat token only — **not** the brand teal |
| `--color-destructive` | `#FF453A` | Delete actions, error messages, overspend alerts |
| `--color-success` | `#00D4AA` (= teal) | Income amounts, "on track" / saved status |
| `--color-warning` | `#FBBF24` (= honey) | Unusual spending alerts |
| `--color-info` | `#34D399` (= mint) | Informational, "under pace" velocity |

**Semantic color rules — these have caused real bugs, apply carefully:**
- `text-destructive` for delete buttons, error messages, and "spending ahead of pace" — **never `text-accent`**.
- `text-warning` for unusual spending alert icons and borders — **never `text-accent`**.
- **Never use `text-accent`** for any visible text — `--color-accent` is a Radix UI compat token set to `#EEEAF5` (foreground). Use `text-teal` for brand interactive states.
- `text-success` for income amounts and positive spending velocity (renders as teal `#00D4AA`).
- `text-info` for neutral informational status ("under pace") (renders as mint `#34D399`).

**Button variants (CVA, `src/components/ui/button.tsx`):**
- `default` → gradient primary (`btn-gradient` utility class)
- `outline` → bordered, neutral hover — use for secondary/cancel actions
- `ghost` → no border, neutral hover — use for icon buttons and tertiary actions
- `destructive` → red background — use only for irreversible destructive confirmation buttons
- Never use `destructive` variant for label/toggle buttons that merely navigate to a destructive action.

Spectrum + state/feedback/motion/a11y/money rules: see docs/design-language.md §2, §12–§16.

### Category Color System

`getCategoryColor(category)` in `src/lib/utils.ts` — always use this function, never hardcode category colors. Runtime overrides (learned via recategorization) are loaded into `_categoryColorOverrides` via `setCategoryColors()`.

**Hex-suffix opacity convention** for category row tinting — must be consistent across all transaction lists:
- Row background resting: `${categoryColor}0D` (5% opacity)
- Row background hover: `${categoryColor}1A` (10% opacity)
- Icon pill background: `${categoryColor}33` (20% opacity)
- Edit mode active background: `${categoryColor}1A`

The 20-color `PALETTE` array in `lib/utils.ts` is used by the category color picker in Settings. The picker enforces uniqueness — already-used colors are shown at 30% opacity and are non-interactive.

### Chart Conventions

All Recharts configuration is centralized in `src/lib/chartTheme.ts`. **Never inline Recharts props** — import from `chartTheme.ts`. This is necessary because Recharts does not support CSS custom properties, so hex values are encoded in named constants rather than scattered across components.

| Export | Apply to |
|---|---|
| `CHART_TOOLTIP_STYLE` | `<Tooltip contentStyle={CHART_TOOLTIP_STYLE}>` |
| `{...CHART_AXIS_PROPS}` | Spread onto every `<XAxis>` and `<YAxis>` |
| `CHART_CURSOR_BAR` | `<Tooltip cursor={CHART_CURSOR_BAR}>` on BarCharts |
| `CHART_CURSOR_LINE` | `<Tooltip cursor={CHART_CURSOR_LINE}>` on LineCharts |
| `CHART_LEGEND_STYLE` | `<Legend wrapperStyle={CHART_LEGEND_STYLE}>` |

### Card Component System

Three tiers — use the highest applicable tier, not the lower primitives directly.

**Tier 1 — Base `Card` (from `src/components/ui/card.tsx`):**
`border-border` is baked into the base class. Never add `border-border` or `bg-card` explicitly to a `<Card>` — they are redundant. Padding defaults: `CardHeader` `p-4`, `CardContent` `p-4 pt-0`.

**Tier 2 — Wrapper components (from `src/components/ui/cards.tsx`):**

| Component | Use for | Key difference |
|---|---|---|
| `PageCard` | Content, tables, lists, SVG-based visuals | `CardContent` retains `p-4` padding |
| `ChartCard` | Recharts chart components | `CardContent className="p-0"` — charts render edge-to-edge |
| `StatCard` | Compact numeric KPI display | Props: `label`, `value`, `variant` (`'expense'`/`'income'`/`'neutral'`) |
| `HeroCard` | Large prominent stat with gradient wash | Used for savings overview, health score hero |
| `HighlightCard` | Secondary accent stats in pairs | Paired with HeroCard |

All accept `title`, `children`, and optional `action` (rendered right-aligned in the header). `className` is forwarded to the Card root for one-off overrides.

**Tier 3 — Bespoke (use raw `Card`):**
- Alert card in Analytics — `border-warning/30` semantics, intentionally not abstracted
- Login card — unique layout, not a repeating pattern

### CSS Utility Classes

Utility classes defined in `src/web/frontend/src/index.css` under `@layer components`:

- **`.input-field`** — use on native `<input>` elements: `px-3 py-1.5 text-sm bg-background border border-border rounded-md text-foreground`. Replaces the repeated inline string.
- **`.btn-action`** — use for primary save/submit `<button>` elements outside the Button CVA system: `px-4 py-1.5 text-sm bg-foreground text-background rounded-md hover:opacity-90`.
- **`.btn-gradient`** — gradient background for the `default` Button variant. Do not apply manually; the CVA default variant uses it.
- **`.select-field`** — use on all native `<select>` elements. Includes the white SVG chevron via `background-image`. Never use `.input-field` on a `<select>`.
- **`.grid-scroll-panel`** — use on grid-area children that may contain long content: `overflow-y: auto; min-height: 0`. The `min-height: 0` is critical and must not be removed.
- **`.toggle-on`** — gradient active state for toggle switches. Applied by the toggle component; do not apply manually.
- **`.area-header`**, **`.area-title`**, **`.area-left`**, **`.area-right`**, **`.area-top`** — `grid-area` assignments for named CSS Grid template areas. No-ops outside a grid parent (safe on mobile).
- **`.page-grid-overview`**, **`.page-grid-analytics`**, **`.page-grid-finance`**, **`.page-grid-settings`** — per-page grid template definitions with responsive `@media` overrides. Mobile: single-column stack. Desktop (`md+`): multi-column viewport-filling grid.
- **Radix `<SelectTrigger>` chevron** — always `opacity-50` (`<ChevronDown className="h-4 w-4 opacity-50" />`). Do not change to `text-foreground` or any explicit color. The 50% opacity is intentional and must be preserved across all usages.

### Navigation Pattern

Sidebar (`hidden md:flex`, `w-56` md / `w-64` lg, `sticky top-0 h-screen`, `bg-card border-r border-border`) + bottom tabs (`md:hidden fixed bottom-0 h-16`, `bg-card border-t border-border`). Main content always has `pb-20 md:pb-0` for bottom-tab clearance.

Nav item states: active `bg-foreground/10 text-foreground font-medium`, inactive `text-muted hover:text-foreground hover:bg-foreground/5`. Six routes: Overview `/`, Transactions `/transactions`, Analytics `/analytics`, Finance `/finance`, Merchants `/merchants`, Settings `/settings`.

### Dashboard Layout Principles

Four rules that govern how all dashboard pages are structured. Introduced to eliminate page-level scrolling on desktop and keep interactive controls always visible.

#### 1. Viewport-Native Grid Layout

On `md+` screens, dashboard pages fill the viewport with CSS Grid — no page-level scrollbar. Each page defines its own `grid-template-areas`. On mobile, pages revert to single-column stacking with normal browser scroll.

**CSS implementation:**
- Page container: `p-4 space-y-4 md:h-full md:overflow-hidden md:grid md:gap-4 md:p-6 md:space-y-0 page-grid-<name>`
- Content panels: `area-<name> grid-scroll-panel space-y-4` (for panels with multiple cards)
- The `.grid-scroll-panel` utility (`overflow-y: auto; min-height: 0`) is required on every grid-area child that may contain long content. `min-height: 0` is critical — it prevents grid children from overflowing their row constraint.
- On mobile, `area-*` classes are no-ops (no grid parent), children stack via `space-y-4` on the outer container.

**Per-page grid areas (defined in `index.css`):**

| Page | CSS class | Areas | Columns (md+) | Rows (md+) |
|---|---|---|---|---|
| Overview | `.page-grid-overview` | `"header header" / "left right"` | `1fr 1.2fr` | `auto 1fr` |
| Analytics | `.page-grid-analytics` | `"header header" / "left right"` | `1fr 1fr` | `auto 1fr` |
| Finance | `.page-grid-finance` | `"top top" / "left right"` | `1fr 1fr` | `auto 1fr` |
| Settings | `.page-grid-settings` | `"title title" / "left right"` | `1fr 1fr` | `auto 1fr` |

**Panel assignments:**
- **Overview** — Left: stats + health score + budget/goals summaries + charts. Right: transactions (paginated, 20/page).
- **Analytics** — Left: health score breakdown + alerts. Right: comparison chart + velocity + top merchants + income/expense bar.
- **Finance** — Top strip: savings overview. Left: budgets. Right: goals. Trips integrated below.
- **Settings** — Left: categories + merchant overrides. Right: feature toggles + alert thresholds.
- **Merchants** — Full-width two-panel list/detail view (no grid template, uses flex layout).
- **Transactions** — Full-width two-panel list/detail view.

#### 2. Persistent Chrome Rule

Interactive controls that modify content (edit, delete, save, cancel) must always be visible when the content they control is on screen. **Never place action buttons in a footer that can scroll off-screen.**

**Correct pattern for `flex flex-col h-full` panel components:**
```
[Header: identity info + close button]              ← shrink-0, outside scroll
[Action bar: edit/delete  OR  cancel/save]          ← shrink-0, outside scroll
[Scrollable body: detail fields / content]          ← flex-1 overflow-y-auto
```

Action bar classes: `shrink-0 border-b border-border` with inner `flex gap-2 px-4 py-2`

**Existing components that implement this pattern:** `TransactionDetail`, `MerchantProfile`.

#### 3. Two-Panel Interaction Pattern

Detail/profile panels follow a split-panel layout: list on left, detail on right. Already established in `TransactionsPage` and `MerchantsPage` — apply to any future list-detail view.

- Left panel: `flex-1 overflow-y-auto`
- Right panel: `w-full md:w-96 shrink-0 border-l border-border bg-card overflow-hidden`
- On mobile: right panel takes full screen (left panel `hidden md:block`)

#### 4. Paginated Summary Lists

Summary/overview pages show paginated lists (page size 20), not infinite scroll dumps. Infinite scroll is only for dedicated list pages (e.g. `TransactionsPage`).

Pagination controls go in the `PageCard` header `action` slot. Reset page to 1 whenever the date/period changes.

```tsx
const PAGE_SIZE = 20;
const [page, setPage] = useState(1);
useEffect(() => { setPage(1); }, [start, end]);
const totalPages = Math.ceil((items?.length ?? 0) / PAGE_SIZE);
const pageItems = (items ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
```

Pagination control (only rendered when `totalPages > 1`):
```tsx
<div className="flex items-center gap-1">
  <Button variant="ghost" size="icon" className="h-6 w-6"
    onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
    <ChevronLeft className="h-3 w-3" />
  </Button>
  <span className="text-xs text-muted">{page}/{totalPages}</span>
  <Button variant="ghost" size="icon" className="h-6 w-6"
    onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
    <ChevronRight className="h-3 w-3" />
  </Button>
</div>
```

### Common UI Patterns

- **Quick-select chips:** `px-2.5 py-1 text-xs rounded-full border transition-colors`. Active: `border-foreground text-foreground bg-foreground/10`. Inactive: `border-border text-muted hover:text-foreground`. "All time" chip is never highlighted active.
- **Segmented / inline toggle:** Container `flex rounded-md border border-border overflow-hidden`. Active button: `bg-primary text-primary-foreground`. Inactive: `text-muted hover:text-foreground`. Subsequent buttons add `border-l border-border`.
- **Source labels:** Use `SOURCE_DISPLAY_LABELS` from `@/components/icons/sources` for human-readable source display names (e.g. `'DBS PayLah!'`, used in `TransactionDetail.tsx`). `SOURCE_LABELS` contains single-character glyphs for the `SourceGlyph` component and must not be used for readable text. Never hardcode source strings in UI text.
- **Error feedback:** Always `text-sm text-destructive`, inline below the relevant field or immediately below the submit button.
- **Loading state:** Replace button label text (e.g. "Saving…"). Never leave the button without visual feedback during async operations.

### Icons & Typography

All icons from **lucide-react**. Three sizes: `w-3.5 h-3.5` inline actions (Pencil, Trash2), `w-4 h-4` standard buttons and form icons, `w-5 h-5` navigation. Category avatars use the emoji from the `icon` DB column, rendered inside a colored `div` (not an `<img>`).

**Edit/delete icon buttons — use this pattern everywhere, no exceptions:**
```tsx
<Button variant="ghost" size="icon" className={sizeClass} onClick={onEdit}>
  <Pencil className="w-3.5 h-3.5" />
</Button>
<Button variant="ghost" size="icon" className={`${sizeClass} text-destructive`} onClick={onDelete}>
  <Trash2 className="w-3.5 h-3.5" />
</Button>
```
- Always use `Button` from `@/components/ui/button` — never a bare `<button>` for icon actions
- Always `variant="ghost" size="icon"` — button size class (e.g. `h-7 w-7`) should match the surrounding context, not be universally fixed
- Edit button: no extra color class (inherits default muted ghost style)
- Delete button: always `text-destructive` — **never `text-muted`**, **never hidden on hover**
- Icons are always **persistent** — never `opacity-0 group-hover:opacity-100` or similar reveal patterns

Size scale: `text-xs` labels/metadata, `text-sm` body/button labels, `text-base` default inputs, `text-lg` card titles, `text-xl` page headings, `text-2xl` main figures and balance amounts. Weights: `font-medium` labels/nav items, `font-semibold` card titles/amounts, `font-bold` page h1s/balance figures.

Typography system uses `font-display` (heading variant) on card titles and `font-mono` for monetary amounts.

Responsive breakpoints: `sm` (640px) form layout changes, `md` (768px) sidebar visible / bottom tabs hidden / padding increases, `lg` (1024px) wider sidebar / two-column analytics grid.

## Database Schema

```sql
-- Per-user DB: /data/users/<username>/expense_tracker.db
transactions (id, source, source_id UNIQUE, amount, currency, exchange_rate, type, merchant, description, category, transaction_date, ingested_at, raw_data)
categories (name PK, keywords, icon, color, type)   -- type: 'needs'|'wants'|'neutral'
ingestion_state (source PK, last_processed_id, last_processed_at, updated_at)
merchant_overrides (merchant PK, category, source, updated_at)
merchant_tags (merchant PK, tags, notes, updated_at)
recurring_transactions (id, merchant, avg_amount, frequency, category, first_seen, last_seen, occurrences)
app_settings (key PK, value TEXT, updated_at)        -- all values stored as TEXT
budgets (id, category, period, amount, created_at, updated_at, UNIQUE(category, period))
goals (id, name, target_amount, saved_amount, target_date, status, created_at, updated_at)
goal_contributions (id, goal_id FK, amount, month, contributed_date, source, note, created_at)
trips (id, name, destination, start_date, end_date, primary_currency, status, created_at, updated_at)
trip_transactions (trip_id FK, transaction_id FK, added_by, PRIMARY KEY(trip_id, transaction_id))
subscriptions (id, merchant, normalized_merchant, amount, frequency, category, status, source, first_seen, last_seen, next_expected, notes, created_at, updated_at)
upcoming_transactions (id, subscription_id FK, expected_date, status, matched_transaction_id FK, created_at, updated_at)
sessions (token PK, created_at)   -- legacy; superseded by app.db sessions

-- Admin DB: /data/app.db
users (id, username UNIQUE, password_hash, telegram_chat_id, gmail_connected, wants_gmail, wants_apple_wallet, onboarding_complete, force_password_change, created_at)
sessions (token PK, username FK, user_agent, created_at, last_used_at)
admin_sessions (token PK, created_at, last_used_at)
telegram_link_tokens (token PK, username FK, expires_at)
```

**app_settings keys:** `anomaly_multiplier`, `velocity_alert_threshold`, `budgets_enabled`, `goals_enabled`, `trips_enabled`, `subscriptions_enabled`, `llm_insight_content`, `llm_insight_generated_at`, `llm_weekly_insight_content`, `llm_weekly_insight_generated_at`, `llm_monthly_insight_content`, `llm_monthly_insight_generated_at`.

## Testing

Run: `pytest tests/ -v`

All tests use in-memory SQLite (`:memory:`) — no files on disk.
591 tests across all modules.
Fixtures in `tests/conftest.py` provide pre-initialized DB connections and sample configs.

Test files: `test_storage.py`, `test_categorizer.py`, `test_parsers.py`, `test_telegram_bot.py`, `test_web_api.py`, `test_web_auth.py`, `test_web_security.py`, `test_webhook.py`, `test_gmail_poller.py`, `test_exchange.py`, `test_recurring.py`, `test_ingestion.py`, `test_analytics.py`, `test_merchants.py`, `test_budgets.py`, `test_goals.py`, `test_trips.py`, `test_health_score.py`, `test_subscriptions.py`, `test_llm_service.py`, `test_user_manager.py`, `test_admin_app.py`, `test_admin_storage.py`, `test_config.py`.

## Security

- `config.yaml` is gitignored — contains bot tokens, password hashes, Gmail credentials
- `credentials.json`, `token.json`, `.env` are all gitignored
- Never commit any file containing real tokens, passwords, or API keys
- Use `config.example.yaml` as the template — it has placeholder values only
- On Oracle Cloud, `config.yaml` and `credentials.json` are mounted as read-only volumes in docker-compose
- Web sessions expire after 30 days of inactivity (sliding window, enforced in `AdminStorage.verify_session`)
- Admin panel has IP-based login lockout: 5 failed attempts → 15-minute lockout
- New users created via admin panel have `force_password_change=1` — they are redirected to `SetPasswordPage` on first login
- Telegram linking uses time-limited tokens (`telegram_link_tokens` table) rather than direct chat ID entry

## Branching

- `feature/*` branches merge into `develop` for integration testing
- `develop` merges into `main` only for releases (with version tag + CHANGELOG)
- See README.md for detailed workflow
- NEVER commit directly to `develop` or `master`, always spawn feature or hotfix/bugfix branch before committing
- **Merge commits required:** When merging a feature branch into `develop`, always use `git merge --no-ff <branch>` to create an explicit merge commit. This preserves a clear history of when each feature was integrated. Never use fast-forward merges.

## Commit Style

- No co-author lines in commits
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Keep messages concise — describe what and why, not how

## Common Modifications

- **Adding a new bank parser:** Create `src/parsers/<bank>.py` extending `BankParser`, add sender filter to `config.yaml`, add test in `tests/test_parsers.py`
- **Adding a Telegram command:** Add handler in `src/telegram_bot.py`, register in `setup_handlers()`, follow existing command pattern
- **Changing the schema:** Append a version in `src/migrations.py`; tests use production `init_db` and those same migrations.
- **Adding an API endpoint:** Add route in `src/web/app.py` inside `create_dashboard_app()`, add `Depends(require_auth)`. Finance feature routes also need `Depends(_get_storage)`.
- **Adding a category color:** Add the color to `getCategoryColor()` defaults and the 20-color `PALETTE` array in `src/web/frontend/src/lib/utils.ts`
- **Adding a new chart component:** Create in `src/components/charts/`. Import all Recharts config from `src/lib/chartTheme.ts`. Wrap in `ChartCard` from `src/components/ui/cards.tsx` if the component owns its card.
- **Adding a new page section:** Use `PageCard` (content/tables/lists) or `ChartCard` (Recharts charts) from `src/components/ui/cards.tsx`. Avoid bare `Card/CardHeader/CardContent` for standard layouts.
- **Adding a new full-page view:** Use `p-4 space-y-4 md:h-full md:overflow-hidden md:grid md:gap-4 md:p-6 md:space-y-0` on the outer container. Define a `.page-grid-<name>` template in `index.css` with mobile single-column and `md` two-column variants. Apply `.grid-scroll-panel` to every grid-area child. Panel components inside the grid must follow the Persistent Chrome Rule (header + action bar outside scroll area).
- **Deploying to Oracle Cloud:** `git pull` on the OCI instance, then `docker-compose down && docker-compose build --no-cache && docker-compose up -d`. The `data/` volume persists across rebuilds. Cloudflare Tunnel reconnects automatically.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `xinweichong/cashe`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.


### Next experience navigation

When `home_briefing_enabled` is true, primary navigation is Home `/`, Activity `/activity`, Plan `/plan`, Explore `/explore`. Settings and capture review are in Profile; merchant drill-downs use `/explore/merchants/:merchantName`. Legacy routes redirect with suffix/query/fragment preserved; classic mode remains the default. Home/Explore naturally scroll, overriding the universal desktop viewport-grid rule for these pages. Activity keeps independent list/detail scrolling and preserves parent component state across detail URLs. See docs/design-language.md “Next experience navigation”.


### Appearance

System/light/dark preferences are supplied by `ThemeProvider` and selected in Profile. Theme changes must preserve drafts and mounted page state. Use semantic CSS tokens for HTML/SVG surfaces, `text-on-brand` over spectrum gradient buttons, and `useChartTheme()` for Recharts colors (explicit per-theme hex values centralized in `lib/chartTheme.ts`). Dark muted token is now `#A8A1B5`; light token overrides are in `index.css`. Neutral text contrast is tested; rendered/device accessibility validation remains required.
