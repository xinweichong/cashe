import bcrypt
from typing import Optional

_admin_storage = None   # set by init_auth()


def init_auth(admin_storage) -> None:
    """Called once at startup with the AdminStorage instance."""
    global _admin_storage
    _admin_storage = admin_storage


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


class LoginRateLimiter:
    """At most `max_attempts` login attempts per key within a sliding window.

    reserve() takes an attempt before the password check (so concurrent
    requests can't overshoot) and returns its timestamp, or None when any
    key is locked out."""

    def __init__(self, max_attempts: int = 5, window_seconds: float = 900):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = {}

    def reserve(self, keys: list[str], now: float) -> float | None:
        for key in list(self._attempts):
            self._attempts[key] = [t for t in self._attempts[key] if t > now - self.window_seconds]
            if not self._attempts[key]:
                del self._attempts[key]
        if any(len(self._attempts.get(key, [])) >= self.max_attempts for key in keys):
            return None
        for key in keys:
            self._attempts.setdefault(key, []).append(now)
        return now

    def clear(self, key: str) -> None:
        self._attempts.pop(key, None)

    def release(self, key: str, stamp: float) -> None:
        """Give back one reserved attempt, keeping the key's others."""
        if key in self._attempts:
            self._attempts[key] = [t for t in self._attempts[key] if t != stamp]


def create_session(username: str, user_agent: str = "") -> str:
    """Create a session for a user. Returns the session token."""
    return _admin_storage.create_session(username, user_agent)


def verify_session(token: str) -> Optional[str]:
    """Returns username if session is valid and within 30-day sliding window.
    Returns None if invalid or expired.
    """
    if _admin_storage is None:
        return None
    return _admin_storage.verify_session(token)


def destroy_session(token: str) -> None:
    if _admin_storage is not None:
        _admin_storage.destroy_session(token)
