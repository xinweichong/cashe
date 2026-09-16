import pytest
from datetime import datetime, date, timedelta
from src.storage import Storage


class TestGoalCRUD:
    def test_create_goal_no_deadline(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Emergency Fund", target_amount=10000.0)
        assert isinstance(goal_id, int)
        goals = storage.get_goals()
        assert len(goals) == 1
        assert goals[0]["name"] == "Emergency Fund"
        assert goals[0]["target_amount"] == 10000.0
        assert goals[0]["saved_amount"] == 0.0
        assert goals[0]["status"] == "active"
        assert goals[0]["target_date"] is None

    def test_create_goal_with_deadline(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        storage.create_goal(name="Japan Trip", target_amount=2000.0, target_date="2026-12-01")
        goals = storage.get_goals()
        assert goals[0]["target_date"] == "2026-12-01"

    def test_update_goal_name_and_target(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Old Name", target_amount=500.0)
        storage.update_goal(goal_id, name="New Name", target_amount=1000.0)
        goals = storage.get_goals()
        assert goals[0]["name"] == "New Name"
        assert goals[0]["target_amount"] == 1000.0

    def test_update_goal_status(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Test", target_amount=100.0)
        storage.update_goal(goal_id, status="paused")
        assert storage.get_goals()[0]["status"] == "paused"

    def test_update_nonexistent_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        with pytest.raises(ValueError):
            storage.update_goal(999, name="X")

    def test_delete_goal_removes_contributions(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Test", target_amount=100.0)
        storage.add_contribution(goal_id, amount=50.0, month="2026-04", source="manual")
        storage.delete_goal(goal_id)
        assert storage.get_goals() == []
        # Contributions should also be gone (ON DELETE CASCADE)
        rows = in_memory_db.execute("SELECT * FROM goal_contributions WHERE goal_id = ?", (goal_id,)).fetchall()
        assert len(rows) == 0

    def test_delete_nonexistent_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        with pytest.raises(ValueError):
            storage.delete_goal(999)


class TestGoalContributions:
    def test_add_manual_contribution_updates_saved_amount(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=200.0, month="2026-04", source="manual")
        goals = storage.get_goals()
        assert goals[0]["saved_amount"] == 200.0

    def test_add_auto_contribution(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=300.0, month="2026-03", source="auto")
        goals = storage.get_goals()
        assert goals[0]["saved_amount"] == 300.0

    def test_multiple_contributions_accumulate(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=100.0, month="2026-02", source="auto")
        storage.add_contribution(goal_id, amount=200.0, month="2026-03", source="auto")
        storage.add_contribution(goal_id, amount=50.0, month="2026-04", source="manual")
        assert storage.get_goals()[0]["saved_amount"] == 350.0

    def test_get_contributions_ordered_by_month(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=300.0, month="2026-03", source="auto")
        storage.add_contribution(goal_id, amount=100.0, month="2026-01", source="auto")
        contribs = storage.get_contributions(goal_id)
        assert contribs[0]["month"] == "2026-01"
        assert contribs[1]["month"] == "2026-03"

    def test_add_contribution_for_nonexistent_goal_raises(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        with pytest.raises(ValueError):
            storage.add_contribution(999, amount=100.0, month="2026-04", source="manual")

    def test_add_contribution_auto_completes_goal(self, in_memory_db):
        """Contribution that hits or exceeds target_amount auto-sets status to 'completed'."""
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=100.0)
        storage.add_contribution(goal_id, amount=100.0, month="2026-04", source="manual")
        assert storage.get_goals()[0]["status"] == "completed"

    def test_add_contribution_partial_stays_active(self, in_memory_db):
        """Contribution below the target does not change status."""
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=100.0)
        storage.add_contribution(goal_id, amount=50.0, month="2026-04", source="manual")
        assert storage.get_goals()[0]["status"] == "active"

    def test_add_contribution_over_target_completes_goal(self, in_memory_db):
        """Contribution exceeding target_amount also sets status to 'completed'."""
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=100.0)
        storage.add_contribution(goal_id, amount=150.0, month="2026-04", source="auto")
        assert storage.get_goals()[0]["status"] == "completed"


class TestGoalProgress:
    def test_progress_zero_when_no_contributions(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        progress = storage.get_goal_progress(goal_id)
        assert progress["percent"] == 0.0
        assert progress["monthly_rate"] is None
        assert progress["rate_window"] is None
        assert progress["months_to_target"] is None

    def test_percent_calculated_correctly(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=250.0, month="2026-04", source="manual")
        progress = storage.get_goal_progress(goal_id)
        assert progress["percent"] == pytest.approx(25.0, 0.01)

    def test_a_single_contribution_has_no_elapsed_window_and_rate_is_unavailable(self, in_memory_db):
        # R13: sparse histories must produce an unavailable estimate rather
        # than an invented rate — a lone contribution has no elapsed window.
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        storage.add_contribution(goal_id, amount=250.0, month="2026-04", source="manual", contributed_date="2026-04-15")
        progress = storage.get_goal_progress(goal_id)
        assert progress["monthly_rate"] is None
        assert progress["rate_window"] is None
        assert progress["months_to_target"] is None

    def test_same_day_contributions_have_no_elapsed_window_and_rate_is_unavailable(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        for amount in (100.0, 100.0, 100.0):
            storage.add_contribution(goal_id, amount=amount, month="2026-04", source="manual", contributed_date="2026-04-15")
        progress = storage.get_goal_progress(goal_id)
        assert progress["monthly_rate"] is None

    def test_same_contribution_amounts_on_different_dates_produce_different_rate_estimates(self, in_memory_db):
        # The exact R13 exit check: the same three $100 contributions imply a
        # different pace depending on whether they happened in one day or
        # were spread across three months.
        storage = Storage(connection=in_memory_db)
        bunched_goal = storage.create_goal(name="Bunched", target_amount=10000.0)
        for _ in range(3):
            storage.add_contribution(bunched_goal, amount=100.0, month="2026-04", source="manual", contributed_date="2026-04-15")
        bunched = storage.get_goal_progress(bunched_goal)

        spread_goal = storage.create_goal(name="Spread", target_amount=10000.0)
        for date_str in ("2026-01-15", "2026-02-15", "2026-04-15"):
            storage.add_contribution(spread_goal, amount=100.0, month=date_str[:7], source="manual", contributed_date=date_str)
        spread = storage.get_goal_progress(spread_goal)

        assert bunched["monthly_rate"] is None  # zero elapsed days between first and last
        assert spread["monthly_rate"] is not None
        assert spread["monthly_rate"] != bunched["monthly_rate"]

    def test_monthly_rate_uses_the_dated_elapsed_window_not_a_flat_average(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=10000.0)
        # $100 + $200 + $300 + $400 = $1000 total, spread across exactly 3
        # calendar months (Jan 1 to Apr 1 = 90 days ≈ 2.957 months).
        for date_str, amount in [
            ("2026-01-01", 100.0), ("2026-02-01", 200.0), ("2026-03-01", 300.0), ("2026-04-01", 400.0),
        ]:
            storage.add_contribution(goal_id, amount=amount, month=date_str[:7], source="auto", contributed_date=date_str)
        progress = storage.get_goal_progress(goal_id)
        expected_rate = 1000.0 / (90 / 30.436875)
        assert progress["monthly_rate"] == pytest.approx(expected_rate, 0.01)
        assert progress["rate_window"] == {"start": "2026-01-01", "end": "2026-04-01"}

    def test_months_to_target_calculated(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1200.0)
        # $100 x 3, dated Feb 1 to Apr 1 (59 days elapsed ≈ 1.94 months):
        # rate ≈ $300 / 1.94 ≈ $154.76/mo, saved=$300, remaining=$900.
        for date_str in ("2026-02-01", "2026-03-01", "2026-04-01"):
            storage.add_contribution(goal_id, amount=100.0, month=date_str[:7], source="auto", contributed_date=date_str)
        progress = storage.get_goal_progress(goal_id)
        expected_rate = 300.0 / (59 / 30.436875)
        assert progress["monthly_rate"] == pytest.approx(expected_rate, 0.01)
        assert progress["months_to_target"] == pytest.approx(900.0 / expected_rate, 0.01)

    def test_on_track_status_when_no_deadline(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        goal_id = storage.create_goal(name="Fund", target_amount=1000.0)
        progress = storage.get_goal_progress(goal_id)
        assert progress["on_track"] is None  # no deadline → no on_track verdict

    def test_get_goal_progress_returns_none_for_unknown(self, in_memory_db):
        storage = Storage(connection=in_memory_db)
        assert storage.get_goal_progress(999) is None


import bcrypt
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from src.storage import Storage, AdminStorage
from src.web.app import create_dashboard_app
from helpers import FakeUserManager, make_admin_db_with_user, TEST_USERNAME, TEST_PASSWORD


@pytest.fixture
def goal_app(in_memory_db):
    from src.web import auth as _auth
    admin_conn = make_admin_db_with_user()
    admin_storage = AdminStorage(admin_conn)
    _auth.init_auth(admin_storage)
    storage = Storage(connection=in_memory_db)
    user_manager = FakeUserManager(storage)
    yield create_dashboard_app(user_manager, admin_storage), storage
    _auth._admin_storage = None


@pytest_asyncio.fixture
async def api(goal_app):
    app, storage = goal_app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        yield ac, storage


class TestGoalAPI:
    @pytest.mark.asyncio
    async def test_get_goals_empty(self, api):
        ac, _ = api
        resp = await ac.get("/api/goals")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_create_goal(self, api):
        ac, _ = api
        resp = await ac.post(
            "/api/goals",
            json={"name": "Emergency Fund", "target_amount": 10000},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Emergency Fund"
        assert data["target_amount"] == 10000.0
        assert data["saved_amount"] == 0.0
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_goal_requires_name_and_amount(self, api):
        ac, _ = api
        resp = await ac.post("/api/goals", json={"name": "X"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_update_goal(self, api):
        ac, _ = api
        create = await ac.post("/api/goals", json={"name": "X", "target_amount": 500})
        goal_id = create.json()["id"]
        resp = await ac.put(f"/api/goals/{goal_id}", json={"name": "Y", "target_amount": 1000})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Y"
        assert resp.json()["target_amount"] == 1000.0

    @pytest.mark.asyncio
    async def test_delete_goal(self, api):
        ac, _ = api
        create = await ac.post("/api/goals", json={"name": "X", "target_amount": 100})
        goal_id = create.json()["id"]
        resp = await ac.delete(f"/api/goals/{goal_id}")
        assert resp.status_code == 200
        assert (await ac.get("/api/goals")).json() == []

    @pytest.mark.asyncio
    async def test_manual_contribution(self, api):
        ac, _ = api
        create = await ac.post("/api/goals", json={"name": "X", "target_amount": 1000})
        goal_id = create.json()["id"]
        resp = await ac.post(
            f"/api/goals/{goal_id}/contribute",
            json={"amount": 250, "note": "Bonus"},
        )
        assert resp.status_code == 200
        goals_resp = await ac.get("/api/goals")
        assert goals_resp.json()[0]["saved_amount"] == 250.0

    @pytest.mark.asyncio
    async def test_get_contributions(self, api):
        ac, _ = api
        create = await ac.post("/api/goals", json={"name": "X", "target_amount": 1000})
        goal_id = create.json()["id"]
        await ac.post(f"/api/goals/{goal_id}/contribute", json={"amount": 100})
        resp = await ac.get(f"/api/goals/{goal_id}/contributions")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["source"] == "manual"


class TestGoalAPIV2:
    @pytest.mark.asyncio
    async def test_list_v2_empty(self, api):
        ac, _ = api
        resp = await ac.get("/api/v2/goals")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_v2_returns_typed_money(self, api):
        ac, _ = api
        create = await ac.post("/api/goals", json={"name": "Emergency Fund", "target_amount": 1000})
        goal_id = create.json()["id"]
        await ac.post(f"/api/goals/{goal_id}/contribute", json={"amount": 250, "note": "Bonus"})

        resp = await ac.get("/api/v2/goals")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        goal = data[0]
        assert goal["name"] == "Emergency Fund"
        assert goal["target_amount"] == {"minor_units": 100000, "currency": "SGD"}
        assert goal["saved_amount"] == {"minor_units": 25000, "currency": "SGD"}
        assert goal["monthly_rate"] is None  # a single contribution has no elapsed window to infer a rate from
        assert goal["rate_window"] is None
        assert goal["percent"] == 25.0
        assert len(goal["contributions"]) == 1
        contribution = goal["contributions"][0]
        assert contribution["amount"] == {"minor_units": 25000, "currency": "SGD"}
        assert contribution["source"] == "manual"
        assert contribution["note"] == "Bonus"

    @pytest.mark.asyncio
    async def test_list_v2_requires_auth(self, api):
        ac, _ = api
        await ac.post("/api/logout")
        resp = await ac.get("/api/v2/goals")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_settings_includes_goals_enabled(self, api):
        ac, _ = api
        resp = await ac.get("/api/settings")
        assert "goals_enabled" in resp.json()
        assert resp.json()["goals_enabled"] is False

    @pytest.mark.asyncio
    async def test_toggle_goals_enabled(self, api):
        ac, _ = api
        resp = await ac.put("/api/settings", json={"goals_enabled": True})
        assert resp.status_code == 200
        resp2 = await ac.get("/api/settings")
        assert resp2.json()["goals_enabled"] is True
