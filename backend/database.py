from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from config import get_settings

settings = get_settings()
database_url = settings.database_url


def create_database_engine(url: str, *, echo: bool = False) -> Engine:
    is_sqlite = make_url(url).get_backend_name() == "sqlite"
    database_engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        pool_pre_ping=True,
        pool_recycle=3600,
        echo=echo,
    )

    if is_sqlite:
        @event.listens_for(database_engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return database_engine


engine = create_database_engine(database_url, echo=settings.DEBUG)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Iterator[Session]:
    """Dependency for FastAPI routes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_checkin_uniqueness(
    bind: Engine,
    session_factory: sessionmaker,
) -> None:
    """Deduplicate legacy rows and enforce one check-in per habit and date."""
    from models.habit import HabitCheckIn

    db = session_factory()
    try:
        seen: set[tuple[int, object]] = set()
        checkins = db.query(HabitCheckIn).order_by(HabitCheckIn.id).all()
        for checkin in checkins:
            key = (checkin.habit_id, checkin.date)
            if key in seen:
                db.delete(checkin)
            else:
                seen.add(key)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    inspector = inspect(bind)
    target_columns = {"habit_id", "date"}
    constraints = inspector.get_unique_constraints("habit_check_ins")
    indexes = inspector.get_indexes("habit_check_ins")
    uniqueness_exists = any(
        set(item.get("column_names") or []) == target_columns
        for item in [*constraints, *indexes]
        if item.get("unique", True)
    )
    if not uniqueness_exists:
        with bind.begin() as connection:
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX uq_habit_check_ins_habit_date "
                    "ON habit_check_ins (habit_id, date)"
                )
            )


def init_db(
    *,
    bind: Engine | None = None,
    session_factory: sessionmaker | None = None,
) -> None:
    """Initialize database tables."""
    from models import habit, reading, shopping, task, user, workout  # noqa

    selected_engine = bind or engine
    selected_session_factory = session_factory or SessionLocal
    Base.metadata.create_all(bind=selected_engine)
    _ensure_checkin_uniqueness(selected_engine, selected_session_factory)
