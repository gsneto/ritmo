from hashlib import sha256

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import get_settings


def access_key_or_remote_address(request: Request) -> str:
    """Group paid requests by access key without retaining the secret itself."""
    supplied_key = request.headers.get("X-Ritmo-Key")
    if supplied_key:
        digest = sha256(supplied_key.encode("utf-8")).hexdigest()
        return f"access-key:{digest}"
    return f"remote-address:{get_remote_address(request)}"


def anahi_rate_limit() -> str:
    return get_settings().ANAHI_RATE_LIMIT


limiter = Limiter(key_func=get_remote_address)
