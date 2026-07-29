import logging
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from config import Settings, get_settings
from database import SessionLocal, get_db, init_db
from routers import habits, stats, tasks, users, workouts
from security import require_api_key
from seed import seed_default_data
from time_utils import app_today


logger = logging.getLogger(__name__)


def create_app(
    app_settings: Settings | None = None,
    *,
    database_initializer: Callable[[], None] | None = None,
    session_factory: sessionmaker | None = None,
) -> FastAPI:
    settings = app_settings or get_settings()
    initialize_database = database_initializer or init_db
    make_session = session_factory or SessionLocal

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        initialize_database()
        db = make_session()
        try:
            seed_default_data(db)
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        yield

    docs_enabled = settings.DEBUG
    application = FastAPI(
        title=settings.APP_NAME,
        description="API FastAPI do Ritmo",
        version="1.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
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

    @application.get("/")
    def root():
        return {"message": settings.APP_NAME, "version": "1.1.0"}

    @application.get("/api", dependencies=protected)
    def api_root():
        return {"message": settings.APP_NAME, "version": "1.1.0"}

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
        return {
            "status": "healthy",
            "date": app_today().isoformat(),
            "timezone": settings.TIMEZONE,
        }

    if app_settings is not None:
        application.dependency_overrides[get_settings] = lambda: settings

    return application


app = create_app()
