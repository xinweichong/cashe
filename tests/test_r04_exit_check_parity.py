"""R04 exit-check parity tests.

R04's exit checks (docs/plans/2026-09-09-cashe-completion-roadmap.md) ask:
"The same fixture produces equal money/classification on Home, Explore,
Activity day totals, finance views, Telegram, and exports. Test refunds
across months, transfers/card repayments, sparse income, timezone offsets,
unresolved FX, and end-of-short-month comparisons."

Refunds and transfers aren't real concepts yet (that's R05's job — marking
a transaction as a refund/transfer). What's tested here is everything that
*is* buildable today: a same-fixture total across Home/Explore/Telegram/
exports, sparse income, unresolved FX, and end-of-short-month comparisons.

Finance views (trip/budget summaries) already have dedicated typed-contract
tests elsewhere and aren't re-covered here.

A genuine divergence was found while writing this (Explore's
analytics._query_total buckets by the raw SQL DATE(transaction_date),
while Home/Telegram's spending_facts._rows projects into the configured
local timezone) — deliberately not encoded as a test here, since asserting
on it would either lock in a bug as "expected" or require fixing it, and
fixing it is exactly the period-semantics unification work the roadmap
flags as a separate, riskier follow-up. See the roadmap's R04 follow-up
notes for the concrete repro.
"""
import csv
import io
from datetime import date

import pytest

from src.analytics import get_period_comparison
from src.storage import Storage
from src.telegram_bot import TelegramBotService
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


def _seed_april_fixture(storage: Storage) -> None:
    """A representative month: SGD expenses, one resolved foreign-currency
    expense, income, and one unresolved-FX expense (excluded everywhere)."""
    storage.insert_transaction(
        source="manual", source_id="a1", amount=42.50, merchant="Fairprice",
        category="Groceries", transaction_date="2026-04-05", tx_type="expense",
    )
    storage.insert_transaction(
        source="manual", source_id="a2", amount=15.30, merchant="Grab",
        category="Transport", transaction_date="2026-04-10", tx_type="expense",
    )
    storage.insert_transaction(
        source="manual", source_id="a3", amount=1000.0, merchant="Tokyo Cafe",
        category="Dining", transaction_date="2026-04-15", tx_type="expense",
        currency="JPY", exchange_rate=0.0091,  # -> 9.10 SGD
    )
    storage.insert_transaction(
        source="manual", source_id="a4", amount=3000.0, merchant="Employer",
        category="Salary", transaction_date="2026-04-01", tx_type="income",
    )
    # Unresolved marker — must be excluded from every surface's total.
    storage.insert_transaction(
        source="manual", source_id="a5", amount=500.0, merchant="Bangkok Grill",
        category="Dining", transaction_date="2026-04-20", tx_type="expense",
        currency="THB", exchange_rate=1.0,
    )


EXPECTED_APRIL_SPENDING = 42.50 + 15.30 + 9.10  # = 66.90, unresolved a5 excluded


def test_same_fixture_equal_spending_home_explore_export(in_memory_db):
    """Home (spending_facts), Explore (analytics.get_period_comparison), and
    the CSV export must all agree on total spending for the same full
    calendar month, from independently-implemented code paths."""
    storage = Storage(connection=in_memory_db)
    _seed_april_fixture(storage)

    # as_of = the month's last day so spending_facts' elapsed-days-clipped
    # "current" period covers the full month, matching analytics.py's
    # always-full-calendar-month range for the same target month.
    home = storage.get_month_spending_facts(as_of=date(2026, 4, 30))
    home_total = home["current"]["spending"]["minor_units"] / 100

    explore = get_period_comparison(in_memory_db, period="month", date="2026-04-30")
    explore_total = explore["current_total"]

    export_rows = storage.query_transactions(start_date="2026-04-01", end_date="2026-04-30", limit=1000)
    from src.spending_facts import resolve_money
    export_total = 0.0
    for tx in export_rows:
        if tx["type"] == "income":
            continue
        minor, _ = resolve_money(tx)
        if minor is not None:
            export_total += minor / 100

    assert home_total == pytest.approx(EXPECTED_APRIL_SPENDING)
    assert explore_total == pytest.approx(EXPECTED_APRIL_SPENDING)
    assert export_total == pytest.approx(EXPECTED_APRIL_SPENDING)
    assert home_total == explore_total == pytest.approx(export_total)


def test_same_fixture_equal_spending_home_and_telegram(in_memory_db):
    """Telegram's rendered monthly summary must show the same total as Home
    — both call the same Storage.get_month_spending_facts, but this pins
    the text-rendering path end-to-end rather than trusting the shared
    function alone."""
    storage = Storage(connection=in_memory_db)
    _seed_april_fixture(storage)
    bot = TelegramBotService(storage=storage, bot_token="test")

    home = storage.get_month_spending_facts(as_of=date(2026, 4, 30))
    home_total = home["current"]["spending"]["minor_units"] / 100

    text = bot._format_spending_period(storage, "month", as_of=date(2026, 4, 30), include_evidence=False)
    assert f"S${home_total:,.2f}" in text


@pytest.mark.asyncio
async def test_csv_export_amount_sgd_column_excludes_unresolved(in_memory_db):
    """The exported amount_sgd column, summed, must match the same total —
    and the unresolved row must be blank, not silently dropped or fabricated."""
    storage = Storage(connection=in_memory_db)
    _seed_april_fixture(storage)
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user(TEST_PASSWORD)
    from src.storage import AdminStorage
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    user_manager = FakeUserManager(storage)
    app = create_dashboard_app(user_manager, admin_storage)

    from httpx import AsyncClient, ASGITransport

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        resp = await ac.get("/api/transactions/export?start_date=2026-04-01&end_date=2026-04-30")
        text = resp.text

    reader = csv.DictReader(io.StringIO(text))
    total = 0.0
    unresolved_row = None
    for row in reader:
        if row["type"] == "income":
            continue
        if row["merchant"] == "Bangkok Grill":
            unresolved_row = row
            continue
        total += float(row["amount_sgd"])

    assert unresolved_row is not None
    assert unresolved_row["amount_sgd"] == ""
    assert total == pytest.approx(EXPECTED_APRIL_SPENDING)


def test_sparse_income_no_crash_and_consistent_absence(in_memory_db):
    """A period with expenses but zero income must be represented
    consistently as "absent", not a fabricated zero, across Home and the
    health score — and must not crash spending velocity."""
    storage = Storage(connection=in_memory_db)
    storage.insert_transaction(
        source="manual", source_id="e1", amount=50.0, merchant="Fairprice",
        category="Groceries", transaction_date="2026-04-10", tx_type="expense",
    )

    home = storage.get_month_spending_facts(as_of=date(2026, 4, 30))
    assert home["current"]["income"] is None
    # Net flow is meaningless without income data — must not be fabricated as spending's negation.
    assert home["current"]["recorded_net_flow"] is None

    health = storage.get_health_score(months=1)
    assert health["has_income_data"] is False
    assert health["score"] is None

    velocity = storage.spending_velocity()
    assert velocity["status"] in ("ahead", "on_track", "behind")  # doesn't crash


def test_current_month_total_agrees_but_previous_period_intentionally_diverges(in_memory_db):
    """The exit check's core claim — the same fixture produces equal money
    for the *current* period — holds: with as_of on the month's last day,
    Home's "current" bucket (which runs start-of-month through as_of, not
    clipped) and Explore's always-full-calendar-month total agree exactly.

    Their "previous period" values do not, and are not meant to: Home
    (spending_facts.month_periods) anchors "previous" to the actual
    previous calendar month, clipped to the shorter of the two months'
    day counts (Feb 1-28 here). Explore (analytics._get_previous_period)
    instead looks back an equal number of days from the current period's
    start, ignoring calendar-month boundaries (Jan 29-Feb 28 here — it
    pulls in 3 days of January). This is the "materially different period
    semantics" gap the roadmap records as an intentional compatibility
    difference (unifying them is the deferred, separately-flagged
    period-semantics-unification follow-up) — pinned here with a concrete
    fixture so the divergence is documented rather than just asserted in
    prose."""
    storage = Storage(connection=in_memory_db)
    # Only Explore's Jan-29-Feb-28 lookback includes this.
    storage.insert_transaction(
        source="manual", source_id="jan30", amount=15.0, merchant="Jan30 Buy",
        category="Shopping", transaction_date="2026-01-30", tx_type="expense",
    )
    # Both sides' February bucket includes this.
    storage.insert_transaction(
        source="manual", source_id="feb10", amount=25.0, merchant="Feb10 Buy",
        category="Shopping", transaction_date="2026-02-10", tx_type="expense",
    )

    home = storage.get_month_spending_facts(as_of=date(2026, 3, 31))
    explore = get_period_comparison(in_memory_db, period="month", date="2026-03-31")

    # Current period: full March in both — no transactions seeded in March,
    # so both totals are (correctly) zero, and equal.
    assert home["current"]["spending"]["minor_units"] / 100 == pytest.approx(explore["current_total"])

    # Previous period: genuinely different algorithms, genuinely different totals.
    home_previous = home["previous"]["spending"]["minor_units"] / 100
    assert home_previous == pytest.approx(25.0)          # Feb only
    assert explore["previous_total"] == pytest.approx(40.0)  # Jan 29 - Feb 28
    assert home_previous != explore["previous_total"]
