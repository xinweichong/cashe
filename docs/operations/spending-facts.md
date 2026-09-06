# Spending facts compatibility slice

`src/spending_facts.py` is the shared read-only reporting interface for the new client. `Storage.get_month_spending_facts()`, `Storage.get_week_spending_facts()`, and `Storage.get_spending_evidence()` run it under the per-user database lock. The existing dashboard and Telegram reports still use their legacy interfaces; moving those consumers happens in later slices.

Authenticated endpoints:

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

Reasons can coexist. Missing dates alone do not imply missing FX. The response includes `total`, `limit` (1–100), and `offset`; listing is read-only and does not mark records resolved. Corrections/deletions change membership automatically. The Review screen preserves its spending-page URL through transaction details and refreshes after transaction mutations. Existing exchange-rate editing can resolve a missing conversion; new date/classification correction controls remain part of the shared transaction-command work.

This is an all-history scan using the legacy facts calculation, with bounded response pages. It is not an indexed queue or a completion audit, and does not include uncertain duplicates, unknown merchants, refund matches, or recurring suggestions yet.

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
