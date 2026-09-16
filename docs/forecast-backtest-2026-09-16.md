# Forecast backtest results — 2026-09-16 (R12 sub-project 3)

Rolling-origin comparison of `forecast.month_forecast` (the new weekday-median
method) against `analytics.get_spending_velocity` (the existing straight-line
daily-rate method) on synthetic fixtures with a known true month-end total.
The table sections below are the literal output of
`scripts/backtest_forecast.py` — not hand-edited numbers. Re-run with
`python3 -m scripts.backtest_forecast` to reproduce.

## Methodology

Each scenario builds an isolated in-memory database (`src.main.init_db(":memory:")`),
seeds a controlled transaction history plus a "target month" (September 2026)
whose true final total is known exactly (summed directly from the fixture,
not estimated). At each of 2 rolling-origin cutoff dates (`as_of`) within that
month, both methods are asked to project the month's final total using only
data that would have existed as of that date, and compared against the known
true total. Six scenarios were chosen to match the roadmap's own named cases:
sparse histories, one-offs, outages, trips, refunds, and recurring-heavy
months (a seventh, a *longer* outage, was added after the first outage
scenario turned out not to trigger the failure mode being tested for — see
below).

Neither method is assumed superior going in. Results are reported as
observed, including scenarios where the new method does no better, and one
scenario (the long capture outage) where it does meaningfully *worse* — per
the roadmap's explicit instruction to investigate regressions rather than
assert the median model must always win.

## Results

### Sparse history

Only 2 weeks of account history exist before the target month.

True month total: **$450.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-10 | — | unavailable (insufficient_history) | $450.00 | — | $+0.00 |
| 2026-09-20 | — | unavailable (insufficient_history) | $450.00 | — | $+0.00 |

### One-off spike this month

A single $900 purchase on Sep 2, otherwise steady $15/day history and month.

True month total: **$1350.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-05 | $1350.00 | complete | $5850.00 | $+0.00 | $+4500.00 |
| 2026-09-20 | $1350.00 | complete | $1800.00 | $+0.00 | $+450.00 |

### Trip late in the month

A $80/day trip occurs Sep 25-29 — after both forecast cutoffs, so neither method can see it coming.

True month total: **$775.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-10 | $450.00 | complete | $450.00 | $-325.00 | $-325.00 |
| 2026-09-20 | $450.00 | complete | $450.00 | $-325.00 | $-325.00 |

### Capture outage in history (2 weeks)

Zero transactions Aug 10-23 (simulated outage), steady $15/day otherwise.

True month total: **$450.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-10 | $450.00 | complete | $450.00 | $+0.00 | $+0.00 |
| 2026-09-20 | $450.00 | complete | $450.00 | $+0.00 | $+0.00 |

### Long capture outage in history (5 weeks)

Zero transactions for 5 straight weeks (Jul 27 - Aug 30), steady $15/day otherwise — long enough to move most weekdays' median toward zero.

True month total: **$450.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-10 | $150.00 | complete | $450.00 | $-300.00 | $+0.00 |
| 2026-09-20 | $300.00 | complete | $450.00 | $-150.00 | $+0.00 |

### Heavy refunds

Steady $15/day spend, with a $10 refund every Friday netting against it.

True month total: **$410.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-10 | $410.00 | complete | $420.00 | $+0.00 | $+10.00 |
| 2026-09-20 | $410.00 | complete | $405.00 | $+0.00 | $-5.00 |

### Recurring-heavy (rent)

A $150 rent charge posts and is matched on the 1st of every month, on top of $10/day variable spend.

True month total: **$450.00**

| As of | New method | New status | Old method | New error | Old error |
|---|---|---|---|---|---|
| 2026-09-15 | $450.00 | complete | $600.00 | $+0.00 | $+150.00 |
| 2026-09-25 | $450.00 | complete | $480.00 | $+0.00 | $+30.00 |

## Discussion

**Where the new method clearly helps:** one-off spikes and recurring-heavy
months are the two scenarios the new method was specifically designed to
address, and the backtest confirms it. A single $900 purchase inflated the
old method's projection by up to +$4500 (a 333% overestimate, five days into
the month) purely because the straight-line method extrapolates *whatever has
happened so far this month* as if it recurs every day — the new method's
variable estimate comes from a separate 8-week lookback window entirely
unaffected by anything that happens in the target month itself, so it stayed
exact. Similarly, the recurring rent charge caused the old method to
overestimate by up to +$150 (33%) early in the month, because it has no
concept of "a confirmed one-time-per-month commitment" — it just sees a lump
of MTD spending and assumes the daily rate continues. The new method
structurally separates confirmed commitments from the variable baseline and
excludes matched-recurring transactions from the median, eliminating this
error entirely in both tested cutoffs.

**Where the two methods are roughly equivalent:** heavy refunds (both stay
within $10 of the true total — R05's earlier refund-netting fix already made
`analytics.py`'s `_query_total` refund-aware, so this scenario doesn't
differentiate the two methods) and the short 2-week capture outage. The
latter was actually included expecting the new method's median to be dragged
down by the outage's zero days, but 2 zero weeks out of 8 total weekly
occurrences isn't enough to move a median away from a value that holds in
the other 6 — the median's outlier-robustness turned out to *protect*
against this specific gap length. That's a genuine finding, not the one
originally hypothesized, and it's reported here rather than adjusted after
the fact to fit a narrative.

**Where the new method is worse — a real, unresolved limitation:** the
5-week outage scenario was added specifically because the 2-week one didn't
expose the expected failure mode, and it does: with more than half of most
weekdays' 8 lookback occurrences at zero, the median itself becomes zero (or
near it) for those weekdays, understating the true remaining spend by
$150-300 (33-67% of the true total) at both cutoffs — while the old
method, having no memory of history at all beyond "this month so far,"
was completely unaffected and stayed exact. This is `forecast.py`'s
documented, known limitation: `_weekday_medians`'s eligibility check only
excludes lookback weeks that fall *before the account's very first
transaction ever* — it has no way to detect a gap in the *middle* of
otherwise-real history, so a multi-week capture outage (a real, plausible
operational event — see R01's capture-health monitoring) is silently treated
as several weeks of genuine zero-spending rather than as missing data.
Fixing this properly would need the forecast to consult actual capture
health/`source_events` activity per historical day, not just the presence of
any transaction ever — a materially bigger change than this sub-project's
scope. **This is deliberately left unfixed here, per the roadmap's own
instruction to investigate and report regressions rather than assume the new
method must always win** — it should be weighed against `get_capture_health`
data (R01) before deciding whether and how to close it, most likely in a
future sub-project rather than folded into this backtest pass silently.

**On the "trip late in the month" scenario:** both methods underestimated by
the same $325 — a historically-unprecedented event occurring entirely after
the forecast's cutoff isn't something either method could reasonably be
expected to predict from history alone. This isn't a limitation to fix here;
it's exactly the kind of forward-looking uncertainty R13's planned "read-only
scenario requests" (one-off exclusion, category reduction, subscription
removal previews) are scoped to help a user reason about explicitly, not
something a purely historical model should paper over with false confidence.

## Conclusion

The new method is a clear improvement for the two scenarios it targets
(one-off spikes, recurring-heavy months) and performs comparably to the old
method elsewhere in these fixtures, with one identified regression (long
capture outages) that is real, reproducible, and explicitly not fixed as
part of this pass. Both methods remain available side by side
(`get_spending_velocity` untouched, `month_forecast` new and additive), per
the roadmap's own instruction not to rename or retire the old method until
its replacement's backtested performance actually justifies it — this
backtest is evidence toward that future decision, not a conclusion that the
old method should be retired now.
