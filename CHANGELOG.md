# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-09-27

The next-level rewrite. Every financial number in the app is now computed from one canonical, integer-minor-unit money representation and one shared spending-facts engine — reused identically by the web dashboard, the Telegram bot, CSV export, and scheduled reports, closing a long tail of currency-conversion and double-counting bugs. Capture is now durable and replay-safe end to end. The dashboard's classic/new-experience toggle is gone — Home, Activity, Plan, and Explore are the only navigation. Optional Gemini-backed AI intelligence gained a fail-closed policy gate and now writes period narratives, not just anomaly one-liners.

This is a breaking/major release: the classic Overview/Analytics pages are archived, several legacy `/api/analytics/*` and `/api/overview/*` endpoints were removed with no replacement (unused by the current frontend), and money is no longer read from raw `amount * exchange_rate`.

### Added

- **Canonical money (R02)** — `src/money.py` / `src/canonical_money.py`: integer minor-unit arithmetic with explicit Decimal rounding; `reporting_minor_units` computed and backfilled for every existing transaction; `ExchangeRateService.get_rate` returns a `RateResult` with explicit `resolved` / `indicative` / `unresolved` status instead of a bare float, so a legacy `1.0` rate can never again be silently counted as a real conversion
- **Shared spending-facts engine** — `src/spending_facts.py` computes day/week/month totals, comparisons, and evidence once, with one classification/rounding/timezone contract; backs the web dashboard, `/today` `/yesterday` `/week` `/month` `/balance`, the morning digest, and scheduled Telegram reports
- **Refunds and transfers as first-class types** — a refund nets against spending in its own period across every money-aggregating surface (budgets, goals, trips, health score, analytics — not just Home); transfers are excluded everywhere; explicit refund→purchase linking with evidence and currency-mismatch warnings
- **Capture-trust foundation** — durable `source_events` for every intake channel (web, Gmail, Apple Wallet, Telegram `/add`/`/cash`/`/income`, confirmed NL drafts); idempotent replay via `Idempotency-Key` (web) and per-channel private keys (Telegram); revision-numbered transactions with safe undo and 409-on-stale-revision; cross-source reconciliation now requires explicit minute/second precision on both sides — date-only or unknown-precision observations never silently merge
- **Review & merchant maintenance** — all-history review summary (unresolved money, missing merchant/category, undated records) surfaced on Home and Activity; refund-match auto-proposals; merchant display aliases with a category-rule-impact preview and bulk backfill; duplicate-transaction detection with merge/undo
- **Single navigation experience** — Home `/`, Activity `/activity`, Plan `/plan` (+ `/plan/manage` for budgets/goals/subscriptions/trips), Explore `/explore`; Settings and capture Review moved behind the profile menu; every legacy bare URL (`/transactions`, `/analytics`, `/merchants`, `/finance`, `/overview`) redirects to its new-experience equivalent with suffix/query/hash preserved
- **Explore rebuilt around five direct questions** — what drove the spending change, which recurring costs changed, what a normal week looks like, top merchants by category, and trip impact on the month — each with an evidence drill-down
- **Home driver explanations** — deterministic merchant/category contribution, frequency-vs-size change detection, one-off flags, and trip attribution behind each spending change; an overall spending-target line
- **Subscriptions & Plan (R11–R13)** — charge-level date/amount provenance distinguishing a confirmed schedule from a confirmed bill amount; full-horizon generation of every eligible pending cycle with stable per-period identity (corrections/dismissals never regenerate or duplicate); overdue review, price-change and annualized-impact comparisons, annual-renewal surfacing; a weekday-median forecast engine (`src/forecast.py`) with historical scenario bands, replacing the old straight-line projection; an overall spending target, dated goal-progress contribution rate, and baseline-exclusion flags (trip/one-off/date-range — API only, no dedicated UI yet)
- **Telegram durability** — replayable recurring-suggestion acceptance keyed to exact message identity; durable full-merchant suggestion records usable even without a linked Telegram account, surfaced in the web Review page too
- **AI period narratives** — daily/weekly/monthly narrative generation (`LLMService.generate_period_insight`) cached in `app_settings` and shown in the morning digest, `/yesterday`, `/week`, and `/month` when generated fresh that morning; the Gemini layer now requires an explicit `gemini_policy_confirmed` config flag in addition to an API key (fail-closed, not just key-presence)
- **Telegram voice pass** — command/notification copy rewritten against the cashe voice guide (docs/design-language.md §8); decorative emoji formally adopted as a documented Telegram-only exception, since the bot has no colour or iconography to lean on otherwise
- **Typed v2 API + generated TypeScript contracts** — transactions, budgets, goals, trips, merchants, analytics, and subscription endpoints migrated to a typed `/api/v2/*` surface with contracts generated from the OpenAPI schema and gated on drift in CI
- **Production operational hardening** — `job_runs` health tracking, `GET /admin/api/health`, a systemd backup timer with a live encrypted-snapshot restore-and-audit drill against production (which found and fixed two real bugs — orphaned `goal_contributions` rows and a `delete_transaction` foreign-key gap — then enabled `PRAGMA foreign_keys = ON`), and a healthchecks.io dead-man's-switch heartbeat
- **UI component consolidation** — a full audit (docs/plans/2026-09-17-cashe-production-experience-polish.md, "U01–U20") found and resolved duplicate button/card/field/switch implementations between the old and new dashboards; several new shared owners (`Switch`, category/colour pickers, `SegmentedChoice`, `ChoiceChip`, `StatusDot`, `ProgressBar`) approved and registered in the design-language component registry
- **Phone/mobile layout pass** — one-screen phone layouts for Activity, Plan, and Explore with a slide-in drill system, scaling text, and safe-area-correct status bar/home-indicator handling

### Changed

- **Activity** — migrated to typed v2 transactions with day-grouping and shared-fact daily totals (immune to pagination-boundary double-counting); full search across merchant/alias/description/category/amount; URL-encoded shareable filters (type, trip, review-state); scroll-anchor restoration across remounts; bulk select/categorize/reclassify/undo; two-tap category picker on the detail view
- **Quick entry** — redesigned amount/merchant-first with progressive disclosure for the remaining fields
- Every financial reader (Overview, Analytics, Telegram summaries, CSV export, scheduled reports) now reads canonical money instead of recomputing `amount * exchange_rate`; several real conversion bugs found and fixed along the way

### Removed

- **Classic Overview/Analytics dashboard** — archived at `archive/legacy-overview-2026-09-26/`, no longer reachable except via redirect; the classic/new-experience toggle (`settings.home_briefing_enabled` branching) removed from the frontend
- `.btn-action` CSS class — fully migrated to the shared `Button` component
- Unused legacy endpoints with no frontend caller: `/api/analytics/{comparison,merchants,velocity,alerts}`, `/api/analytics/yoy`, `/api/income-vs-expense`, `/api/v2/overview/*`

### Deferred (scoped, explicitly not shipped this release)

- CSV bank-statement import (blocked on sanitized sample statements)
- Category splits (a single transaction across multiple categories)
- Local/offline receipt OCR drafts
- Offline/PWA support and Web Push notification preferences
- A local, non-cloud alternative to the optional Gemini AI path
- Native mobile app (always scoped as a separate future decision, not a gap)

### Tests

- 1677 tests passing (1454 backend + 223 frontend), up from 591 in v2.1.0
- Cross-surface money-parity regression suite (`test_r04_exit_check_parity.py`) verifying Home/Explore/Telegram/CSV export agree on every total

## [2.1.0] - 2026-06-26

### Added

- **LLM Intelligence** — optional Gemini Flash integration (`gemini_api_key` in `config.yaml`); `LLMService` wraps the Gemini API for three tasks: anomaly explanations, natural-language Telegram parsing, and weekly/monthly insight generation; the service is `None` when the key is absent — all callers guard before use
- **Subscriptions system** — `subscriptions` and `upcoming_transactions` tables; `SubscriptionMatcher` daily job (6 AM) generates upcoming charges for each active subscription, auto-matches incoming transactions against pending upcoming entries, and flags subscriptions as `possibly_cancelled` when charges are overdue by more than 1.5× their interval; full CRUD API at `/api/subscriptions/*`; `subscriptions_enabled` feature toggle in Settings
- **LLM anomaly explanations** — Analytics page unusual-spend alerts now carry a one-line AI explanation of why each transaction was flagged, generated by `LLMService.explain_anomaly()` when `gemini_api_key` is configured
- **LLM Telegram parsing** — natural-language transaction entry via bot (e.g. "spent 12 at toast box") parsed by `LLMService.parse_telegram_message()` into structured fields; falls back silently to the regex parser when LLM is absent or returns low confidence
- **LLM weekly/monthly insights** — AI-generated spending narrative appended to Sunday weekly and monthly-1st Telegram digests; insights cached in `app_settings` (`llm_weekly_insight_content`, `llm_monthly_insight_content`) and exposed via `GET /api/analytics/insight/weekly` and `/monthly`; daily digest insight at `GET /api/analytics/insight`

### Fixed

- Weekly/monthly Telegram summary crash — `_weekly_summary` and `_monthly_summary` called non-existent `storage.get_total_spent()`; rewritten to use `bot.format_weekly_summary` / `format_monthly_summary`

### Tests

- 591 tests passing (up from 528 in v2.0.0)
- New test files: `test_subscriptions.py`, `test_llm_service.py`

## [2.0.0] - 2026-05-12

### Design Language v2 — "cash, caught."

**Brand:**
- New wordmark: `ca$he` (lowercase, with warm-gradient `$` glyph)
- New brand-mark meaning: cashe = cash + cache
- New brand hook: "cash, caught."
- Retired the teal-square check-sparkline logo

**Color:**
- New 5-anchor spectrum: teal (#00D4AA) → mint → honey → tangerine → coral
- Yellow `#FFD60A` retired; "notable" alerts now use tangerine
- 20-color category palette replaced with 10-color spectrum-derived palette
- Existing custom category colors auto-snap to nearest spectrum match on first load

**Typography:**
- Display: Plus Jakarta Sans (700, 800)
- Body: Inter (kept)
- Mono: JetBrains Mono (new)
- Modular scale 1.250

**Components:**
- New `<HeroCard>` and `<HighlightCard>` wrappers
- New `<Button variant="hero">` with gradient sweep
- New `<Badge tone={...}>` spectrum API
- Ghost-button bug fixed (no more teal bleed on hover)

**Voice:**
- Matter-of-fact, slightly knowing. No cheerleader, no emoji in microcopy.

See `docs/design-language.md` for the full reference.

## [1.0.0] - 2026-04-25

### Added

- **Budget system** — `budgets` table with CRUD, per-category spend-progress calculation, and `budgets_enabled` feature toggle; Finance tab in the dashboard with a dedicated budgets section and an Overview budget summary card; Telegram alerts at 80% and 100% threshold crossings
- **Financial goals** — `goals` and `goal_contributions` tables; goal CRUD with target amount, target date, and status; manual contributions with `contributed_date` and full edit/delete history; monthly savings auto-contribute scheduler with Telegram completion notification; progress rings and savings overview in the Finance tab; goals summary card on Overview; `goals_enabled` feature toggle
- **Financial Health Score** — composite score computed from savings rate, spending trends, and needs/wants/neutral category classification; `get_health_score()` storage method; `GET /api/health-score` endpoint; compact score card on Overview; full breakdown panel on Analytics; category type editor (needs / wants / neutral) in Settings; `categories.type` column
- **Trips** — `trips` and `trip_transactions` tables; trip CRUD with activate/deactivate, end-date, and daily elapsed tracking; transactions auto-assigned to the active trip across all ingestion paths (Gmail, Apple Wallet, Telegram, web); `trips_enabled` feature toggle; `/trip` Telegram command shows active trip summary with spend breakdown; trip context injected into transaction notifications; `TripsPage` with `TripRow` list, bidirectional toggle, pagination, and end-date field; `ActiveTripCard` on Overview left panel; trip membership shown in `TransactionDetail`
- **Merchant Intelligence** — `merchant_tags` table; merchant storage methods for list, profile, tags, notes, and monthly trend; merchant intelligence API (`/api/merchant-intelligence/*`); `MerchantsPage` with split-panel profile view, transaction history, and sparkline chart; merchant link in `TransactionRow`; merchant tags: subscription, online, foreign, essential, recurring
- **Transaction Detail panel** — `TransactionDetail` side panel with URL-synced routing (`/transactions/:transactionId`); persistent action bar (edit/delete) pinned above the scrollable body; `MerchantProfile` panel with full transaction history and navigation links; clicking an active merchant row toggles the panel closed
- **Timestamp completeness** — time extracted from DBS PayLah! `Date & Time` field and UOB emails; `datetime-local` input in the web transaction form; transaction time displayed in the UI and Telegram notifications; bare `YYYY-MM-DD` dates normalised to `T00:00:00`; `/add`, `/cash`, and `/income` accept `YYYY-MM-DD HH:MM` format
- **Frontend design system** — centralised `chartTheme.ts` (tooltip, axis, cursor, legend, colour constants); three-tier card system (`Card`, `PageCard`/`ChartCard`/`StatCard` in `cards.tsx`); CSS utility classes: `.input-field`, `.btn-action`, `.select-field`, `.grid-scroll-panel`, `.area-*`, `.page-grid-*`
- **Viewport-native grid layout** — all four dashboard pages use viewport-filling CSS Grid on `md+` screens with no page-level scroll; per-page `.page-grid-*` templates defined in `index.css`; Persistent Chrome Rule enforced — action bars pinned outside scroll areas in `TransactionDetail` and `MerchantProfile`; `.grid-scroll-panel` utility (`overflow-y: auto; min-height: 0`) applied to all scrollable grid children; paginated transaction list on Overview (page size 20)
- **Cashe rebrand** — app renamed to Cashe with abstract SVG mark logo; redesigned login screen with branding and slogan; full favicon and PWA icon coverage for all platforms (16×16 to 512×512, maskable, apple-touch-icon)
- **framer-motion animations** — spring SVG rings and progress bars in the Health Score card; count-up stats with spring easing; staggered list entry in `TransactionList`; spring slide-in for detail panels; page transitions; BottomTabs drawer spring; hover-lift on interactive cards; `LoginScreen` entrance animation; `ColorPicker` spring
- **Phase 1 enhancements** — `/delete` and `/edit` conversation handlers in the Telegram bot; CSV export endpoint (`GET /api/transactions/export`) and Export CSV button on the Transactions page; date range filter with quick-select chips (Today, This week, This month, Last 30 days, Last 3 months, This year) on the Transactions page; configurable alert thresholds stored in `app_settings` with a Settings page UI; `app_settings` table with `get_setting`/`set_setting` storage methods; income vs expenses 6-month bar chart on Overview; biweekly recurring transaction detection (13–17 day intervals)
- **Income vs expense chart** — `IncomeExpenseBar` component on the Analytics page showing a 6-month paired bar chart with income/expense colour coding

### Changed

- **UOB parsers consolidated** — `uob_paynow.py` and `uob_card.py` merged into a single `src/parsers/uob.py` (`UobParser`) with 5 email patterns and a `can_parse` collision bug fixed
- **Overview layout** — removed `ResizeObserver` and nested flex/overflow chains; replaced with clean CSS grid; `StatCard` font size scales dynamically; transaction panel fills grid height with dynamic pagination
- **Transaction list** — `TransactionRow` simplified to remove inline edit, source/FX badges, and merchant click; all editing moved to the `TransactionDetail` panel
- **Income in Telegram summaries** — income transactions marked distinctly in all summary views (`/today`, `/week`, `/month`); UOB income transactions trigger a "Received" notification
- **Railway URL auto-config** — dashboard URL auto-derived from `RAILWAY_PUBLIC_DOMAIN` env var; `/dashboard` command and help text updated automatically
- **Merchant tags** — replaced with a curated set: subscription, online, foreign, essential, recurring
- **Daily digest timing** — corrected to 8 am SGT via explicit APScheduler timezone configuration
- **Finance tab navigation** — locked state in Sidebar and mobile More drawer redirects to Settings `#feature-toggles` with smooth scroll when budgets/goals are disabled

### Fixed

- Segmented toggle styling applied consistently to transaction type selector
- 7 narrow/mobile viewport bugs (sidebar icon rail at `md`, card header flex constraints, `StatCard` font size, category legend truncation, and more)
- Toggle thumb positioning in `TripCard` matching the `SettingsPage` pattern
- Trip transaction rows: symmetric side padding and full card width
- MarkdownV2 reserved character escaping in `/trip` output
- `auto_assign_to_active_trip` wrapped as best-effort in the webhook path so a trip error never loses a transaction
- `daysElapsed` in `ActiveTripCard` uses local date arithmetic
- Donut container uses explicit `h-[220px]` for reliable centre text alignment on mobile
- `deactivate_trip` API returns 404 on unknown trip ID
- `uob_transfer` added to Telegram `SOURCE_LABELS`
- `MerchantProfile` header pinned outside scroll area (Persistent Chrome Rule)
- `IncomeExpenseBar` colours aligned to design tokens (`#30D158` income, `#FF453A` expense)
- Timezone-aware date queries using `local_now()` throughout — fixes wrong-day results for SGT users on Railway (UTC)
- Gmail poller skips insert when a cross-source duplicate already exists (Apple Wallet arrives before email)
- Safe area insets for bottom navigation on devices with curved corners

### Tests

- 416 tests passing (up from 206 in v0.3.0)
- New test files: `test_health_score.py`, `test_trips.py`, `test_budgets.py`, `test_goals.py`, `test_merchants.py`

## [0.3.0] - 2026-04-23

### Added

- **React SPA dashboard** — Complete rewrite with Vite, Tailwind CSS, and shadcn/ui components; responsive layout shell with app routing, auth hook, and login screen; API client layer; FastAPI serves SPA with catch-all routing
- **Dashboard: Overview page** — Period selector (Day/Week/Month), donut and trend charts, insights panel, and recent transactions
- **Dashboard: Transactions page** — Filterable/sortable transaction list with infinite scroll, inline edit, and transaction form supporting expense/income/cash entry and multi-currency
- **Dashboard: Analytics page** — Comparison charts, spending velocity ring, merchant table, and unusual-spend alerts with explanatory labels
- **Dashboard: Settings page** — Category CRUD with keyword editor and color/icon picker, merchant override management
- **Transaction CRUD from dashboard** — `POST`, `PATCH`, and `DELETE` `/api/transactions` endpoints; inline edit form includes card/source field; transaction cards show SGD equivalent and exchange rate editing
- **Analytics engine** — Spending velocity, anomaly/unusual-spend detection, new merchant alerts, period-over-period trend comparison, merchant analysis, and cached summary report generation
- **Analytics API endpoints** — `/api/analytics/*` routes backing comparison charts, velocity, and merchant table
- **Telegram: new commands** — `/compare`, `/merchants_report`, `/velocity`, `/summary`, `/menu`, `/dashboard`
- **Telegram: inline keyboards** — Post-command action buttons and `/menu` command; button grid layout for category selection
- **Telegram: daily morning digest** — Yesterday's summary plus anomaly/new-merchant alerts; scheduled weekly and monthly summary report delivery
- **Telegram: transaction notifications** — Instant notification with inline categorization option on every new ingested transaction
- **Telegram: command menu** — Registered via `setMyCommands`; `/help` updated with full command reference
- **Category icons and color system** — Per-category icon pills, unique color picker in settings, consolidated palette, category row tinting in transaction list
- **Source/card badges** — Friendly source labels and card name badges on transaction rows in dashboard and Telegram messages
- **Apple Wallet card name tracking** — Card name stored alongside multi-currency amount and surfaced in dashboard transaction cards
- **UOB card parser** — New `src/parsers/uob_card.py` with transit transaction support
- **Multi-stage Docker build** — Node.js excluded from runtime image; `.dockerignore` added to exclude `node_modules` and secrets; pytest deps moved to `requirements-dev.txt`

### Changed

- **Deduplication** — Replaced time-window cross-source dedup with `source_id`-based dedup for correctness; merchant overrides hot-reloaded from DB on every transaction
- **Exchange rate direction** — Fixed inversion bug causing incorrect SGD conversion
- **Telegram formatting** — Markdown escaping applied to all summary, alert, and confirmation messages; richer `/insights`, `/subscriptions`, and `/balance` output with structured sections
- **Settings page design** — Redesigned to match dark fintech theme; improved mobile responsiveness across dashboard and settings
- **Dashboard accent colour** — Changed to teal `#00D4AA` to avoid visual clash with the Food category colour
- **`match_source` propagation** — Threaded through the full notification pipeline so categorization context is available in Telegram notifications

### Removed

- **Vanilla JS dashboard** — Old Chart.js-based frontend replaced entirely by the React SPA; all legacy dashboard templates and static assets removed

### Fixed

- Inline keyboard callbacks failing on frozen `Update` objects (python-telegram-bot v21+) — now use `SimpleNamespace`
- Telegram menu button not registered on startup — `post_init` called correctly in `_run_bot`
- Category trend chart lines not rendering in Recharts — gap-fill missing data points so all series are continuous
- Missing CSS variables for `--popover` and `--accent-foreground` causing broken select/popover styling
- `401` responses not redirecting to login when session expires — global interceptor added to API client
- Dashboard category chart rendering and transaction period filtering returning wrong results
- Timezone bug, `CategoryDonut` empty state, `TrendLine` duplicate gradient IDs
- Gmail poller crashing on OAuth scope errors; DBS email date parsing failure
- Month-end date overflow in recurring transaction `estimate_next_date`
- `change_percent` being `None` crashing `/compare` Telegram command
- `check_new_merchants` returning duplicates; spending velocity pace semantics corrected
- `googleapiclient` file-cache warning suppressed via `cache_discovery=False`

### Performance

- Expression indexes added on `transaction_date`, `category`, `type`, and `merchant` columns
- Vite vendor chunk splitting (`vendor`, `vendor-ui`) for improved browser caching of third-party bundles

### Tests

- 206 tests passing (up from 127 in v0.2.0)

## [0.2.0] - 2026-04-20

### Added

- **DBS PayLah! email parsing fix** — Updated regex to match real email format (`Amount: SGD8.20`, `To: MERCHANT`, `Transaction Ref`), with HTML body extraction fallback when emails lack `text/plain` MIME parts
- **Cross-source deduplication** — Same transaction reported by both Gmail and Apple Wallet is now counted once (matched by merchant + amount within 10-minute window)
- **Category management** — Full CRUD for categories via web settings page at `/settings` with keyword editor, merchant override cleanup, and category delete with transaction reassignment
- **Merchant override learning** — When a transaction is recategorized via `/recategorize`, the merchant → category mapping is learned and applied to future transactions from the same merchant. Overrides take priority over keyword matching
- **Categorizer match source tracking** — `categorize()` now returns `(category, match_source)` tuple where match_source is `"learned"`, `"keyword:<kw>"`, or `"default"`
- **Cash tracking** — `/cash <amount> <merchant> [category]` command for quick offline transaction entry
- **Multi-currency support** — Tag foreign currency expenses (e.g. `/add 500 THB street food`), auto-converted to SGD using cached exchange rates with fallback rates for offline use
- **Income tracking** — `type` column on transactions (`expense` / `income`), `/income` command to record income, `/balance` command showing earned/spent/net
- **Spending insights** — `/insights` Telegram command showing top merchants and average daily spend; `/api/insights`, `/api/trend`, `/api/merchants` API endpoints for dashboard
- **Recurring transaction detection** — Automatically detects subscriptions and regular payments (monthly/weekly) based on consistent amounts and intervals; `/subscriptions` Telegram command; `/api/recurring` API endpoint
- **Telegram guided UX** — Catch-all handler for unknown commands and plain text, contextual error messages with usage hints and examples, enhanced `/help` with structured command reference, redirects removed commands to web dashboard
- **Dashboard redesign** — Complete frontend rewrite with dark fintech theme (Sora + DM Sans fonts, custom color system), period selector (Day/Week/Month), donut and trend charts, insights panel, filterable/sortable transaction list with infinite scroll, PWA meta tags for iOS home screen
- **Railway deployment** — Dockerfile, environment variable configuration fallback (no `config.yaml` needed), Gmail credential decoding from base64 env vars, persistent volume support, updated setup guide
- **Income vs expense API** — `GET /api/balance` and `GET /api/income-vs-expense` endpoints for net position and monthly comparison

### Changed

- **Gmail poller dedup bug fix** — `is_duplicate()` now uses the parser's `source` (e.g. `"dbs_paylah"`) instead of hardcoded `"gmail"`, fixing a bug where previously-seen emails were re-processed every poll cycle
- **Gmail poller parse failure logging** — Logs full email body at WARNING level when DBS parser returns None, aiding regex tuning
- **Spending summary excludes income** — `get_spending_summary()` now filters to `type = 'expense'` only; income tracked separately via `get_income_summary()`
- **Commit style** — Merge commits required (`--no-ff`) for feature → develop merges

### Tests

- 127 tests passing (up from 66 in v0.1.0)
- New test files: `tests/test_gmail_poller.py`, `tests/test_exchange.py`, `tests/test_recurring.py`
- New test classes: `TestCrossSourceDedup`, `TestWebhookDedup`, `TestCategoryCRUD`, `TestMerchantOverrides`, `TestCategorizerOverrides`, `TestIncomeTracking`, `TestInsights`, `TestEnvConfig`

## [0.1.0] - 2026-04-17

### Added

- SQLite storage layer with CRUD operations and spending queries
- Configuration loader with YAML file + environment variable overrides
- Parser engine with DBS PayLah!, UOB PayNow, and Apple Wallet parsers
- Keyword-based auto-categorization engine
- Gmail polling pipeline with per-bank parser dispatch and OAuth flow
- Apple Wallet webhook receiver with 5-minute deduplication window
- Telegram bot with `/today`, `/week`, `/month`, `/add`, `/help` commands
- Web dashboard with Chart.js visualizations and bcrypt-gated auth
- Main entry point integrating all services with background threads
- Comprehensive `.gitignore` blocking all sensitive files (config, tokens, DBs)
- `README.md` with installation guide and iOS Shortcut setup instructions
- `AGENTS.md` for AI agent context
- `config.example.yaml` template with placeholder values
- 66 passing tests across all modules
