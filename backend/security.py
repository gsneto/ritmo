from hmac import compare_digest
from threading import Lock
from time import monotonic
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status

from config import Settings, get_settings


class AuthFailureLimiter:
    """Small in-process lockout for repeated invalid access-key attempts."""

    def __init__(self) -> None:
        self._failures: dict[str, list[float]] = {}
        self._locked_until: dict[str, float] = {}
        self._lock = Lock()

    def retry_after(self, identifier: str, now: float | None = None) -> int:
        current = monotonic() if now is None else now
        with self._lock:
            locked_until = self._locked_until.get(identifier, 0)
            if locked_until <= current:
                self._locked_until.pop(identifier, None)
                return 0
            return max(1, int(locked_until - current + 0.999))

    def record_failure(
        self,
        identifier: str,
        settings: Settings,
        now: float | None = None,
    ) -> int:
        current = monotonic() if now is None else now
        window_start = current - settings.AUTH_FAILURE_WINDOW_SECONDS
        with self._lock:
            failures = [
                timestamp
                for timestamp in self._failures.get(identifier, [])
                if timestamp > window_start
            ]
            failures.append(current)
            self._failures[identifier] = failures
            if len(failures) < settings.AUTH_MAX_FAILURES:
                return 0

            locked_until = current + settings.AUTH_LOCKOUT_SECONDS
            self._locked_until[identifier] = locked_until
            self._failures.pop(identifier, None)
            return settings.AUTH_LOCKOUT_SECONDS

    def clear(self, identifier: str) -> None:
        with self._lock:
            self._failures.pop(identifier, None)
            self._locked_until.pop(identifier, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._locked_until.clear()


auth_failure_limiter = AuthFailureLimiter()


def _raise_locked_out(retry_after: int) -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many invalid access-key attempts",
        headers={"Retry-After": str(retry_after)},
    )


def validate_api_key(
    supplied_key: str | None,
    settings: Settings,
    identifier: str,
) -> None:
    expected_key = settings.access_token
    if expected_key is None:
        return

    retry_after = auth_failure_limiter.retry_after(identifier)
    if retry_after:
        _raise_locked_out(retry_after)

    if supplied_key is None or not compare_digest(supplied_key, expected_key):
        retry_after = auth_failure_limiter.record_failure(identifier, settings)
        if retry_after:
            _raise_locked_out(retry_after)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing access key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    auth_failure_limiter.clear(identifier)


def require_api_key(
    request: Request,
    supplied_key: Annotated[str | None, Header(alias="X-Ritmo-Key")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Protect the personal API without introducing user accounts."""
    identifier = request.client.host if request.client is not None else "unknown-client"
    validate_api_key(supplied_key, settings, identifier)
