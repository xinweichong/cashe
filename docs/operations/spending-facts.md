# Spending facts compatibility slice

`src/spending_facts.py` is the shared read-only reporting interface for the new client. `Storage.get_day_spending_facts()`, `Storage.get_month_spending_facts()`, `Storage.get_week_spending_facts()`, and `Storage.get_spending_evidence()` run it under the per-user database lock. Home and Telegram /today, /yesterday, /week, /month, and /balance consume these shared facts. Scheduled weekly/monthly Telegram summaries also use these facts. Other dashboard reports and the morning Telegram digest retain their legacy interfaces; moving those consumers happens in later slices.

Authenticated endpoints:

- `GET /api/v2/spending/day?as_of=2026-09-08`
- `GET /api/v2/spending/month?as_of=2026-09-06`
- `GET /api/v2/spending/week?as_of=2026-09-09`
- `GET /api/v2/spending/evidence?start=2026-09-01&end=2026-09-06&measure=spending&category=Food&limit=50&offset=0`

The month response includes the full month-to-date period, a separate comparable current period, the previous comparable period, and category contributions to the spending change. Both comparison windows have the same number of calendar days. For March 31 against a 28-day February, the comparison uses March 1–28 and February 1–28; the main current total still includes March 29–31.

The week response uses the same contract and calculations. Its current period starts Monday and ends on `as_of`; the previous period covers the same weekdays seven days earlier. A Wednesday query compares Monday–Wednesday with the preceding Monday–Wednesday, including across month/year boundaries.

For a total, query evidence using that period's `start` and `end`. For a category contribution, query both comparable periods with its `category`. `measure` accepts `spending`, `income`, and `unresolved`. Evidence is paginated, includes transaction IDs for details, and uses the same conversion/classification functions as the totals. It excludes raw payloads and internal source identifiers.

Amounts are SGD integer minor units computed with Decimal and half-up rounding **per transaction**. This is identified by `money_basis=legacy_values_rounded_per_transaction`; it is not an audited integer-money storage migration. Summing the signed evidence amounts reproduces the corresponding known subtotal. These rules apply:

- NULL transaction types remain expenses. Explicit refunds reduce spending when received, and explicit transfers are excluded. Existing income records are not reclassified. Refund linking, split commands, and settlement-amount storage remain future work.
- Income and recorded net flow are absent when no income observations exist. Negative recorded net flow remains visible. Net flow is suppressed when unresolved records prevent a reliable calculation.
- Native SGD ignores historical exchange-rate columns. Other currencies with a finite positive stored rate other than `1.0` are labeled `indicative`; their conversion date/source cannot be recovered from the legacy schema.
- Missing, invalid, non-positive, or `1.0` foreign rates are `unresolved`. Legacy `1.0` may have been a silent fallback, so it cannot establish a valid conversion, even for a currency that could legitimately trade at parity. These amounts are excluded from known subtotals. No rate is fetched or fabricated by this interface.
- Unknown classifications and invalid monetary values make a period partial. Consumers must display `partial`/`indicative` status alongside subtotals. A partial known subtotal of zero must not be presented as zero spending.
- Undated/unparseable observations are counted separately in `undated_count` and make comparisons unavailable because their reporting period is unknown. The unresolved evidence view includes those observations for review, even though they cannot be assigned to the requested dates.
- Naive stored timestamps follow the configured local calendar. Offset timestamps are projected into the configured timezone before period membership is determined. The default `as_of` date uses `local_now(timezone)`; the server passes its configured timezone into the new API.

A period's `complete` status means its selected monetary values are resolved by these rules. It does **not** establish source completeness or mailbox freshness. Source-health information must accompany the eventual Home briefing. Category changes are suppressed when either comparable period is partial.

Storage is unchanged by these endpoints. Audited integer-money conversion, settlement precedence, explicit FX provenance, migration of legacy report consumers, forecast inputs, and the new Home UI remain open in the plan.

## Spending review

Authenticated `GET /api/v2/spending/review?limit=50&offset=0` lists unresolved records across all dates, including older and undated observations. It shares selection and conversion rules with unresolved spending evidence. Transfers and usable indicative conversions are excluded; legacy NULL types remain expenses. Each item exposes only its transaction ID, merchant, category, projected date, and reason codes:

- `missing_date`: missing or unreadable transaction date.
- `unresolved_money`: the original amount or retained conversion cannot produce a reporting amount.
- `unknown_type`: classification is not expense, income, or refund.

Reasons can coexist. Missing dates alone do not imply missing FX. The response includes `total`, `limit` (1–100), and `offset`; listing is read-only and does not mark records resolved. Corrections/deletions change membership automatically. The Review screen preserves its spending-page URL through transaction details and refreshes after transaction mutations. Transaction details support exchange-rate, date, and spending/income classification corrections. Dates accept `YYYY-MM-DD` or a full ISO timestamp, retaining any supplied offset. Date-only corrections normalize to midnight in the legacy ledger without inventing time precision on source evidence. Invalid date/type corrections reject the whole update, including any remembered category rule. Unchanged fields and source observations remain intact. Refund linking, transfer workflows, and a complete shared creation/correction command interface remain open.

This is an all-history scan using the legacy facts calculation, with bounded response pages. It is not an indexed queue or a completion audit, and does not include uncertain duplicates, unknown merchants, refund matches, or recurring suggestions yet.

Monetary corrections in transaction details accept non-negative finite original amounts, three-letter currency codes, and positive finite rates. Blank rates are explicitly unknown (`NULL`), never replaced with `1`. Changing currency clears a stale foreign conversion unless a replacement is supplied; switching to SGD sets its native rate to `1`. A foreign rate of `1` remains unresolved under the legacy compatibility rules. Currency validation checks format, not registry membership. Invalid monetary updates reject all fields and any remembered merchant rule. These controls do not implement integer-money storage, settlement precedence, or migrate the remaining legacy reports and automated capture paths.

Web and Telegram manual creation now share the same numeric/date normalization through `Storage.create_manual_transaction`. Missing foreign rates stay unresolved; native SGD uses 1. Web callers receive 400 for invalid creation input and 409 for duplicate generated source IDs. Telegram rejects invalid entries without success messages or trip assignment; failed NL confirmation retains Edit/Cancel actions. The supplied NL date/timestamp is preserved rather than adding the current time. Existing source-ID conventions remain unchanged; request idempotency is still separate work.

Accepted manual entries retain a private snapshot of command fields after caller parsing/categorization, in the same SQLite commit as the transaction and requested trip job. The snapshot preserves the supplied date, currency, amount/rate representation, merchant, description, category, and type. It is not raw Telegram text or HTTP request data. Invalid entries create no observations. Processed `manual:1` snapshots survive correction/deletion and are excluded from capture replay. Unknown timestamp precision prevents newly retained manual evidence from silently enabling automatic Wallet/email matching. The provenance API exposes only the manual/cash channel and retained-evidence flag; it never returns the snapshot. Legacy manual entries remain without snapshots.

Telegram `/add`, `/cash`, and confirmed NL entries retain their existing active-trip assignment behavior through the ingestion outbox. If enabled and active, the destination trip ID commits atomically with the manual transaction. Immediate dispatch and the existing two-minute worker share the same per-user lock, retry limits, and Review follow-up recovery endpoints. A failed assignment does not undo capture or prevent the command's confirmation; deleted trips/transactions are skipped. Later activation of another trip does not redirect the job. Web manual entries and `/income` retain their existing no-auto-trip behavior. Manual confirmation messages remain direct replies, not outbox notifications; historical-import suppression and the broader shared command interface remain open.

## Synthetic performance baseline

Run the reproducible benchmark without providing any real database path:

```sh
python -m scripts.benchmark_spending_facts
python -m scripts.benchmark_spending_facts --history-days 6 --runs 3
```

It creates and removes a temporary disk SQLite/WAL database using the production schema. Fixture creation is excluded from timings. Each response is serialized separately to measure payload size; timings measure the Storage query/calculation only, excluding HTTP, authentication, and network latency.

Measured on 2026-09-06, macOS arm64, Python 3.12.1, SQLite 3.43.1:

| 100,000-row profile | Monthly facts median | First evidence page median | Later evidence page median |
|---|---:|---:|---:|
| Spread over 240 days; 5 runs | 61.8 ms | 9.7 ms | 9.7 ms |
| Concentrated in 6 days; 3 runs | 466.2 ms | 393.2 ms | 395.5 ms |

Monthly JSON was about 1.6 KB; each 50-row evidence response was under 9.7 KB. These are local warm-cache measurements, not OCI capacity or mobile LCP measurements. No caching or additional indexes were introduced. Evidence payloads are bounded, but calculation still scans/materializes the selected period to share exact timezone/conversion semantics; concentrated periods are the next performance concern if they occur in real usage. Re-run on the deployment hardware before setting service latency targets.


## Telegram period commands

`/week` uses Monday through today; `/month` uses the first of the month through today, in the bot's configured timezone. Both resolve the linked user's Storage, read shared facts and evidence under one lock, and release that lock before sending. They display known SGD spending/income subtotals, absent income, negative recorded net flow, unresolved/indicative status, and the exact comparable date windows. Monetary formatting uses the shared integer minor units without recomputing float totals.

Reports include the three largest category changes and up to 50 spending plus 50 income evidence records, with explicit shown/total counts and an Activity pointer when truncated. Evidence includes projected dates, signed refund amounts, unresolved conversions, and transaction IDs; no raw payload or source identifier is included. Totals are not truncated with the evidence list. Recorded-data status does not establish capture completeness.

These commands no longer append legacy budget-pace advice. The morning digest is outside this migration; its compatibility limits remain. This change does not migrate money storage.


## Scheduled Telegram period reports

The existing Sunday 08:00 schedule now reports Monday through the local send date, including only data recorded so far that Sunday. The first-of-month 08:00 schedule reports the completed previous calendar month, including December/January and leap-year boundaries. It does not report the new month's first day. Interactive `/month` continues to report the current month to date.

Both jobs use the bot's configured local calendar and the same facts formatter as the commands. Notifications retain monetary status, unresolved counts, negative recorded net flow, and exact comparison windows, but omit transaction lists and cap displayed category names at 80 characters. No evidence query is needed for this compact output. Existing per-user scheduling and notification transport remain in place; durable scheduled delivery is not added.

Scheduled weekly/monthly reports no longer generate or append legacy AI narratives. Existing cached insight rows and their timestamps remain available through the legacy read endpoints; they are not refreshed by these jobs. Optional daily AI generation is unchanged. Free-only AI verification, usage controls, privacy minimization, and the remaining legacy report migrations are still pending.


## Telegram recorded flow

`/balance` now reads the current month from the shared facts interface in the bot's configured timezone. It shows recorded income, spending, and **recorded net flow**; it does not claim an account balance. Missing income is absent rather than zero, explicitly recorded zero income remains zero, and negative flow is retained. Unresolved money/classification or undated records produce partial known subtotals and suppress net flow. Indicative conversions remain labeled.

The empty-month response retains navigation and shows recorded zero spending with absent income. It does not infer successful capture or invent a net-flow figure. This command does not query the legacy balance calculation. The morning digest, daily optional AI, remaining dashboard reports, and money-storage migration remain separate work.


## Daily spending facts and commands

`GET /api/v2/spending/day?as_of=2026-09-08` returns the same authenticated response contract as week/month. Its current period contains only the requested local date; its comparison contains only the same weekday seven days earlier. The intervening days do not contribute to either total. The default date comes from the configured local calendar, and dates without a representable preceding weekday return 422.

`/today` and `/yesterday` use this shared calculation and the existing evidence formatter. They retain partial/indicative status, absent income, signed refunds, excluded transfers, negative recorded net flow, undated-observation warnings, and up to 50 evidence records per measure with explicit counts. Legacy daily budget-pace advice is removed. The morning digest's combined totals/alerts/cached prose and daily AI generation remain pending migration; this slice adds no cloud calls or storage migration.
