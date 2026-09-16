import sqlite3
import bcrypt
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


@pytest.fixture
def dashboard_app(in_memory_db):
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user(TEST_PASSWORD)
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    yield create_dashboard_app(user_manager, admin_storage)
    _auth._admin_storage = None


@pytest_asyncio.fixture
async def client(dashboard_app):
    transport = ASGITransport(app=dashboard_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Log in to get a session cookie
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac


class TestCreateTransaction:
    @pytest.mark.asyncio
    async def test_create_expense(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 12.50,
            "merchant": "Toast Box",
            "category": "Food",
            "type": "expense",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 12.50
        assert data["merchant"] == "Toast Box"
        assert data["category"] == "Food"
        assert data["type"] == "expense"
        assert data["source"] == "manual"
        assert data["currency"] == "SGD"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_income(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 5000.00,
            "merchant": "Employer",
            "category": "Salary",
            "type": "income",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 5000.00
        assert data["type"] == "income"
        assert data["category"] == "Salary"

    @pytest.mark.asyncio
    async def test_create_cash_transaction(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 5.00,
            "merchant": "Hawker Stall",
            "category": "Food",
            "type": "expense",
            "source": "cash",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "cash"
        assert data["amount"] == 5.00

    @pytest.mark.asyncio
    async def test_create_with_foreign_currency(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 350.00,
            "merchant": "Thai Restaurant BKK",
            "category": "Food",
            "type": "expense",
            "currency": "THB",
            "exchange_rate": 0.039,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["currency"] == "THB"
        assert data["exchange_rate"] == 0.039
        assert data["amount"] == 350.00

    @pytest.mark.asyncio
    async def test_create_missing_amount_returns_400(self, client):
        response = await client.post("/api/transactions", json={
            "merchant": "Test",
            "type": "expense",
        })
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_create_invalid_type_returns_400(self, client):
        response = await client.post("/api/transactions", json={
            "amount": 10.00,
            "type": "transfer",
        })
        assert response.status_code == 400


class TestListTransactions:
    @pytest.mark.asyncio
    async def test_list_transactions_with_limit(self, client):
        # Create 3 transactions
        for i in range(3):
            await client.post("/api/transactions", json={
                "amount": 10.0 + i,
                "merchant": f"Shop {i}",
                "type": "expense",
            })

        response = await client.get("/api/transactions?limit=2")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2


class TestCreateTransactionV2:
    @pytest.mark.asyncio
    async def test_returns_canonical_money_and_revision(self, client):
        response = await client.post("/api/v2/transactions", json={
            "amount": 15.00, "merchant": "New Name", "category": "Food", "type": "expense",
        })
        assert response.status_code == 201
        data = response.json()
        assert data["merchant"] == "New Name"
        assert data["category"] == "Food"
        assert data["type"] == "expense"
        assert data["source"] == "manual"
        assert data["revision"] == 1
        assert data["original"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["reporting"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["conversion"]["status"] == "native"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_cash_source_is_accepted(self, client):
        response = await client.post("/api/v2/transactions", json={
            "amount": 5.00, "merchant": "Hawker Stall", "type": "expense", "source": "cash",
        })
        assert response.status_code == 201
        assert response.json()["source"] == "cash"

    @pytest.mark.asyncio
    async def test_defaults_type_and_currency(self, client):
        response = await client.post("/api/v2/transactions", json={"amount": 5.00})
        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "expense"
        assert data["original"]["currency"] == "SGD"

    @pytest.mark.asyncio
    async def test_missing_amount_returns_422(self, client):
        response = await client.post("/api/v2/transactions", json={"merchant": "Test"})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_type_returns_422(self, client):
        response = await client.post("/api/v2/transactions", json={"amount": 10.00, "type": "transfer"})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_idempotency_key_replays_same_transaction(self, client):
        payload = {"amount": 9.00, "merchant": "Coffee", "type": "expense"}
        first = await client.post(
            "/api/v2/transactions", json=payload, headers={"Idempotency-Key": "key-v2-abc"},
        )
        second = await client.post(
            "/api/v2/transactions", json=payload, headers={"Idempotency-Key": "key-v2-abc"},
        )
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["id"] == second.json()["id"]

        listing = await client.get("/api/transactions")
        assert sum(1 for tx in listing.json() if tx["merchant"] == "Coffee") == 1

    @pytest.mark.asyncio
    async def test_same_key_different_payload_returns_409_without_creating(self, client, in_memory_db):
        payload = {"amount": 9.00, "merchant": "Coffee", "type": "expense"}
        headers = {"Idempotency-Key": "key-v2-conflict"}
        first = await client.post("/api/v2/transactions", json=payload, headers=headers)
        assert first.status_code == 201

        conflict = await client.post(
            "/api/v2/transactions", json={**payload, "amount": 20.00}, headers=headers,
        )
        assert conflict.status_code == 409
        assert len(Storage(in_memory_db).query_transactions(limit=50)) == 1

    @pytest.mark.asyncio
    async def test_replay_after_deletion_returns_409_and_does_not_resurrect(self, client, in_memory_db):
        payload = {"amount": 9.00, "merchant": "Coffee", "type": "expense"}
        headers = {"Idempotency-Key": "key-v2-deleted"}
        first = await client.post("/api/v2/transactions", json=payload, headers=headers)
        tx_id = first.json()["id"]
        await client.delete(f"/api/v2/transactions/{tx_id}")

        replay = await client.post("/api/v2/transactions", json=payload, headers=headers)

        assert replay.status_code == 409
        assert Storage(in_memory_db).query_transactions(limit=50) == []


class TestListTransactionsV2:
    @pytest.mark.asyncio
    async def test_list_returns_canonical_money_shape_newest_first(self, client):
        await client.post("/api/transactions", json={"amount": 10.0, "merchant": "A", "type": "expense"})
        await client.post("/api/transactions", json={"amount": 20.0, "merchant": "B", "type": "expense"})

        response = await client.get("/api/v2/transactions?limit=10")

        assert response.status_code == 200
        data = response.json()
        assert [tx["merchant"] for tx in data] == ["B", "A"]
        assert data[0]["reporting"]["minor_units"] == 2000
        assert "revision" in data[0] and "original" in data[0]

    @pytest.mark.asyncio
    async def test_list_respects_limit_and_offset(self, client):
        for i in range(3):
            await client.post("/api/transactions", json={"amount": 10.0 + i, "merchant": f"Shop {i}", "type": "expense"})

        page1 = (await client.get("/api/v2/transactions?limit=2&offset=0")).json()
        page2 = (await client.get("/api/v2/transactions?limit=2&offset=2")).json()

        assert len(page1) == 2
        assert len(page2) == 1
        assert {tx["id"] for tx in page1} & {tx["id"] for tx in page2} == set()

    @pytest.mark.asyncio
    async def test_list_filters_by_category_and_merchant_search(self, client):
        await client.post("/api/transactions", json={"amount": 5.0, "merchant": "Cafe Aroma", "category": "Food", "type": "expense"})
        await client.post("/api/transactions", json={"amount": 5.0, "merchant": "Gas Station", "category": "Transport", "type": "expense"})

        by_category = (await client.get("/api/v2/transactions?category=Food")).json()
        by_search = (await client.get("/api/v2/transactions?merchant_search=Aroma")).json()

        assert [tx["merchant"] for tx in by_category] == ["Cafe Aroma"]
        assert [tx["merchant"] for tx in by_search] == ["Cafe Aroma"]

    @pytest.mark.asyncio
    async def test_search_matches_alias_description_category_and_amount(self, client):
        cafe = (await client.post("/api/transactions", json={"amount": 12.34, "merchant": "Kopi King", "category": "Food", "description": "Morning brew", "type": "expense"})).json()
        await client.post("/api/transactions", json={"amount": 9.0, "merchant": "Other Shop", "category": "Shopping", "type": "expense"})
        await client.put(f"/api/merchant-intelligence/{cafe['merchant']}/alias", json={"display_name": "The Coffee Place"})

        by_alias = (await client.get("/api/v2/transactions?merchant_search=Coffee Place")).json()
        by_description = (await client.get("/api/v2/transactions?merchant_search=brew")).json()
        by_category_term = (await client.get("/api/v2/transactions?merchant_search=Food")).json()
        by_amount = (await client.get("/api/v2/transactions?merchant_search=12.34")).json()

        for results in (by_alias, by_description, by_category_term, by_amount):
            assert [tx["merchant"] for tx in results] == ["Kopi King"]

    @pytest.mark.asyncio
    async def test_type_filter_treats_legacy_null_as_expense(self, client, in_memory_db):
        expense_id = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": "A", "type": "expense"})).json()["id"]
        refund_id = (await client.post("/api/transactions", json={"amount": 2.0, "merchant": "A", "type": "expense"})).json()["id"]
        await client.put(f"/api/v2/transactions/{refund_id}", json={"type": "refund"})
        Storage(in_memory_db)._conn.execute("UPDATE transactions SET type = NULL WHERE id = ?", (expense_id,))
        Storage(in_memory_db)._conn.commit()

        by_expense = (await client.get("/api/v2/transactions?type=expense")).json()
        by_refund = (await client.get("/api/v2/transactions?type=refund")).json()

        assert {tx["id"] for tx in by_expense} == {expense_id}
        assert {tx["id"] for tx in by_refund} == {refund_id}

    @pytest.mark.asyncio
    async def test_trip_filter_only_returns_enlisted_transactions(self, client):
        in_trip = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": "A", "type": "expense"})).json()["id"]
        not_in_trip = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": "B", "type": "expense"})).json()["id"]
        trip = (await client.post("/api/trips", json={"name": "Bali", "start_date": "2026-01-01"})).json()
        await client.post(f"/api/trips/{trip['id']}/transactions", json={"transaction_id": in_trip})

        results = (await client.get(f"/api/v2/transactions?trip_id={trip['id']}")).json()

        assert {tx["id"] for tx in results} == {in_trip}
        assert not_in_trip not in {tx["id"] for tx in results}

    @pytest.mark.asyncio
    async def test_needs_review_filter_matches_the_review_page(self, client):
        clean = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": "A", "category": "Food", "type": "expense"})).json()["id"]
        no_merchant = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": None, "category": "Food", "type": "expense"})).json()["id"]

        results = (await client.get("/api/v2/transactions?needs_review=true")).json()
        review = (await client.get("/api/v2/spending/review")).json()

        result_ids = {tx["id"] for tx in results}
        assert clean not in result_ids
        assert no_merchant in result_ids
        assert result_ids == {item["id"] for item in review["items"]}


class TestDailyTotalsV2:
    @pytest.mark.asyncio
    async def test_daily_totals_over_range(self, client):
        await client.post("/api/transactions", json={
            "amount": 12.0, "merchant": "A", "type": "expense", "transaction_date": "2026-09-01T09:00:00",
        })
        await client.post("/api/transactions", json={
            "amount": 8.0, "merchant": "B", "type": "expense", "transaction_date": "2026-09-02T09:00:00",
        })

        response = await client.get("/api/v2/transactions/daily-totals?start=2026-09-01&end=2026-09-02")

        assert response.status_code == 200
        by_date = {row["date"]: row for row in response.json()}
        assert by_date["2026-09-01"]["spending"]["minor_units"] == 1200
        assert by_date["2026-09-02"]["spending"]["minor_units"] == 800

    @pytest.mark.asyncio
    async def test_end_before_start_is_rejected(self, client):
        response = await client.get("/api/v2/transactions/daily-totals?start=2026-09-02&end=2026-09-01")
        assert response.status_code == 422


class TestUpdateTransaction:
    @pytest.mark.asyncio
    async def test_update_transaction(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 15.00,
            "merchant": "Old Name",
            "category": "Food",
            "type": "expense",
        })
        assert create_resp.status_code == 200
        tx_id = create_resp.json()["id"]

        update_resp = await client.put(f"/api/transactions/{tx_id}", json={
            "merchant": "New Name",
            "amount": 20.00,
            "category": "Shopping",
        })
        assert update_resp.status_code == 200
        data = update_resp.json()
        assert data["merchant"] == "New Name"
        assert data["amount"] == 20.00
        assert data["category"] == "Shopping"
        assert data["id"] == tx_id

    @pytest.mark.asyncio
    async def test_update_nonexistent_returns_404(self, client):
        response = await client.put("/api/transactions/99999", json={
            "merchant": "Ghost",
        })
        assert response.status_code == 404


class TestUpdateTransactionV2:
    @pytest.mark.asyncio
    async def test_returns_canonical_money_and_revision(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 15.00, "merchant": "Old Name", "category": "Food", "type": "expense",
        })
        tx_id = create_resp.json()["id"]

        response = await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "New Name"})

        assert response.status_code == 200
        data = response.json()
        assert data["merchant"] == "New Name"
        assert data["revision"] == 2
        assert data["original"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["reporting"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["conversion"]["status"] == "native"

    @pytest.mark.asyncio
    async def test_matching_expected_revision_succeeds(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]

        response = await client.put(
            f"/api/v2/transactions/{tx_id}",
            json={"merchant": "New Name", "expected_revision": 1},
        )
        assert response.status_code == 200
        assert response.json()["revision"] == 2

    @pytest.mark.asyncio
    async def test_stale_expected_revision_returns_409_with_current_state(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "First Edit"})  # revision -> 2

        response = await client.put(
            f"/api/v2/transactions/{tx_id}",
            json={"merchant": "Conflicting Edit", "expected_revision": 1},
        )

        assert response.status_code == 409
        current = response.json()["detail"]["current"]
        assert current["revision"] == 2
        assert current["merchant"] == "First Edit"
        # The conflicting edit must not have been applied.
        unchanged = await client.get(f"/api/transactions/{tx_id}")
        assert unchanged.json()["merchant"] == "First Edit"

    @pytest.mark.asyncio
    async def test_nonexistent_returns_404(self, client):
        response = await client.put("/api/v2/transactions/99999", json={"merchant": "Ghost"})
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_no_fields_returns_400(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        response = await client.put(f"/api/v2/transactions/{tx_id}", json={})
        assert response.status_code == 400


class TestRefundLinkingV2:
    @staticmethod
    async def _make_refund(client, amount: float, merchant: str | None = None) -> int:
        # POST /api/transactions only accepts expense/income at creation
        # time (R05 sub-project 1's deliberate design) — a refund is always
        # a reclassification of a captured expense via the v2 correction path.
        body = {"amount": amount, "type": "expense"}
        if merchant:
            body["merchant"] = merchant
        resp = await client.post("/api/transactions", json=body)
        tx_id = resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"type": "refund"})
        return tx_id

    @pytest.mark.asyncio
    async def test_get_returns_refund_of_and_refunded_by(self, client):
        purchase_resp = await client.post("/api/transactions", json={
            "amount": 100.00, "merchant": "Shop", "type": "expense",
        })
        purchase_id = purchase_resp.json()["id"]
        refund_id = await self._make_refund(client, 30.00, "Shop")

        link_resp = await client.put(
            f"/api/v2/transactions/{refund_id}",
            json={"refund_of_transaction_id": purchase_id},
        )
        assert link_resp.status_code == 200
        assert link_resp.json()["refund_of"]["transaction_id"] == purchase_id
        assert link_resp.json()["refund_of"]["warning"] is None

        refund_get = await client.get(f"/api/v2/transactions/{refund_id}")
        assert refund_get.json()["refund_of"]["transaction_id"] == purchase_id

        purchase_get = await client.get(f"/api/v2/transactions/{purchase_id}")
        assert len(purchase_get.json()["refunded_by"]) == 1
        assert purchase_get.json()["refunded_by"][0]["transaction_id"] == refund_id

    @pytest.mark.asyncio
    async def test_correction_can_flag_a_purchase_as_excluded_from_baseline(self, client):
        create = await client.post("/api/transactions", json={"amount": 900.00, "merchant": "Splurge", "type": "expense"})
        tx_id = create.json()["id"]
        response = await client.put(f"/api/v2/transactions/{tx_id}", json={"excluded_from_baseline": True})
        assert response.status_code == 200
        assert response.json()["excluded_from_baseline"] is True
        get_resp = await client.get(f"/api/v2/transactions/{tx_id}")
        assert get_resp.json()["excluded_from_baseline"] is True

    @pytest.mark.asyncio
    async def test_unlink_with_explicit_null(self, client):
        purchase_resp = await client.post("/api/transactions", json={"amount": 100.00, "type": "expense"})
        purchase_id = purchase_resp.json()["id"]
        refund_id = await self._make_refund(client, 30.00)
        await client.put(f"/api/v2/transactions/{refund_id}", json={"refund_of_transaction_id": purchase_id})

        response = await client.put(
            f"/api/v2/transactions/{refund_id}",
            json={"refund_of_transaction_id": None},
        )
        assert response.status_code == 200
        assert response.json()["refund_of"] is None

    @pytest.mark.asyncio
    async def test_link_to_income_returns_422(self, client):
        income_resp = await client.post("/api/transactions", json={"amount": 5000.00, "type": "income"})
        income_id = income_resp.json()["id"]
        refund_id = await self._make_refund(client, 30.00)

        response = await client.put(
            f"/api/v2/transactions/{refund_id}",
            json={"refund_of_transaction_id": income_id},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_404(self, client):
        response = await client.get("/api/v2/transactions/99999")
        assert response.status_code == 404


class TestSubscriptionReviewV2:
    @pytest.mark.asyncio
    async def test_returns_empty_review_with_no_subscriptions(self, client):
        response = await client.get("/api/v2/subscriptions/review")
        assert response.status_code == 200
        assert response.json() == {"overdue": [], "price_changes": [], "annual_renewals": []}

    @pytest.mark.asyncio
    async def test_returns_typed_price_change_for_a_repriced_subscription(self, client, in_memory_db):
        storage = Storage(in_memory_db)
        sub = storage.create_subscription("Netflix", "monthly", billing_day=15)
        for date, amount in [("2026-03-15", 17.98), ("2026-04-15", 22.98)]:
            upcoming_id = storage.create_upcoming_transaction(sub, date, amount)
            tx_id = storage.insert_transaction(
                source="manual", source_id=f"tx-{date}", amount=amount, currency="SGD",
                merchant="Netflix", transaction_date=f"{date}T10:00:00", tx_type="expense",
            )
            storage.match_upcoming_transaction(upcoming_id, tx_id)

        response = await client.get("/api/v2/subscriptions/review")

        assert response.status_code == 200
        data = response.json()
        assert data["price_changes"] == [{
            "subscription_id": sub, "label": "Netflix",
            "old_amount": {"minor_units": 1798, "currency": "SGD"},
            "new_amount": {"minor_units": 2298, "currency": "SGD"},
            "change": {"minor_units": 500, "currency": "SGD"},
            "annualized_impact": {"minor_units": 6000, "currency": "SGD"},
            "old_date": "2026-03-15", "new_date": "2026-04-15",
        }]


class TestBulkTransactionsV2:
    @pytest.mark.asyncio
    async def test_bulk_categorize_applies_to_every_row(self, client):
        ids = []
        for i in range(3):
            resp = await client.post("/api/transactions", json={"amount": 5.0 + i, "merchant": f"M{i}", "category": "Food", "type": "expense"})
            ids.append(resp.json()["id"])

        response = await client.post("/api/v2/transactions/bulk", json={"transaction_ids": ids, "category": "Transport"})

        assert response.status_code == 200
        results = response.json()
        assert {r["status"] for r in results} == {"ok"}
        assert {r["revision"] for r in results} == {2}
        for tx_id in ids:
            assert (await client.get(f"/api/v2/transactions/{tx_id}")).json()["category"] == "Transport"

    @pytest.mark.asyncio
    async def test_bulk_type_reclassification_inherits_refund_link_clearing(self, client):
        purchase = (await client.post("/api/transactions", json={"amount": 20.0, "merchant": "Shop", "type": "expense"})).json()["id"]
        refund = (await client.post("/api/transactions", json={"amount": 5.0, "merchant": "Shop", "type": "expense"})).json()["id"]
        await client.put(f"/api/v2/transactions/{refund}", json={"type": "refund", "refund_of_transaction_id": purchase})

        response = await client.post("/api/v2/transactions/bulk", json={"transaction_ids": [refund], "type": "transfer"})

        assert response.status_code == 200
        assert response.json()[0]["status"] == "ok"
        reclassified = (await client.get(f"/api/v2/transactions/{refund}")).json()
        assert reclassified["type"] == "transfer"
        assert reclassified["refund_of"] is None  # inherited from update_transaction's own invariant

    @pytest.mark.asyncio
    async def test_bulk_reports_a_conflict_without_blocking_the_rest_of_the_batch(self, client):
        stale = (await client.post("/api/transactions", json={"amount": 5.0, "type": "expense"})).json()
        fresh = (await client.post("/api/transactions", json={"amount": 5.0, "type": "expense"})).json()
        await client.put(f"/api/v2/transactions/{stale['id']}", json={"merchant": "Edited elsewhere"})  # bumps stale's revision to 2

        response = await client.post("/api/v2/transactions/bulk", json={
            "transaction_ids": [stale["id"], fresh["id"]],
            "category": "Food",
            "expected_revisions": {str(stale["id"]): 1, str(fresh["id"]): 1},
        })

        assert response.status_code == 200
        by_id = {r["id"]: r for r in response.json()}
        assert by_id[stale["id"]]["status"] == "conflict"
        assert by_id[stale["id"]]["current_revision"] == 2
        assert by_id[fresh["id"]]["status"] == "ok"
        assert (await client.get(f"/api/v2/transactions/{fresh['id']}")).json()["category"] == "Food"
        # The conflicted row is untouched, not silently overwritten.
        assert (await client.get(f"/api/v2/transactions/{stale['id']}")).json()["category"] is None

    @pytest.mark.asyncio
    async def test_bulk_undo_reverts_a_prior_bulk_categorize(self, client):
        ids = []
        for i in range(2):
            resp = await client.post("/api/transactions", json={"amount": 5.0 + i, "category": "Food", "type": "expense"})
            ids.append(resp.json()["id"])
        bulk = (await client.post("/api/v2/transactions/bulk", json={"transaction_ids": ids, "category": "Transport"})).json()
        revisions = {str(r["id"]): r["revision"] for r in bulk}

        response = await client.post("/api/v2/transactions/bulk/undo", json={
            "transaction_ids": ids, "expected_revisions": revisions,
        })

        assert response.status_code == 200
        assert {r["status"] for r in response.json()} == {"ok"}
        for tx_id in ids:
            assert (await client.get(f"/api/v2/transactions/{tx_id}")).json()["category"] == "Food"

    @pytest.mark.asyncio
    async def test_bulk_rejects_empty_or_oversized_batches_and_no_op_requests(self, client):
        tx_id = (await client.post("/api/transactions", json={"amount": 5.0, "type": "expense"})).json()["id"]

        assert (await client.post("/api/v2/transactions/bulk", json={"transaction_ids": []})).status_code == 422
        assert (await client.post("/api/v2/transactions/bulk", json={"transaction_ids": [tx_id]})).status_code == 422  # nothing to change
        assert (await client.post("/api/v2/transactions/bulk", json={
            "transaction_ids": list(range(1, 202)), "category": "Food",
        })).status_code == 422


class TestUndoTransactionV2:
    @pytest.mark.asyncio
    async def test_undo_reverts_last_correction(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 15.00, "merchant": "Old Name", "category": "Food", "type": "expense",
        })
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "New Name"})  # revision -> 2

        response = await client.post(f"/api/v2/transactions/{tx_id}/undo", json={})

        assert response.status_code == 200
        data = response.json()
        assert data["merchant"] == "Old Name"
        assert data["revision"] == 3

    @pytest.mark.asyncio
    async def test_undo_reverts_canonical_money_together_with_amount(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"amount": 25.00})

        response = await client.post(f"/api/v2/transactions/{tx_id}/undo", json={})

        assert response.status_code == 200
        data = response.json()
        assert data["original"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["reporting"] == {"minor_units": 1500, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_undo_with_matching_expected_revision_succeeds(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "New Name"})  # revision -> 2

        response = await client.post(
            f"/api/v2/transactions/{tx_id}/undo", json={"expected_revision": 2},
        )
        assert response.status_code == 200
        assert response.json()["revision"] == 3

    @pytest.mark.asyncio
    async def test_undo_with_stale_expected_revision_returns_409_with_current_state(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "First Edit"})  # revision -> 2
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "Second Edit"})  # revision -> 3

        response = await client.post(
            f"/api/v2/transactions/{tx_id}/undo", json={"expected_revision": 2},
        )

        assert response.status_code == 409
        current = response.json()["detail"]["current"]
        assert current["revision"] == 3
        assert current["merchant"] == "Second Edit"
        unchanged = await client.get(f"/api/transactions/{tx_id}")
        assert unchanged.json()["merchant"] == "Second Edit"

    @pytest.mark.asyncio
    async def test_undo_always_reverts_the_most_recent_edit(self, client):
        """An intervening edit changes what undo reverts, rather than being blocked by it."""
        create_resp = await client.post("/api/transactions", json={
            "amount": 15.00, "merchant": "Original", "type": "expense",
        })
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "First Edit"})  # revision -> 2
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "Second Edit"})  # revision -> 3

        response = await client.post(f"/api/v2/transactions/{tx_id}/undo", json={})

        assert response.status_code == 200
        assert response.json()["merchant"] == "First Edit"

    @pytest.mark.asyncio
    async def test_undo_with_no_prior_mutation_returns_400(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]

        response = await client.post(f"/api/v2/transactions/{tx_id}/undo", json={})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_undo_nonexistent_returns_404(self, client):
        response = await client.post("/api/v2/transactions/99999/undo", json={})
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_undo_without_body_uses_latest_revision(self, client):
        create_resp = await client.post("/api/transactions", json={"amount": 15.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.put(f"/api/v2/transactions/{tx_id}", json={"merchant": "New Name"})

        response = await client.post(f"/api/v2/transactions/{tx_id}/undo")
        assert response.status_code == 200
        assert response.json()["revision"] == 3


class TestDeleteTransaction:
    @pytest.mark.asyncio
    async def test_delete_transaction(self, client):
        create_resp = await client.post("/api/transactions", json={
            "amount": 8.00,
            "merchant": "To Delete",
            "type": "expense",
        })
        assert create_resp.status_code == 200
        tx_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/transactions/{tx_id}")
        assert delete_resp.status_code == 200

        # Verify it's gone
        get_resp = await client.get(f"/api/transactions/{tx_id}")
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_404(self, client):
        response = await client.delete("/api/transactions/99999")
        assert response.status_code == 404


class TestDeleteTransactionV2:
    @pytest.mark.asyncio
    async def test_returns_deletion_snapshot(self, client):
        create_resp = await client.post("/api/v2/transactions", json={
            "amount": 8.00, "merchant": "To Delete", "type": "expense",
        })
        tx_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/v2/transactions/{tx_id}")
        assert delete_resp.status_code == 200
        data = delete_resp.json()
        assert data["id"] == tx_id
        assert data["merchant"] == "To Delete"
        assert data["revision"] == 1
        assert data["original"] == {"minor_units": 800, "currency": "SGD"}
        assert "deleted_at" in data and data["deleted_at"]

        get_resp = await client.get(f"/api/transactions/{tx_id}")
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_nonexistent_returns_404(self, client):
        response = await client.delete("/api/v2/transactions/99999")
        assert response.status_code == 404


class TestRestoreTransactionV2:
    @pytest.mark.asyncio
    async def test_restore_recreates_the_deleted_transaction(self, client):
        create_resp = await client.post("/api/v2/transactions", json={
            "amount": 8.00, "merchant": "To Delete", "category": "Food", "type": "expense",
        })
        tx_id = create_resp.json()["id"]
        await client.delete(f"/api/v2/transactions/{tx_id}")

        response = await client.post(f"/api/v2/transactions/{tx_id}/restore")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == tx_id
        assert data["merchant"] == "To Delete"
        assert data["category"] == "Food"
        assert data["revision"] == 2  # bumped past the revision it had when deleted
        assert data["original"] == {"minor_units": 800, "currency": "SGD"}
        assert data["reporting"] == {"minor_units": 800, "currency": "SGD"}
        assert data["conversion"]["status"] == "native"

        get_resp = await client.get(f"/api/transactions/{tx_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["merchant"] == "To Delete"

    @pytest.mark.asyncio
    async def test_restore_preserves_foreign_currency_conversion(self, client):
        create_resp = await client.post("/api/v2/transactions", json={
            "amount": 350.00, "currency": "THB", "exchange_rate": 0.039, "type": "expense",
        })
        tx_id = create_resp.json()["id"]
        await client.delete(f"/api/v2/transactions/{tx_id}")

        response = await client.post(f"/api/v2/transactions/{tx_id}/restore")

        assert response.status_code == 200
        data = response.json()
        assert data["original"] == {"minor_units": 35000, "currency": "THB"}
        assert data["conversion"]["status"] == "indicative"

    @pytest.mark.asyncio
    async def test_restore_a_never_deleted_transaction_returns_404(self, client):
        response = await client.post("/api/v2/transactions/99999/restore")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_restore_twice_returns_409(self, client):
        create_resp = await client.post("/api/v2/transactions", json={"amount": 8.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.delete(f"/api/v2/transactions/{tx_id}")
        await client.post(f"/api/v2/transactions/{tx_id}/restore")

        response = await client.post(f"/api/v2/transactions/{tx_id}/restore")
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_restore_can_be_deleted_and_restored_again(self, client):
        create_resp = await client.post("/api/v2/transactions", json={"amount": 8.00, "type": "expense"})
        tx_id = create_resp.json()["id"]
        await client.delete(f"/api/v2/transactions/{tx_id}")
        await client.post(f"/api/v2/transactions/{tx_id}/restore")
        await client.delete(f"/api/v2/transactions/{tx_id}")

        response = await client.post(f"/api/v2/transactions/{tx_id}/restore")
        assert response.status_code == 200
        assert response.json()["revision"] == 3


class TestOverviewV2:
    @pytest.mark.asyncio
    async def test_summary_returns_canonical_money(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 15.00, "category": "Food", "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 5.00, "category": "Transport", "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        response = await client.get("/api/v2/overview/summary", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["start"] == "2026-04-01"
        assert data["end"] == "2026-04-30"
        assert data["total"] == {"minor_units": 2000, "currency": "SGD"}
        assert data["by_category"]["Food"] == {"minor_units": 1500, "currency": "SGD"}
        assert data["by_category"]["Transport"] == {"minor_units": 500, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_summary_excludes_unresolved_foreign_amount(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 50.00, "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 500.00, "currency": "THB", "exchange_rate": 1.0,
            "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        response = await client.get("/api/v2/overview/summary", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.json()["total"] == {"minor_units": 5000, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_trend_returns_daily_points(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 10.00, "type": "expense", "transaction_date": "2026-04-10T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 20.00, "type": "expense", "transaction_date": "2026-04-12T12:00:00",
        })
        response = await client.get("/api/v2/overview/trend", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.status_code == 200
        data = response.json()
        assert data == [
            {"date": "2026-04-10", "amount": {"minor_units": 1000, "currency": "SGD"}},
            {"date": "2026-04-12", "amount": {"minor_units": 2000, "currency": "SGD"}},
        ]

    @pytest.mark.asyncio
    async def test_merchants_returns_ranking(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 10.00, "merchant": "Toast Box", "type": "expense", "transaction_date": "2026-04-10T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 25.00, "merchant": "Grab", "type": "expense", "transaction_date": "2026-04-11T12:00:00",
        })
        response = await client.get("/api/v2/overview/merchants", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.status_code == 200
        data = response.json()
        assert data[0]["merchant"] == "Grab"
        assert data[0]["total"] == {"minor_units": 2500, "currency": "SGD"}
        assert data[0]["visits"] == 1

    @pytest.mark.asyncio
    async def test_merchants_filters_by_category(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 10.00, "merchant": "Toast Box", "category": "Food", "type": "expense", "transaction_date": "2026-04-10T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 25.00, "merchant": "Grab", "category": "Transport", "type": "expense", "transaction_date": "2026-04-11T12:00:00",
        })
        response = await client.get("/api/v2/overview/merchants", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30", "category": "Food",
        })
        assert response.status_code == 200
        data = response.json()
        assert [m["merchant"] for m in data] == ["Toast Box"]

    @pytest.mark.asyncio
    async def test_balance_returns_income_expenses_net(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 3000.00, "category": "Salary", "type": "income", "transaction_date": "2026-04-16T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 1200.00, "category": "Rent", "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        response = await client.get("/api/v2/overview/balance", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["income"] == {"minor_units": 300000, "currency": "SGD"}
        assert data["expenses"] == {"minor_units": 120000, "currency": "SGD"}
        assert data["net"] == {"minor_units": 180000, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_balance_net_can_be_negative(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 100.00, "category": "Salary", "type": "income", "transaction_date": "2026-04-16T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 400.00, "category": "Rent", "type": "expense", "transaction_date": "2026-04-16T12:00:00",
        })
        response = await client.get("/api/v2/overview/balance", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.json()["net"] == {"minor_units": -30000, "currency": "SGD"}

    @pytest.mark.asyncio
    async def test_trend_by_category_gap_fills_with_null_money(self, client):
        await client.post("/api/v2/transactions", json={
            "amount": 10.00, "category": "Food", "type": "expense", "transaction_date": "2026-04-10T12:00:00",
        })
        await client.post("/api/v2/transactions", json={
            "amount": 20.00, "category": "Transport", "type": "expense", "transaction_date": "2026-04-11T12:00:00",
        })
        response = await client.get("/api/v2/overview/trend-by-category", params={
            "start_date": "2026-04-01", "end_date": "2026-04-30",
        })
        assert response.status_code == 200
        data = response.json()
        day10 = next(d for d in data if d["date"] == "2026-04-10")
        day11 = next(d for d in data if d["date"] == "2026-04-11")
        assert day10["categories"]["Food"] == {"minor_units": 1000, "currency": "SGD"}
        assert day10["categories"]["Transport"] is None
        assert day11["categories"]["Transport"] == {"minor_units": 2000, "currency": "SGD"}
        assert day11["categories"]["Food"] is None

    @pytest.mark.asyncio
    async def test_requires_auth(self, client):
        await client.post("/api/logout")
        response = await client.get("/api/v2/overview/summary")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_settings_returns_defaults(client):
    """GET /api/settings should return the two default threshold values."""
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["anomaly_multiplier"] == 2.0
    assert data["velocity_alert_threshold"] == 110

@pytest.mark.asyncio
async def test_put_settings_updates_values(client):
    """PUT /api/settings should persist new threshold values."""
    resp = await client.put("/api/settings", json={
        "anomaly_multiplier": 3.0,
        "velocity_alert_threshold": 120,
    })
    assert resp.status_code == 200
    # Verify persisted
    resp2 = await client.get("/api/settings")
    assert resp2.json()["anomaly_multiplier"] == 3.0
    assert resp2.json()["velocity_alert_threshold"] == 120

@pytest.mark.asyncio
async def test_put_settings_rejects_out_of_range(client):
    """PUT /api/settings should reject values outside allowed range."""
    resp = await client.put("/api/settings", json={"anomaly_multiplier": 0.5})
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_put_settings_rejects_velocity_out_of_range(client):
    resp = await client.put("/api/settings", json={"velocity_alert_threshold": 30})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_settings_atomic_on_mixed_valid_invalid(client):
    """When one field is invalid, no settings should be written."""
    # Set a known starting state
    await client.put("/api/settings", json={"velocity_alert_threshold": 150})
    # Now send a mixed request: one valid, one invalid
    resp = await client.put("/api/settings", json={
        "anomaly_multiplier": 0.5,      # invalid
        "velocity_alert_threshold": 200, # valid
    })
    assert resp.status_code == 422
    # velocity_alert_threshold should remain 150, not 200
    resp2 = await client.get("/api/settings")
    assert resp2.json()["velocity_alert_threshold"] == 150


@pytest.mark.asyncio
async def test_export_transactions_returns_csv(client, in_memory_db):
    """GET /api/transactions/export should return a CSV file."""
    # Seed a transaction
    in_memory_db.execute(
        "INSERT INTO transactions (source, source_id, amount, currency, exchange_rate, merchant, "
        "category, transaction_date, type) VALUES ('manual', 'exp1', 25.50, 'SGD', 1.0, "
        "'Coffee Bean', 'Dining', '2026-04-10', 'expense')"
    )
    in_memory_db.commit()

    resp = await client.get("/api/transactions/export")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers.get("content-disposition", "")
    lines = resp.text.strip().split("\n")
    assert lines[0].startswith("date,merchant,amount")   # header row
    assert len(lines) >= 2                                # at least one data row
    assert "Coffee Bean" in resp.text

@pytest.mark.asyncio
async def test_export_transactions_respects_category_filter(client, in_memory_db):
    for i, cat in enumerate(["Dining", "Transport", "Dining"]):
        in_memory_db.execute(
            "INSERT INTO transactions (source, source_id, amount, merchant, category, "
            "transaction_date, type) VALUES ('manual', ?, 10.0, 'Merchant', ?, '2026-04-10', 'expense')",
            (f"s{i}", cat),
        )
    in_memory_db.commit()

    resp = await client.get("/api/transactions/export?category=Dining")
    lines = resp.text.strip().split("\n")
    assert len(lines) == 3  # 1 header + 2 Dining rows


@pytest.mark.asyncio
async def test_export_amount_sgd_uses_canonical_conversion(client, in_memory_db):
    # Written through Storage.insert_transaction so reporting_minor_units/
    # conversion_status are actually computed (R02 canonical money) —
    # the export must read those, not recompute amount * exchange_rate.
    storage = Storage(in_memory_db)
    storage.insert_transaction(
        source="manual", source_id="jpy1", amount=1000.0, merchant="Tokyo Cafe",
        category="Dining", transaction_date="2026-04-10", tx_type="expense",
        currency="JPY", exchange_rate=0.0091,
    )
    resp = await client.get("/api/transactions/export")
    lines = resp.text.strip().split("\n")
    row = next(l for l in lines if "Tokyo Cafe" in l)
    assert "9.1" in row  # 1000 * 0.0091 = 9.10 SGD

@pytest.mark.asyncio
async def test_export_amount_sgd_blank_for_unresolved_fx(client, in_memory_db):
    # A legacy exchange_rate of 1.0 on a non-SGD currency is the silent
    # unresolved marker (R02) — the export must not fabricate a face-value
    # SGD amount for it (the exact `amount * exchange_rate` bug R04 fixed
    # everywhere else it appeared).
    storage = Storage(in_memory_db)
    storage.insert_transaction(
        source="manual", source_id="thb1", amount=500.0, merchant="Bangkok Grill",
        category="Dining", transaction_date="2026-04-10", tx_type="expense",
        currency="THB", exchange_rate=1.0,
    )
    resp = await client.get("/api/transactions/export")
    lines = resp.text.strip().split("\n")
    row = next(l for l in lines if "Bangkok Grill" in l)
    fields = row.split(",")
    amount_sgd_col = fields[5]  # date,merchant,amount,currency,exchange_rate,amount_sgd,...
    assert amount_sgd_col == ""  # never fabricated as face-value SGD
    assert fields[2] == "500.0"  # the raw original-currency amount is still shown


class TestBudgetAPI:
    @pytest.mark.asyncio
    async def test_create_budget_returns_progress(self, client):
        resp = await client.post("/api/budgets", json={
            "amount": 500.0,
            "period": "monthly",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["period"] == "monthly"
        assert data["amount"] == 500.0

    @pytest.mark.asyncio
    async def test_list_budget_progress(self, client):
        await client.post("/api/budgets", json={"amount": 300.0, "period": "monthly"})
        resp = await client.get("/api/budgets/progress")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # The progress endpoint returns budget_amount, label, period, id
        item = data[0]
        assert "id" in item
        assert "label" in item
        assert "period" in item
        assert "budget_amount" in item

    @pytest.mark.asyncio
    async def test_update_budget(self, client):
        create_resp = await client.post("/api/budgets", json={
            "amount": 400.0,
            "period": "monthly",
        })
        assert create_resp.status_code == 200
        budget_id = create_resp.json()["id"]

        update_resp = await client.put(f"/api/budgets/{budget_id}", json={"amount": 600.0})
        assert update_resp.status_code == 200
        data = update_resp.json()
        assert data["amount"] == 600.0

    @pytest.mark.asyncio
    async def test_delete_budget(self, client):
        create_resp = await client.post("/api/budgets", json={
            "amount": 200.0,
            "period": "weekly",
        })
        assert create_resp.status_code == 200
        budget_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/budgets/{budget_id}")
        assert delete_resp.status_code == 200

        # Confirm removed from progress list
        progress_resp = await client.get("/api/budgets/progress")
        assert progress_resp.status_code == 200
        ids = [b["id"] for b in progress_resp.json()]
        assert budget_id not in ids

    @pytest.mark.asyncio
    async def test_create_budget_missing_amount_returns_400(self, client):
        resp = await client.post("/api/budgets", json={"period": "monthly"})
        assert resp.status_code == 400


class TestGoalAPI:
    @pytest.mark.asyncio
    async def test_create_goal(self, client):
        resp = await client.post("/api/goals", json={
            "name": "Emergency Fund",
            "target_amount": 10000.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Emergency Fund"
        assert data["target_amount"] == 10000.0

    @pytest.mark.asyncio
    async def test_contribute_to_goal(self, client):
        create_resp = await client.post("/api/goals", json={
            "name": "Vacation Fund",
            "target_amount": 5000.0,
        })
        assert create_resp.status_code == 200
        goal_id = create_resp.json()["id"]

        contrib_resp = await client.post(f"/api/goals/{goal_id}/contribute", json={"amount": 500.0})
        assert contrib_resp.status_code == 200
        data = contrib_resp.json()
        assert data["saved_amount"] == 500.0

    @pytest.mark.asyncio
    async def test_delete_goal(self, client):
        create_resp = await client.post("/api/goals", json={
            "name": "Car Fund",
            "target_amount": 20000.0,
        })
        assert create_resp.status_code == 200
        goal_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/goals/{goal_id}")
        assert delete_resp.status_code == 200

    @pytest.mark.asyncio
    async def test_create_goal_missing_name_returns_400(self, client):
        resp = await client.post("/api/goals", json={"target_amount": 1000.0})
        assert resp.status_code == 400


class TestTripAPI:
    @pytest.mark.asyncio
    async def test_create_trip(self, client):
        resp = await client.post("/api/trips", json={
            "name": "Bangkok Trip",
            "start_date": "2026-07-01",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Bangkok Trip"
        assert data["status"] == "inactive"

    @pytest.mark.asyncio
    async def test_activate_trip(self, client):
        create_resp = await client.post("/api/trips", json={
            "name": "Japan Trip",
            "start_date": "2026-08-01",
        })
        assert create_resp.status_code == 200
        trip_id = create_resp.json()["id"]

        activate_resp = await client.post(f"/api/trips/{trip_id}/activate")
        assert activate_resp.status_code == 200
        data = activate_resp.json()
        assert data["status"] == "active"

    @pytest.mark.asyncio
    async def test_delete_trip(self, client):
        create_resp = await client.post("/api/trips", json={
            "name": "Europe Trip",
            "start_date": "2026-09-01",
        })
        assert create_resp.status_code == 200
        trip_id = create_resp.json()["id"]

        delete_resp = await client.delete(f"/api/trips/{trip_id}")
        assert delete_resp.status_code == 200


class TestRecurringAPI:
    @pytest.mark.asyncio
    async def test_recurring_returns_list(self, client):
        resp = await client.get("/api/recurring")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


class TestSettingsFeatureFlags:
    @pytest.mark.asyncio
    async def test_recurring_enabled_in_settings(self, client):
        resp = await client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "recurring_enabled" in data
        assert data["recurring_enabled"] is False

    @pytest.mark.asyncio
    async def test_set_recurring_enabled(self, client):
        put_resp = await client.put("/api/settings", json={"recurring_enabled": True})
        assert put_resp.status_code == 200

        get_resp = await client.get("/api/settings")
        assert get_resp.status_code == 200
        assert get_resp.json()["recurring_enabled"] is True


@pytest.mark.asyncio
async def test_category_edit_only_remembers_when_requested(client, in_memory_db):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='scope-1', amount=12, merchant='Cafe', category='Other')
    storage.set_merchant_override('Cafe', 'Original rule')
    response = await client.put(f'/api/transactions/{tx_id}', json={'category': 'Food'})
    assert response.status_code == 200
    assert response.json()['category'] == 'Food'
    assert storage.get_merchant_overrides() == {'Cafe': 'Original rule'}
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'category': 'Food', 'merchant': 'New Cafe', 'remember_category': True,
    })
    assert response.status_code == 200
    assert storage.get_merchant_overrides() == {'Cafe': 'Original rule', 'New Cafe': 'Food'}


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'category': 'Food', 'remember_category': 'true'},
    {'category': 'Food', 'merchant': '', 'remember_category': True},
    {'description': 'changed', 'remember_category': True},
    {'category': None, 'remember_category': True},
])
async def test_invalid_remember_choice_does_not_partially_edit(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='scope-invalid', amount=12, merchant='Cafe', category='Other')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json=fields)
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'transaction_date': None}, {'transaction_date': 123}, {'transaction_date': ''},
    {'transaction_date': '2026-02-30'}, {'transaction_date': '2026-09-06T25:00:00'},
    {'transaction_date': '2026-W36-7'}, {'transaction_date': '20260906'},
    {'transaction_date': '2026-09-06T12:00:00+99:00'},
    {'transaction_date': '2026-09-06T12:00:00+08:90'},
    {'type': None}, {'type': 'cash'}, {'type': []},
])
async def test_invalid_date_or_type_correction_is_atomic(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='invalid-correction', amount=12, merchant='Cafe', category='Other')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'merchant': 'Changed', 'category': 'Food', 'remember_category': True, **fields,
    })
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('date_value,stored', [
    ('2024-02-29', '2024-02-29T00:00:00'),
    ('2026-09-06 12:30', '2026-09-06T12:30:00'),
    ('2026-09-06T12:30:01+08:00', '2026-09-06T12:30:01+08:00'),
    ('2026-09-06T12:30:01.123Z', '2026-09-06T12:30:01.123000+00:00'),
])
async def test_date_corrections_preserve_precision_and_offset(client, in_memory_db, date_value, stored):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='date-correction', amount=12)
    response = await client.put(f'/api/transactions/{tx_id}', json={'transaction_date': date_value})
    assert response.status_code == 200
    assert response.json()['transaction_date'] == stored


@pytest.mark.asyncio
async def test_correcting_review_date_and_type_updates_facts_without_changing_evidence(client, in_memory_db):
    from datetime import date
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='review-correction', amount=12,
                                       tx_type='unknown', transaction_date=None, raw_data='original payload',
                                       merchant='Employer', category='Salary')
    event = storage.record_source_event('manual', 'original-id', 'original evidence')
    storage.finish_source_event(event['id'], 'processed', tx_id)
    original_event = storage.get_source_event('manual', 'original-id')
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'transaction_date': '2026-08-31T18:00:00+00:00', 'type': 'income',
    })
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 0
    facts = storage.get_month_spending_facts(date(2026, 9, 6))
    assert facts['current']['income']['minor_units'] == 1200
    assert facts['current']['spending']['minor_units'] == 0
    assert storage.get_source_event('manual', 'original-id') == original_event
    assert storage.get_transaction(tx_id)['raw_data'] == 'original payload'
    assert storage.get_transaction(tx_id)['source_id'] == 'review-correction'


@pytest.mark.asyncio
async def test_correction_rejects_non_object_body(client, in_memory_db):
    tx_id = Storage(in_memory_db).insert_transaction(source='manual', source_id='body', amount=12)
    response = await client.put(f'/api/transactions/{tx_id}', json=['transaction_date'])
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'amount': None}, {'amount': True}, {'amount': -1}, {'amount': 'NaN'}, {'amount': '1e309'},
    {'amount': []}, {'exchange_rate': 0}, {'exchange_rate': -1}, {'exchange_rate': True},
    {'exchange_rate': 'Infinity'}, {'exchange_rate': ''}, {'currency': None}, {'currency': 'US'},
    {'currency': 'U$D'},
])
async def test_invalid_monetary_correction_is_atomic(client, in_memory_db, fields):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='money-invalid', amount=12, merchant='Cafe')
    original = storage.get_transaction(tx_id)
    response = await client.put(f'/api/transactions/{tx_id}', json={
        'merchant': 'Changed', 'category': 'Food', 'remember_category': True, **fields,
    })
    assert response.status_code == 422
    assert storage.get_transaction(tx_id) == original
    assert storage.get_merchant_overrides() == {}


@pytest.mark.asyncio
async def test_currency_correction_clears_old_rate_and_refreshes_facts(client, in_memory_db):
    from datetime import date
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='currency-change', amount=12, currency='USD', exchange_rate=1.3, transaction_date='2026-09-01', merchant='Shop', category='Shopping')
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'eur', 'amount': '20.25'})
    assert response.status_code == 200
    assert response.json()['currency'] == 'EUR'
    assert response.json()['exchange_rate'] is None
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={'exchange_rate': '1.5'})
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 0
    facts = storage.get_month_spending_facts(date(2026, 9, 6))
    assert facts['current']['spending']['minor_units'] == 3038
    assert facts['current']['status'] == 'indicative'
    response = await client.put(f'/api/transactions/{tx_id}', json={'exchange_rate': None})
    assert response.status_code == 200
    assert storage.get_spending_review()['total'] == 1
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'SGD', 'amount': 0})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1
    assert storage.get_spending_review()['total'] == 0


@pytest.mark.asyncio
async def test_currency_correction_with_explicit_rate_and_unrelated_edit_preservation(client, in_memory_db):
    storage = Storage(in_memory_db)
    tx_id = storage.insert_transaction(source='manual', source_id='rate-preserve', amount=12, currency='USD', exchange_rate=None)
    response = await client.put(f'/api/transactions/{tx_id}', json={'category': 'Food'})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] is None
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'EUR', 'exchange_rate': 1.5})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1.5
    response = await client.put(f'/api/transactions/{tx_id}', json={'currency': 'EUR'})
    assert response.json()['exchange_rate'] == 1.5


@pytest.mark.asyncio
@pytest.mark.parametrize('fields', [
    {'amount': True}, {'amount': -1}, {'amount': 'NaN'}, {'amount': 'Infinity'},
    {'amount': []}, {'currency': 'US'}, {'currency': None}, {'exchange_rate': 0},
    {'exchange_rate': 'NaN'}, {'transaction_date': None}, {'transaction_date': ''},
    {'transaction_date': '2026-02-30'}, {'source': 'apple_wallet'}, {'merchant': {}},
])
async def test_manual_creation_validation_leaves_no_rows(client, in_memory_db, fields):
    response = await client.post('/api/transactions', json={'amount': 12, 'merchant': 'Cafe', **fields})
    assert response.status_code == 400
    assert Storage(in_memory_db).query_transactions(limit=50) == []


@pytest.mark.asyncio
async def test_manual_creation_unknown_fx_date_normalization_and_native_rate(client):
    response = await client.post('/api/transactions', json={
        'amount': '12.50', 'currency': 'usd', 'transaction_date': '2026-09-01',
    })
    assert response.status_code == 200
    tx = response.json()
    assert tx['currency'] == 'USD'
    assert tx['amount'] == 12.5
    assert tx['exchange_rate'] is None
    assert tx['transaction_date'] == '2026-09-01T00:00:00'
    assert tx['source_id'].startswith('manual_')
    assert (await client.get('/api/v2/spending/review')).json()['total'] == 1
    response = await client.post('/api/transactions', json={'amount': 0, 'source': 'cash'})
    assert response.status_code == 200
    assert response.json()['exchange_rate'] == 1
    assert response.json()['source'] == 'cash'
    assert (await client.post('/api/transactions', json=[])).status_code == 400


@pytest.mark.asyncio
async def test_manual_creation_exposes_provenance_without_snapshot_payload(client, in_memory_db):
    response = await client.post('/api/transactions', json={
        'amount': '12.50', 'merchant': 'Original Cafe', 'description': 'Private note',
        'transaction_date': '2026-09-07',
    })
    tx = response.json()
    assert response.status_code == 200
    provenance = await client.get(f'/api/v2/transactions/{tx["id"]}/provenance')
    assert provenance.json() == {
        'transaction_id': tx['id'], 'sources': [{'channel': 'manual', 'evidence_recorded': True}],
    }
    assert 'Private note' not in provenance.text
    assert tx['source_id'] not in provenance.text
    assert 'manual_entry' not in response.text
    assert Storage(in_memory_db).get_source_event('manual', tx['source_id']) is not None


@pytest.mark.asyncio
async def test_web_creation_idempotency_replay_conflict_and_deletion(client, in_memory_db):
    body = {'amount': 12.5, 'merchant': 'Cafe'}
    headers = {'Idempotency-Key': 'web-request-1'}
    first = await client.post('/api/transactions', json=body, headers=headers)
    assert first.status_code == 200
    # JSON property ordering does not alter request identity.
    replay = await client.post('/api/transactions', json=dict(reversed(list(body.items()))), headers=headers)
    assert replay.json() == first.json()
    assert 'request_key' not in replay.json()
    assert 'fingerprint' not in replay.json()
    conflict = await client.post('/api/transactions', json={**body, 'amount': 20}, headers=headers)
    assert conflict.status_code == 409
    assert len(Storage(in_memory_db).query_transactions(limit=50)) == 1
    await client.delete(f"/api/transactions/{first.json()['id']}")
    deleted = await client.post('/api/transactions', json=body, headers=headers)
    assert deleted.status_code == 409
    assert Storage(in_memory_db).query_transactions(limit=50) == []


@pytest.mark.asyncio
async def test_web_creation_invalid_key_and_legacy_requests(client, in_memory_db):
    body = {'amount': 12}
    invalid = await client.post('/api/transactions', json=body, headers={'Idempotency-Key': 'bad key'})
    assert invalid.status_code == 400
    assert Storage(in_memory_db).query_transactions(limit=50) == []
    first = await client.post('/api/transactions', json=body)
    second = await client.post('/api/transactions', json=body)
    assert first.json()['id'] != second.json()['id']
    await client.post('/api/logout')
    denied = await client.post('/api/transactions', json=body, headers={'Idempotency-Key': 'key'})
    assert denied.status_code == 401


@pytest.mark.asyncio
async def test_telegram_input_review_excludes_raw_payload_and_rejects_bank_retry(client, in_memory_db):
    storage = Storage(in_memory_db)
    event = storage.begin_telegram_nl_input(100, 10, 'private raw financial text')
    storage.fail_telegram_nl_input(event['id'])
    response = await client.get('/api/v2/capture/issues')
    assert response.status_code == 200
    item = next(item for item in response.json() if item['id'] == event['id'])
    assert item['source'] == 'telegram_nl'
    assert 'payload' not in item
    assert 'source_id' not in item
    assert 'private raw financial text' not in response.text
    retry = await client.post(f"/api/v2/capture/issues/{event['id']}/retry")
    assert retry.status_code == 409
    assert storage.get_source_event('telegram_nl', event['source_id'])['status'] == 'failed'


@pytest.mark.asyncio
async def test_capture_resolution_api_auth_privacy_and_reopen(client, in_memory_db):
    storage = Storage(in_memory_db)
    event = storage.begin_telegram_nl_input(100, 10, 'private raw financial text')
    route = f"/api/v2/capture/issues/{event['id']}"
    response = await client.post(route + '/resolve')
    assert response.status_code == 200
    assert response.json() == {'id': event['id'], 'handled': True}
    assert (await client.get('/api/v2/capture/issues')).json() == []
    response = await client.get('/api/v2/capture/issues?include_handled=true')
    assert response.json()[0]['handled'] is True
    assert 'private raw' not in response.text
    assert 'source_id' not in response.json()[0]
    assert (await client.post(route + '/reopen')).json()['handled'] is False
    assert (await client.get('/api/v2/capture/issues')).json()[0]['handled'] is False
    bank = storage.record_source_event('gmail', 'bank', '{}', '1')
    assert (await client.post(f"/api/v2/capture/issues/{bank['id']}/resolve")).status_code == 409
    assert (await client.post('/api/v2/capture/issues/99999/resolve')).status_code == 404
    await client.post('/api/logout')
    for action in ('resolve', 'reopen'):
        assert (await client.post(route + '/' + action)).status_code == 401
    assert (await client.get('/api/v2/capture/issues?include_handled=true')).status_code == 401


@pytest.mark.asyncio
async def test_daily_spending_api_contract_dates_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    storage.insert_transaction(source='manual', source_id='private-daily-source', amount=12.005,
                               transaction_date='2026-09-07T18:00:00+00:00', raw_data='private-daily-payload')
    response = await client.get('/api/v2/spending/day?as_of=2026-09-08')
    assert response.status_code == 200
    facts = response.json()
    assert facts['current']['spending']['minor_units'] == 1201
    assert facts['current']['start'] == facts['current']['end'] == '2026-09-08'
    assert facts['previous']['start'] == facts['previous']['end'] == '2026-09-01'
    assert 'private-daily' not in response.text
    assert (await client.get('/api/v2/spending/day?as_of=0001-01-01')).status_code == 422
    assert (await client.get('/api/v2/spending/day?as_of=invalid')).status_code == 422
    await client.post('/api/logout')
    assert (await client.get('/api/v2/spending/day')).status_code == 401


@pytest.mark.asyncio
async def test_upcoming_plan_api_is_sanitized_bounded_and_authenticated(client, in_memory_db):
    from unittest.mock import patch
    from datetime import datetime
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'annual', notes='PRIVATE NOTES')
    storage.create_upcoming_transaction(sub, '2026-09-08', 12.005)
    with patch('src.storage.local_now', return_value=datetime(2026, 9, 8)):
        response = await client.get('/api/v2/plan/upcoming?days=14')
    assert response.status_code == 200
    report = response.json()
    assert report['items'][0]['frequency'] == 'annual'
    assert report['known_total']['minor_units'] == 1201
    assert 'PRIVATE NOTES' not in response.text
    assert 'notes' not in report['items'][0]
    assert (await client.get('/api/v2/plan/upcoming?days=91')).status_code == 422
    assert (await client.get('/api/v2/plan/upcoming?offset=-1')).status_code == 422
    await client.post('/api/logout')
    assert (await client.get('/api/v2/plan/upcoming')).status_code == 401


@pytest.mark.asyncio
async def test_planned_charge_commands_validation_conflicts_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', 12.005)
    path = f'/api/v2/plan/upcoming/{charge}'
    invalid = await client.put(path, json={'expected_date': '2026-02-30', 'expected_amount': 99})
    assert invalid.status_code == 422
    assert storage.get_upcoming_transaction(charge)['expected_amount'] == 12.005
    response = await client.put(path, json={'expected_date': '2026-09-10', 'expected_amount': None})
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    assert storage.get_upcoming_transaction(charge)['expected_amount'] is None
    assert (await client.post(path + '/dismiss')).status_code == 200
    assert (await client.put(path, json={'expected_amount': 5})).status_code == 409
    assert (await client.post(path + '/dismiss')).status_code == 409
    assert (await client.post('/api/v2/plan/upcoming/999999/dismiss')).status_code == 404
    await client.post('/api/logout')
    assert (await client.put(path, json={'expected_amount': 5})).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401


@pytest.mark.asyncio
async def test_subscription_matching_conflicts_validation_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    other = storage.create_subscription('Cafe', 'monthly')
    first = storage.create_upcoming_transaction(sub, '2026-09-09', 12)
    second = storage.create_upcoming_transaction(other, '2026-09-09', 12)
    tx = (await client.post('/api/transactions', json={'amount': 12, 'merchant': 'Cafe'})).json()['id']
    path = f'/api/subscriptions/{sub}/upcoming/{first}'
    other_path = f'/api/subscriptions/{other}/upcoming/{second}'
    link = f'/api/subscriptions/{other}/link-transaction'
    for invalid in [True, None, '1', 0, -1]:
        assert (await client.post(path + '/match', json={'transaction_id': invalid})).status_code == 422
        assert (await client.post(link, json={'transaction_id': invalid})).status_code == 422
    assert (await client.post(path + '/match', json={'transaction_id': 999999})).status_code == 404
    assert (await client.post(f'/api/subscriptions/{other}/upcoming/{first}/match', json={'transaction_id': tx})).status_code == 404
    for _ in range(2):
        assert (await client.post(path + '/match', json={'transaction_id': tx})).status_code == 200
    assert (await client.post(other_path + '/match', json={'transaction_id': tx})).status_code == 409
    assert (await client.post(link, json={'transaction_id': tx})).status_code == 409
    assert (await client.post(path + '/dismiss')).status_code == 409
    await client.post('/api/logout')
    assert (await client.post(path + '/match', json={'transaction_id': tx})).status_code == 401
    assert (await client.post(link, json={'transaction_id': tx})).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401


@pytest.mark.asyncio
async def test_subscription_pause_resume_api(client, in_memory_db):
    storage = Storage(in_memory_db)
    sub = storage.create_subscription('Cafe', 'monthly')
    charge = storage.create_upcoming_transaction(sub, '2026-09-09', 12)
    path = f'/api/subscriptions/{sub}'
    assert (await client.put(path, json={'status': 'paused'})).json()['status'] == 'paused'
    listing = (await client.get('/api/subscriptions')).json()['subscriptions'][0]
    assert listing['next_expected_date'] is None
    assert listing['next_upcoming_id'] is None
    assert (await client.get(path + '/upcoming')).json()[0]['id'] == charge
    response = await client.put(path, json={'status': 'invalid', 'merchant': 'Changed'})
    assert response.status_code == 422
    assert storage.get_subscription(sub)['merchant'] == 'Cafe'
    assert (await client.put(path, json={'status': 'active'})).json()['status'] == 'active'
    listing = (await client.get('/api/subscriptions')).json()['subscriptions'][0]
    assert listing['next_upcoming_id'] == charge
    assert (await client.put('/api/subscriptions/999999', json={'status': 'paused'})).status_code == 404
    await client.post('/api/logout')
    assert (await client.put(path, json={'status': 'paused'})).status_code == 401


@pytest.mark.asyncio
async def test_subscription_confirmation_api(client, in_memory_db):
    response = await client.post('/api/subscriptions', json={
        'merchant': 'Cafe', 'frequency': 'monthly', 'confirmation_source': 'recurring_suggestion',
    })
    assert response.status_code == 201
    assert response.json()['confirmation_source'] == 'user'
    storage = Storage(in_memory_db)
    legacy = storage.create_subscription('Old', 'monthly')
    storage.update_subscription(legacy, status='paused')
    path = f'/api/subscriptions/{legacy}/confirm'
    for _ in range(2):
        response = await client.post(path)
        assert response.status_code == 200
        assert response.json() == {'status': 'ok'}
    assert storage.get_subscription(legacy)['status'] == 'paused'
    assert storage.get_subscription(legacy)['confirmation_source'] == 'user'
    assert (await client.post('/api/subscriptions/999999/confirm')).status_code == 404
    await client.post('/api/logout')
    assert (await client.post(path)).status_code == 401


@pytest.mark.asyncio
async def test_recurring_review_api_privacy_resolution_validation_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    suggestion = storage.prepare_recurring_suggestion(123456789, 'Full merchant', 'monthly', 98765)
    report = (await client.get('/api/v2/recurring/review?limit=1')).json()
    assert report == {'items': [{'id': suggestion['id'], 'merchant': 'Full merchant', 'frequency': 'monthly'}],
                      'total': 1, 'limit': 1, 'offset': 0}
    for query in ['limit=0', 'limit=101', 'offset=-1']:
        assert (await client.get('/api/v2/recurring/review?' + query)).status_code == 422
    path = f"/api/v2/recurring/suggestions/{suggestion['id']}"
    assert (await client.post(path + '/invalid')).status_code == 422
    first = await client.post(path + '/accept')
    assert first.status_code == 200
    assert set(first.json()) == {'status', 'subscription_id'}
    assert (await client.post(path + '/accept')).json() == first.json()
    assert (await client.get('/api/v2/recurring/review')).json()['total'] == 0
    assert (await client.post(path + '/dismiss')).status_code == 409
    assert (await client.post('/api/v2/recurring/suggestions/missing/accept')).status_code == 404
    second = storage.prepare_recurring_suggestion(123456789, 'Second', 'monthly', 12)
    response = await client.post(f"/api/v2/recurring/suggestions/{second['id']}/dismiss")
    assert response.json() == {'status': 'ok', 'subscription_id': None}
    await client.post('/api/logout')
    assert (await client.get('/api/v2/recurring/review')).status_code == 401
    assert (await client.post(path + '/accept')).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401


@pytest.mark.asyncio
async def test_refund_match_review_api_privacy_resolution_validation_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    purchase = storage.insert_transaction(source='manual', source_id='p1', amount=20,
                                          merchant='Cafe', transaction_date='2026-06-01T12:00:00')
    refund = storage.insert_transaction(source='manual', source_id='r1', amount=20, merchant='Cafe',
                                        transaction_date='2026-06-10T12:00:00', tx_type='refund')
    report = (await client.get('/api/v2/refund-matches/review?limit=1')).json()
    assert report == {'items': [{
        'refund_transaction_id': refund,
        'refund': {'merchant': 'Cafe', 'date': '2026-06-10T12:00:00', 'amount': {'minor_units': 2000, 'currency': 'SGD'}},
        'candidate_purchase': {'transaction_id': purchase, 'merchant': 'Cafe', 'date': '2026-06-01T12:00:00',
                               'amount': {'minor_units': 2000, 'currency': 'SGD'}},
        'reason': 'same_merchant_amount_window',
    }], 'total': 1, 'limit': 1, 'offset': 0}
    for query in ['limit=0', 'limit=101', 'offset=-1']:
        assert (await client.get('/api/v2/refund-matches/review?' + query)).status_code == 422
    path = f"/api/v2/refund-matches/{refund}"
    assert (await client.post(path + '/invalid')).status_code == 422
    assert (await client.post('/api/v2/refund-matches/999999/accept')).status_code == 404
    accept = await client.post(path + '/accept')
    assert accept.status_code == 200
    assert accept.json() == {'status': 'ok'}
    assert storage.get_transaction(refund)['refund_of_transaction_id'] == purchase
    assert (await client.get('/api/v2/refund-matches/review')).json()['total'] == 0
    await client.post('/api/logout')
    assert (await client.get('/api/v2/refund-matches/review')).status_code == 401
    assert (await client.post(path + '/dismiss')).status_code == 401


@pytest.mark.asyncio
async def test_merchant_alias_and_rule_impact_preview_and_apply(client, in_memory_db):
    storage = Storage(in_memory_db)
    matches_already = storage.insert_transaction(source='manual', source_id='g1', amount=10,
                                                  merchant='Grab', category='Transport', transaction_date='2026-06-01')
    differs = storage.insert_transaction(source='manual', source_id='g2', amount=10,
                                         merchant='Grab', category='Rideshare', transaction_date='2026-06-02')
    storage.set_merchant_override('Grab', 'Transport')

    alias = await client.put('/api/merchant-intelligence/Grab/alias', json={'display_name': 'Grab Rides'})
    assert alias.status_code == 200
    assert alias.json() == {'merchant': 'Grab', 'display_name': 'Grab Rides'}
    assert (await client.get('/api/v2/merchants/Grab')).json()['display_name'] == 'Grab Rides'
    assert (await client.get('/api/v2/merchants')).json()[0]['display_name'] == 'Grab Rides'

    impact = await client.get('/api/merchant-intelligence/Grab/rule-impact')
    assert impact.status_code == 200
    assert impact.json() == {'merchant': 'Grab', 'category': 'Transport', 'differing_count': 1}

    apply_resp = await client.post('/api/merchant-intelligence/Grab/apply-rule')
    assert apply_resp.status_code == 200
    assert apply_resp.json() == {'status': 'ok', 'updated_count': 1}
    assert storage.get_transaction(differs)['category'] == 'Transport'
    assert storage.get_transaction(matches_already)['revision'] == 1
    assert (await client.get('/api/merchant-intelligence/Grab/rule-impact')).json()['differing_count'] == 0

    assert (await client.get('/api/merchant-intelligence/NoRule/rule-impact')).status_code == 404
    assert (await client.post('/api/merchant-intelligence/NoRule/apply-rule')).status_code == 404
    await client.post('/api/logout')
    assert (await client.put('/api/merchant-intelligence/Grab/alias', json={'display_name': 'x'})).status_code == 401
    assert (await client.get('/api/merchant-intelligence/Grab/rule-impact')).status_code == 401
    assert (await client.post('/api/merchant-intelligence/Grab/apply-rule')).status_code == 401


@pytest.mark.asyncio
async def test_duplicate_review_dismiss_merge_and_undo_privacy_and_auth(client, in_memory_db):
    storage = Storage(in_memory_db)
    survivor = storage.insert_transaction(source='manual', source_id='p1', amount=10, merchant='Cafe',
                                          transaction_date='2026-06-01T12:00:00')
    loser = storage.insert_transaction(source='gmail', source_id='p2', amount=10, merchant='Cafe',
                                       transaction_date='2026-06-01T12:00:30')
    for source, source_id, tx_id in (('manual', 'p1', survivor), ('gmail', 'p2', loser)):
        event = storage.record_source_event(source, source_id, 'payload', timestamp_precision='second')
        storage.finish_source_event(event['id'], 'processed', transaction_id=tx_id)

    review = await client.get('/api/v2/duplicates/review?limit=1')
    assert review.status_code == 200
    body = review.json()
    assert body['total'] == 1
    assert {body['items'][0]['transaction_a']['id'], body['items'][0]['transaction_b']['id']} == {survivor, loser}
    assert body['items'][0]['reason'] == 'same_merchant_amount_time_cross_source'

    dismiss = await client.post(f'/api/v2/duplicates/{survivor}/{loser}/dismiss')
    assert dismiss.status_code == 200
    assert dismiss.json() == {'status': 'ok'}
    assert (await client.get('/api/v2/duplicates/review')).json()['total'] == 0

    merge = await client.post('/api/v2/duplicates/merge', json={'survivor_id': survivor, 'loser_id': loser})
    assert merge.status_code == 200
    merge_id = merge.json()['merge_id']
    assert (await client.get(f'/api/transactions/{loser}')).status_code == 404
    assert 'private' not in merge.text

    bad_merge = await client.post('/api/v2/duplicates/merge', json={'survivor_id': survivor, 'loser_id': survivor})
    assert bad_merge.status_code == 404

    undo = await client.post(f'/api/v2/duplicates/merges/{merge_id}/undo')
    assert undo.status_code == 200
    assert (await client.get(f'/api/transactions/{loser}')).status_code == 200
    assert (await client.post(f'/api/v2/duplicates/merges/{merge_id}/undo')).status_code == 404

    await client.post('/api/logout')
    assert (await client.get('/api/v2/duplicates/review')).status_code == 401
    assert (await client.post(f'/api/v2/duplicates/{survivor}/{loser}/dismiss')).status_code == 401
    assert (await client.post('/api/v2/duplicates/merge', json={'survivor_id': survivor, 'loser_id': loser})).status_code == 401
