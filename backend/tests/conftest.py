from dataclasses import dataclass
from functools import partial

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from config import Settings
from database import Base, create_database_engine, get_db, init_db
from main import create_app

ACCESS_KEY = "test-ritmo-key"


@dataclass
class TestContext:
    client: TestClient
    engine: Engine
    session_factory: sessionmaker


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN=ACCESS_KEY,
        DATABASE_URL=f"sqlite:///{(tmp_path / 'ritmo-test.db').as_posix()}",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
    )


@pytest.fixture()
def context(settings) -> TestContext:
    test_engine = create_database_engine(settings.database_url)
    testing_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine,
    )

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    application = create_app(
        settings,
        database_initializer=partial(
            init_db,
            bind=test_engine,
            session_factory=testing_session,
        ),
        session_factory=testing_session,
    )
    application.dependency_overrides[get_db] = override_get_db

    with TestClient(application) as test_client:
        yield TestContext(test_client, test_engine, testing_session)

    application.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


@pytest.fixture()
def client(context) -> TestClient:
    return context.client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"X-Ritmo-Key": ACCESS_KEY}


@pytest.fixture()
def user_id(client, auth_headers) -> int:
    response = client.get("/api/users", headers=auth_headers)
    assert response.status_code == 200
    return response.json()[0]["id"]
