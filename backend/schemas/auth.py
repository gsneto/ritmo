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
    """Minimal directory entry shown before authentication.

    Only what the login screen needs: an identifier and a human label. No
    initials, theme, id, e-mail, activity or preference is exposed.
    """

    profile_id: str
    name: str


class LogoutResponse(ApiSchema):
    authenticated: bool = False
