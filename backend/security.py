from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from config import Settings, get_settings


def require_api_key(
    supplied_key: Annotated[str | None, Header(alias="X-Ritmo-Key")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Protect the personal API without introducing user accounts."""
    expected_key = settings.access_token
    if expected_key is None:
        # A missing token is intentionally allowed only by validated debug settings.
        return

    if supplied_key is None or not compare_digest(supplied_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing access key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
