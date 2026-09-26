# Cashe — understand your spending in seconds

## 1. Direction and success criteria

Turn Cashe into a personal finance companion that automatically explains your spending, shows what is coming next, and asks for your attention only when it needs help.

The defining experience should be: **open Cashe, understand what changed, and know whether anything needs doing—all within 30 seconds.**

Your decisions shape this plan:

- Individual users with private data; no shared expenses or household features.
- Spending, income, bills, subscriptions, goals, and trips; no account balances, investments, or net worth.
- Automatic trends and explanations first. Budgets remain optional.
- Redesigned web app for daily use, including installation on iPhone/iPad Home Screens.
- A cross-platform native app later.
- Near-zero infrastructure cost and strictly free AI usage.

Keep the Python backend, SQLite, bank parsers, React, and existing finance capabilities. The substantial changes belong in how financial information is captured, interpreted, and presented.

The repository already contains useful foundations: multi-user isolation, subscription matching, learned categories, optional Gemini summaries, optimistic transaction edits, and route splitting. The frontend’s 33 tests and production build pass; 17 focused backend ingestion tests also pass. This plan builds on those foundations.

The review found gaps that justify deeper changes:

- Gmail messages can be marked read before their transactions are stored.
- Duplicate detection can confuse different historical purchases or currencies.
- Some reports disagree about legacy transactions.
- Forecasting largely extrapolates spending by elapsed days.
- The interface spreads understanding across six destinations and many cards.
- Home Screen installation exists, but offline data handling does not.

The result should meet these product targets:

| Outcome | Acceptance target |
|---|---|
| Understand this month | Identify the main spending change and its causes within 30 seconds |
| Maintain the data | Under five minutes of corrections per week during a four-week personal pilot |
| Correct a transaction | Change its category within two taps after opening it |
| Trust an explanation | Every amount and comparison opens its supporting transactions |
| Understand uncertainty | Missing sources, unavailable conversions, and estimates are visibly distinguished |
| Keep operating | Capture continues on the server while every client is closed |
| Keep costs controlled | No paid AI fallback or required paid mobile distribution |

## 2. Redesign the product around four destinations

### Home: your money briefing

Replace the current dashboard with a deliberately ordered briefing.

An illustrative first screen:

> **S$1,420 spent this month**\
> S$180 more than the same point last month.\
> Annual insurance accounts for S$150; transport accounts for S$30.
>
> **Coming up:** S$96 in expected charges over the next 14 days.\
> **Needs attention:** 2 transactions to check.

The screen contains:

1. **This month so far:** spending, a fair comparison, and source freshness.
2. **What changed:** up to three explanations, ordered by monetary impact.
3. **Coming up:** confirmed bills and subscriptions, with estimated amounts labeled.
4. **Needs attention:** one compact entry into unresolved items.
5. **Recent activity:** five transactions and a link to the full history.

Income and recorded net flow appear when income data exists. Missing income does not produce a zero-income warning or an unfavorable financial score.

Remove the health score from Home. Replace its prominence with observable facts: increased recurring costs, unusually expensive weeks, or a goal falling behind its contribution schedule.

Every explanation is interactive. Tapping “transport increased” opens the exact comparison and transactions, retaining the date range and filters.

### Activity: one dependable transaction history

Make this the place for searching, correcting, and understanding individual purchases.

- Group transactions by day, with daily totals.
- Search merchant names, descriptions, amounts, and categories.
- Offer filters for spending, income, refunds, transfers, source, trip, and review status.
- Use readable merchant names while preserving the original description in details.
- Show source provenance: one purchase can have both Wallet and email evidence.
- Support bulk categorization, category splits, refund linking, and marking a transfer.
- Preserve filters, selection, and scroll position when opening or closing details.
- Provide undo for reversible corrections.

Quick entry starts with amount and merchant. Currency, date, category, notes, and trip appear through progressive disclosure. Cash becomes a payment/source choice within an expense, rather than a competing transaction type.

When changing a category, offer an explicit choice:

- Apply to this transaction.
- Remember for future matching transactions.

Existing learned rules continue working. Corrections should never silently become global rules.

### Plan: upcoming commitments and optional intentions

Consolidate subscriptions, recurring bills, budgets, goals, and trips into a coherent planning area.

The default view is an upcoming timeline. Each charge shows its expected date, amount or range, and whether it is confirmed or inferred.

- Confirm a detected recurring purchase once, then maintain its schedule automatically.
- Match actual transactions to expected charges so they are counted once.
- Surface price increases and annual renewals.
- Let users dismiss, pause, or correct a prediction.
- Keep cancellation tracking descriptive; marking a subscription canceled in Cashe does not cancel it with the provider.

Budgets remain an optional layer. A user can add one overall spending target without configuring every category.

Goals distinguish amounts recorded as contributed from suggested future contributions. Goal projections use contribution dates and elapsed time.

Trips provide their own spending view and can be excluded from the usual-spending baseline without disappearing from actual totals.

Add lightweight scenario previews:

- What would my forecast look like without this one-off purchase?
- What would reducing this category by S$100 change?
- How would removing this subscription change annual commitments?

Scenarios never modify transactions or claim to know a bank balance.

### Explore: answer specific questions

Merge Analytics and Merchants into a single exploration area.

Start with useful questions:

- Where did the increase come from?
- Which recurring costs changed?
- What does a normal week look like?
- Which merchants account for most of this category?
- How did this trip affect the month?

Use ranked bars for comparisons, lines for changes over time, and transaction lists for evidence. Merchant profiles become drill-downs rather than a primary navigation destination.

Settings move behind the profile menu. Review remains accessible from Home and Activity.

Preserve old links through redirects:

| Existing destination | New destination |
|---|---|
| Overview | Home |
| Transactions | Activity |
| Finance | Plan |
| Analytics | Explore |
| Merchants | Explore → merchant |
| Settings | Profile → Settings |

### Visual and interaction direction

Retain the Cashe name, icon, and recognizable teal accent. Simplify the surrounding presentation.

- Introduce complete light and dark themes, following system preference by default.
- Use neutral surfaces, stronger typography, and restrained category color.
- Reserve gradients for limited brand moments.
- Present important amounts immediately; avoid repeated count-up animations.
- Use approximately 16px body text on phones and minimum 44px touch targets.
- Correct text contrast. The current muted token measures approximately 4.0:1 on card backgrounds, below the normal-text AA target.
- Make loading, empty, failed, stale, offline, and estimated states distinct. Failed data must never render as a genuine zero.
- Support keyboard navigation, screen readers, enlarged text, and reduced motion.

On phones, use four bottom tabs, accessible quick-add controls, and bottom sheets for short tasks. Longer edits get a full screen.

On iPad and desktop, use adaptive list/detail layouts. Home and Explore get natural page scrolling; Activity retains independently scrolling list/detail panels and persistent actions. This deliberately revises the current universal desktop “no page scrolling” rule.

Update the design language and agent instructions alongside these changes so future work follows the new patterns.

## 3. Make the financial information dependable

### Reliable capture and a small review inbox

Deepen the existing ingestion module so every source follows one dependable path:

**receive → persist source event → parse → reconcile → save transaction → run follow-up work**

Gmail, Wallet, manual entry, Telegram, and imports use the same transaction rules.

Implement:

- Durable source events with processing status, source identity, parser version, and linked transaction.
- Gmail ingestion independent of unread status.
- Paginated initial synchronization, persisted progress, and incremental synchronization.
- Retryable processing after crashes or temporary failures.
- Explicit failed/unrecognized events instead of silent omission.
- Idempotent poller startup and recorded job completion.
- Notifications and recurring analysis after persistence, with retryable follow-up work.

Use Gmail history checkpoints for incremental synchronization and a bounded resynchronization when history expires, as required by Google’s synchronization behavior. Start with 90 days of history by default and offer older backfills explicitly. [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)

Duplicate handling needs two levels:

- Exact source identity prevents processing the same observation twice.
- Cross-source matching uses transaction date/time, currency, amount, merchant, and available payment identifiers.

Strong matches link evidence to one purchase. Ambiguous matches enter review. Date-only statement rows and different currencies must not be collapsed by a loose timing heuristic.

Preserve existing source IDs, including the Wallet hash convention, for compatibility. New reconciliation metadata supplements them.

The review inbox handles uncertain duplicates, unknown merchants, missing conversions, refund matches, and recurring suggestions. It should explain each issue and offer one clear resolution. Successfully captured transactions require no daily confirmation.

### One spending-facts module

The architecture review points to a useful simplification: put monetary interpretation, reporting periods, comparisons, and forecast inputs behind one shared interface.

Web, Telegram, and future native clients must consume the same answers.

Define these rules:

- Expense totals include legacy NULL-type expenses.
- Transfers and card repayments can be excluded from spending without introducing an account ledger.
- Refunds reduce net spending when received and can link back to the original purchase.
- Category splits must sum exactly to their parent transaction.
- Income minus spending is labeled **recorded net flow**. Negative values remain visible.
- All reporting follows the user’s configured calendar/timezone.
- Current-month comparisons use equivalent elapsed periods; weekly comparisons align weekdays.
- Unavailable exchange rates stay unresolved. Never silently substitute `1.0`.
- Actual statement settlement amounts take precedence over indicative currency conversion.

Move stored monetary values to integer minor units, with currency-aware precision. Perform exchange calculations using decimal arithmetic and preserve the conversion’s date, source, and status.

Migrate existing data with an audit report. Preserve historical source evidence and user corrections; do not automatically reinterpret all old income transactions as refunds or transfers.

### Explain first, forecast second

Generate explanations through deterministic calculations:

- Category and merchant contributions to a spending change.
- Changes in purchase frequency versus average purchase size.
- New or increased recurring commitments.
- Identified one-off purchases and trips.
- Comparison with the individual’s own historical pattern.

Forecast month-end spending as:

**recorded spending + unpaid confirmed commitments + estimated remaining variable spending**

For the first implementation:

- Estimate variable spending using weekday medians from the preceding eight complete weeks.
- Require at least four complete weeks before showing the variable-spending forecast.
- Remove confirmed recurring charges from that baseline because they are modeled separately.
- Exclude only explicitly marked exceptional periods/purchases from the baseline; retain them in actual totals.
- Show lower/upper historical scenarios, labeled as scenarios rather than statistical confidence intervals.
- Suppress or qualify forecasts when capture gaps or unresolved currency conversions materially affect them.

“Sources checked recently” is a freshness statement, not proof that every purchase was captured. Statement imports provide an additional completeness check.

An optional spending target can show “remaining against your target.” Without balances and reconciled obligations, Cashe should not call this “safe to spend.”

### Imports and receipt capture

Add CSV import before sophisticated receipt automation.

The flow is:

**select statement → choose saved mapping → preview → review overlaps → import → reconcile**

Provide presets for available DBS/UOB statement formats, backed by sanitized fixtures. Preserve legitimate repeated transactions; identical-looking rows are not automatically duplicates.

Each import gets a batch identifier, row-level results, and an undo operation that removes newly created records without deleting pre-existing transactions it matched. Historical imports must not generate a burst of notifications or join today’s active trip.

For receipts:

- Capture or upload a photo.
- Perform OCR locally on the existing server.
- Extract likely merchant, date, currency, and total into an editable draft.
- Require confirmation before creating a transaction.
- Discard the image after extraction or expiry; retain the confirmed fields and necessary provenance.
- Fall back to manual completion when extraction is uncertain.

Use Tesseract for the initial local OCR implementation, with bounded image sizes and one OCR job at a time. Its extraction quality must be tested against actual receipt formats. [Tesseract documentation](https://tesseract-ocr.github.io/tessdoc/)

### Interfaces, persistence, and recovery

Introduce typed, authenticated `/api/v2` interfaces for the redesigned client while retaining compatibility adapters for existing routes.

The minimum additions are:

| Interface/type | Responsibility |
|---|---|
| `Money` | Integer minor-unit amount and currency |
| `Transaction` | Classification, provenance, conversion status, revision, and optional split/refund links |
| `HomeBriefing` | Totals, comparisons, explanation evidence, upcoming charges, freshness, and review count |
| `Forecast` | Actuals, commitments, estimated component, scenarios, assumptions, and unavailable reason |
| Review/import interfaces | Preview, resolve, retry, confirm, and batch results |
| Transaction commands | Shared validation, idempotent creation, corrections, and downstream effects |

Use explicit response models. Raw emails, OAuth credentials, and internal storage columns do not belong in ordinary client responses.

Retain SQLite/WAL and per-user databases. Introduce ordered, versioned migrations and run those same migrations in tests. Check existing orphaned references before consistently enabling foreign keys.

Add encrypted off-host backups covering the admin database, user databases, and protected connection credentials. Use SQLite’s backup API rather than copying live database files. Keep 30 daily and 12 monthly snapshots while within storage limits, and test restoration into an isolated environment.

Before expanding intake, add revocable Wallet credentials, random expiring OAuth state bound to the initiating session, user-login rate limiting, and consistent authorization on private routes. Existing Wallet shortcuts need a guided credential upgrade before unauthenticated intake is disabled.

## 4. Free AI, inexpensive hosting, and the native path

### Keep AI completely free

Verified from the repository: Gemini summaries and natural-language transaction extraction exist; receipt-photo extraction does not.

The code defaults to `gemini-2.0-flash`, which Google lists with a June 1, 2026 shutdown date. The deployed model and project billing tier remain unverified because they are external account settings. [Model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations)

Use `gemini-2.5-flash-lite` as the initial replacement candidate: its current pricing includes free text/image input and text output. Validate its output against Cashe fixtures before enabling it. Actual quotas must come from the project’s AI Studio limits, not an assumed public allowance. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

Apply a strict operating policy:

- Use a verified Free Tier project with billing unlinked.
- If free status is unverified, continue with deterministic functionality until verified.
- Persist request/token usage and respect the project’s actual limits.
- Prioritize user-requested assistance over background prose generation.
- Generate at most one daily narrative per user; weekly/monthly narratives run once per period.
- Cache by underlying facts and share the result across web and Telegram.
- Stop on exhausted quota; never switch to a paid model or rotate projects to evade limits.
- Disable optional AI if free availability disappears.

Google documents billing tier at project level; an API key alone does not prove free usage. [Billing documentation](https://ai.google.dev/gemini-api/docs/billing)

There is also a concrete privacy constraint: Google’s unpaid-service terms permit product-improvement use and say not to submit sensitive, confidential, or personal information. Consequently, the free-only design keeps raw receipts, bank emails, and personal financial text local. Any cloud-generated wording uses non-sensitive abstract patterns and placeholders, with personal values inserted locally. If information cannot be sufficiently minimized, use built-in wording. [Gemini data terms](https://ai.google.dev/gemini-api/terms)

The core product remains intelligent without a model call: calculations, drivers, forecasts, search, and recurring detection all run locally. Gemini improves wording where appropriate; it does not own financial arithmetic or transaction-writing authority.

### Make the web app comfortable on iPhone and iPad

Extend the existing installable shell with:

- A service worker for versioned application assets.
- Optional trusted-device storage for a recent briefing and activity.
- Offline manual-entry drafts, uploaded on reopening/reconnection with idempotency keys.
- Explicit “saved on this device” and “last updated” indicators.
- Cache separation by user and clearing on logout.
- Safe updates that preserve unfinished drafts.
- Opt-in Web Push for useful changes and reconnect alerts.

Do not promise that browser storage is a permanent backup or that offline work uploads while the app is closed.

Home Screen web apps support Web Push on iOS/iPadOS 16.4 and later without Apple Developer Program membership. Request permission after demonstrating value, through an explicit user action. [WebKit documentation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Retain Telegram as an optional capture and notification channel. Default to one weekly briefing; routine transaction notifications are opt-in.

### Keep the backend on the server

Continue with the existing OCI instance, Docker Compose, Cloudflare Tunnel, and SQLite.

Gmail polling, processing, scheduled analysis, backups, and database writes continue independently of any phone. Native iOS background execution is scheduled by the operating system and cannot replace an always-running poller. [Apple background execution guidance](https://developer.apple.com/documentation/BackgroundTasks/choosing-background-strategies-for-your-app)

Add source/job health reporting, bounded retry queues, backup-age monitoring, and an external heartbeat check. Keep raw financial data out of logs.

| Item | Cost policy |
|---|---|
| Existing OCI backend | Stay within the tenancy’s verified free allocation |
| Backup storage | Use R2 Standard’s free allowance |
| Gemini | Verified free tier only |
| Web client | Served by the existing backend |
| Native builds later | Local tools; no required paid build service |

Oracle documents possible reclamation of idle free instances, so recoverability matters even at this scale. Its current Always Free documentation lists 2 OCPUs/12GB for A1 free tenancies; verify the existing tenancy rather than relying on older allowances. [Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

R2 currently includes 10GB-month of Standard storage and free operation allowances. Monitor retained bytes and stop backup accumulation before crossing the configured free-storage ceiling. Existing domain renewal remains a separate cost. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### Native later: TypeScript, React Native, and Expo

Choose **React Native with TypeScript and Expo** for the later iOS, iPadOS, and Android client.

This gives Cashe a shared mobile codebase and carries forward existing React/TypeScript knowledge. Expo’s framework is free and open source; its hosted services are optional. [React Native guidance](https://reactnative.dev/docs/environment-setup)

Share API contracts, formatting, validation, and suitable application logic. Build the mobile interface using native components; existing Radix, DOM, Tailwind, and Recharts screens require mobile equivalents.

Flutter/Dart is a valid alternative with a shared, compiled mobile application, but introduces another language and replaces more of the existing frontend investment. It offers no escape from Apple’s signing requirements. [Flutter architecture](https://docs.flutter.dev/resources/architectural-overview)

The native milestone will include:

- Local SQLite storage and offline transaction entry.
- Credentials in platform secure storage.
- Device sessions with revocation.
- Incremental synchronization with revisions and deletion records.
- Explicit conflicts when another device changed the same transaction.
- Adaptive tablet navigation.
- Camera capture and targeted platform integrations.

Build locally through Xcode and Android tooling; avoid requiring EAS subscriptions. [Expo local builds](https://docs.expo.dev/guides/local-app-overview/)

You can install the iOS app personally without paying Apple, but free provisioning expires after seven days and requires rebuilding/reinstalling. It supports up to three devices. Because you chose not to take on that upkeep, native distribution is deferred; the web release must stand on its own. [Apple Personal Team rules](https://developer.apple.com/help/account/basics/about-your-developer-account)

A native client still uses the same server for continuous capture. Retain Wallet Shortcuts as a supported input; native installation does not automatically grant broad access to financial data.

## 5. Delivery sequence and verification

Deliver through small vertical slices, with the current application usable throughout.

| Phase | Deliverable | Exit condition |
|---|---|---|
| 1. Establish trust | Backups/restore, CI, capture retries, correct dedup, intake authentication, essential reporting fixes | Crash/replay tests pass; restored data boots correctly |
| 2. Ship the new daily experience | Home briefing, four-destination navigation, shared spending facts, accessible light/dark design | Understand the month and open supporting evidence within 30 seconds |
| 3. Reduce maintenance | Review inbox, merchant rules, CSV imports, refunds/transfers/splits, local receipt drafts | Repeated imports and corrections preserve accurate totals |
| 4. Improve foresight | Upcoming timeline, recurring confirmation, weekday forecasts, optional targets/goals, scenarios | Forecast components reconcile and actual charges replace predictions once |
| 5. Complete the mobile web experience | Offline drafts, trusted-device cache, Web Push, onboarding, quota-aware free AI | Airplane-mode, expiry, quota exhaustion, and update tests pass |
| Later. Native client | React Native/Expo client against the same interfaces | Offline/sync/device tests pass; installation upkeep is explicitly accepted |

Allow roughly **10–16 engineer-weeks** for the web transformation, including migration work and real-device verification. This is a planning estimate, not a delivery promise. The first substantial Home redesign should arrive after the trust foundation, without waiting for every later feature.

Use these verification gates:

- **Capture:** read email, paginated history, crashes before/after commit, replay, parser failures, late arrivals, and simultaneous Wallet/email observations.
- **Money:** different currencies with identical numeric amounts; NULL expense types; refunds across months; transfers; split rounding; unresolved FX; negative recorded net flow.
- **Reporting:** equal elapsed periods, Singapore midnight, month/year boundaries, sparse history, source outages, one-off costs, and recurring charges counted once.
- **Forecasting:** rolling historical backtests against the existing straight-line projection; keep simple forecasts until the replacement improves relevant cases.
- **Imports:** overlapping statements, legitimate repeated purchases, interrupted batches, and safe undo.
- **Security:** user isolation, forged/replayed webhook requests, expired OAuth state, session revocation, and offline cache separation.
- **AI:** zero calls without verified free configuration; exhausted quota, invalid output, retired models, redaction, and deterministic fallback.
- **UX:** phone portrait, iPad split view, desktop keyboard use, enlarged text, screen readers, reduced motion, slow networks, and offline/reconnect flows.

Performance targets: fewer initial Home requests, no chart bundle required for the first useful briefing, mobile LCP at or below 2.5 seconds under a defined test profile, and responsive interaction during imports. Benchmark reporting with 100,000 synthetic transactions per user before adding caching or indexes beyond demonstrated needs.

Run the redesigned experience for four weeks on your own account before extending it to other individual users. Track correction time, missed-capture incidents, explanations opened, and whether the briefing answered the question you came with.

Use additive migrations, retained IDs, preview reconciliation reports, and feature flags for the new screens. Validate upgrade and rollback against representative old databases. Database rollback uses a verified snapshot with later accepted source events available for replay.

The release is complete when Cashe reliably turns captured transactions into an understandable personal spending story, with minimal maintenance and no dependency on paid AI or native distribution.
