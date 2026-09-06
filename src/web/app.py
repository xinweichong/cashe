import asyncio
import logging
import os
import secrets
import hashlib
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from functools import partial
from typing import Literal, Optional

import bcrypt
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
import csv
import io
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse

from src.config import local_now
from src.web.auth import verify_password, create_session, verify_session, destroy_session
from src.web.contracts import CaptureFollowup, CaptureIssue, HomeBriefing, QueuedResponse, SpendingEvidence, SpendingFacts, SpendingReview, TransactionProvenance
from src.analytics import (
    load_summary,
    get_yoy_comparison,
)

logger = logging.getLogger(__name__)


SUMMARY_CACHE_DIR = os.environ.get(
    "SUMMARY_CACHE_DIR",
    os.path.join(os.path.dirname(__file__), "..", "data", "summaries")
)

# DB thread pool: allows concurrent read queries while serialising writes via SQLite WAL mode.
_DB_EXECUTOR = ThreadPoolExecutor(max_workers=4)


async def _db(fn, *args, **kwargs):
    """Run a synchronous storage/DB call in the dedicated DB thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_DB_EXECUTOR, partial(fn, *args, **kwargs))


VALID_SUBSCRIPTION_FREQUENCIES = {"weekly", "biweekly", "monthly", "quarterly", "annual"}


def create_dashboard_app(
    user_manager,
    admin_storage,
    exchange_service=None,
    host_base_url: str = "",
    llm_service=None,
    timezone: str = "Asia/Singapore",
) -> FastAPI:
    app = FastAPI(title="Expense Tracker Dashboard")
    app.add_middleware(GZipMiddleware, minimum_size=500)

    oauth_states: dict[str, tuple[str, str, float]] = {}
    login_attempts: dict[str, list[float]] = {}

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
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(_DB_EXECUTOR, partial(ctx.poller.complete_reauth, code, state))
            user_manager.start_poller(username)
            await loop.run_in_executor(_DB_EXECUTOR, partial(admin_storage.update_user, username, gmail_connected=1))
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
        now = time.monotonic()
        # Reserve an attempt before awaiting bcrypt, including concurrent requests.
        for key in list(login_attempts):
            login_attempts[key] = [stamp for stamp in login_attempts[key] if stamp > now - 900]
            if not login_attempts[key]:
                del login_attempts[key]
        keys = ["user:" + username.casefold(), "ip:" + (request.client.host if request.client else "unknown")]
        if any(len(login_attempts.get(key, [])) >= 5 for key in keys):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
        for key in keys:
            login_attempts.setdefault(key, []).append(now)
        loop = asyncio.get_running_loop()
        user = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.get_user, username)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        ok = await loop.run_in_executor(None, verify_password, password, user["password_hash"])
        if not ok:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        login_attempts.pop(keys[0], None)
        if keys[1] in login_attempts:
            login_attempts[keys[1]] = [stamp for stamp in login_attempts[keys[1]] if stamp != now]
        user_agent = request.headers.get("User-Agent", "")
        token = await loop.run_in_executor(_DB_EXECUTOR, create_session, username, user_agent)
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
        loop = asyncio.get_running_loop()
        username = await loop.run_in_executor(_DB_EXECUTOR, verify_session, session) if session else None
        if not username:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.get_user, username)
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
            destroy_session(session)
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
    async def capture_issues(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), storage=Depends(_get_storage)):
        return await _db(storage.list_capture_issues, limit, offset)

    @app.post("/api/v2/capture/issues/{event_id}/retry", response_model=QueuedResponse)
    async def retry_capture_issue(event_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.retry_source_event, event_id)
        except ValueError as exc:
            raise HTTPException(status_code=404 if str(exc).endswith("not found") else 409, detail=str(exc))
        return QueuedResponse()

    @app.get("/api/v2/capture/followups", response_model=list[CaptureFollowup])
    async def capture_followups(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), storage=Depends(_get_storage)):
        return await _db(storage.list_ingestion_effects, limit, offset)

    @app.post("/api/v2/capture/followups/{effect_id}/retry", response_model=QueuedResponse)
    async def retry_capture_followup(effect_id: int, storage=Depends(_get_storage)):
        try:
            await _db(storage.retry_ingestion_effect, effect_id)
        except ValueError as exc:
            raise HTTPException(status_code=404 if str(exc).endswith("not found") else 409, detail=str(exc))
        return QueuedResponse()

    @app.get("/api/v2/spending/month", response_model=SpendingFacts)
    async def month_spending(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_month_spending_facts, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/home", response_model=HomeBriefing)
    async def home_briefing(username: str = Depends(require_auth)):
        ctx = user_manager.get(username)
        report = await _db(ctx.storage.get_home_briefing, timezone)
        poller = ctx.poller
        report["freshness"] = {
            "gmail_connected": bool(poller and poller.service),
            "gmail_last_checked": getattr(poller, "last_poll_at", None),
            "gmail_needs_reconnection": bool(getattr(poller, "last_auth_error", None)),
        }
        return report

    @app.get("/api/v2/spending/week", response_model=SpendingFacts)
    async def week_spending(as_of: date | None = None, storage=Depends(_get_storage)):
        try:
            return await _db(storage.get_week_spending_facts, as_of, timezone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/api/v2/spending/review", response_model=SpendingReview)
    async def spending_review(
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_spending_review, timezone=timezone, limit=limit, offset=offset)

    @app.get("/api/v2/spending/evidence", response_model=SpendingEvidence)
    async def spending_evidence(
        start: date, end: date, category: str | None = None,
        measure: Literal["spending", "income", "unresolved"] = "spending",
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
        storage=Depends(_get_storage),
    ):
        if end < start:
            raise HTTPException(status_code=422, detail="End must not precede start")
        return await _db(storage.get_spending_evidence, start, end, timezone=timezone,
                         category=category, measure=measure, limit=limit, offset=offset)

    # ── Current user ──────────────────────────────────────────────────────────

    @app.get("/api/users/me")
    async def get_current_user(username: str = Depends(require_auth)):
        loop = asyncio.get_running_loop()
        user = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.get_user, username)
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
        user = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.get_user, username)
        ok = await loop.run_in_executor(None, verify_password, current_password, user["password_hash"])
        if not ok:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        new_hash = await loop.run_in_executor(None, lambda: bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode())
        await loop.run_in_executor(_DB_EXECUTOR, lambda: admin_storage.update_user(username, password_hash=new_hash, force_password_change=0))
        return {"status": "ok"}

    # ── Session management ────────────────────────────────────────────────────

    @app.get("/api/sessions")
    async def list_sessions(request: Request, username: str = Depends(require_auth)):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_DB_EXECUTOR, admin_storage.list_sessions, username)

    @app.delete("/api/sessions")
    async def logout_all_other_sessions(request: Request, username: str = Depends(require_auth)):
        current_token = request.cookies.get("session")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_DB_EXECUTOR, partial(admin_storage.destroy_all_sessions, username, except_token=current_token))
        return {"status": "ok"}

    @app.delete("/api/sessions/{token}")
    async def logout_session(token: str, username: str = Depends(require_auth)):
        loop = asyncio.get_running_loop()
        sessions = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.list_sessions, username)
        if not any(s["token"] == token for s in sessions):
            raise HTTPException(status_code=404, detail="Session not found")
        await loop.run_in_executor(_DB_EXECUTOR, admin_storage.destroy_session, token)
        return {"status": "ok"}

    # ── Onboarding ────────────────────────────────────────────────────────────

    @app.put("/api/onboarding/preferences")
    async def set_onboarding_preferences(request: Request, username: str = Depends(require_auth)):
        body = await request.json()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_DB_EXECUTOR, lambda: admin_storage.update_user(
            username,
            wants_gmail=1 if body.get("wants_gmail", True) else 0,
            wants_apple_wallet=1 if body.get("wants_apple_wallet", True) else 0,
        ))
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
        loop = asyncio.get_running_loop()
        token = await loop.run_in_executor(_DB_EXECUTOR, admin_storage.create_telegram_link_token, username)
        return {"token": token}

    @app.get("/api/onboarding/webhook-url")
    async def get_webhook_url(username: str = Depends(require_auth)):
        url = f"{host_base_url.rstrip('/')}/webhook/apple-wallet/{username}"
        return {"url": url}

    @app.put("/api/onboarding/complete")
    async def mark_onboarding_complete(username: str = Depends(require_auth)):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_DB_EXECUTOR, partial(admin_storage.update_user, username, onboarding_complete=1))
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
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_DB_EXECUTOR, partial(admin_storage.update_user, username, telegram_chat_id=None))
        return {"status": "ok"}

    @app.delete("/api/connections/gmail")
    async def disconnect_gmail(username: str = Depends(require_auth)):
        import httpx
        ctx = user_manager.get(username)
        if ctx and ctx.poller and os.path.exists(ctx.poller.token_path):
            try:
                import json
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
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_DB_EXECUTOR, partial(admin_storage.update_user, username, gmail_connected=0))
        return {"status": "ok"}

    @app.get("/api/connections/gmail/connect-url")
    async def gmail_reconnect_url(request: Request, username: str = Depends(require_auth)):
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

    @app.get("/api/summary")
    async def summary(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        username: str = Depends(require_auth),
    ):
        storage = user_manager.get(username).storage
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return await _db(storage.get_spending_summary, start_date=start, end_date=end)

    @app.get("/api/transactions")
    async def transactions(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        merchant_search: Optional[str] = None,
        merchant: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        username: str = Depends(require_auth),
    ):
        storage = user_manager.get(username).storage
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
        username: str = Depends(require_auth),
    ):
        storage = user_manager.get(username).storage
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
            writer.writerow({
                "date": (tx.get("transaction_date") or "")[:10],
                "merchant": tx.get("merchant") or "",
                "amount": tx.get("amount") if tx.get("amount") is not None else "",
                "currency": tx.get("currency") or "SGD",
                "exchange_rate": tx.get("exchange_rate") if tx.get("exchange_rate") is not None else 1.0,
                "amount_sgd": round((tx.get("amount") or 0) * (tx.get("exchange_rate") or 1.0), 2),
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

    @app.get("/api/v2/transactions/{tx_id}/provenance", response_model=TransactionProvenance)
    async def get_transaction_provenance(tx_id: int, username: str = Depends(require_auth)):
        storage = user_manager.get(username).storage
        try:
            return await _db(storage.get_transaction_provenance, tx_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    @app.get("/api/transactions/{tx_id}")
    async def get_transaction(tx_id: int, username: str = Depends(require_auth)):
        storage = user_manager.get(username).storage
        tx = await _db(storage.get_transaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return tx

    @app.post("/api/transactions")
    async def create_transaction(request: Request, username: str = Depends(require_auth)):
        storage = user_manager.get(username).storage
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Transaction must be an object")
        amount = body.get("amount")
        if amount is None:
            raise HTTPException(status_code=400, detail="amount is required")
        tx_type = body.get("type", "expense")
        if tx_type not in ("expense", "income"):
            raise HTTPException(status_code=400, detail="type must be 'expense' or 'income'")

        source = body.get("source", "manual")
        source_id = f"manual_{uuid.uuid4().hex[:12]}"
        merchant = body.get("merchant")
        description = body.get("description")
        category = body.get("category")
        currency = body.get("currency", "SGD")
        exchange_rate = body.get("exchange_rate")
        transaction_date = body.get("transaction_date", local_now(timezone).strftime("%Y-%m-%dT%H:%M:%S"))

        try:
            tx_id = await _db(storage.create_manual_transaction,
                source=source,
                source_id=source_id,
                amount=amount,
                merchant=merchant,
                description=description,
                category=category,
                currency=currency,
                exchange_rate=exchange_rate,
                transaction_date=transaction_date,
                tx_type=tx_type,
            )
        except ValueError as e:
            raise HTTPException(status_code=409 if str(e).startswith("duplicate source_id:") else 400, detail=str(e))

        return await _db(storage.get_transaction, tx_id)

    @app.put("/api/transactions/{tx_id}")
    async def update_transaction(tx_id: int, request: Request, username: str = Depends(require_auth)):
        storage = user_manager.get(username).storage
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
            status_code = 422 if "cat_type" in str(e) else 409
            raise HTTPException(status_code=status_code, detail=str(e))
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
            if "cat_type" in str(e):
                raise HTTPException(status_code=422, detail=str(e))
            status_code = 409 if "already used" in str(e) else 404
            raise HTTPException(status_code=status_code, detail=str(e))
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

    @app.get("/api/merchant-intelligence")
    async def merchant_intelligence_list(
        sort_by: str = "total_spent",
        tag: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 25,
        offset: int = 0,
        storage=Depends(_get_storage),
    ):
        return await _db(storage.get_merchant_list,
            sort_by=sort_by,
            tag_filter=tag,
            category_filter=category,
            name_search=search,
            limit=limit,
            offset=offset,
        )

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

    @app.get("/api/merchant-intelligence/{merchant}")
    async def merchant_intelligence_profile(merchant: str, storage=Depends(_get_storage)):
        profile = await _db(storage.get_merchant_profile, merchant)
        if not profile:
            raise HTTPException(status_code=404, detail="Merchant not found")
        return profile

    @app.get("/api/balance")
    async def balance(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return await _db(storage.get_balance, start, end)

    @app.get("/api/health-score")
    async def health_score(months: int = 1, storage=Depends(_get_storage)):
        if months < 1 or months > 12:
            raise HTTPException(status_code=400, detail="months must be between 1 and 12")
        return await _db(storage.get_health_score, months=months)

    @app.get("/api/income-vs-expense")
    async def income_vs_expense(months: int = 6, storage=Depends(_get_storage)):
        today = local_now()
        results = []
        for i in range(months):
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1
            m_start = f"{y}-{m:02d}-01"
            if m == 12:
                m_end = f"{y+1}-01-01"
            else:
                m_end = f"{y}-{m+1:02d}-01"
            b = await _db(storage.get_balance, m_start, m_end)
            results.append({"month": m_start[:7], "income": b["income"], "expenses": b["expenses"]})
        return list(reversed(results))

    @app.get("/api/trend")
    async def trend(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return await _db(storage.get_trend, start, end)

    @app.get("/api/trend/by-category")
    async def trend_by_category(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return await _db(storage.get_trend_by_category, start, end)

    @app.get("/api/merchants")
    async def merchants(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return await _db(storage.get_merchants_in_range, start, end)

    @app.get("/api/insights")
    async def insights(start_date: Optional[str] = None, end_date: Optional[str] = None, storage=Depends(_get_storage)):
        today = local_now()
        start = start_date or f"{today.year}-{today.month:02d}-01"
        end = end_date or today.strftime("%Y-%m-%d")
        return {
            "merchants": await _db(storage.get_merchant_ranking, start, end),
            "average_daily": await _db(storage.get_average_daily, start, end),
        }

    @app.get("/api/recurring")
    async def recurring(storage=Depends(_get_storage)):
        return await _db(storage.get_recurring_transactions)

    @app.get("/api/analytics/comparison")
    async def analytics_comparison(
        period: str = "month",
        date: Optional[str] = None,
        storage=Depends(_get_storage),
    ):
        return await _db(storage.comparison, period=period, date=date)


    @app.get("/api/analytics/merchants")
    async def analytics_merchants(
        limit: int = 10,
        merchant: Optional[str] = None,
        storage=Depends(_get_storage),
    ):
        top = await _db(storage.top_merchants_by_period, limit=limit)
        trend = await _db(storage.merchant_trend_chart, merchant) if merchant else None
        return {"top": top, "trend": trend}


    @app.get("/api/analytics/velocity")
    async def analytics_velocity(storage=Depends(_get_storage)):
        return await _db(storage.spending_velocity)


    @app.get("/api/analytics/alerts")
    async def analytics_alerts(storage=Depends(_get_storage)):
        multiplier = float(await _db(storage.get_setting, "anomaly_multiplier", "2.0"))
        anomalies = await _db(storage.spending_anomalies, multiplier=multiplier)
        if llm_service:
            for a in anomalies:
                try:
                    a["explanation"] = llm_service.explain_anomaly(
                        a["merchant"], a["amount"], a.get("avg_amount", a["amount"]), a["category"]
                    )
                except Exception:
                    a["explanation"] = ""
        return {
            "anomalies": anomalies,
            "new_merchants": await _db(storage.new_merchants),
        }


    @app.get("/api/analytics/summaries")
    async def analytics_summaries(storage=Depends(_get_storage)):
        loop = asyncio.get_running_loop()
        monthly = await loop.run_in_executor(_DB_EXECUTOR, load_summary, SUMMARY_CACHE_DIR, "monthly")
        weekly = await loop.run_in_executor(_DB_EXECUTOR, load_summary, SUMMARY_CACHE_DIR, "weekly")
        return {"monthly": monthly, "weekly": weekly}


    @app.get("/api/analytics/yoy")
    async def get_yoy_endpoint(months: int = Query(default=12, ge=1, le=60), storage=Depends(_get_storage)):
        return await _db(get_yoy_comparison, storage._conn, months)


    @app.get("/api/analytics/insight")
    async def get_analytics_insight(storage=Depends(_get_storage)):
        import json as _json
        content_str = await _db(storage.get_setting, "llm_insight_content", "")
        generated_at = await _db(storage.get_setting, "llm_insight_generated_at", "")
        if not content_str:
            return {"content": None, "generated_at": None, "is_stale": True}
        try:
            content = _json.loads(content_str)
        except Exception:
            content = None
        is_stale = True
        if generated_at:
            from datetime import timedelta
            try:
                gen = datetime.fromisoformat(generated_at)
                if gen.tzinfo is None:
                    from zoneinfo import ZoneInfo
                    from src.config import DEFAULT_TIMEZONE
                    gen = gen.replace(tzinfo=ZoneInfo(DEFAULT_TIMEZONE))
                is_stale = (local_now() - gen).total_seconds() > 25 * 3600
            except Exception:
                pass
        return {"content": content, "generated_at": generated_at, "is_stale": is_stale}


    @app.get("/api/analytics/insight/weekly")
    async def get_weekly_insight(storage=Depends(_get_storage)):
        import json as _json
        content_str = await _db(storage.get_setting, "llm_weekly_insight_content", "")
        generated_at = await _db(storage.get_setting, "llm_weekly_insight_generated_at", "")
        if not content_str:
            return {"content": None, "generated_at": None, "is_stale": True}
        try:
            content = _json.loads(content_str)
        except Exception:
            content = None
        is_stale = True
        if generated_at:
            try:
                gen = datetime.fromisoformat(generated_at)
                if gen.tzinfo is None:
                    from zoneinfo import ZoneInfo
                    from src.config import DEFAULT_TIMEZONE
                    gen = gen.replace(tzinfo=ZoneInfo(DEFAULT_TIMEZONE))
                is_stale = (local_now() - gen).total_seconds() > 8 * 24 * 3600  # stale after 8 days
            except Exception:
                pass
        return {"content": content, "generated_at": generated_at, "is_stale": is_stale}

    @app.get("/api/analytics/insight/monthly")
    async def get_monthly_insight(storage=Depends(_get_storage)):
        import json as _json
        content_str = await _db(storage.get_setting, "llm_monthly_insight_content", "")
        generated_at = await _db(storage.get_setting, "llm_monthly_insight_generated_at", "")
        if not content_str:
            return {"content": None, "generated_at": None, "is_stale": True}
        try:
            content = _json.loads(content_str)
        except Exception:
            content = None
        is_stale = True
        if generated_at:
            try:
                gen = datetime.fromisoformat(generated_at)
                if gen.tzinfo is None:
                    from zoneinfo import ZoneInfo
                    from src.config import DEFAULT_TIMEZONE
                    gen = gen.replace(tzinfo=ZoneInfo(DEFAULT_TIMEZONE))
                is_stale = (local_now() - gen).total_seconds() > 35 * 24 * 3600  # stale after 35 days
            except Exception:
                pass
        return {"content": content, "generated_at": generated_at, "is_stale": is_stale}

    @app.get("/api/settings")
    async def get_settings(storage=Depends(_get_storage)):
        return {
            "anomaly_multiplier": float(await _db(storage.get_setting, "anomaly_multiplier", "2.0")),
            "velocity_alert_threshold": int(await _db(storage.get_setting, "velocity_alert_threshold", "110")),
            "budgets_enabled": await _db(storage.get_setting, "budgets_enabled", "false") == "true",
            "goals_enabled": await _db(storage.get_setting, "goals_enabled", "false") == "true",
            "trips_enabled": await _db(storage.get_setting, "trips_enabled", "false") == "true",
            "subscriptions_enabled": await _db(storage.get_setting, "subscriptions_enabled", "false") == "true",
            "recurring_enabled": await _db(storage.get_setting, "recurring_enabled", "false") == "true",
            "home_briefing_enabled": await _db(storage.get_setting, "home_briefing_enabled", "false") == "true",
            "category_colors_snapped_v2": await _db(storage.get_setting, "category_colors_snapped_v2", "false"),
        }

    @app.put("/api/settings")
    async def update_settings(request: Request, storage=Depends(_get_storage)):
        body = await request.json()
        errors = {}
        validated = {}

        if "home_briefing_enabled" in body:
            if not isinstance(body["home_briefing_enabled"], bool):
                errors["home_briefing_enabled"] = "must be a boolean"
            else:
                validated["home_briefing_enabled"] = str(body["home_briefing_enabled"]).lower()

        if "anomaly_multiplier" in body:
            val = body["anomaly_multiplier"]
            try:
                val = float(val)
            except (TypeError, ValueError):
                errors["anomaly_multiplier"] = "must be a number"
            else:
                if not (1.0 <= val <= 10.0):
                    errors["anomaly_multiplier"] = "must be between 1.0 and 10.0"
                else:
                    validated["anomaly_multiplier"] = str(val)

        if "velocity_alert_threshold" in body:
            val = body["velocity_alert_threshold"]
            try:
                val = int(val)
            except (TypeError, ValueError):
                errors["velocity_alert_threshold"] = "must be an integer"
            else:
                if not (50 <= val <= 300):
                    errors["velocity_alert_threshold"] = "must be between 50 and 300"
                else:
                    validated["velocity_alert_threshold"] = str(val)

        if "budgets_enabled" in body:
            val = body["budgets_enabled"]
            if not isinstance(val, bool):
                errors["budgets_enabled"] = "must be a boolean"
            else:
                validated["budgets_enabled"] = "true" if val else "false"

        if "goals_enabled" in body:
            val = body["goals_enabled"]
            if not isinstance(val, bool):
                errors["goals_enabled"] = "must be a boolean"
            else:
                validated["goals_enabled"] = "true" if val else "false"

        if "trips_enabled" in body:
            val = body["trips_enabled"]
            if not isinstance(val, bool):
                errors["trips_enabled"] = "must be a boolean"
            else:
                validated["trips_enabled"] = "true" if val else "false"

        if "subscriptions_enabled" in body:
            val = body["subscriptions_enabled"]
            if not isinstance(val, bool):
                errors["subscriptions_enabled"] = "must be a boolean"
            else:
                validated["subscriptions_enabled"] = "true" if val else "false"

        if "recurring_enabled" in body:
            val = body["recurring_enabled"]
            if not isinstance(val, bool):
                errors["recurring_enabled"] = "must be a boolean"
            else:
                validated["recurring_enabled"] = "true" if val else "false"

        if "category_colors_snapped_v2" in body:
            validated["category_colors_snapped_v2"] = str(body["category_colors_snapped_v2"])

        if "category_colors_pre_v2" in body:
            validated["category_colors_pre_v2"] = str(body["category_colors_pre_v2"])

        if errors:
            raise HTTPException(status_code=422, detail=errors)

        # Write all-or-nothing after validation
        for key, value in validated.items():
            await _db(storage.set_setting, key, value)

        return {
            "anomaly_multiplier": float(await _db(storage.get_setting, "anomaly_multiplier", "2.0")),
            "velocity_alert_threshold": int(await _db(storage.get_setting, "velocity_alert_threshold", "110")),
            "budgets_enabled": await _db(storage.get_setting, "budgets_enabled", "false") == "true",
            "goals_enabled": await _db(storage.get_setting, "goals_enabled", "false") == "true",
            "trips_enabled": await _db(storage.get_setting, "trips_enabled", "false") == "true",
            "subscriptions_enabled": await _db(storage.get_setting, "subscriptions_enabled", "false") == "true",
            "recurring_enabled": await _db(storage.get_setting, "recurring_enabled", "false") == "true",
            "category_colors_snapped_v2": await _db(storage.get_setting, "category_colors_snapped_v2", "false"),
        }

    # ── Budgets ──────────────────────────────────────────────────────────

    @app.get("/api/budgets")
    async def list_budgets(storage=Depends(_get_storage)):
        return await _db(storage.get_budgets)

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

    @app.get("/api/budgets/progress")
    async def budget_progress(storage=Depends(_get_storage)):
        return await _db(storage.get_budget_progress)

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

    @app.get("/api/goals")
    async def list_goals(storage=Depends(_get_storage)):
        goals = await _db(storage.get_goals)
        results = []
        for g in goals:
            progress = await _db(storage.get_goal_progress, g["id"])
            results.append(progress if progress else g)
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

    @app.get("/api/goals/{goal_id}/contributions")
    async def goal_contributions(goal_id: int, storage=Depends(_get_storage)):
        if not await _db(storage.get_goal, goal_id):
            raise HTTPException(status_code=404, detail="Goal not found")
        return await _db(storage.get_contributions, goal_id)

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

    @app.get("/api/trips/{trip_id}/transactions/{tx_id}/membership")
    async def check_trip_membership(trip_id: int, tx_id: int, storage=Depends(_get_storage)):
        return {"in_trip": await _db(storage.is_in_trip, trip_id, tx_id)}

    # ── Subscriptions ──────────────────────────────────────────────────────────

    @app.get("/api/subscriptions/summary")
    async def get_subscription_summary(storage=Depends(_get_storage)):
        return await _db(storage.get_subscription_summary)

    @app.get("/api/subscriptions")
    async def list_subscriptions(storage=Depends(_get_storage)):
        subs = await _db(storage.list_subscriptions)
        summary = await _db(storage.get_subscription_summary)
        enriched = []
        for sub in subs:
            last_amount = await _db(storage.get_subscription_last_amount, sub["id"])
            upcoming = await _db(storage.list_upcoming_transactions, sub["id"])
            pending = [u for u in upcoming if u["status"] == "pending"]
            next_upcoming = pending[0] if pending else None
            enriched.append({
                **sub,
                "last_amount": last_amount,
                "next_expected_date": next_upcoming["expected_date"] if next_upcoming else None,
                "next_upcoming_id": next_upcoming["id"] if next_upcoming else None,
            })
        return {"subscriptions": enriched, "summary": summary}

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
        )
        return await _db(storage.get_subscription, sub_id)

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
            raise HTTPException(status_code=404, detail=str(e))
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
        if not transaction_id:
            raise HTTPException(status_code=422, detail="transaction_id required")
        if not await _db(storage.get_transaction, transaction_id):
            raise HTTPException(status_code=404, detail="Transaction not found")
        await _db(storage.match_upcoming_transaction, upcoming_id, transaction_id)
        return {"status": "ok"}

    @app.post("/api/subscriptions/{sub_id}/upcoming/{upcoming_id}/dismiss")
    async def dismiss_upcoming(sub_id: int, upcoming_id: int, storage=Depends(_get_storage)):
        upcoming = await _db(storage.get_upcoming_transaction, upcoming_id)
        if not upcoming or upcoming["subscription_id"] != sub_id:
            raise HTTPException(status_code=404, detail="Upcoming transaction not found")
        await _db(storage.dismiss_upcoming_transaction, upcoming_id)
        return {"status": "ok"}

    @app.post("/api/subscriptions/{sub_id}/link-transaction", status_code=201)
    async def link_transaction(sub_id: int, body: dict, storage=Depends(_get_storage)):
        tx_id = body.get("transaction_id")
        if not isinstance(tx_id, int):
            raise HTTPException(status_code=422, detail="transaction_id must be an integer")
        try:
            await _db(storage.link_transaction_to_subscription, sub_id, tx_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
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
            file_path = os.path.join(static_dist, full_path)
            if os.path.isfile(file_path) and not full_path.startswith("api"):
                return FileResponse(file_path)
            return FileResponse(os.path.join(static_dist, "index.html"))

    return app
