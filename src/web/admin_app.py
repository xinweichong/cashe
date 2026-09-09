import bcrypt
import logging
import os
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse

logger = logging.getLogger(__name__)


def create_admin_app(
    admin_storage,           # AdminStorage instance
    user_manager,            # UserManager instance
    admin_password_hash: str,
) -> FastAPI:
    app = FastAPI(title="Cashe Admin")

    # In-memory rate limiting: {ip: (attempt_count, lockout_until_datetime | None)}
    _login_attempts: dict[str, tuple[int, datetime | None]] = {}
    _MAX_ATTEMPTS = 5
    _LOCKOUT_MINUTES = 15

    # ── Auth helpers ──────────────────────────────────────────────────────────

    def _get_client_ip(request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        return forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else "unknown"
        )

    def _is_locked_out(ip: str) -> bool:
        attempts, lockout_until = _login_attempts.get(ip, (0, None))
        if lockout_until and datetime.now(timezone.utc) < lockout_until:
            return True
        if lockout_until and datetime.now(timezone.utc) >= lockout_until:
            _login_attempts.pop(ip, None)
        return False

    def _record_failure(ip: str) -> None:
        attempts, _ = _login_attempts.get(ip, (0, None))
        attempts += 1
        if attempts >= _MAX_ATTEMPTS:
            _login_attempts[ip] = (attempts, datetime.now(timezone.utc) + timedelta(minutes=_LOCKOUT_MINUTES))
        else:
            _login_attempts[ip] = (attempts, None)

    def require_admin_session(request: Request) -> None:
        token = request.headers.get("X-Admin-Token")
        if not token or not admin_storage.verify_admin_session(token):
            raise HTTPException(status_code=401, detail="Not authenticated")

    # ── Login / logout ────────────────────────────────────────────────────────

    @app.post("/api/login")
    async def admin_login(request: Request):
        ip = _get_client_ip(request)
        if _is_locked_out(ip):
            raise HTTPException(
                status_code=429,
                detail=f"Too many attempts. Try again in {_LOCKOUT_MINUTES} minutes.",
            )
        body = await request.json()
        password = body.get("password", "")
        if not bcrypt.checkpw(password.encode(), admin_password_hash.encode()):
            _record_failure(ip)
            raise HTTPException(status_code=401, detail="Incorrect password")
        _login_attempts.pop(ip, None)
        token = admin_storage.create_admin_session()
        return JSONResponse({"status": "ok", "token": token})

    @app.post("/api/logout")
    async def admin_logout(request: Request):
        token = request.headers.get("X-Admin-Token")
        if token:
            admin_storage.destroy_admin_session(token)
        return JSONResponse({"status": "ok"})

    # ── User management ───────────────────────────────────────────────────────

    @app.get("/api/users", dependencies=[Depends(require_admin_session)])
    async def list_users():
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
    async def create_user(request: Request):
        body = await request.json()
        username = body.get("username", "").strip().lower()
        if not username:
            raise HTTPException(status_code=400, detail="username is required")
        password = _generate_password()
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
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
    async def delete_user(username: str):
        user = admin_storage.get_user(username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_manager.delete_user(username)
        admin_storage.delete_user(username)
        return {"status": "ok"}

    @app.post("/api/users/{username}/reset-password", dependencies=[Depends(require_admin_session)])
    async def reset_password(username: str, request: Request):
        body = await request.json()
        new_password = body.get("new_password", "")
        if len(new_password) < 8:
            raise HTTPException(status_code=422, detail="password must be at least 8 characters")
        user = admin_storage.get_user(username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        admin_storage.update_user(username, password_hash=new_hash, force_password_change=1)
        admin_storage.destroy_all_sessions(username)
        return {"status": "ok"}

    # ── Operational health (private; distinct from the public /health liveness check) ──

    @app.get("/api/health", dependencies=[Depends(require_admin_session)])
    async def job_health():
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
        }

    # ── Serve admin SPA ───────────────────────────────────────────────────────
    static_dist = os.path.join(os.path.dirname(__file__), "dist")
    if os.path.isdir(static_dist):
        @app.get("/{full_path:path}")
        async def serve_admin_spa(full_path: str):
            return FileResponse(os.path.join(static_dist, "index.html"))

    return app
