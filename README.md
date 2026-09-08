<div align="center">

<img src="cashe-banner.png" alt="cashe" width="640" />

# cashe

### cash, caught.

A privacy-first personal finance app that **automatically captures every transaction** from your bank emails and Apple Wallet — no manual logging, no subscription fees, no data leaving your server.

[![Version](https://img.shields.io/badge/version-2.1.0-00D4AA?style=flat-square)](CHANGELOG.md)
[![Tests](https://img.shields.io/badge/tests-623%20passing-30D158?style=flat-square)](tests/)
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
    <td align="center"><b>Overview</b></td>
    <td align="center"><b>Transactions</b></td>
    <td align="center"><b>Analytics</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/overview.png" alt="Overview page" width="280" /></td>
    <td><img src="docs/screenshots/transactions.png" alt="Transactions page" width="280" /></td>
    <td><img src="docs/screenshots/analytics.png" alt="Analytics page" width="280" /></td>
  </tr>
  <tr>
    <td align="center"><b>Finance</b></td>
    <td align="center"><b>Merchants</b></td>
    <td align="center"><b>Telegram</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/finance.png" alt="Finance page" width="280" /></td>
    <td><img src="docs/screenshots/merchants.png" alt="Merchants page" width="280" /></td>
    <td><img src="docs/screenshots/telegram.png" alt="Telegram bot" width="280" /></td>
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

### Analytics & intelligence

| | |
|---|---|
| **Financial Health Score** | Composite score from savings rate, spending trends, and needs/wants/neutral category breakdown — see it at a glance on Overview and in full on Analytics |
| **Spending Velocity** | Daily pace indicator and projected month-end total based on current trajectory |
| **Merchant Intelligence** | Per-merchant profiles with spend trends, tags (subscription, online, foreign, essential, recurring), notes, and full transaction history |
| **Anomaly Detection** | Unusual spending flagged in yellow with explanatory labels; new merchants highlighted separately |
| **LLM Intelligence** | Optional Gemini Flash integration — AI anomaly explanations on Analytics, natural-language Telegram transaction entry, and AI-generated daily spending insights; disabled when `gemini_api_key` is blank |
| **Recurring Detection** | Automatically identifies subscriptions and regular payments — monthly, weekly, biweekly |
| **Period Comparison** | Current vs previous period charts, category-level breakdown, and change percentages |

### Planning

| | |
|---|---|
| **Budgets** | Monthly per-category budgets with animated progress bars; Telegram alerts at 80% and 100% |
| **Financial Goals** | Savings goals with target amounts and dates, manual contributions, progress rings, and Telegram completion notifications |
| **Subscriptions** | Tracked recurring charges with upcoming-transaction predictions; daily matcher auto-links incoming transactions; match/dismiss flow; possibly-cancelled detection |
| **Trips** | Group any set of transactions into a trip; all new transactions auto-assigned to the active trip across every ingestion path |
| **Income Tracking** | Record income alongside expenses; see recorded income, spending, and recorded net flow via `/balance` |

### Interface

| | |
|---|---|
| **Telegram Bot** | Real-time alerts with inline categorisation, 15+ commands, guided `/edit` and `/delete` flows, daily 8 am digest, and a `/menu` button grid |
| **React Web Dashboard** | Six-page SPA — Overview, Transactions, Analytics, Finance, Merchants, Settings — with viewport-native grid layout, framer-motion spring animations, and full PWA support |
| **Auto-Categorisation** | Keyword matching with learned merchant overrides that persist and hot-reload without a restart |
| **Category Management** | Full CRUD with keyword editor, icon and colour picker, needs/wants/neutral type classification |
| **CSV Export** | Download filtered transactions from the Transactions page |
| **Scheduled Reports** | Daily morning digest, weekly and monthly summary reports via Telegram |
| **Oracle Cloud Deployment** | Runs free on Oracle Always Free ARM VM + Cloudflare Tunnel — no open ports, automatic TLS, custom domain |
| **Privacy-First** | All data stays in your own SQLite database. No third-party data sharing. No telemetry |

---

## Architecture

```
Gmail API ──poll──> Parser Engine ──> SQLite <──> Telegram Bot
                       ^                ^    └──> Analytics Engine
                       │                │    └──> Web Dashboard (React SPA)
iOS Shortcut ──POST──> ┘                │              └── Overview
                                        │              └── Transactions
                                        │              └── Analytics
                                        │              └── Finance (Budgets + Goals)
                                        │              └── Merchants
                                        └── Auto-categoriser   └── Settings
                                            └── Merchant Overrides
                                            └── Recurring Detector
                                            └── Exchange Rates
                                            └── Health Score
```

Single Python process. SQLite with WAL mode. FastAPI for webhooks and the dashboard API. React SPA built with Vite, served from `dist/`.

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
# Edit config.yaml with your token, password hash, and webhook URL

# Gmail OAuth (one-time)
python scripts/gmail_auth.py

# Run
python src/main.py
```

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
```

### Environment variable overrides

All config values can be set via environment variables (for Railway or Docker). When `config.yaml` is absent, the app builds its config entirely from env vars:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `WEB_PASSWORD_HASH` | bcrypt hash for dashboard |
| `PORT` | Server port (Railway sets this automatically) |
| `WEBHOOK_BASE_URL` | Public URL for Apple Wallet webhooks |
| `GMAIL_SENDER_FILTERS` | Comma-separated sender addresses |
| `GMAIL_CREDENTIALS_JSON` | Base64-encoded `credentials.json` |
| `GMAIL_TOKEN_JSON` | Base64-encoded `token.json` |
| `EXPENSE_DB_PATH` | Path to SQLite database |
| `GEMINI_API_KEY` | Google Gemini API key (enables LLM Intelligence features) |

---

## Telegram commands

### Viewing spending

| Command | Description |
|---------|-------------|
| `/today` | Today's spending summary |
| `/yesterday` | Yesterday's spending summary |
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
| `/help` | Full command reference |
| Any unknown text | Bot responds with guidance and available commands |

All commands support **inline keyboards** — post-command action buttons appear automatically so you can drill deeper without typing follow-up commands. Transaction notifications include an inline category selection grid for instant recategorisation.

---

## Web dashboard

Access at `http://your-server:8080`. The dashboard is a React SPA with six pages, all using viewport-native CSS Grid layout on desktop (no page-level scroll) with spring animations powered by framer-motion.

### Overview

- **Period selector** — Day / Week / Month tabs with forward/back date navigation
- **Hero total** — spending total for the period with income/expense split
- **Donut chart** — category breakdown with color-coded legend and tinted rows
- **Trend chart** — daily spending over time; switchable to per-category trend mode
- **Health Score card** — composite financial health score with at-a-glance colour indicator
- **Budget summary card** — progress bars for each active budget (when budgets enabled)
- **Goals summary card** — savings goals progress (when goals enabled)
- **Active trip card** — days elapsed, total spend, and category breakdown for the active trip
- **Income vs expenses chart** — 6-month paired bar chart
- **Recent transactions** — paginated (20/page) with source/card badges and category icon pills

### Transactions

- **Filterable list** — filter by category, source, merchant text, or date range; quick-select chips (Today, This week, This month, Last 30 days, Last 3 months, This year); sort by date, amount, or category
- **Infinite scroll** — loads more as you scroll, no pagination needed
- **Transaction detail panel** — URL-synced side panel (`/transactions/:id`) with edit form, delete, and merchant profile link; action bar always visible (never scrolls off)
- **Add transaction form** — expense, income, cash, or multi-currency entry with `datetime-local` input
- **CSV export** — download all transactions matching current filters

### Analytics

- **Health Score breakdown** — full score card with needs/wants/neutral category breakdown
- **Period comparison charts** — current vs previous period, category-level breakdown
- **Spending velocity ring** — daily pace indicator and projected month-end total
- **Merchant table** — top merchants ranked by spend with period-over-period trend
- **Unusual spend alerts** — highlighted in yellow with explanatory labels
- **New merchant alerts** — flags merchants not seen in the previous period
- **Income vs expenses bar chart** — 6-month income/expense comparison

### Finance

- **Budgets** — create, edit, and delete monthly per-category budgets; animated progress bars; spend and remaining amounts (requires `budgets_enabled` in Settings)
- **Goals** — savings goals with target amount and date; manual contribution entry with date picker; contribution history with edit/delete; progress rings; auto-complete when target is reached (requires `goals_enabled` in Settings)
- **Savings overview** — net monthly savings rate and total saved across all goals

### Merchants

- **Merchant list** — all merchants ranked by total spend with sparkline trend
- **Merchant profile panel** — tags (subscription, online, foreign, essential, recurring), notes, monthly spend chart, and full transaction history with links to transaction detail

### Settings

- **Category CRUD** — create, edit, and delete categories with keyword editor, icon picker, unique color picker, and needs/wants/neutral type classification
- **Merchant overrides** — view and delete learned merchant-to-category mappings
- **Feature toggles** — enable/disable budgets, goals, trips, subscriptions
- **Alert thresholds** — configure unusual-spend and budget alert sensitivity
- **Live reload** — changes take effect immediately without restarting the server

The dashboard is **fully responsive** (iPhone, iPad, desktop), **PWA-ready** — "Add to Home Screen" opens fullscreen on iOS — and **animated** with framer-motion spring transitions throughout.

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

All tests use in-memory SQLite — no database files created on disk. 623 tests across all modules.

---

## Project structure

```
cashe/
├── src/
│   ├── main.py              # Entry point — starts all services, runs DB migrations
│   ├── config.py            # Config loader + env-var fallback
│   ├── storage.py           # SQLite CRUD, queries, insights, income, overrides, budgets, goals, trips, merchants, health score
│   ├── categorizer.py       # Keyword matching + merchant overrides
│   ├── analytics.py         # Velocity, anomaly detection, comparison, merchant trends, reports
│   ├── ingestion.py         # IngestionPipeline — single ingest path (dedup → exchange → categorize → store → trip → recurring)
│   ├── user_manager.py      # UserManager — central registry of per-user UserContext objects
│   ├── gmail_poller.py      # Gmail API polling + HTML extraction
│   ├── telegram_bot.py      # All Telegram commands + inline keyboards + notifications
│   ├── webhook.py           # Apple Wallet webhook + source-ID dedup
│   ├── exchange.py          # Exchange rate fetching + 24h caching
│   ├── recurring.py         # Recurring transaction detection
│   ├── subscriptions.py     # SubscriptionMatcher — daily job for upcoming-transaction lifecycle
│   ├── llm_service.py       # LLMService wrapping Gemini Flash; absent when gemini_api_key is blank
│   ├── parsers/
│   │   ├── base.py          # BankParser abstract class
│   │   ├── dbs_paylah.py    # DBS PayLah! email parser (with time extraction)
│   │   ├── uob.py           # UOB PayNow + UOB Card unified parser (5 patterns, time extraction)
│   │   └── apple_wallet.py  # Apple Wallet webhook parser
│   └── web/
│       ├── app.py           # FastAPI routes — dashboard API + SPA serving
│       ├── admin_app.py     # FastAPI admin panel (mounted at /admin) — user CRUD + password reset
│       ├── auth.py          # Thin shim delegating to AdminStorage for session create/verify/destroy
│       ├── dist/            # Pre-built React SPA (committed, served by FastAPI)
│       └── frontend/        # React source (Vite + Tailwind + shadcn/ui + framer-motion)
│           ├── src/
│           │   ├── pages/
│           │   │   ├── OverviewPage.tsx
│           │   │   ├── TransactionsPage.tsx
│           │   │   ├── AnalyticsPage.tsx
│           │   │   ├── FinancePage.tsx
│           │   │   ├── MerchantsPage.tsx
│           │   │   └── SettingsPage.tsx
│           │   ├── components/  # Shared UI components (TransactionDetail, ActiveTripCard, …)
│           │   ├── lib/         # chartTheme.ts, utils.ts
│           │   ├── api/         # API client layer
│           │   └── hooks/       # Data-fetching hooks (React Query)
│           └── vite.config.ts
├── tests/                   # 623 tests, all in-memory SQLite
│   ├── test_storage.py
│   ├── test_categorizer.py
│   ├── test_parsers.py
│   ├── test_analytics.py
│   ├── test_health_score.py
│   ├── test_ingestion.py
│   ├── test_trips.py
│   ├── test_budgets.py
│   ├── test_goals.py
│   ├── test_merchants.py
│   ├── test_subscriptions.py
│   ├── test_recurring.py
│   ├── test_exchange.py
│   ├── test_gmail_poller.py
│   ├── test_telegram_bot.py
│   ├── test_webhook.py
│   ├── test_web_api.py
│   ├── test_web_auth.py
│   ├── test_web_security.py
│   ├── test_user_manager.py
│   ├── test_admin_app.py
│   ├── test_admin_storage.py
│   ├── test_llm_service.py
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
| Can't add/edit categories | Go to the **Settings** page (gear icon in the header) |
| Analytics page shows no data | Requires at least two periods of transactions for comparison. Add historical entries first |

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
- **[CHANGELOG.md](CHANGELOG.md)** — Version history
- **[AGENTS.md](AGENTS.md)** — AI agent context and architecture notes

---

## License

Private project. All rights reserved.
