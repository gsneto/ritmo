from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from config import Settings, get_settings
from database import get_db
from models.user import User
from rate_limit import limiter
from schemas.auth import LoginRequest, LogoutResponse, PublicProfile, SessionResponse
from security import (
    Principal,
    clear_session_cookies,
    create_session,
    enforce_origin,
    hash_password,
    login_failure_limiter,
    password_needs_rehash,
    require_session_principal,
    revoke_session,
    set_session_cookies,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_CREDENTIALS = "Perfil ou senha invalidos"


def _client_identifier(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown-client"


def _raise_login_locked_out(retry_after: int) -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many login attempts",
        headers={"Retry-After": str(retry_after)},
    )


@router.get("/profiles", response_model=list[PublicProfile])
@limiter.limit("30/minute")
def list_public_profiles(request: Request, db: Session = Depends(get_db)):
    """Minimal profile directory for the login screen.

    Only display data is exposed; no credential, preference or activity is
    returned. The endpoint is rate limited and documented as a deliberate
    trade-off in docs/ADR-AUTH-WEB.md.
    """
    users = db.query(User).order_by(User.id).all()
    return [
        PublicProfile(profile_id=user.profile_id, name=user.name)
        for user in users
    ]


@router.post("/login", response_model=SessionResponse)
@limiter.limit("10/minute")
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # Login is exempt from CSRF (there is no session yet) but not from the
    # origin check, which blocks cross-site login attempts.
    enforce_origin(request, settings)

    identifier = _client_identifier(request)
    retry_after = login_failure_limiter.retry_after(identifier)
    if retry_after:
        _raise_login_locked_out(retry_after)

    user = db.query(User).filter(User.profile_id == payload.profile_id).first()
    password_ok = verify_password(
        user.password_hash if user is not None else None,
        payload.password,
    )

    if user is None or not password_ok:
        retry_after = login_failure_limiter.record_failure(identifier, settings)
        if retry_after:
            _raise_login_locked_out(retry_after)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS,
            headers={"WWW-Authenticate": "Session"},
        )

    login_failure_limiter.clear(identifier)

    if user.password_hash and password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        db.commit()

    session_row, token, csrf_token = create_session(db, user, settings)
    set_session_cookies(response, settings, token, csrf_token, session_row.expires_at)
    return SessionResponse(
        profile=_profile_payload(user),
        expires_at=session_row.expires_at.isoformat(),
    )


@router.get("/session", response_model=SessionResponse)
def read_session(
    principal: Principal = Depends(require_session_principal),
):
    """Return the profile bound to the current cookie."""
    assert principal.user is not None
    assert principal.session is not None
    return SessionResponse(
        profile=_profile_payload(principal.user),
        expires_at=principal.session.expires_at.isoformat(),
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(
    response: Response,
    principal: Principal = Depends(require_session_principal),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    assert principal.session is not None
    revoke_session(db, principal.session)
    clear_session_cookies(response, settings)
    return LogoutResponse()


def _profile_payload(user: User) -> dict:
    return {
        "id": user.id,
        "profile_id": user.profile_id,
        "name": user.name,
        "initials": user.initials,
        "theme": user.theme or "light",
    }
