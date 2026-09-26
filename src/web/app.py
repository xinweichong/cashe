import asyncio
import logging
import os
import secrets
import hashlib
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from functools import partial
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
import csv
import io
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse

from src.storage import Conflict, NotFound, RevisionConflict
from src import transaction_commands
from src.money import to_minor_units, from_minor_units
from src.spending_facts import resolve_money
from src.config import DEFAULT_TIMEZONE, local_now
from src.web.auth import LoginRateLimiter, create_session, destroy_session, hash_password, verify_password, verify_session
from src.web.contracts import BudgetProgress, BulkTransactionRequest, BulkTransactionResultItem, BulkUndoRequest, CaptureFollowup, CaptureIssue, CaptureResolution, CategoryBreakdown, CategoryTrendPoint, DailyTotal, GoalProgress, HealthScore, HomeBriefing, MerchantRanking, MerchantSummary, QueuedResponse, SpendingEvidence, SpendingFacts, SpendingReview, TransactionCorrection, TransactionCreate, TransactionDeletion, TransactionProvenance, TransactionUndo, TransactionV2, TripSummary, UpcomingPlan, UpcomingCalendar, PlanMutationResponse, RecurringReview, RecurringResolution, RefundMatchReview, RefundMatchResolution, DuplicateReview, DuplicateDismissal, DuplicateMergeRequest, DuplicateMergeResult, DuplicateMergeUndoResult, SubscriptionReview, WeekdayPattern, MonthForecast, ScenarioRequest, ScenarioResponse, SpendingSignals, MonthlyFlow

logger = logging.getLogger(__name__)


# Keeps blocking SQLite calls off the event loop. Each Storage serialises its
# own calls (one lock per instance), so the workers run different users' and
# the admin database's calls concurrently, never one database's.
_DB_EXECUTOR = ThreadPoolExecutor(max_workers=4)


async def _db(fn, *args, **kwargs):
    """Run a synchronous storage/DB call in the dedicated DB thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_DB_EXECUTOR, partial(fn, *args, **kwargs))


def _http_error(exc: ValueError, default: int) -> HTTPException:
    """Storage's NotFound and Conflict carry their own status; any other
    ValueError is a bad request with the route's `default` status."""
    status = 404 if isinstance(exc, NotFound) else 409 if isinstance(exc, Conflict) else default
    return HTTPException(status_code=status, detail=str(exc))


def _parse_bool_setting(value) -> str:
    if not isinstance(value, bool):
        raise ValueError("must be a boolean")
    return "true" if value else "false"


def _parse_ranged_setting(cast, low, high, kind):
    def parse(value) -> str:
        try:
            value = cast(value)
        except (TypeError, ValueError):
            raise ValueError(f"must be {kind}") from None
        if not low <= value <= high:
            raise ValueError(f"must be between {low} and {high}")
        return str(value)
    return parse


def _is_true(value: str) -> bool:
    return value == "true"


# key → (stored default, read the stored string, validate a PUT value into
# the string to store). Drives both GET and PUT /api/settings.
SETTINGS = {
    "anomaly_multiplier": ("2.0", float, _parse_ranged_setting(float, 1.0, 10.0, "a number")),
    "velocity_alert_threshold": ("110", int, _parse_ranged_setting(int, 50, 300, "an integer")),
    **{key: ("false", _is_true, _parse_bool_setting) for key in (
        "budgets_enabled", "goals_enabled", "trips_enabled", "subscriptions_enabled",
        "recurring_enabled", "home_briefing_enabled",
    )},
    "category_colors_snapped_v2": ("false", str, str),
}
# Accepted by PUT but never returned.
WRITE_ONLY_SETTINGS = {"category_colors_pre_v2": str}


VALID_SUBSCRIPTION_FREQUENCIES = {"weekly", "biweekly", "monthly", "quarterly", "annual"}


def create_dashboard_app(
    user_manager,
    admin_storage,
    exchange_service=None,
    host_base_url: str = "",
    llm_service=None,
    timezone: str = DEFAULT_TIMEZONE,
) -> FastAPI:
    app = FastAPI(title="Expense Tracker Dashboard")
    app.add_middleware(GZipMiddleware, minimum_size=500)

    oauth_states: dict[str, tuple[str, str, float]] = {}
    login_limiter = LoginRateLimiter()

    @app.get("/oauth/callback")
    async def oauth_callback(request: Request):
        code = request.query_params.get("code")
        state = request.query_params.get("state", "")
        pending = oauth_states.pop(state, None)
        session = request.cookies.get("session", "")
        if not code or not pending or pending[2] <= time.monotonic() or pending[1] != session:
            raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
        username = await _db(verify_session, session)
        if username != pending[0]:
            raise HTTPException(status_code=400, detail="Invalid OAuth session")
        ctx = user_manager.get(username)
        if not ctx:
            return Response(content="<h2>Unknown user.</h2>", media_type="text/html", status_code=404)
        try:
            await _db(ctx.poller.complete_reauth, code, state)
            user_manager.start_poller(username)
            await _db(admin_storage.update_user, username, gmail_connected=1)
            return Response(
                content="<h2>Gmail connected. You can close this tab.</h2>",
                media_type="text/html",
            )
        except Exception as e:
            logger.warning("OAuth callback failed: %s", type(e).__name__)
            return Response(content="<h2>Connection failed. Please reconnect from Settings.</h2>", media_type="text/html", status_code=400)

    @app.post("/api/login")
    async def login(request: Request):
        body = await request.json()
        username = body.get("username", "")
        password = body.get("password", "")
        if not isinstance(username, str) or not isinstance(password, str):
            raise HTTPException(status_code=422, detail="Username and password must be strings")
        keys = ["user:" + username.casefold(), "ip:" + (request.client.host if request.client else "unknown")]
        stamp = login_limiter.reserve(keys, time.monotonic())
        if stamp is None:
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
        loop = asyncio.get_running_loop()
        user = await _db(admin_storage.get_user, username)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        ok = await loop.run_in_executor(None, verify_password, password, user["password_hash"])
        if not ok:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        login_limiter.clear(keys[0])
        login_limiter.release(keys[1], stamp)
        user_agent = request.headers.get("User-Agent", "")
        token = await _db(create_session, username, user_agent)
        secure_cookies = os.environ.get("SECURE_COOKIES", "true") == "true"
        response = JSONResponse({"status": "ok"})
        response.set_cookie(
            key="session",
            value=token,
            httponly=True,
            samesite="lax",
            secure=secure_cookies,
            max_age=86400 * 30,
        )
        return response

    # Endpoints that a force_password_change user may still access.
    _FORCE_PW_ALLOWED = {"/api/logout", "/api/users/me", "/api/users/me/password"}

    async def require_auth(request: Request) -> str:
        session = request.cookies.get("session")
        username = await _db(verify_session, session) if session else None
        if not username:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user = await _db(admin_storage.get_user, username)
        if user and user["force_password_change"] and request.url.path not in _FORCE_PW_ALLOWED:
            raise HTTPException(status_code=403, detail="Password change required")
        return username

    def _get_storage(username: str = Depends(require_auth)):
        ctx = user_manager.get(username)
        if not ctx:
            raise HTTPException(status_code=500, detail="User context not found")
        return ctx.storage

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/ping")
    async def ping(username: str = Depends(require_auth)):
        return {"status": "ok"}

    @app.post("/api/logout")
    async def logout(request: Request, response: Response):
        session = request.cookies.get("session")
        if session:
            await _db(destroy_session, session)
        response.delete_cookie("session", httponly=True, samesite="lax")
        return {"status": "ok"}

    @app.get("/api/status")
    async def get_status(username: str = Depends(require_auth)):
        ctx = user_manager.get(username)
        poller = ctx.poller if ctx else None
        return {
            "gmail": {
                "authenticated": poller.service is not None if poller else None,
                "last_auth_error": getattr(poller, "last_auth_error", None),
                "last_poll_at": getattr(poller, "last_poll_at", None),
            },
            "telegram": {
                "running": None,
                "last_error": None,
            },
            "exchange": {
                "using_fallback": exchange_service.using_fallback if exchange_service else None,
                "last_fetch_error": exchange_service.last_fetch_error if exchange_service else None,
            },
        }

    @app.get("/api/v2/capture/issues", response_model=list[CaptureIssue])
    async def capture_issues(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), include_handled: bool = False, storage=Depends(_get_storage)):
        return await _db(storage.list_capture_issues, limit, offset, include_handled)

    @app.post("/api/v2/capture/issues/{event_id}/resolve", response_model=CaptureResolution)
    async def resolve_capture_issue(event_id: int, storage=Depends(_get_storage)):
        return await change_capture_resolution(storage, event_id, True)

    @app.post("/api/v2/capture/issues/{event_id}/reopen", response_model=CaptureResolution)
    async def reopen_capture_issue(event_id: int, storage=Depends(_get_storage)):
        return await change_capture_resolution(storage, event_id, False)

    async def change_capture_resolution(storage, event_id, handled):
        try:
            return await _db(storage.set_capture_issue_handled, event_id, handled)
        except ValueError as exc:
            raise _http_error(exc, 409)

    @app.post("/api/v2/capture/issues/{event_id}/retry", response_model=QueuedResponse)
    async def retry_capture_issue(event_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.retry_source_event, event_id)
        except ValueError as exc:
            raise _http_error(exc, 409)
        return QueuedResponse()

    @app.get("/api/v2/capture/followups", response_model=list[CaptureFollowup])
    async def capture_followups(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), storage=Depends(_get_storage)):
        return await _db(storage.list_ingestion_effects, limit, offset)

    @app.post("/api/v2/capture/followups/{effect_id}/retry", response_model=QueuedResponse)
    async def retry_capture_followup(effect_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.retry_ingestion_effect, effect_id)
        except ValueError as exc:
            raise _http_error(exc, 409)
        return QueuedResponse()

    @app.get("/api/v2/spending/month", response_model=SpendingFacts)
    async def month_spending(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_month_spending_facts, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.put("/api/v2/plan/upcoming/{upcoming_id}", response_model=PlanMutationResponse)
    async def update_planned_charge(upcoming_id: int, body: dict, storage=Depends(_get_storage)):
        try:
            await _db(storage.update_planned_charge, upcoming_id, body)
        except ValueError as exc:
            raise _http_error(exc, 422) from None
        return {"status": "ok"}

    @app.post("/api/v2/plan/upcoming/{upcoming_id}/dismiss", response_model=PlanMutationResponse)
    async def dismiss_planned_charge(upcoming_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.dismiss_planned_charge, upcoming_id)
        except ValueError as exc:
            raise _http_error(exc, 409) from None
        return {"status": "ok"}

    @app.get("/api/v2/plan/upcoming", response_model=UpcomingPlan)
    async def upcoming_plan(days: int = Query(30, ge=1, le=90), limit: int = Query(50, ge=1, le=100),
                            offset: int = Query(0, ge=0), on_date: date | None = Query(None, alias="date"),
                            storage=Depends(_get_storage)):
        return await _db(storage.get_upcoming_plan, days, timezone, limit, offset, on_date)

    @app.get("/api/v2/plan/upcoming/calendar", response_model=UpcomingCalendar)
    async def upcoming_calendar(start: date, end: date, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_upcoming_calendar, start, end, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/home", response_model=HomeBriefing)
    async def home_briefing(username: str = Depends(require_auth)):
        ctx = user_manager.get(username)
        report = await _db(ctx.storage.get_home_briefing, timezone)
        poller = ctx.poller
        capture_health = await _db(ctx.storage.get_capture_health)
        report["freshness"] = {
            "gmail_connected": bool(poller and poller.service),
            "gmail_last_checked": getattr(poller, "last_poll_at", None),
            "gmail_needs_reconnection": bool(getattr(poller, "last_auth_error", None)),
            "last_capture_processed_at": capture_health["last_capture_processed_at"],
        }
        return report

    @app.get("/api/v2/spending/day", response_model=SpendingFacts)
    async def day_spending(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_day_spending_facts, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/spending/week", response_model=SpendingFacts)
    async def week_spending(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_week_spending_facts, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/recurring/review", response_model=RecurringReview)
    async def recurring_review(
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_recurring_review, limit=limit, offset=offset)

    @app.get("/api/v2/subscriptions/review", response_model=SubscriptionReview)
    async def subscription_review(storage=Depends(_get_storage)):
        return await _db(storage.get_subscription_review)

    @app.post("/api/v2/recurring/suggestions/{suggestion_id}/{action}", response_model=RecurringResolution)
    async def resolve_recurring_review(
        suggestion_id: str, action: Literal["accept", "dismiss"], storage=Depends(_get_storage),
    ):
        try:
            sub_id = await _db(storage.resolve_recurring_review, suggestion_id, action)
        except ValueError as exc:
            raise _http_error(exc, 404) from None
        return {"status": "ok", "subscription_id": sub_id}

    @app.get("/api/v2/refund-matches/review", response_model=RefundMatchReview)
    async def refund_match_review(
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_refund_match_review, limit=limit, offset=offset)

    @app.post("/api/v2/refund-matches/{refund_transaction_id}/{action}", response_model=RefundMatchResolution)
    async def resolve_refund_match(
        refund_transaction_id: int, action: Literal["accept", "dismiss"], storage=Depends(_get_storage),
    ):
        try:
            await _db(storage.resolve_refund_match, refund_transaction_id, action)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        return {"status": "ok"}

    @app.get("/api/v2/duplicates/review", response_model=DuplicateReview)
    async def duplicate_review(
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_duplicate_review, limit=limit, offset=offset)

    @app.post("/api/v2/duplicates/{transaction_a_id}/{transaction_b_id}/dismiss", response_model=DuplicateDismissal)
    async def dismiss_duplicate(transaction_a_id: int, transaction_b_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.dismiss_duplicate, transaction_a_id, transaction_b_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        return {"status": "ok"}

    @app.post("/api/v2/duplicates/merge", response_model=DuplicateMergeResult)
    async def merge_duplicates(body: DuplicateMergeRequest, storage=Depends(_get_storage)):
        try:
            merge_id = await _db(storage.merge_transactions, body.survivor_id, body.loser_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        return {"status": "ok", "merge_id": merge_id}

    @app.post("/api/v2/duplicates/merges/{merge_id}/undo", response_model=DuplicateMergeUndoResult)
    async def undo_duplicate_merge(merge_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.undo_transaction_merge, merge_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        return {"status": "ok"}

    @app.get("/api/v2/spending/review", response_model=SpendingReview)
    async def spending_review(
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_spending_review, timezone=timezone, limit=limit, offset=offset)

    @app.get("/api/v2/spending/evidence", response_model=SpendingEvidence)
    async def spending_evidence(
        start: date, end: date, category: str | None = None, merchant: str | None = None,
        weekday: int | None = Query(None, ge=0, le=6),
        measure: Literal["spending", "income", "unresolved"] = "spending",
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        return await _db(storage.get_spending_evidence, start, end, timezone=timezone,
                         category=category, merchant=merchant, weekday=weekday, measure=measure, limit=limit, offset=offset)

    @app.get("/api/v2/spending/signals", response_model=SpendingSignals)
    async def spending_signals(as_of: date | None = None, storage=Depends(_get_storage)):
        return await _db(storage.get_spending_signals, as_of, timezone)

    @app.get("/api/v2/spending/monthly", response_model=list[MonthlyFlow])
    async def spending_monthly(months: int = Query(6, ge=1, le=36), storage=Depends(_get_storage)):
        return await _db(storage.get_monthly_flows, months, None, timezone)

    @app.get("/api/v2/spending/weekday-pattern", response_model=WeekdayPattern)
    async def weekday_pattern(weeks: int = Query(8, ge=1, le=52), storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_weekday_pattern, None, weeks, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/forecast/month", response_model=MonthForecast)
    async def month_forecast(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_month_forecast, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.post("/api/v2/forecast/scenario", response_model=ScenarioResponse)
    async def forecast_scenario(request: ScenarioRequest, storage=Depends(_get_storage)):
        if not request.adjustments:
            raise HTTPException(status_code=422, detail="At least one adjustment is required")
        adjustments = [a.model_dump(exclude_none=True) for a in request.adjustments]
        try:
            return await _db(storage.get_forecast_scenario, adjustments, None, timezone)
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    # ── Current user ──────────────────────────────────────────────────────────

    @app.get("/api/users/me")
    async def get_current_user(username: str = Depends(require_auth)):
        user = await _db(admin_storage.get_user, username)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "username": user["username"],
            "gmail_connected": bool(user["gmail_connected"]),
            "telegram_chat_id": user["telegram_chat_id"],
            "wants_gmail": bool(user["wants_gmail"]),
            "wants_apple_wallet": bool(user["wants_apple_wallet"]),
            "onboarding_complete": bool(user["onboarding_complete"]),
            "force_password_change": bool(user["force_password_change"]),
        }

    @app.put("/api/users/me/password")
    async def change_password(request: Request, username: str = Depends(require_auth)):
        body = await request.json()
        current_password = body.get("current_password", "")
        new_password = body.get("new_password", "")
        if not new_password or len(new_password) < 8:
            raise HTTPException(status_code=422, detail="new_password must be at least 8 characters")
        loop = asyncio.get_running_loop()
        user = await _db(admin_storage.get_user, username)
        ok = await loop.run_in_executor(None, verify_password, current_password, user["password_hash"])
        if not ok:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        new_hash = await loop.run_in_executor(None, hash_password, new_password)
        await _db(admin_storage.update_user, username, password_hash=new_hash, force_password_change=0)
        return {"status": "ok"}

    # ── Session management ────────────────────────────────────────────────────

    @app.get("/api/sessions")
    async def list_sessions(request: Request, username: str = Depends(require_auth)):
        return await _db(admin_storage.list_sessions, username)

    @app.delete("/api/sessions")
    async def logout_all_other_sessions(request: Request, username: str = Depends(require_auth)):
        current_token = request.cookies.get("session")
        await _db(admin_storage.destroy_all_sessions, username, except_token=current_token)
        return {"status": "ok"}

    @app.delete("/api/sessions/{token}")
    async def logout_session(token: str, username: str = Depends(require_auth)):
        sessions = await _db(admin_storage.list_sessions, username)
        if not any(s["token"] == token for s in sessions):
            raise HTTPException(status_code=404, detail="Session not found")
        await _db(admin_storage.destroy_session, token)
        return {"status": "ok"}

    # ── Onboarding ────────────────────────────────────────────────────────────

    @app.put("/api/onboarding/preferences")
    async def set_onboarding_preferences(request: Request, username: str = Depends(require_auth)):
        body = await request.json()
        await _db(
            admin_storage.update_user,
            username,
            wants_gmail=1 if body.get("wants_gmail", True) else 0,
            wants_apple_wallet=1 if body.get("wants_apple_wallet", True) else 0,
        )
        return {"status": "ok"}

    @app.get("/api/onboarding/gmail/connect-url")
    async def gmail_connect_url(request: Request, username: str = Depends(require_auth)):
        ctx = user_manager.get(username)
        if not ctx:
            raise HTTPException(status_code=503, detail="User context not ready — please try again")
        redirect_uri = f"{host_base_url.rstrip('/')}/oauth/callback"
        for token, pending in list(oauth_states.items()):
            if pending[0] == username or pending[2] <= time.monotonic():
                del oauth_states[token]
        state = secrets.token_urlsafe(32)
        url = ctx.poller.get_auth_url(redirect_uri=redirect_uri, state=state)
        oauth_states[state] = (username, request.cookies["session"], time.monotonic() + 600)
        return {"url": url}

    @app.post("/api/onboarding/telegram/link-token")
    async def create_telegram_link_token(username: str = Depends(require_auth)):
        token = await _db(admin_storage.create_telegram_link_token, username)
        return {"token": token}

    @app.get("/api/onboarding/webhook-url")
    async def get_webhook_url(username: str = Depends(require_auth)):
        url = f"{host_base_url.rstrip('/')}/webhook/apple-wallet/{username}"
        return {"url": url}

    @app.put("/api/onboarding/complete")
    async def mark_onboarding_complete(username: str = Depends(require_auth)):
        await _db(admin_storage.update_user, username, onboarding_complete=1)
        return {"status": "ok"}

    @app.get("/api/connections/apple-wallet")
    async def wallet_connection(storage=Depends(_get_storage)):
        return {
            "configured": bool(await _db(storage.get_setting, "wallet_credential_hash", "")),
            "required": await _db(storage.get_setting, "wallet_auth_required", "false") == "true",
        }

    @app.post("/api/connections/apple-wallet/credential")
    async def create_wallet_credential(storage=Depends(_get_storage)):
        token = secrets.token_urlsafe(32)
        await _db(storage.set_setting, "wallet_credential_hash", hashlib.sha256(token.encode()).hexdigest())
        return JSONResponse({"token": token}, headers={"Cache-Control": "no-store"})

    @app.delete("/api/connections/apple-wallet/credential")
    async def revoke_wallet_credential(storage=Depends(_get_storage)):
        await _db(storage.revoke_wallet_credential)
        return {"status": "ok"}

    # ── Connection management ─────────────────────────────────────────────────

    @app.delete("/api/connections/telegram")
    async def disconnect_telegram(username: str = Depends(require_auth)):
        await _db(admin_storage.update_user, username, telegram_chat_id=None)
        return {"status": "ok"}

    @app.delete("/api/connections/gmail")
    async def disconnect_gmail(username: str = Depends(require_auth)):
        import httpx
        ctx = user_manager.get(username)
        if ctx and ctx.poller and os.path.exists(ctx.poller.token_path):
            try:
                with open(ctx.poller.token_path) as f:
                    token_data = json.load(f)
                access_token = token_data.get("token") or token_data.get("access_token")
                if access_token:
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            "https://oauth2.googleapis.com/revoke",
                            params={"token": access_token},
                            timeout=5.0,
                        )
            except Exception as e:
                logger.warning(f"OAuth revocation failed for {username}: {e}")
            try:
                os.remove(ctx.poller.token_path)
            except Exception:
                pass
        if ctx and ctx.poller:
            ctx.poller.stop()
        await _db(admin_storage.update_user, username, gmail_connected=0)
        return {"status": "ok"}

    @app.get("/api/transactions")
    async def transactions(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        merchant_search: Optional[str] = None,
        merchant: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        storage=Depends(_get_storage),
    ):
        return await _db(storage.query_transactions,
            start_date=start_date,
            end_date=end_date,
            category=category,
            merchant_search=merchant_search or merchant,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/transactions/export")
    async def export_transactions(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        merchant_search: Optional[str] = None,
        merchant: Optional[str] = None,
        storage=Depends(_get_storage),
    ):
        rows = await _db(storage.query_transactions,
            start_date=start_date,
            end_date=end_date,
            category=category,
            merchant_search=merchant_search or merchant,
            limit=50_000,
            offset=0,
        )
        output = io.StringIO()
        fieldnames = ["date", "merchant", "amount", "currency", "exchange_rate",
                      "amount_sgd", "type", "category", "source", "description"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for tx in rows:
            # reporting_minor_units (R02 canonical money) rather than
            # amount * exchange_rate — a legacy exchange_rate of 1.0 is a
            # silent unresolved fallback, not real conversion evidence, and
            # the raw multiplication has no currency validation. Leave
            # amount_sgd blank rather than fabricate a face-value SGD figure
            # for an unresolved conversion.
            minor, _status = resolve_money(tx)
            amount_sgd = float(from_minor_units(minor, "SGD")) if minor is not None else ""
            writer.writerow({
                "date": (tx.get("transaction_date") or "")[:10],
                "merchant": tx.get("merchant") or "",
                "amount": tx.get("amount") if tx.get("amount") is not None else "",
                "currency": tx.get("currency") or "SGD",
                "exchange_rate": tx.get("exchange_rate") if tx.get("exchange_rate") is not None else 1.0,
                "amount_sgd": amount_sgd,
                "type": tx.get("type") or "expense",
                "category": tx.get("category") or "",
                "source": tx.get("source") or "",
                "description": tx.get("description") or "",
            })
        output.seek(0)
        filename = f"transactions-{local_now().strftime('%Y-%m-%d')}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/v2/transactions", response_model=list[TransactionV2])
    async def list_transactions_v2(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
        merchant_search: Optional[str] = None,
        merchant: Optional[str] = None,
        type: Optional[Literal["expense", "income", "refund", "transfer"]] = None,
        trip_id: Optional[int] = None,
        needs_review: Optional[bool] = None,
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        rows = await _db(
            storage.get_transactions_v2,
            start_date=start_date, end_date=end_date, category=category, source=source,
            merchant_search=merchant_search or merchant, type=type, trip_id=trip_id,
            needs_review=needs_review, limit=limit, offset=offset,
        )
        return await _db(transaction_commands.to_v2_many, rows, storage)

    @app.get("/api/v2/transactions/daily-totals", response_model=list[DailyTotal])
    async def transactions_daily_totals(start: date, end: date, storage=Depends(_get_storage)):
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        return await _db(storage.get_daily_totals, start, end, timezone)

    @app.get("/api/v2/spending/breakdown", response_model=CategoryBreakdown)
    async def spending_breakdown(start: date, end: date, storage=Depends(_get_storage)):
        """Category totals for [start, end] on the same shared-facts rules as
        /api/v2/home's hero (spending_facts.py), not the legacy SQL
        aggregates behind /api/v2/overview/* — see the increment-3 finding in
        docs/plans/2026-09-16-cashe-design-language-restoration.md."""
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        return await _db(storage.get_category_breakdown, start, end, timezone)

    @app.get("/api/v2/spending/merchants", response_model=list[MerchantRanking])
    async def spending_merchants(start: date, end: date, category: Optional[str] = None,
                                  limit: int = Query(10, ge=1, le=50), storage=Depends(_get_storage)):
        """Same shared-facts rules as /api/v2/spending/breakdown — a merchant
        ranking scoped to a selected category always agrees with that
        category's breakdown total for the identical period."""
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        return await _db(storage.get_merchant_ranking_facts, start, end, timezone, category, limit)

    @app.get("/api/v2/spending/trend-by-category", response_model=list[CategoryTrendPoint])
    async def spending_trend_by_category(start: date, end: date, categories: Optional[str] = None,
                                          storage=Depends(_get_storage)):
        """Same shared-facts rules as /api/v2/spending/breakdown and
        /transactions/daily-totals — not storage.get_trend_by_category's
        legacy SQL, which has no timezone conversion on transaction_date.
        `categories` is a comma-separated allowlist (the frontend's "at most
        three selectable categories" default)."""
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        category_list = [c for c in categories.split(",") if c] if categories else None
        return await _db(storage.get_category_daily_trend, start, end, timezone, category_list)

    @app.get("/api/v2/transactions/{tx_id}", response_model=TransactionV2)
    async def get_transaction_v2(tx_id: int, storage=Depends(_get_storage)):
        tx = await _db(storage.get_transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return transaction_commands.to_v2(tx, storage)

    @app.get("/api/v2/transactions/{tx_id}/provenance", response_model=TransactionProvenance)
    async def get_transaction_provenance(tx_id: int, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_transaction_provenance, tx_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    @app.post("/api/v2/transactions", response_model=TransactionV2, status_code=201)
    async def create_transaction_v2(payload: TransactionCreate, request: Request, storage=Depends(_get_storage)):
        body = payload.model_dump(exclude_none=True)
        try:
            return await _db(
                transaction_commands.create_web, storage, body,
                source_id=f"manual_{uuid.uuid4().hex[:12]}",
                request_key=request.headers.get("Idempotency-Key"), timezone=timezone,
            )
        except ValueError as e:
            raise _http_error(e, 400)

    @app.post("/api/v2/transactions/bulk", response_model=list[BulkTransactionResultItem])
    async def bulk_correct_transactions(payload: BulkTransactionRequest, storage=Depends(_get_storage)):
        if not payload.transaction_ids:
            raise HTTPException(status_code=422, detail="No transactions selected")
        if len(payload.transaction_ids) > 200:
            raise HTTPException(status_code=422, detail="At most 200 transactions per batch")
        if payload.category is None and payload.type is None:
            raise HTTPException(status_code=422, detail="Nothing to change")
        return await _db(
            storage.bulk_correct, payload.transaction_ids,
            category=payload.category, type=payload.type,
            remember_category=payload.remember_category,
            expected_revisions=payload.expected_revisions,
        )

    @app.post("/api/v2/transactions/bulk/undo", response_model=list[BulkTransactionResultItem])
    async def bulk_undo_transactions(payload: BulkUndoRequest, storage=Depends(_get_storage)):
        if not payload.transaction_ids:
            raise HTTPException(status_code=422, detail="No transactions selected")
        if len(payload.transaction_ids) > 200:
            raise HTTPException(status_code=422, detail="At most 200 transactions per batch")
        return await _db(storage.bulk_undo, payload.transaction_ids, expected_revisions=payload.expected_revisions)

    @app.delete("/api/v2/transactions/{tx_id}", response_model=TransactionDeletion)
    async def delete_transaction_v2(tx_id: int, storage=Depends(_get_storage)):
        try:
            return await _db(transaction_commands.delete, storage, tx_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="Transaction not found")

    @app.put("/api/v2/transactions/{tx_id}", response_model=TransactionV2)
    async def update_transaction_v2(tx_id: int, correction: TransactionCorrection, storage=Depends(_get_storage)):
        tx = await _db(storage.get_transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        fields = correction.model_dump(
            exclude={"remember_category", "expected_revision"}, exclude_none=True,
        )
        # exclude_none drops an explicit null the same as an omitted field —
        # only refund_of_transaction_id needs "explicit null" to mean unlink,
        # so restore it from the raw payload when the client actually sent it.
        if "refund_of_transaction_id" in correction.model_fields_set:
            fields["refund_of_transaction_id"] = correction.refund_of_transaction_id
        if not fields:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        try:
            return await _db(
                transaction_commands.correct, storage, tx_id, fields,
                remember_category=correction.remember_category,
                expected_revision=correction.expected_revision,
            )
        except RevisionConflict as exc:
            raise HTTPException(status_code=409, detail={
                "message": str(exc), "current": transaction_commands.to_v2(exc.current, storage),
            })
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/transactions/{tx_id}/undo", response_model=TransactionV2)
    async def undo_transaction_v2(tx_id: int, payload: TransactionUndo | None = None, storage=Depends(_get_storage)):
        expected_revision = payload.expected_revision if payload else None
        try:
            return await _db(transaction_commands.undo, storage, tx_id, expected_revision=expected_revision)
        except RevisionConflict as exc:
            raise HTTPException(status_code=409, detail={
                "message": str(exc), "current": transaction_commands.to_v2(exc.current, storage),
            })
        except ValueError as exc:
            raise _http_error(exc, 400)

    @app.post("/api/v2/transactions/{tx_id}/restore", response_model=TransactionV2)
    async def restore_transaction_v2(tx_id: int, storage=Depends(_get_storage)):
        try:
            return await _db(transaction_commands.restore, storage, tx_id)
        except ValueError as exc:
            raise _http_error(exc, 409)

    @app.post("/api/transactions")
    async def create_transaction(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Transaction must be an object")
        amount = body.get("amount")
        if amount is None:
            raise HTTPException(status_code=400, detail="amount is required")
        tx_type = body.get("type", "expense")
        if tx_type not in ("expense", "income"):
            raise HTTPException(status_code=400, detail="type must be 'expense' or 'income'")

        try:
            return await _db(
                storage.create_web_transaction, body,
                source_id=f"manual_{uuid.uuid4().hex[:12]}",
                request_key=request.headers.get("Idempotency-Key"), timezone=timezone,
            )
        except ValueError as e:
            raise _http_error(e, 400)

    @app.put("/api/transactions/{tx_id}")
    async def update_transaction(tx_id: int, request: Request, storage=Depends(_get_storage)):
        tx = await _db(storage.get_transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        body = await request.json()
        allowed = {"merchant", "amount", "currency", "exchange_rate", "category", "description", "transaction_date", "type"}
        if not isinstance(body, dict):
            raise HTTPException(status_code=422, detail="Correction must be an object")
        fields = {k: v for k, v in body.items() if k in allowed}
        if not fields:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        remember = body.get("remember_category", False)
        if not isinstance(remember, bool):
            raise HTTPException(status_code=422, detail="remember_category must be a boolean")
        try:
            await _db(storage.update_transaction, tx_id, remember_category=remember, **fields)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        return await _db(storage.get_transaction, tx_id)

    @app.delete("/api/transactions/{tx_id}")
    async def delete_transaction(tx_id: int, storage=Depends(_get_storage)):
        tx = await _db(storage.get_transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        await _db(storage.delete_transaction, tx_id)
        return {"status": "ok"}

    @app.get("/api/apple-wallet/cards")
    async def apple_wallet_cards(storage=Depends(_get_storage)):
        """Return distinct card names known from Apple Wallet transactions.

        Only returns descriptions that have a real card name — i.e. the format
        'Apple Wallet - <something>' where <something> is non-empty.  Used to
        populate the description dropdown in the transaction edit form.
        """
        return await _db(storage.get_apple_wallet_cards)

    @app.get("/api/categories")
    async def categories(storage=Depends(_get_storage)):
        return await _db(storage.get_categories)

    @app.post("/api/categories")
    async def create_category(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        name = body.get("name", "").strip()
        keywords = body.get("keywords", "")
        icon = body.get("icon", "📌")
        color = body.get("color")
        cat_type = body.get("type", "neutral")
        if not name:
            raise HTTPException(status_code=400, detail="Category name is required")
        try:
            await _db(storage.add_category, name, keywords, icon, color, cat_type=cat_type)
        except ValueError as e:
            raise _http_error(e, 422)
        return {"status": "ok", "name": name}

    @app.put("/api/categories/{name}")
    async def update_category(name: str, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        cat_type = body.get("type")
        try:
            await _db(storage.update_category,
                name,
                keywords=body.get("keywords"),
                icon=body.get("icon"),
                color=body.get("color"),
                cat_type=cat_type,
            )
        except ValueError as e:
            raise _http_error(e, 422)
        return {"status": "ok", "name": name}

    @app.delete("/api/categories/{name}")
    async def delete_category(name: str, storage=Depends(_get_storage)):
        try:
            count = await _db(storage.delete_category, name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok", "reassigned": count}

    @app.get("/api/merchant-overrides")
    async def merchant_overrides(storage=Depends(_get_storage)):
        overrides = await _db(storage.get_merchant_overrides)
        return [{"merchant": m, "category": c} for m, c in overrides.items()]

    @app.delete("/api/merchant-overrides/{merchant}")
    async def remove_merchant_override(merchant: str, storage=Depends(_get_storage)):
        await _db(storage.remove_merchant_override, merchant)
        return {"status": "ok"}

    VALID_TAGS = {"online", "subscription", "foreign", "essential", "recurring"}

    @app.get("/api/merchant-intelligence/{merchant}/trend")
    async def merchant_trend(merchant: str, storage=Depends(_get_storage)):
        return await _db(storage.get_merchant_trend, merchant)

    @app.put("/api/merchant-intelligence/{merchant}/tags")
    async def merchant_set_tags(merchant: str, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        tags = body.get("tags", [])
        invalid = [t for t in tags if t not in VALID_TAGS]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid tags: {invalid}. Valid: {sorted(VALID_TAGS)}")
        await _db(storage.set_merchant_tags, merchant, tags)
        return await _db(storage.get_merchant_tags, merchant)

    @app.put("/api/merchant-intelligence/{merchant}/notes")
    async def merchant_set_notes(merchant: str, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        notes = body.get("notes", "")
        await _db(storage.set_merchant_notes, merchant, notes)
        return await _db(storage.get_merchant_tags, merchant)

    @app.put("/api/merchant-intelligence/{merchant}/alias")
    async def merchant_set_alias(merchant: str, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        await _db(storage.set_merchant_alias, merchant, body.get("display_name", ""))
        profile = await _db(storage.get_merchant_profile, merchant)
        return {"merchant": merchant, "display_name": profile["display_name"] if profile else merchant}

    @app.get("/api/merchant-intelligence/{merchant}/rule-impact")
    async def merchant_rule_impact(merchant: str, storage=Depends(_get_storage)):
        overrides = await _db(storage.get_merchant_overrides)
        category = overrides.get(merchant)
        if category is None:
            raise HTTPException(status_code=404, detail="No category rule for this merchant")
        count = await _db(storage.get_category_rule_impact, merchant, category)
        return {"merchant": merchant, "category": category, "differing_count": count}

    @app.post("/api/merchant-intelligence/{merchant}/apply-rule")
    async def merchant_apply_rule(merchant: str, storage=Depends(_get_storage)):
        overrides = await _db(storage.get_merchant_overrides)
        category = overrides.get(merchant)
        if category is None:
            raise HTTPException(status_code=404, detail="No category rule for this merchant")
        updated = await _db(storage.apply_category_rule_to_existing, merchant, category)
        return {"status": "ok", "updated_count": updated}

    def _merchant_to_v2(d: dict) -> dict:
        # total_sgd/avg_amount_sgd can be NULL if every transaction for this
        # merchant has an unresolved FX conversion (SUM/AVG over an all-NULL
        # group) — same latent gap the v1 route has always had (silently
        # returns null); _sgd_money can't represent "unresolved" here (no
        # per-merchant conversion_status), so it's treated as zero rather
        # than crashing the route.
        return {
            "merchant": d["merchant"],
            "display_name": d.get("display_name") or d["merchant"],
            "total": _sgd_money(d["total_sgd"] or 0.0),
            "transaction_count": d["transaction_count"],
            "avg_amount": _sgd_money(d["avg_amount_sgd"] or 0.0),
            # get_merchant_profile (unlike get_merchant_list) doesn't select a
            # category column at all — same v1 gap, not introduced here.
            "category": d.get("category"),
            "first_seen": d["first_seen"],
            "last_seen": d["last_seen"],
            "tags": d["tags"],
            "notes": d["notes"],
        }

    @app.get("/api/v2/merchants", response_model=list[MerchantSummary])
    async def merchant_list_v2(
        sort_by: str = "total_spent",
        tag: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 25,
        offset: int = 0,
        storage=Depends(_get_storage),
    ):
        rows = await _db(storage.get_merchant_list,
            sort_by=sort_by,
            tag_filter=tag,
            category_filter=category,
            name_search=search,
            limit=limit,
            offset=offset,
        )
        return [_merchant_to_v2(r) for r in rows]

    @app.get("/api/v2/merchants/{merchant}", response_model=MerchantSummary)
    async def merchant_profile_v2(merchant: str, storage=Depends(_get_storage)):
        profile = await _db(storage.get_merchant_profile, merchant)
        if not profile:
            raise HTTPException(status_code=404, detail="Merchant not found")
        return _merchant_to_v2(profile)

    @app.get("/api/v2/analytics/health-score", response_model=HealthScore)
    async def health_score_v2(months: int = 1, storage=Depends(_get_storage)):
        if months < 1 or months > 12:
            raise HTTPException(status_code=400, detail="months must be between 1 and 12")
        return await _db(storage.get_health_score, months, timezone)

    def _default_month_range(start_date: Optional[str], end_date: Optional[str]) -> tuple[str, str]:
        today = local_now()
        return (
            start_date or f"{today.year}-{today.month:02d}-01",
            end_date or today.strftime("%Y-%m-%d"),
        )

    @app.get("/api/merchants")
    async def merchants(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        return await _db(storage.get_merchants_in_range, *_default_month_range(start_date, end_date))

    def _sgd_money(value: float) -> dict:
        return {"minor_units": to_minor_units(value, "SGD"), "currency": "SGD"}

    @app.get("/api/recurring")
    async def recurring(storage=Depends(_get_storage)):
        return await _db(storage.get_recurring_transactions)

    @app.get("/api/analytics/insight")
    async def get_analytics_insight(storage=Depends(_get_storage)):
        content_str = await _db(storage.get_setting, "llm_insight_content", "")
        generated_at = await _db(storage.get_setting, "llm_insight_generated_at", "")
        if not content_str:
            return {"content": None, "generated_at": None, "is_stale": True}
        try:
            content = json.loads(content_str)
        except Exception:
            content = None
        is_stale = True
        if generated_at:
            try:
                gen = datetime.fromisoformat(generated_at)
                if gen.tzinfo is None:
                    gen = gen.replace(tzinfo=ZoneInfo(DEFAULT_TIMEZONE))
                is_stale = (local_now() - gen).total_seconds() > 25 * 3600
            except Exception:
                pass
        return {"content": content, "generated_at": generated_at, "is_stale": is_stale}


    async def _read_settings(storage) -> dict:
        stored = await _db(storage.get_settings, SETTINGS)
        return {key: read(stored.get(key, default)) for key, (default, read, _) in SETTINGS.items()}

    @app.get("/api/settings")
    async def get_settings(storage=Depends(_get_storage)):
        return await _read_settings(storage)

    @app.put("/api/settings")
    async def update_settings(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        errors = {}
        validated = {}
        for key, value in body.items():
            parse = SETTINGS[key][2] if key in SETTINGS else WRITE_ONLY_SETTINGS.get(key)
            if parse is None:
                continue
            try:
                validated[key] = parse(value)
            except ValueError as exc:
                errors[key] = str(exc)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        await _db(storage.set_settings, validated)
        return await _read_settings(storage)

    # ── Budgets ──────────────────────────────────────────────────────────

    @app.post("/api/budgets")
    async def create_budget(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        amount = body.get("amount")
        period = body.get("period", "monthly")
        category = body.get("category")  # None = overall
        if amount is None:
            raise HTTPException(status_code=400, detail="amount is required")
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="amount must be a number")
        if period not in ("monthly", "weekly"):
            raise HTTPException(status_code=422, detail="period must be 'monthly' or 'weekly'")
        try:
            budget_id = await _db(storage.create_budget, category=category, amount=amount, period=period)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
        row = await _db(storage.get_budget, budget_id)
        return dict(row)

    @app.get("/api/v2/budgets/progress", response_model=list[BudgetProgress])
    async def budget_progress_v2(storage=Depends(_get_storage)):
        rows = await _db(storage.get_budget_progress)
        return [
            {
                **row,
                "budget_amount": _sgd_money(row["budget_amount"]),
                "spent": _sgd_money(row["spent"]),
                "remaining": _sgd_money(row["remaining"]),
                "projected": _sgd_money(row["projected"]),
            }
            for row in rows
        ]

    @app.put("/api/budgets/{budget_id}")
    async def update_budget(budget_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        amount = body.get("amount")
        if amount is None:
            raise HTTPException(status_code=400, detail="amount is required")
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="amount must be a number")
        try:
            await _db(storage.update_budget, budget_id, amount=amount)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        row = await _db(storage.get_budget, budget_id)
        return dict(row)

    @app.delete("/api/budgets/{budget_id}")
    async def delete_budget(budget_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.delete_budget, budget_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok"}

    # ── Goals ──────────────────────────────────────────────────────────────

    @app.get("/api/v2/goals", response_model=list[GoalProgress])
    async def list_goals_v2(storage=Depends(_get_storage)):
        results = []
        for progress in await _db(storage.get_all_goal_progress):
            results.append({
                "id": progress["id"],
                "name": progress["name"],
                "target_amount": _sgd_money(progress["target_amount"]),
                "saved_amount": _sgd_money(progress["saved_amount"]),
                "target_date": progress["target_date"],
                "status": progress["status"],
                "percent": progress["percent"],
                "monthly_rate": _sgd_money(progress["monthly_rate"]) if progress["monthly_rate"] is not None else None,
                "rate_window": progress["rate_window"],
                "months_to_target": progress["months_to_target"],
                "on_track": progress["on_track"],
                "contributions": [
                    {
                        "id": c["id"],
                        "goal_id": c["goal_id"],
                        "amount": _sgd_money(c["amount"]),
                        "month": c["month"],
                        "contributed_date": c["contributed_date"],
                        "source": c["source"],
                        "note": c["note"],
                        "created_at": c["created_at"],
                    }
                    for c in progress["contributions"]
                ],
            })
        return results

    @app.post("/api/goals")
    async def create_goal(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        name = body.get("name", "").strip()
        target_amount = body.get("target_amount")
        target_date = body.get("target_date")
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        if target_amount is None:
            raise HTTPException(status_code=400, detail="target_amount is required")
        try:
            target_amount = float(target_amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="target_amount must be a number")
        goal_id = await _db(storage.create_goal,
            name=name, target_amount=target_amount, target_date=target_date
        )
        return await _db(storage.get_goal_progress, goal_id)

    @app.put("/api/goals/{goal_id}")
    async def update_goal(goal_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        allowed = {"name", "target_amount", "target_date", "status"}
        fields = {k: v for k, v in body.items() if k in allowed}
        if not fields:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        try:
            await _db(storage.update_goal, goal_id, **fields)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_goal_progress, goal_id)

    @app.delete("/api/goals/{goal_id}")
    async def delete_goal(goal_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.delete_goal, goal_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok"}

    @app.post("/api/goals/{goal_id}/contribute")
    async def contribute_to_goal(goal_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        amount = body.get("amount")
        note = body.get("note")
        if amount is None:
            raise HTTPException(status_code=400, detail="amount is required")
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="amount must be a number")
        today = local_now()
        try:
            await _db(storage.add_contribution,
                goal_id,
                amount=amount,
                month=today.strftime("%Y-%m"),
                contributed_date=today.strftime("%Y-%m-%d"),
                source="manual",
                note=note,
            )
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_goal_progress, goal_id)

    @app.put("/api/goals/{goal_id}/contributions/{contribution_id}")
    async def update_contribution(goal_id: int, contribution_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        allowed = {"amount", "note", "contributed_date"}
        fields = {k: v for k, v in body.items() if k in allowed}
        if "amount" in fields:
            try:
                fields["amount"] = float(fields["amount"])
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="amount must be a number")
        try:
            await _db(storage.update_contribution, contribution_id, **fields)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_goal_progress, goal_id)

    @app.delete("/api/goals/{goal_id}/contributions/{contribution_id}")
    async def delete_contribution(goal_id: int, contribution_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.delete_contribution, contribution_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_goal_progress, goal_id)

    @app.get("/api/savings/overview")
    async def savings_overview(storage=Depends(_get_storage)):
        month = local_now().strftime("%Y-%m")
        return await _db(storage.get_savings_overview, month)

    # ── Trips ───────────────────────────────────────────────────────────────

    @app.get("/api/trips")
    async def list_trips(storage=Depends(_get_storage)):
        return await _db(storage.get_trips)

    # IMPORTANT: /api/trips/active must be registered before /api/trips/{trip_id}
    # routes. FastAPI resolves top-to-bottom; without this ordering, "active"
    # would be treated as a trip_id and fail int conversion with a 422.
    @app.get("/api/trips/active")
    async def get_active_trip(storage=Depends(_get_storage)):
        active = await _db(storage.get_active_trip)
        if not active:
            raise HTTPException(status_code=404, detail="No active trip")
        return active

    @app.post("/api/trips")
    async def create_trip(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        name = body.get("name", "").strip()
        start_date = body.get("start_date", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        if not start_date:
            raise HTTPException(status_code=400, detail="start_date is required")
        trip_id = await _db(storage.create_trip,
            name=name,
            start_date=start_date,
            destination=body.get("destination"),
            primary_currency=body.get("primary_currency", "SGD"),
        )
        return await _db(storage.get_trip, trip_id)

    @app.put("/api/trips/{trip_id}")
    async def update_trip(trip_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        try:
            await _db(storage.update_trip, trip_id, **{k: v for k, v in body.items()})
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_trip, trip_id)

    @app.post("/api/trips/{trip_id}/activate")
    async def activate_trip(trip_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.activate_trip, trip_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_trip, trip_id)

    @app.post("/api/trips/{trip_id}/deactivate")
    async def deactivate_trip(trip_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.deactivate_trip, trip_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return await _db(storage.get_trip, trip_id)

    @app.post("/api/v2/trips/{trip_id}/baseline-exclusion")
    async def set_trip_baseline_exclusion(trip_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        excluded = body.get("excluded")
        if not isinstance(excluded, bool):
            raise HTTPException(status_code=422, detail="excluded must be a boolean")
        count = await _db(storage.set_trip_baseline_exclusion, trip_id, excluded)
        return {"status": "ok", "transactions_updated": count}

    @app.post("/api/v2/baseline-exclusion/period")
    async def set_period_baseline_exclusion(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        start, end, excluded = body.get("start"), body.get("end"), body.get("excluded")
        if not isinstance(start, str) or not isinstance(end, str) or end < start:
            raise HTTPException(status_code=422, detail="start/end must be ISO dates with start <= end")
        if not isinstance(excluded, bool):
            raise HTTPException(status_code=422, detail="excluded must be a boolean")
        count = await _db(storage.set_period_baseline_exclusion, start, end, excluded)
        return {"status": "ok", "transactions_updated": count}

    @app.delete("/api/trips/{trip_id}")
    async def delete_trip(trip_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.delete_trip, trip_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok"}

    @app.get("/api/trips/{trip_id}/summary")
    async def trip_summary(trip_id: int, storage=Depends(_get_storage)):
        summary = await _db(storage.get_trip_summary, trip_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="Trip not found")
        return summary

    @app.get("/api/v2/trips/{trip_id}/summary", response_model=TripSummary)
    async def trip_summary_v2(trip_id: int, storage=Depends(_get_storage)):
        summary = await _db(storage.get_trip_summary, trip_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="Trip not found")
        return {
            "trip": summary["trip"],
            "total": _sgd_money(summary["total_sgd"]),
            "transaction_count": summary["transaction_count"],
            "days": summary["days"],
            "daily_average": _sgd_money(summary["daily_average_sgd"]),
            "currencies_used": summary["currencies_used"],
            "by_category": [
                {"category": c["category"], "amount": _sgd_money(c["amount_sgd"]), "count": c["count"]}
                for c in summary["by_category"]
            ],
            "by_day": [
                {"date": d["date"], "amount": _sgd_money(d["amount_sgd"])}
                for d in summary["by_day"]
            ],
        }

    @app.get("/api/trips/{trip_id}/transactions")
    async def trip_transactions(
        trip_id: int,
        limit: int = 50,
        offset: int = 0,
        storage=Depends(_get_storage),
    ):
        if not await _db(storage.get_trip, trip_id):
            raise HTTPException(status_code=404, detail="Trip not found")
        return await _db(storage.get_trip_transactions, trip_id, limit=limit, offset=offset)

    @app.post("/api/trips/{trip_id}/transactions")
    async def enlist_transaction(trip_id: int, request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        tx_id = body.get("transaction_id")
        if tx_id is None:
            raise HTTPException(status_code=400, detail="transaction_id is required")
        if not await _db(storage.get_trip, trip_id):
            raise HTTPException(status_code=404, detail="Trip not found")
        await _db(storage.enlist_transaction, trip_id, int(tx_id), added_by="manual")
        return {"status": "ok"}

    @app.delete("/api/trips/{trip_id}/transactions/{tx_id}")
    async def delist_transaction(trip_id: int, tx_id: int, storage=Depends(_get_storage)):
        if not await _db(storage.get_trip, trip_id):
            raise HTTPException(status_code=404, detail="Trip not found")
        await _db(storage.delist_transaction, trip_id, tx_id)
        return {"status": "ok"}

    @app.get("/api/transactions/{tx_id}/trips")
    async def transaction_trips(tx_id: int, storage=Depends(_get_storage)):
        return {"trip_ids": await _db(storage.get_trip_ids_for_transaction, tx_id)}

    # ── Subscriptions ──────────────────────────────────────────────────────────

    @app.get("/api/subscriptions")
    async def list_subscriptions(storage=Depends(_get_storage)):
        subs = await _db(storage.list_subscriptions_enriched)
        summary = await _db(storage.get_subscription_summary)
        return {"subscriptions": subs, "summary": summary}

    def _validate_billing_day(day) -> None:
        """Raise HTTPException 422 if billing_day is present but out of range."""
        if day is not None and not (1 <= int(day) <= 31):
            raise HTTPException(status_code=422, detail="billing_day must be between 1 and 31")

    @app.post("/api/subscriptions", status_code=201)
    async def create_subscription(body: dict, storage=Depends(_get_storage)):
        required = {"merchant", "frequency"}
        missing = required - body.keys()
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing fields: {missing}")
        if body["frequency"] not in VALID_SUBSCRIPTION_FREQUENCIES:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid frequency. Must be one of {VALID_SUBSCRIPTION_FREQUENCIES}",
            )
        _validate_billing_day(body.get("billing_day"))
        sub_id = await _db(
            storage.create_subscription,
            merchant=body["merchant"],
            frequency=body["frequency"],
            billing_day=body.get("billing_day"),
            label=body.get("label"),
            notes=body.get("notes"),
            confirmation_source="user",
        )
        return await _db(storage.get_subscription, sub_id)

    @app.post("/api/subscriptions/{sub_id}/confirm", response_model=PlanMutationResponse)
    async def confirm_subscription(sub_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.confirm_subscription, sub_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok"}

    @app.put("/api/subscriptions/{sub_id}")
    async def update_subscription(sub_id: int, body: dict, storage=Depends(_get_storage)):
        if "frequency" in body and body["frequency"] not in VALID_SUBSCRIPTION_FREQUENCIES:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid frequency. Must be one of {VALID_SUBSCRIPTION_FREQUENCIES}",
            )
        if "billing_day" in body:
            _validate_billing_day(body["billing_day"])
        try:
            await _db(storage.update_subscription, sub_id, **body)
        except ValueError as e:
            raise _http_error(e, 422)
        return await _db(storage.get_subscription, sub_id)

    @app.delete("/api/subscriptions/{sub_id}")
    async def delete_subscription(sub_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.delete_subscription, sub_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"status": "ok"}

    @app.get("/api/subscriptions/{sub_id}/history")
    async def get_subscription_history(sub_id: int, limit: int = 50, storage=Depends(_get_storage)):
        if not await _db(storage.get_subscription, sub_id):
            raise HTTPException(status_code=404, detail="Subscription not found")
        return await _db(storage.get_subscription_matched_transactions, sub_id, limit)

    @app.get("/api/subscriptions/{sub_id}/upcoming")
    async def get_subscription_upcoming(sub_id: int, storage=Depends(_get_storage)):
        if not await _db(storage.get_subscription, sub_id):
            raise HTTPException(status_code=404, detail="Subscription not found")
        return await _db(storage.list_upcoming_transactions, sub_id)

    @app.post("/api/subscriptions/{sub_id}/upcoming/{upcoming_id}/match")
    async def manual_match_upcoming(
        sub_id: int, upcoming_id: int, body: dict, storage=Depends(_get_storage)
    ):
        upcoming = await _db(storage.get_upcoming_transaction, upcoming_id)
        if not upcoming or upcoming["subscription_id"] != sub_id:
            raise HTTPException(status_code=404, detail="Upcoming transaction not found")
        transaction_id = body.get("transaction_id")
        try:
            await _db(storage.match_upcoming_transaction, upcoming_id, transaction_id)
        except ValueError as e:
            raise _http_error(e, 422)
        return {"status": "ok"}

    @app.post("/api/subscriptions/{sub_id}/upcoming/{upcoming_id}/dismiss")
    async def dismiss_upcoming(sub_id: int, upcoming_id: int, storage=Depends(_get_storage)):
        upcoming = await _db(storage.get_upcoming_transaction, upcoming_id)
        if not upcoming or upcoming["subscription_id"] != sub_id:
            raise HTTPException(status_code=404, detail="Upcoming transaction not found")
        try:
            await _db(storage.dismiss_planned_charge, upcoming_id)
        except ValueError as e:
            raise _http_error(e, 404)
        return {"status": "ok"}

    @app.post("/api/subscriptions/{sub_id}/link-transaction", status_code=201)
    async def link_transaction(sub_id: int, body: dict, storage=Depends(_get_storage)):
        tx_id = body.get("transaction_id")
        try:
            await _db(storage.link_transaction_to_subscription, sub_id, tx_id)
        except ValueError as e:
            raise _http_error(e, 422)
        return {"status": "ok"}

    # Serve React SPA

    static_dist = os.path.join(os.path.dirname(__file__), "dist")
    if os.path.isdir(static_dist):
        app.mount(
            "/assets",
            StaticFiles(directory=os.path.join(static_dist, "assets")),
            name="spa_assets",
        )

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            # Unknown API paths are a 404, not the SPA shell with a 200.
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found")
            file_path = os.path.join(static_dist, full_path)
            if os.path.isfile(file_path):
                return FileResponse(file_path)
            return FileResponse(os.path.join(static_dist, "index.html"))

    return app
