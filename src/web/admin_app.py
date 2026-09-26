import logging
import os
import secrets
import string
import time

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse

from src.web.auth import LoginRateLimiter, hash_password, verify_password

logger = logging.getLogger(__name__)


def create_admin_app(
    admin_storage,           # AdminStorage instance
    user_manager,            # UserManager instance
    admin_password_hash: str,
) -> FastAPI:
    app = FastAPI(title="Cashe Admin")

    # Same limiter as the dashboard login, keyed by the connecting client (not
    # a client-supplied X-Forwarded-For header, which would let anyone reset
    # their own lockout).
    login_limiter = LoginRateLimiter()

    # ── Auth helpers ──────────────────────────────────────────────────────────

    def require_admin_session(request: Request) -> None:
        token = request.headers.get("X-Admin-Token")
        if not token or not admin_storage.verify_admin_session(token):
            raise HTTPException(status_code=401, detail="Not authenticated")

    # ── Login / logout ────────────────────────────────────────────────────────

    # Plain `def` handlers: FastAPI runs them in its threadpool, so bcrypt and
    # SQLite never block the event loop.
    @app.post("/api/login")
    def admin_login(request: Request, body: dict):
        key = "ip:" + (request.client.host if request.client else "unknown")
        if login_limiter.reserve([key], time.monotonic()) is None:
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
        if not verify_password(body.get("password", ""), admin_password_hash):
            raise HTTPException(status_code=401, detail="Incorrect password")
        login_limiter.clear(key)
        token = admin_storage.create_admin_session()
        return JSONResponse({"status": "ok", "token": token})

    @app.post("/api/logout")
    def admin_logout(request: Request):
        token = request.headers.get("X-Admin-Token")
        if token:
            admin_storage.destroy_admin_session(token)
        return JSONResponse({"status": "ok"})

    # ── User management ───────────────────────────────────────────────────────

    @app.get("/api/users", dependencies=[Depends(require_admin_session)])
    def list_users():
        users = admin_storage.list_users()
        return [
            {
                "username": u["username"],
                "gmail_connected": bool(u["gmail_connected"]),
                "telegram_linked": u["telegram_chat_id"] is not None,
                "onboarding_complete": bool(u["onboarding_complete"]),
                "created_at": u["created_at"],
            }
            for u in users
        ]

    def _generate_password(length: int = 16) -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%"
        return "".join(secrets.choice(alphabet) for _ in range(length))

    @app.post("/api/users", dependencies=[Depends(require_admin_session)])
    def create_user(body: dict):
        username = body.get("username", "").strip().lower()
        if not username:
            raise HTTPException(status_code=400, detail="username is required")
        password = _generate_password()
        password_hash = hash_password(password)
        try:
            user_manager.create_user(username, password_hash)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return {
            "status": "ok",
            "username": username,
            "password": password,
            "reminder": "Add this user's Gmail to Google Cloud Console Test Users before sending invite.",
        }

    @app.delete("/api/users/{username}", dependencies=[Depends(require_admin_session)])
    def delete_user(username: str):
        user = admin_storage.get_user(username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_manager.delete_user(username)
        admin_storage.delete_user(username)
        return {"status": "ok"}

    @app.post("/api/users/{username}/reset-password", dependencies=[Depends(require_admin_session)])
    def reset_password(username: str, body: dict):
        new_password = body.get("new_password", "")
        if len(new_password) < 8:
            raise HTTPException(status_code=422, detail="password must be at least 8 characters")
        user = admin_storage.get_user(username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        new_hash = hash_password(new_password)
        admin_storage.update_user(username, password_hash=new_hash, force_password_change=1)
        admin_storage.destroy_all_sessions(username)
        return {"status": "ok"}

    # ── Operational health (private; distinct from the public /health liveness check) ──

    @app.get("/api/health", dependencies=[Depends(require_admin_session)])
    def job_health():
        capture = {}
        for user in admin_storage.list_users():
            ctx = user_manager.get(user["username"])
            if ctx is not None:
                capture[user["username"]] = ctx.storage.get_capture_health()
        return {
            "jobs": [
                {
                    "job_name": row["job_name"],
                    "status": row["status"],
                    "started_at": row["started_at"],
                    "finished_at": row["finished_at"],
                    "error_code": row["error_code"],
                    "consecutive_failures": row["consecutive_failures"],
                }
                for row in admin_storage.get_job_health()
            ],
            "capture": capture,
        }

    # ── Serve admin SPA ───────────────────────────────────────────────────────
    static_dist = os.path.join(os.path.dirname(__file__), "dist")
    if os.path.isdir(static_dist):
        @app.get("/{full_path:path}")
        async def serve_admin_spa(full_path: str):
            return FileResponse(os.path.join(static_dist, "index.html"))

    return app
