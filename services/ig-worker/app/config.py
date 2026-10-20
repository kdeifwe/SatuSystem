from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    pass


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number") from exc


def _int(name: str, default: int) -> int:
    return int(_float(name, default))


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    worker_secret: str
    encryption_key: str
    supabase_url: str
    supabase_key: str
    next_inbound_url: str
    proxy_url: str | None = None
    poll_min_sec: float = 20.0
    poll_max_sec: float = 40.0
    poll_pending: bool = True
    backfill_minutes: int = 10
    max_sends_per_hour: int = 30
    locale: str = "ru_RU"
    timezone_offset_sec: int = 18000
    persist_interval_sec: int = 1800
    inbox_amount: int = 10
    send_jitter_min: float = 0.3
    send_jitter_max: float = 1.2
    challenge_wait_sec: int = 300


def load_settings() -> Settings:
    required = {
        "IG_WORKER_SECRET": os.getenv("IG_WORKER_SECRET", "").strip(),
        "IG_SESSION_ENCRYPTION_KEY": os.getenv("IG_SESSION_ENCRYPTION_KEY", "").strip(),
        "SUPABASE_URL": (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip(),
        "SUPABASE_SERVICE_ROLE_KEY": os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
        "NEXT_INBOUND_URL": os.getenv("NEXT_INBOUND_URL", "").strip(),
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise ConfigError("Missing required env vars: " + ", ".join(missing))

    poll_min = _float("IG_POLL_MIN_SEC", 20.0)
    poll_max = _float("IG_POLL_MAX_SEC", 40.0)
    if poll_min < 5 or poll_max < poll_min:
        raise ConfigError("IG_POLL_MIN_SEC must be >= 5 and IG_POLL_MAX_SEC >= IG_POLL_MIN_SEC")

    return Settings(
        worker_secret=required["IG_WORKER_SECRET"],
        encryption_key=required["IG_SESSION_ENCRYPTION_KEY"],
        supabase_url=required["SUPABASE_URL"].rstrip("/"),
        supabase_key=required["SUPABASE_SERVICE_ROLE_KEY"],
        next_inbound_url=required["NEXT_INBOUND_URL"],
        proxy_url=(os.getenv("IG_PROXY_URL") or "").strip() or None,
        poll_min_sec=poll_min,
        poll_max_sec=poll_max,
        poll_pending=_bool("IG_POLL_PENDING", True),
        backfill_minutes=_int("IG_BACKFILL_MINUTES", 10),
        max_sends_per_hour=_int("IG_MAX_SENDS_PER_HOUR", 30),
        locale=os.getenv("IG_LOCALE", "ru_RU").strip() or "ru_RU",
        timezone_offset_sec=_int("IG_TIMEZONE_OFFSET_SEC", 18000),
    )
