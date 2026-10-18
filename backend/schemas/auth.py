from pydantic import Field

from schemas.common import ApiSchema, Name50


class LoginRequest(ApiSchema):
    profile_id: Name50
    # Bounded so a huge body cannot be fed to Argon2 as a cheap CPU sink.
    password: str = Field(min_length=1, max_length=256)


class SessionProfile(ApiSchema):
    id: int
    profile_id: str
    name: str
    initials: str
    theme: str


class SessionResponse(ApiSchema):
    authenticated: bool = True
    profile: SessionProfile
    expires_at: str


class PublicProfile(ApiSchema):
    """Directory entry shown before authentication.

    Deliberately anonymous: an opaque handle that only works for the login
    form, plus a positional label. The real profile id, name, initials and
    theme are never returned to an unauthenticated caller.
    """

    login_id: str
    label: str


class LogoutResponse(ApiSchema):
    authenticated: bool = False
