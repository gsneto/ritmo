import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hmac import compare_digest
from threading import Lock
from time import monotonic
from typing import Annotated, Literal, cast

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import Settings, get_settings
from database import get_db
from models.session import UserSession
from models.user import User


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
login_failure_limiter = AuthFailureLimiter()

SESSION_COOKIE = "ritmo_session"
CSRF_COOKIE = "ritmo_csrf"
CSRF_HEADER = "X-CSRF-Token"
SESSION_COOKIE_PREFIX = "__Host-"

_password_hasher = PasswordHasher()
# Verified against an unknown profile so a missing user costs the same as a
# wrong password. Computed once; never compared to a real credential.
_DUMMY_HASH = _password_hasher.hash(secrets.token_urlsafe(32))

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_EXEMPT_PATHS = frozenset({"/api/auth/login"})


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
    """Protect server-to-server callers without introducing user accounts."""
    identifier = request.client.host if request.client is not None else "unknown-client"
    validate_api_key(supplied_key, settings, identifier)


# ---------------------------------------------------------------------------
# Password credentials
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        # Keep timing comparable to a real verification.
        try:
            _password_hasher.verify(_DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            pass
        return False
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _password_hasher.check_needs_rehash(password_hash)


def validate_password_strength(password: str) -> None:
    if len(password) < 12:
        raise ValueError("password must have at least 12 characters")
    if len(password) > 256:
        raise ValueError("password must have at most 256 characters")


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def cookie_name(base: str, settings: Settings) -> str:
    """Use the __Host- prefix only when the cookie can actually satisfy it."""
    return f"{SESSION_COOKIE_PREFIX}{base}" if settings.SESSION_COOKIE_SECURE else base


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes even for timezone-aware columns."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def create_session(
    db: Session,
    user: User,
    settings: Settings,
) -> tuple[UserSession, str, str]:
    """Create a fresh session. A new token on every login prevents fixation."""
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    now = _now()
    session_row = UserSession(
        user_id=user.id,
        token_hash=_digest(token),
        csrf_hash=_digest(csrf_token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.SESSION_TTL_HOURS),
    )
    db.add(session_row)
    db.commit()
    db.refresh(session_row)
    return session_row, token, csrf_token


def revoke_session(db: Session, session_row: UserSession) -> None:
    if session_row.revoked_at is None:
        session_row.revoked_at = _now()
        db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    now = _now()
    db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
    ).update({UserSession.revoked_at: now}, synchronize_session=False)
    db.commit()


def resolve_session(db: Session, token: str) -> UserSession | None:
    row = (
        db.query(UserSession)
        .filter(UserSession.token_hash == _digest(token))
        .first()
    )
    if row is None:
        return None
    if row.revoked_at is not None:
        return None
    if _as_utc(row.expires_at) <= _now():
        return None
    return row


def login_handle(profile_id: str, settings: Settings) -> str:
    """Opaque, stable handle for the unauthenticated login screen.

    The public profile list must not leak the household's names. The handle is
    derived with HMAC so it cannot be reversed by guessing common first names,
    and it changes only if the access token is rotated. The client fetches the
    list on every page load, so rotation is harmless.
    """
    key = (settings.access_token or "ritmo-login-handle-dev").encode("utf-8")
    digest = hmac.new(key, profile_id.encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()[:16]


def resolve_login_handle(
    users: list[User],
    supplied: str,
    settings: Settings,
) -> User | None:
    """Find the user behind a login handle, or behind a raw profile id.

    Accepting the raw profile id keeps the CLI scripts and the test suite
    working; it is still protected by the password and the login lockout.
    """
    for user in users:
        if user.profile_id == supplied:
            return user
    for user in users:
        handle = login_handle(cast(str, user.profile_id), settings)
        if hmac.compare_digest(handle, supplied):
            return user
    return None


def csrf_matches(session_row: UserSession, supplied: str | None) -> bool:
    if not supplied:
        return False
    return hmac.compare_digest(cast(str, session_row.csrf_hash), _digest(supplied))


def set_session_cookies(
    response,
    settings: Settings,
    token: str,
    csrf_token: str,
    expires_at: datetime,
) -> None:
    secure = settings.SESSION_COOKIE_SECURE
    samesite = settings.SESSION_COOKIE_SAMESITE
    max_age = max(0, int((_as_utc(expires_at) - _now()).total_seconds()))
    response.set_cookie(
        cookie_name(SESSION_COOKIE, settings),
        token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
    )
    # Readable by JavaScript on purpose: the double-submit value must be echoed
    # in the X-CSRF-Token header. It grants nothing on its own.
    response.set_cookie(
        cookie_name(CSRF_COOKIE, settings),
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite=samesite,
        path="/",
    )


def clear_session_cookies(response, settings: Settings) -> None:
    for base in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            cookie_name(base, settings),
            path="/",
            secure=settings.SESSION_COOKIE_SECURE,
            samesite=settings.SESSION_COOKIE_SAMESITE,
        )


# ---------------------------------------------------------------------------
# Principals and authorization
# ---------------------------------------------------------------------------

AuthMethod = Literal["session", "api_key"]


@dataclass(frozen=True)
class Principal:
    """Who is calling.

    ``session`` is a browser holding an HttpOnly cookie and is always scoped to
    one profile. ``api_key`` is a trusted server-side caller (scripts, backups,
    tests) and keeps full household access.
    """

    method: AuthMethod
    user: User | None
    session: UserSession | None = None

    @property
    def user_id(self) -> int | None:
        return cast(int, self.user.id) if self.user is not None else None


def _client_identifier(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown-client"


def enforce_origin(request: Request, settings: Settings) -> None:
    """Reject mutating requests from an origin we do not trust.

    Two independent browser signals are checked:

    * ``Origin`` must match an allowed origin exactly when it is present.
      ``Origin: null`` (sandboxed iframe, some redirects) never matches.
    * ``Sec-Fetch-Site: cross-site`` is rejected even when ``Origin`` is
      absent, because the fetch metadata is set by the browser and cannot be
      forged from a page.

    A request with neither header (curl, server scripts) is allowed; the CSRF
    token remains mandatory whenever a session cookie is present.
    """
    if request.method not in MUTATING_METHODS:
        return

    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site is not None and fetch_site.strip().lower() == "cross-site":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-site request rejected",
        )

    origin = request.headers.get("origin")
    if origin is None:
        return
    normalized = origin.strip().rstrip("/")
    if normalized not in settings.cors_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin not allowed",
        )


def enforce_csrf(request: Request, session_row: UserSession) -> None:
    if request.method not in MUTATING_METHODS:
        return
    if request.url.path in CSRF_EXEMPT_PATHS:
        return
    if not csrf_matches(session_row, request.headers.get(CSRF_HEADER)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing or invalid CSRF token",
        )


def enforce_profile_scope(request: Request, principal: Principal) -> None:
    """Never trust a user id supplied by the browser.

    Paths shaped ``/api/users/{user_id}/...`` are the main data surface. A
    session may only address its own profile. Shared shopping is resolved
    inside the shopping routes, which read the pair from the database rather
    than from the client.
    """
    if principal.method != "session":
        return
    path_user_id = request.path_params.get("user_id")
    if path_user_id is None:
        return
    try:
        target_user_id = int(path_user_id)
    except (TypeError, ValueError):
        # FastAPI validates the path parameter later; treat an unparseable id
        # as a forbidden target instead of leaking a 500.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile not accessible with this session",
        ) from None
    if target_user_id != principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile not accessible with this session",
        )


def enforce_resource_scope(request: Request, principal: Principal, db: Session) -> None:
    """Guard routes whose profile is implied by a resource id.

    Kept in a separate module so the model imports stay out of the auth core.
    """
    if principal.method != "session":
        return
    from services.authorization import resource_owner_ids

    allowed = resource_owner_ids(db, request.url.path)
    if allowed is None:
        return
    if principal.user_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not accessible with this session",
        )


def get_principal(
    request: Request,
    supplied_key: Annotated[str | None, Header(alias="X-Ritmo-Key")] = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Principal:
    """Resolve the caller from a browser session or a server API key."""
    enforce_origin(request, settings)

    token = request.cookies.get(cookie_name(SESSION_COOKIE, settings))
    if token:
        session_row = resolve_session(db, token)
        if session_row is not None:
            user = db.get(User, session_row.user_id)
            if user is not None:
                enforce_csrf(request, session_row)
                principal = Principal(method="session", user=user, session=session_row)
                enforce_profile_scope(request, principal)
                enforce_resource_scope(request, principal, db)
                return principal
        # An expired or revoked cookie is a 401 so the browser can log in again.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired",
            headers={"WWW-Authenticate": "Session"},
        )

    identifier = _client_identifier(request)
    validate_api_key(supplied_key, settings, identifier)
    return Principal(method="api_key", user=None)


def require_session_principal(principal: Principal = Depends(get_principal)) -> Principal:
    if principal.method != "session" or principal.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Browser session required",
            headers={"WWW-Authenticate": "Session"},
        )
    return principal


def require_user_access(principal: Principal, user_id: int) -> None:
    """Guard a resource that belongs to a single profile."""
    if principal.method != "session":
        return
    if principal.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile not accessible with this session",
        )


def require_household_access(principal: Principal, user_ids: set[int]) -> None:
    """Guard a resource shared between the paired profiles."""
    if principal.method != "session":
        return
    if principal.user_id not in user_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile not accessible with this session",
        )
