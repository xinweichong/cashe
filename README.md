<div align="center">

<img src="cashe-banner.png" alt="cashe" width="640" />

# cashe

### cash, caught.

A privacy-first personal finance app that **automatically captures every transaction** from your bank emails and Apple Wallet — no manual logging, no subscription fees, no data leaving your server. Supports multiple accounts, each with its own isolated database.

[![Version](https://img.shields.io/badge/version-3.0.0-00D4AA?style=flat-square)](CHANGELOG.md)
[![Tests](https://img.shields.io/badge/tests-1677%20passing-30D158?style=flat-square)](tests/)
[![Python](https://img.shields.io/badge/python-3.11%2B-3572A5?style=flat-square)](https://python.org)
[![License](https://img.shields.io/badge/license-private-72727E?style=flat-square)](#license)

</div>

---

## Why cashe?

Most people don't track their spending — not because they don't care, but because it's too much friction. cashe removes the friction entirely.

**Transactions captured automatically.** Every DBS PayLah!, UOB PayNow, UOB Card payment, and Apple Wallet tap is ingested and categorised the moment it happens. You never open an app to log anything.

**Your data, your server.** Everything lives in a SQLite database you control. No cloud vendor sees your transactions. No subscription. No lock-in.

**Intelligent, not just transactional.** cashe tracks budgets, goals, health score, merchant patterns, recurring charges, and trips — so you get a complete picture of your finances, not just a list of debits.

---

<!--
## Screenshots

> Drop images into `docs/screenshots/` to populate this section. Suggested filenames below.

<table>
  <tr>
    <td align="center"><b>Home</b></td>
    <td align="center"><b>Activity</b></td>
    <td align="center"><b>Plan</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/home.png" alt="Home page" width="280" /></td>
    <td><img src="docs/screenshots/activity.png" alt="Activity page" width="280" /></td>
    <td><img src="docs/screenshots/plan.png" alt="Plan page" width="280" /></td>
  </tr>
  <tr>
    <td align="center"><b>Explore</b></td>
    <td align="center"><b>Telegram</b></td>
    <td align="center"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/explore.png" alt="Explore page" width="280" /></td>
    <td><img src="docs/screenshots/telegram.png" alt="Telegram bot" width="280" /></td>
    <td></td>
  </tr>
</table>
-->

---

## Features

### Automatic capture

| | |
|---|---|
| **Gmail Auto-Ingestion** | Polls DBS PayLah!, UOB PayNow, and UOB Card transaction emails automatically, with HTML body fallback and time extraction |
| **Apple Wallet Capture** | iOS Shortcut fires on every tap — card name, merchant, amount, and timestamp sent to your server instantly |
| **Source-ID Deduplication** | Every transaction carries a unique `source_id`; cross-source duplicates (Gmail + Apple Wallet arriving for the same transaction) are discarded automatically |
| **Multi-Currency** | Foreign currency transactions (e.g. `PLN 3.78`, `£12.50`) auto-converted to SGD using cached exchange rates with offline fallbacks |

### Money & data integrity

| | |
|---|---|
| **Canonical money** | Every total is computed from one integer-minor-unit money representation shared by the web dashboard, Telegram, CSV export, and scheduled reports — no more silent `amount * exchange_rate` drift on unresolved foreign-currency rates |
| **Refunds & transfers** | Refunds net against spending in their own period across every surface (budgets, goals, trips, health score); transfers are excluded everywhere; explicit refund→purchase linking |
| **Durable capture** | Every intake channel (Gmail, Apple Wallet, web, Telegram) records a replay-safe source event before processing — a crash or retry can never double-count or silently drop a transaction |
| **Review** | Unresolved money, missing merchant/category, undated records, refund matches, and possible duplicates surfaced in one place, with evidence and direct resolution actions |

### Analytics & intelligence

| | |
|---|---|
| **Financial Health Score** | Composite score from savings rate, spending trends, and needs/wants/neutral category breakdown |
| **Explore** | Five direct questions — what drove the change, which recurring costs changed, what a normal week looks like, top merchants by category, and trip impact — each with an evidence drill-down |
| **Merchant Intelligence** | Per-merchant profiles with spend trends, tags, aliases, notes, and full transaction history |
| **Spending signals** | Unusual purchases and first-seen merchants flagged automatically |
| **LLM Intelligence** | Optional Gemini Flash integration, gated behind an explicit `gemini_policy_confirmed` config flag — AI daily/weekly/monthly narratives, natural-language Telegram entry; disabled entirely when not configured |
| **Recurring Detection** | Automatically identifies subscriptions and regular payments — monthly, weekly, biweekly |
| **Forecast** | Weekday-median projected month-end total with historical scenario bands, replacing straight-line extrapolation |

### Planning

| | |
|---|---|
| **Budgets** | Monthly per-category budgets with progress bars; Telegram alerts at 80% and 100% |
| **Financial Goals** | Savings goals with target amounts and dates, manual contributions, dated (not averaged) progress rate |
| **Subscriptions & Plan** | Full-horizon upcoming-charge generation with stable per-period identity, charge-level date/amount provenance, overdue review, price-change and annual-impact comparisons, pause/resume, possibly-cancelled detection |
| **Trips** | Group any set of transactions into a trip; all new transactions auto-assigned to the active trip across every ingestion path |
| **Income Tracking** | Record income alongside expenses; recorded net flow surfaced via `/balance` and Home |

### Interface

| | |
|---|---|
| **Telegram Bot** | Real-time alerts with inline categorisation, 20+ commands, guided `/edit` and `/delete` flows, a daily digest with an AI narrative, and a `/menu` button grid |
| **React Web Dashboard** | Four destinations — Home, Activity, Plan, Explore — plus Settings and capture Review behind the profile menu; one-screen phone layouts with slide-in drill sheets |
| **Multi-user** | Each account gets an isolated SQLite database, its own Gmail connection, and its own Telegram link; managed from an admin panel |
| **Auto-Categorisation** | Keyword matching with learned merchant overrides that persist and hot-reload without a restart |
| **CSV Export** | Download filtered transactions from Activity |
| **Oracle Cloud Deployment** | Runs free on Oracle Always Free ARM VM + Cloudflare Tunnel — no open ports, automatic TLS, custom domain |
| **Privacy-First** | All data stays in your own SQLite database. No third-party data sharing. No telemetry |

---

## Architecture

```
Gmail API ──poll──> Parser Engine ──> IngestionPipeline ──> SQLite (per user)
                       ^                                        │
iOS Shortcut ──POST──> ┘                                        ├── Spending Facts (shared)
                                                                  │       ├── Telegram Bot
                                                                  │       └── Web Dashboard (React SPA)
                                                                  │              ├── Home
                                                                  │              ├── Activity
                                                                  │              ├── Plan
                                                                  │              └── Explore
                                                                  ├── Auto-categoriser
                                                                  ├── Recurring Detector / Subscriptions
                                                                  ├── Exchange Rates
                                                                  └── LLM Intelligence (optional)
```

Single Python process, multi-user: each account has its own SQLite database (WAL mode), Gmail connection, and Telegram link, managed by `UserManager`. FastAPI serves webhooks, the dashboard API, and the admin panel. React SPA built with Vite, served from `dist/`.

---

## Prerequisites

- **Python 3.11+**
- **Node.js 22+** (only needed to rebuild the frontend — a pre-built `dist/` is committed)
- **Gmail account** with API credentials (for email ingestion) — see setup guide
- **Telegram Bot Token** (from [@BotFather](https://t.me/botfather))
- **An [Oracle Cloud](https://cloud.oracle.com/) Always Free account** for cloud deployment
- **A [Cloudflare](https://cloudflare.com/) account with a domain** for the Tunnel + TLS

---

## Quick start

### Local development

```bash
# Clone and set up
git clone https://github.com/xinweichong/cashe.git
cd cashe
git checkout develop
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure
cp config.example.yaml config.yaml
# Edit config.yaml with your Telegram token, admin username/password hash, and webhook URL

# Gmail OAuth (one-time, per user — can also be done later from the dashboard)
python scripts/gmail_auth.py

# Run
python src/main.py
```

On first boot, if `app.db` has no users yet, an admin account is seeded from `config.yaml`'s `web.admin_username` / `web.password_hash`. Additional accounts are created from the admin panel at `/admin`; each gets its own isolated database, Gmail connection, and Telegram link.

The pre-built React frontend is committed in `src/web/dist/` and served automatically. To rebuild it after frontend changes:

```bash
cd src/web/frontend
npm ci
npm run build   # output goes to src/web/dist/
cd ../../..
```

### Generate web dashboard password

```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"
```

Copy the output (starts with `$2b$12$...`) into `config.yaml` as `web.password_hash`.

### Oracle Cloud deployment

cashe runs on an **Oracle Always Free** ARM VM behind a **Cloudflare Tunnel** — no open inbound ports, automatic TLS, and a custom domain. Docker Compose manages the two services (`app` + `cloudflared`).

**Prerequisites:** an Oracle Cloud account and a domain on Cloudflare (free plan works).

**One-time setup:**

```bash
# 1. Provision an A1.Flex VM on Oracle Cloud (Ubuntu 22.04)
#    Minimum: 1 OCPU / 6 GB RAM from the Always Free pool

# 2. Install Docker on the VM
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Create a Cloudflare Tunnel
#    Zero Trust → Networks → Tunnels → Create tunnel → cloudflared connector
#    Add public hostname: cashe.yourdomain.com → http://app:8080
#    Copy the tunnel token shown in the dashboard

# 4. Clone and configure on the VM
git clone https://github.com/xinweichong/cashe.git
cd cashe && git checkout develop
cp .env.example .env
# Edit .env — paste in TUNNEL_TOKEN from step 3
mkdir -p data

# 5. Copy credentials from your local machine
scp config.yaml ubuntu@YOUR-VM-IP:~/cashe/
scp credentials.json ubuntu@YOUR-VM-IP:~/cashe/
scp token.json ubuntu@YOUR-VM-IP:~/cashe/data/

# 6. First deploy
docker compose up -d --build
```

**Subsequent deploys** — run on the VM from `~/cashe/`:

```bash
./deploy.sh   # git pull + docker compose up -d --build
```

See [docs/setup-guide.md](docs/setup-guide.md) for the full Oracle + Cloudflare Tunnel walkthrough.

---

## Configuration

All configuration lives in `config.yaml` (gitignored). A template is provided at `config.example.yaml`.

```yaml
gmail:
  credentials_file: credentials.json
  poll_interval_seconds: 120
  sender_filters:
    - notification@dbs.com
    - notification@uob.com

server:
  host: "0.0.0.0"
  port: 8080
  webhook_base_url: "https://your-server.example.com"

web:
  password_hash: "<bcrypt hash>"

telegram:
  bot_token: "<from @BotFather>"

categories:
  - name: Food
    keywords: ["restaurant", "cafe", "food", "kopitiam", "toast box", "ya kun"]
    icon: "🍜"
  - name: Transport
    keywords: ["grab", "gojek", "comfortdelgro", "mrt", "bus", "taxi", "cdg"]
    icon: "🚗"
  - name: Shopping
    keywords: ["shopee", "lazada", "fairprice", "cold storage", "ntuc"]
    icon: "🛒"
  - name: Bills
    keywords: ["sp services", "singtel", "starhub", "m1"]
    icon: "📄"
  - name: Entertainment
    keywords: ["netflix", "spotify"]
    icon: "🎬"
  - name: Other
    keywords: []
    icon: "📌"

# LLM Intelligence (optional — leave blank to disable)
gemini_api_key: ""
# gemini_model: "gemini-2.0-flash"   # default
# gemini_policy_confirmed: true      # required in addition to the key — set only after
                                      # verifying billing/quota and data-handling terms
```

### Environment variable overrides

Config values can be overridden via environment variables — mainly used for Docker Compose secrets. `PORT` and `EXPENSE_CONFIG_PATH` override `config.yaml` values directly; the rest are the documented overrides used in the Oracle Cloud deployment below.

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `WEB_PASSWORD_HASH` | bcrypt hash for the admin account (first-boot seed only) |
| `PORT` | Overrides the port in `config.yaml` (defaults to 8080) |
| `WEBHOOK_BASE_URL` | Public URL for Apple Wallet webhooks |
| `GMAIL_SENDER_FILTERS` | Comma-separated sender addresses |
| `GMAIL_CREDENTIALS_JSON` | Base64-encoded `credentials.json` |
| `GMAIL_TOKEN_JSON` | Base64-encoded `token.json` |
| `EXPENSE_DB_PATH` | Overrides the legacy single-user DB path only — not per-user paths |
| `EXPENSE_CONFIG_PATH` | Overrides the config file path (defaults to `config.yaml`) |
| `GEMINI_API_KEY` | Google Gemini API key (enables LLM Intelligence when set, overrides `gemini_api_key`) |

---

## Telegram commands

### Viewing spending

| Command | Description |
|---------|-------------|
| `/today` | Today's shared spending facts and evidence |
| `/yesterday` | Yesterday's shared spending facts and evidence |
| `/week` | Monday-to-date spending, comparable prior weekdays, and evidence |
| `/month` | Month-to-date spending, comparable prior-month dates, and evidence |
| `/balance` | Month-to-date recorded income, spending, and recorded net flow |
| `/insights` | Top merchants, average daily spend |
| `/subscriptions` | Detected recurring transactions |
| `/trip` | Active trip summary with spend breakdown |

### Analytics

| Command | Description |
|---------|-------------|
| `/compare` | Period-over-period comparison (this period vs previous) |
| `/velocity` | Spending velocity, daily pace, and projected month-end total |
| `/merchants_report` | Top merchants ranked by total spend with trends |
| `/summary` | Cached weekly or monthly digest report |

### Manual entry

| Command | Description | Example |
|---------|-------------|---------|
| `/add <amount> <merchant> [category] [date]` | Manual expense entry | `/add 12.50 Toast Box food` |
| `/cash <amount> <merchant> [category]` | Quick cash entry | `/cash 5.50 kopi` |
| `/income <amount> <description> [date]` | Record income | `/income 5000 salary` |
| `/add 500 THB street food` | Multi-currency (auto-converted to SGD) | — |
| `/edit` | Edit a recent transaction via guided conversation | — |
| `/delete` | Delete a recent transaction via guided conversation | — |

### Category management

| Command | Description |
|---------|-------------|
| `/recategorize <id> [category] [--remember]` | Change this transaction only; add `--remember` to save its category for future matching purchases |

### Utilities

| Command | Description |
|---------|-------------|
| `/menu` | Quick-access button menu for common commands |
| `/dashboard` | Returns your dashboard URL |
| `/reauth` | Re-authorize Gmail access |
| `/forcepoll` | Force a Gmail poll for new emails |
| `/help` | Full command reference |
| Any unknown text | Bot responds with guidance and available commands |
| Free-text (e.g. "spent 12 at toast box") | Parsed by the optional Gemini layer into a confirmable draft, when configured |

All commands support **inline keyboards** — post-command action buttons appear automatically so you can drill deeper without typing follow-up commands. Transaction notifications include an inline category selection grid for instant recategorisation.

---

## Web dashboard

Access at `http://your-server:8080`. Navigation is four destinations — **Home**, **Activity**, **Plan**, **Explore** — plus Settings and capture Review behind the profile menu. Home and Explore scroll naturally; Activity and Plan's management view keep an independent-scrolling list/detail split. Desktop uses viewport-native CSS Grid where that split layout applies; phone gets one-screen layouts per tab with slide-in drill sheets.

### Home

- **Pulse band** — day/week/month glance at spending, income, and recorded net flow, with forward/back date navigation
- **Driver explanations** — deterministic "what changed" callouts: merchant/category contribution, frequency-vs-size shifts, one-off flags, trip attribution
- **Overall spending target** — dated progress against a target, not an averaged rate
- **Review & recurring summary** — all-history unresolved-record and pending-suggestion counts, linking straight to Review
- **Capture freshness** — sanitized status for each intake channel

### Activity

- **Filterable, day-grouped list** — filter by category, source, merchant, type, trip, and review state; full search across merchant/alias/description/category/amount; URL-encoded shareable filters
- **Transaction detail panel** — URL-synced side panel with edit form, delete, refund/transfer linking, and provenance; action bar always visible (never scrolls off)
- **Bulk actions** — multi-select categorize, reclassify, and undo
- **Add transaction form** — expense, income, cash, or multi-currency entry
- **CSV export** — download filtered transactions

### Plan

- **Upcoming timeline** — recorded pending/unmatched subscription charges over 1–90 days, with estimated/unknown amounts made explicit
- **Forecast** — weekday-median projected month-end total with historical scenario bands
- **Manage** (`/plan/manage`) — budgets, goals, subscriptions (pause/resume, confirm, price-change/annual-impact review), and trips in one view

### Explore

- **Pulse + AI daily read** — month facts plus an optional Gemini-generated narrative
- **Signals** — unusual purchases and first-seen merchants
- **Health score** — score summary with a full breakdown drill-down
- **Modes** — Over time, By category, By merchant, Recurring — held in the URL
- **Merchant drill-down** (`/explore/merchants/:merchant`) — tags, notes, spend trend, full transaction history

### Settings & Review (profile menu)

- **Category CRUD** — keyword editor, icon and colour picker, needs/wants/neutral classification
- **Merchant overrides & aliases** — view/delete learned mappings, edit display aliases with a rule-impact preview
- **Feature toggles** — budgets, goals, trips, subscriptions
- **Connections** — Gmail re-auth, Apple Wallet webhook credential management
- **Review** — unresolved money/classification, undated records, refund matches, possible duplicates, all with evidence

The dashboard is **fully responsive** (iPhone, iPad, desktop) and **PWA-ready** — "Add to Home Screen" opens fullscreen on iOS.

---

## iOS Shortcut setup (Apple Wallet auto-capture)

This sets up an iOS Automation that **automatically fires** whenever an Apple Wallet transaction occurs. The Shortcut extracts transaction details (date, card, merchant, amount) and POSTs them as JSON to your server webhook.

### Part A: Create the automation

1. Open the **Shortcuts** app on your iPhone
2. Go to the **Automation** tab → tap **"+"** → **"Create Personal Automation"**
3. Scroll down or search for **"Transaction"** → select it
4. **Select the cards** you want to automate
5. Leave all **categories** checked
6. Don't filter on **Merchants**
7. Select **"Run Immediately"**
8. Leave **"Notify When Run"** off
9. Tap **"Next"** → **"New Blank Automation"**

### Part B: Date, Card, and Merchant (4-5 actions)

**Action 1 — Format the Date:**
- Search **"Format"** → choose **"Format Date"**
- Set Date to **"Current Date"**
- Set format to **Custom**: `dd/MM/yyyy HH:mm:ss`

**Action 2 — Escape quotes in Card:**
- **"Replace Text"**: replace `"` with `\"` in **Shortcut Input → Card or Pass**

**Action 3 — Set Card variable:**
- **"Set Variable"**: name `Card`, value = **Updated Text** from Action 2

**Action 4 — Escape quotes in Merchant:**
- **"Replace Text"**: replace `"` with `\"` in **Shortcut Input → Merchant**

**Action 5 — Set Merchant variable:**
- **"Set Variable"**: name `Merchant`, value = **Updated Text** from Action 4

### Part C: Send to server (2 actions)

**Action 6 — Build JSON:**
- **"Text"** action with:
```json
{"card":"Card","date":"Formatted Date","merchant":"Merchant","amount":"Amount"}
```
- Replace `Card`, `Formatted Date`, and `Merchant` with the magic variables from Actions 3, 1, and 5
- Replace `Amount` with the **raw** magic variable **Shortcut Input → Amount** (not a Set Variable — tap the Amount placeholder and select the original Shortcut Input directly)

The server handles all currency parsing automatically — iOS sends the raw amount string (e.g. `"PLN 3.78"`, `"£12.50"`, `"S$9.90"`, or a bare `"12.50"` for SGD).

**Action 7 — POST to server:**
- **"Get Contents of URL"**
- URL: `https://YOUR-SERVER/webhook/apple-wallet`
- Method: **POST**
- Headers: `Content-Type: application/json`
- Request Body: **File** → the Text variable from Action 6

### Testing

1. Tap **play** to test manually
2. Add a temporary **"Show Result"** after the Text action to inspect the JSON
3. Make a real purchase and verify:
   - Check `logs/app.log` for `POST /webhook/apple-wallet - 200`
   - Send `/today` to the Telegram bot
4. Expect to refine over the first few purchases

---

## Testing

```bash
pip install -r requirements-dev.txt
python3 -m pytest tests/ -v
```

All tests use in-memory SQLite — no database files created on disk. 1454 backend tests across all modules; the frontend has 223 tests of its own (`cd src/web/frontend && npx vitest run`).

---

## Project structure

```
cashe/
├── src/
│   ├── main.py              # Entry point — starts all services
│   ├── db.py                # Opens a user DB / app.db: baseline tables, then src/migrations.py
│   ├── config.py            # Config loader + env-var fallback
│   ├── storage.py           # SQLite CRUD, queries, budgets, goals, trips, merchants, health score
│   ├── money.py / canonical_money.py  # Canonical integer-minor-unit money domain
│   ├── spending_facts.py    # Shared day/week/month facts engine (web + Telegram)
│   ├── forecast.py          # Weekday-median forecast with historical scenario bands
│   ├── categorizer.py       # Keyword matching + merchant overrides
│   ├── analytics.py         # Velocity, anomaly detection, comparison, merchant trends, reports
│   ├── ingestion.py         # IngestionPipeline — single ingest path (dedup → exchange → categorize → store → trip → recurring)
│   ├── transaction_commands.py / transaction_validation.py  # Shared create/correct/delete path (web + Telegram)
│   ├── user_manager.py      # UserManager — central registry of per-user UserContext objects
│   ├── gmail_poller.py      # Gmail API polling + HTML extraction
│   ├── telegram_bot.py      # All Telegram commands + inline keyboards + notifications
│   ├── webhook.py / wallet_capture.py  # Apple Wallet webhook + durable capture
│   ├── exchange.py          # Exchange rate fetching + 24h caching
│   ├── recurring.py         # Recurring transaction detection
│   ├── subscriptions.py     # SubscriptionMatcher — daily job for upcoming-transaction lifecycle
│   ├── llm_service.py       # LLMService wrapping Gemini Flash; None unless gemini_api_key + gemini_policy_confirmed are set
│   ├── backups.py           # Encrypted SQLite backup/restore CLI
│   ├── parsers/
│   │   ├── base.py          # BankParser abstract class
│   │   ├── dbs_paylah.py    # DBS PayLah! email parser (with time extraction)
│   │   ├── uob.py           # All UOB alert email formats — card, transit, reversal, PayNow, transfer, NETS
│   │   └── apple_wallet.py  # Apple Wallet webhook parser
│   └── web/
│       ├── app.py           # FastAPI routes — dashboard API + SPA serving
│       ├── admin_app.py     # FastAPI admin panel (mounted at /admin) — user CRUD + password reset
│       ├── auth.py          # Thin shim delegating to AdminStorage for session create/verify/destroy
│       ├── dist/            # Pre-built React SPA (committed, served by FastAPI)
│       └── frontend/        # React source (Vite + Tailwind + shadcn/ui)
│           ├── src/
│           │   ├── pages/
│           │   │   ├── HomePage.tsx
│           │   │   ├── TransactionsPage.tsx  # Activity
│           │   │   ├── PlanPage.tsx
│           │   │   ├── ExplorePage.tsx / ExplorePatternsPage.tsx / ExploreDetailPages.tsx
│           │   │   ├── MerchantsPage.tsx     # drill-down only, not a nav destination
│           │   │   ├── ReviewPage.tsx / EvidencePage.tsx
│           │   │   ├── SettingsPage.tsx
│           │   │   └── AdminPage.tsx / OnboardingPage.tsx / SetPasswordPage.tsx
│           │   ├── components/  # Shared UI components (TransactionDetail, ActiveTripCard, …)
│           │   ├── lib/         # chartTheme.ts, utils.ts
│           │   ├── api/         # Typed v2 API client layer
│           │   └── hooks/       # Data-fetching hooks (React Query)
│           └── vite.config.ts
├── tests/                   # 1454 backend tests, all in-memory SQLite (74 files) — key ones:
│   ├── test_storage.py
│   ├── test_spending_facts.py
│   ├── test_money.py
│   ├── test_ingestion.py / test_ingestion_outbox.py
│   ├── test_transaction_commands.py
│   ├── test_r04_exit_check_parity.py   # cross-surface money-parity regression suite
│   ├── test_categorizer.py
│   ├── test_parsers.py
│   ├── test_analytics.py
│   ├── test_health_score.py
│   ├── test_trips.py / test_budgets.py / test_goals.py
│   ├── test_subscriptions.py / test_subscription_*.py
│   ├── test_forecast.py
│   ├── test_recurring.py / test_durable_recurring_suggestions.py
│   ├── test_exchange.py
│   ├── test_gmail_poller.py
│   ├── test_telegram_bot.py / test_telegram_*.py / test_morning_digest_facts.py
│   ├── test_llm_insight_generation.py / test_llm_service.py
│   ├── test_webhook.py
│   ├── test_web_api.py / test_web_auth.py / test_web_security.py
│   ├── test_user_manager.py
│   ├── test_admin_app.py / test_admin_storage.py
│   ├── test_db_audit.py / test_migrations.py / test_repair_orphans.py
│   └── test_config.py
├── scripts/
│   └── gmail_auth.py        # One-time Gmail OAuth flow
├── Dockerfile               # Multi-stage build — Node builds frontend, Python runs it
├── requirements.txt         # Production Python deps
├── requirements-dev.txt     # Test/dev deps (pytest etc.)
├── config.example.yaml      # Config template with placeholder values
├── docs/
│   └── setup-guide.md       # Detailed setup + troubleshooting
└── CHANGELOG.md
```

---

## Troubleshooting

### Gmail

| Issue | Solution |
|-------|----------|
| Auth fails | Delete `token.json` and re-run `scripts/gmail_auth.py` |
| "This app isn't verified" | Click Advanced → Go to app. Add your Gmail as Test User in OAuth consent screen |
| No transactions appearing | Check `logs/app.log` for parser errors. Verify sender filters match actual email senders. Emails must be **unread** in Gmail |
| DBS emails not parsing | The parser uses the real `Amount: SGD8.20` / `To: MERCHANT` format. If emails look different, check `raw_data` in the database |

### Telegram

| Issue | Solution |
|-------|----------|
| Bot doesn't respond | Verify `bot_token`. Send `/start`. Check logs for errors |
| Unknown command | Bot shows available commands for any unrecognised input. Type `/help` for the full list, or `/menu` for buttons |
| `/add` gives "Invalid format" | Format: `/add 12.50 MerchantName [category] [YYYY-MM-DD]`. Amount must be a positive number |
| `/recategorize` says category not found | Use exact category names. Type `/recategorize` alone to see available categories |
| Inline buttons not appearing | Ensure `bot_token` is correct and `post_init` ran successfully — check logs for `Registered Telegram command menu` |

### Web dashboard

| Issue | Solution |
|-------|----------|
| Login fails | Regenerate password hash: `python -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"` |
| Charts empty | No transactions in the selected period. Try a wider date range or add transactions first |
| 401 on API calls | Session expired — you will be redirected to login automatically. Sessions last 30 days |
| Can't add/edit categories | Settings is behind the profile menu |
| Explore shows no comparison | Requires at least two periods of transactions for comparison. Add historical entries first |

### Apple Wallet / iOS Shortcuts

| Issue | Solution |
|-------|----------|
| Automation doesn't fire | Settings → Shortcuts → Advanced → enable "Allow Running Scripts". Check Focus modes |
| Server returns 400 | Add "Show Result" to inspect JSON payload. Verify amount is a number and merchant is not empty |
| Server unreachable | Verify the domain (`https://cashe.yourdomain.com`) resolves and the Cloudflare Tunnel is connected |
| Duplicate transactions | Server deduplicates by `source_id` (unique constraint); re-sent webhooks are silently ignored |

### Database

| Issue | Solution |
|-------|----------|
| SQLite locked errors | WAL mode is enabled by default. Ensure only one process accesses the DB file |
| Missing columns after update | Run `python src/main.py` once — migrations run automatically (`ALTER TABLE` adds missing columns) |

### Oracle Cloud / Docker

| Issue | Solution |
|-------|----------|
| Container won't start | Run `docker compose logs app` — check that `config.yaml` and `credentials.json` are present in the repo root on the VM |
| Gmail not authenticating | Verify `token.json` is in `data/` on the VM; re-run `python scripts/gmail_auth.py` locally and SCP the new `token.json` |
| Tunnel not connecting | Run `docker compose logs cloudflared`. Check `TUNNEL_TOKEN` in `.env`. The tunnel should show as healthy in Cloudflare Zero Trust |
| Database lost on redeploy | It shouldn't be — `data/` is bind-mounted. Use `docker compose down` (not `--volumes`) to stop without wiping it |

---

## Git workflow

```
feature/xxx ──merge --no-ff──> develop ──test──> main (tagged release)
```

- **feature branches** — all development work, always branched from `develop`
- **develop** — integration testing branch, merge commits required (`--no-ff`)
- **main** — production releases only, each tagged with a version number

---

## Documentation

- **[docs/setup-guide.md](docs/setup-guide.md)** — Full setup walkthrough with Telegram, Gmail, Oracle Cloud deployment, and troubleshooting
- **[docs/design-language.md](docs/design-language.md)** — Brand, voice, tokens, and component reuse rules for the web dashboard and Telegram bot
- **[CHANGELOG.md](CHANGELOG.md)** — Version history
- **[AGENTS.md](AGENTS.md)** — AI agent context and architecture notes

---

## License

Private project. All rights reserved.
