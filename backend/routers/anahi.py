from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import Settings, get_settings
from database import get_db
from rate_limit import access_key_or_remote_address, anahi_rate_limit, limiter
from schemas.anahi import AnahiAnswer, AnahiQuestion
from services.anahi import (
    AnahiNotConfiguredError,
    AnahiTimeoutError,
    AnahiUnavailableError,
    generate_anahi_answer,
)
from services.anahi_context import (
    CONTEXT_SCOPE_ORDER,
    build_anahi_context,
    select_anahi_scopes,
)

router = APIRouter(prefix="/api", tags=["anahi"])


@router.post("/users/{user_id}/anahi/ask", response_model=AnahiAnswer)
@limiter.limit(
    anahi_rate_limit,
    key_func=access_key_or_remote_address,
    error_message="Limite de perguntas da ANAHI atingido. Tente novamente em instantes.",
)
def ask_anahi(
    request: Request,
    user_id: int,
    payload: AnahiQuestion,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AnahiAnswer:
    """Answer using a bounded, read-only snapshot of the selected profile."""
    scopes = select_anahi_scopes(payload.question)
    context = build_anahi_context(db, user_id, scopes=scopes)
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil nao encontrado.",
        )
    try:
        answer = generate_anahi_answer(payload.question, settings, context)
    except AnahiNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A assistente ANAHÍ ainda nao esta configurada.",
        ) from exc
    except AnahiTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="A assistente ANAHÍ demorou para responder. Tente novamente.",
        ) from exc
    except AnahiUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="A assistente ANAHÍ esta indisponivel. Tente novamente.",
        ) from exc

    return AnahiAnswer(
        answer=answer,
        model=settings.GEMINI_MODEL,
        profile_name=context["profile"]["name"],
        as_of=context["reference_date"],
        used_sources=[
            source
            for source in CONTEXT_SCOPE_ORDER
            if source in scopes
        ],
    )
