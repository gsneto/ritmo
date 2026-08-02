import asyncio
import logging
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sentry_sdk.integrations.fastapi import FastApiIntegration
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker
from starlette.responses import Response

from config import Settings, get_settings
from database import SessionLocal, get_db, init_db
from push_worker import PushWorkerState, notification_runtime, run_worker
from rate_limit import limiter
from routers import anahi, backup, habits, push, reading, shopping, stats, tasks, users, workouts
from security import require_api_key
from seed import seed_default_data
from time_utils import app_today

logger = logging.getLogger(__name__)


def configure_sentry(settings: Settings) -> None:
    if settings.SENTRY_DSN is None:
        return

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        integrations=[FastApiIntegration()],
        send_default_pii=False,
        traces_sample_rate=0.0,
    )


def rate_limit_exceeded_handler(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, RateLimitExceeded):
        raise exc
    return _rate_limit_exceeded_handler(request, exc)


def create_app(
    app_settings: Settings | None = None,
    *,
    database_initializer: Callable[[], None] | None = None,
    session_factory: sessionmaker | None = None,
) -> FastAPI:
    settings = app_settings or get_settings()
    configure_sentry(settings)
    initialize_database = database_initializer or init_db
    make_session = session_factory or SessionLocal
    push_worker_state = PushWorkerState()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.database_bootstrap_enabled:
            initialize_database()
        db = make_session()
        try:
            seed_default_data(db)
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        worker_stop: threading.Event | None = None
        worker_thread: threading.Thread | None = None
        if settings.push_enabled and settings.PUSH_SCHEDULER_IN_API:
            worker_stop = threading.Event()
            worker_thread = threading.Thread(
                target=run_worker,
                kwargs={
                    "settings": settings,
                    "stop_event": worker_stop,
                    "state": push_worker_state,
                    "session_factory": make_session,
                },
                name="ritmo-push-scheduler",
                daemon=True,
            )
            worker_thread.start()

        try:
            yield
        finally:
            if worker_stop is not None and worker_thread is not None:
                worker_stop.set()
                join_timeout = 30
                await asyncio.to_thread(worker_thread.join, join_timeout)
                if worker_thread.is_alive():
                    logger.error("Push worker did not stop within %s seconds", join_timeout)

    docs_enabled = settings.DEBUG
    application = FastAPI(
        title=settings.APP_NAME,
        description="API FastAPI do Ritmo",
        version="2.0.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    application.state.limiter = limiter
    application.state.push_worker_state = push_worker_state
    application.add_exception_handler(
        RateLimitExceeded,
        rate_limit_exceeded_handler,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Content-Type", "X-Ritmo-Key"],
    )

    @application.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    protected = [Depends(require_api_key)]
    application.include_router(users.router, dependencies=protected)
    application.include_router(habits.router, dependencies=protected)
    application.include_router(tasks.router, dependencies=protected)
    application.include_router(workouts.router, dependencies=protected)
    application.include_router(stats.router, dependencies=protected)
    application.include_router(shopping.router, dependencies=protected)
    application.include_router(reading.router, dependencies=protected)
    application.include_router(anahi.router, dependencies=protected)
    application.include_router(backup.router, dependencies=protected)
    application.include_router(push.router, dependencies=protected)

    @application.get("/")
    def root():
        return {"message": settings.APP_NAME, "version": "2.0.0"}

    @application.get("/api", dependencies=protected)
    def api_root():
        return {"message": settings.APP_NAME, "version": "2.0.0"}

    @application.get("/health")
    def health(db: Session = Depends(get_db)):
        try:
            db.execute(text("SELECT 1"))
        except Exception as exc:
            logger.exception("Database health check failed")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database unavailable",
            ) from exc
        notifications = notification_runtime(settings, push_worker_state)
        return {
            "status": (
                "degraded"
                if notifications["mode"] == "embedded"
                and notifications["status"] != "ready"
                else "healthy"
            ),
            "date": app_today().isoformat(),
            "timezone": settings.TIMEZONE,
            "notifications": notifications,
        }

    @application.get("/ready")
    def ready(response: Response, db: Session = Depends(get_db)):
        notifications = notification_runtime(settings, push_worker_state)
        database_ready = True
        try:
            db.execute(text("SELECT 1"))
        except Exception:
            database_ready = False
            logger.exception("Database readiness check failed")

        notifications_ready = not (
            notifications["mode"] == "embedded"
            and notifications["status"] != "ready"
        )
        ready_status = database_ready and notifications_ready
        if not ready_status:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "healthy" if ready_status else "unhealthy",
            "database": "ready" if database_ready else "unavailable",
            "date": app_today().isoformat(),
            "timezone": settings.TIMEZONE,
            "notifications": notifications,
        }

    if app_settings is not None:
        application.dependency_overrides[get_settings] = lambda: settings

    return application


app = create_app()
