from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from config import get_settings


@lru_cache(maxsize=8)
def _zoneinfo(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def app_now() -> datetime:
    """Return an aware datetime in the configured application timezone."""
    settings = get_settings()
    return datetime.now(_zoneinfo(settings.TIMEZONE))


def app_today() -> date:
    """Return today's date in the configured application timezone."""
    return app_now().date()
