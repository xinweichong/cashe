import os
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml


DEFAULTS = {
    "server": {"host": "0.0.0.0", "port": 8080, "webhook_base_url": ""},
    "gmail": {"poll_interval_seconds": 120, "sender_filters": []},
}

DEFAULT_TIMEZONE = "Asia/Singapore"


def local_now(tz_name: str = DEFAULT_TIMEZONE) -> datetime:
    """Return the current datetime in the configured local timezone.

    Use this instead of datetime.now() everywhere a wall-clock date is needed
    for user-facing queries (today, this week, this month, etc.).  Avoids the
    off-by-one-day bug that occurs when the server runs in UTC but the user is
    in a UTC+ timezone.
    """
    return datetime.now(ZoneInfo(tz_name))

DEFAULT_CATEGORIES = [
    {"name": "Food", "keywords": ["restaurant", "cafe", "food", "kopitiam", "toast box", "ya kun"], "icon": "🍜"},
    {"name": "Transport", "keywords": ["grab", "gojek", "comfortdelgro", "mrt", "bus", "taxi", "cdg"], "icon": "🚗"},
    {"name": "Shopping", "keywords": ["shopee", "lazada", "fairprice", "cold storage", "ntuc"], "icon": "🛒"},
    {"name": "Bills", "keywords": ["sp services", "singtel", "starhub", "m1"], "icon": "📄"},
    {"name": "Entertainment", "keywords": ["netflix", "spotify"], "icon": "🎬"},
    {"name": "Other", "keywords": [], "icon": "📌"},
]


def _webhook_base_url_from_env() -> str:
    """WEBHOOK_BASE_URL, else the Railway public domain, else ''."""
    return (
        os.environ.get("WEBHOOK_BASE_URL")
        or (f"https://{d}" if (d := os.environ.get("RAILWAY_PUBLIC_DOMAIN")) else "")
    )


def _config_from_env() -> dict[str, Any]:
    """Build a config dict purely from environment variables.

    Used as a fallback when config.yaml is not available (e.g. in Docker/Railway).
    """
    port = int(os.environ.get("PORT", os.environ.get("SERVER_PORT", "8080")))

    sender_filters_str = os.environ.get("GMAIL_SENDER_FILTERS", "")
    sender_filters = [s.strip() for s in sender_filters_str.split(",") if s.strip()] if sender_filters_str else []

    poll_interval = int(os.environ.get("GMAIL_POLL_INTERVAL", "120"))

    config: dict[str, Any] = {
        "server": {
            "host": "0.0.0.0",
            "port": port,
            "webhook_base_url": _webhook_base_url_from_env(),
        },
        "gmail": {
            "credentials_file": "credentials.json",
            "poll_interval_seconds": poll_interval,
            "sender_filters": sender_filters,
        },
        "web": {},
        "telegram": {},
        "categories": DEFAULT_CATEGORIES,
        "timezone": DEFAULT_TIMEZONE,
    }

    return config


def load_config(config_path: str) -> dict[str, Any]:
    path = Path(config_path)

    if path.exists():
        with open(path) as f:
            config = yaml.safe_load(f) or {}
    else:
        config = _config_from_env()

    # Apply defaults for missing sections
    for section, defaults in DEFAULTS.items():
        if section not in config:
            config[section] = {}
        for key, default_val in defaults.items():
            config[section].setdefault(key, default_val)

    # Top-level defaults
    config.setdefault("timezone", DEFAULT_TIMEZONE)

    # Environment variable overrides (always applied, even when config file exists)
    if token := os.environ.get("TELEGRAM_BOT_TOKEN"):
        config.setdefault("telegram", {})["bot_token"] = token
    if password_hash := os.environ.get("WEB_PASSWORD_HASH"):
        config.setdefault("web", {})["password_hash"] = password_hash
    if port_env := os.environ.get("PORT"):
        config.setdefault("server", {})["port"] = int(port_env)
    if tz_env := os.environ.get("TIMEZONE"):
        config["timezone"] = tz_env
    if url := _webhook_base_url_from_env():
        config.setdefault("server", {})["webhook_base_url"] = url

    return config
