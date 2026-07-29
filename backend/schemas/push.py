from urllib.parse import urlsplit

from pydantic import Field, StringConstraints, field_validator
from typing import Annotated

from schemas.common import ApiSchema


PushEndpoint = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=10, max_length=4096),
]
PushKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=8,
        max_length=255,
        pattern=r"^[A-Za-z0-9_-]+={0,2}$",
    ),
]


class PushKeys(ApiSchema):
    p256dh: PushKey
    auth: PushKey


class PushSubscriptionUpsert(ApiSchema):
    endpoint: PushEndpoint
    expirationTime: int | None = Field(default=None, ge=0)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def validate_push_service(cls, value: str) -> str:
        parsed = urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        allowed_hosts = (
            "fcm.googleapis.com",
            "push.services.mozilla.com",
            "updates.push.services.mozilla.com",
            "web.push.apple.com",
            "notify.windows.com",
        )
        if (
            parsed.scheme != "https"
            or not hostname
            or not any(
                hostname == allowed
                or hostname.endswith(f".{allowed}")
                for allowed in allowed_hosts
            )
        ):
            raise ValueError("unsupported push service endpoint")
        return value


class PushSubscriptionDelete(ApiSchema):
    endpoint: PushEndpoint

    @field_validator("endpoint")
    @classmethod
    def validate_push_service(cls, value: str) -> str:
        return PushSubscriptionUpsert.validate_push_service(value)


class PushConfigResponse(ApiSchema):
    enabled: bool
    public_key: str | None = None


class PushSubscriptionResponse(ApiSchema):
    subscribed: bool
