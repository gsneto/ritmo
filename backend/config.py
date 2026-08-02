import json
import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, quote_plus, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

ENV_FILE = Path(__file__).with_name(".env")
LOCAL_CORS_ORIGINS = (
    "http://localhost:5173,http://localhost:3000,"
    "http://127.0.0.1:5173,http://127.0.0.1:3000"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
        env_prefix="RITMO_",
    )

    # Database
    DB_HOST: str | None = Field(default=None, validation_alias="DB_HOST")
    DB_PORT: int = Field(default=3306, validation_alias="DB_PORT")
    DB_USER: str = Field(default="root", validation_alias="DB_USER")
    DB_PASSWORD: str = Field(default="", validation_alias="DB_PASSWORD")
    DB_NAME: str = Field(default="ritmo_db", validation_alias="DB_NAME")
    DATABASE_URL: str | None = Field(default=None, validation_alias="DATABASE_URL")
    DATABASE_URL_SYNC: str | None = Field(
        default=None,
        validation_alias="DATABASE_URL_SYNC",
    )

    # App
    APP_NAME: str = "Ritmo API"
    # RITMO_DEBUG avoids collisions with unrelated tools that export DEBUG=release.
    DEBUG: bool = Field(default=False, validation_alias="RITMO_DEBUG")
    APP_ACCESS_TOKEN: SecretStr | None = Field(
        default=None,
        validation_alias="APP_ACCESS_TOKEN",
    )
    ALLOW_INSECURE_NO_ACCESS_TOKEN: bool = Field(
        default=False,
        validation_alias="ALLOW_INSECURE_NO_ACCESS_TOKEN",
    )
    AUTH_MAX_FAILURES: int = Field(
        default=10,
        validation_alias="AUTH_MAX_FAILURES",
        ge=1,
        le=100,
    )
    AUTH_FAILURE_WINDOW_SECONDS: int = Field(
        default=60,
        validation_alias="AUTH_FAILURE_WINDOW_SECONDS",
        ge=1,
        le=3_600,
    )
    AUTH_LOCKOUT_SECONDS: int = Field(
        default=300,
        validation_alias="AUTH_LOCKOUT_SECONDS",
        ge=1,
        le=86_400,
    )
    SENTRY_DSN: str | None = Field(
        default=None,
        validation_alias="SENTRY_DSN",
    )
    SENTRY_ENVIRONMENT: str = Field(
        default="development",
        validation_alias="SENTRY_ENVIRONMENT",
        min_length=1,
        max_length=64,
    )
    VAPID_PUBLIC_KEY: str | None = Field(
        default=None,
        validation_alias="VAPID_PUBLIC_KEY",
    )
    VAPID_PRIVATE_KEY: SecretStr | None = Field(
        default=None,
        validation_alias="VAPID_PRIVATE_KEY",
    )
    VAPID_SUBJECT: str = Field(
        default="mailto:admin@ritmo.local",
        validation_alias="VAPID_SUBJECT",
    )
    PUSH_SCHEDULER_IN_API: bool = Field(
        default=True,
        validation_alias="PUSH_SCHEDULER_IN_API",
    )
    PUSH_WORKER_POLL_SECONDS: int = Field(
        default=60,
        validation_alias="PUSH_WORKER_POLL_SECONDS",
        ge=5,
        le=3_600,
    )
    PUSH_WORKER_BATCH_SIZE: int = Field(
        default=100,
        validation_alias="PUSH_WORKER_BATCH_SIZE",
        ge=1,
        le=1_000,
    )
    PUSH_REMINDER_RECOVERY_HOURS: int = Field(
        default=24,
        validation_alias="PUSH_REMINDER_RECOVERY_HOURS",
        ge=1,
        le=168,
    )
    PUSH_DELIVERY_TTL_HOURS: int = Field(
        default=72,
        validation_alias="PUSH_DELIVERY_TTL_HOURS",
        ge=1,
        le=720,
    )
    PUSH_DELIVERY_MAX_ATTEMPTS: int = Field(
        default=80,
        validation_alias="PUSH_DELIVERY_MAX_ATTEMPTS",
        ge=1,
        le=500,
    )
    PUSH_RETRY_BASE_SECONDS: int = Field(
        default=60,
        validation_alias="PUSH_RETRY_BASE_SECONDS",
        ge=5,
        le=86_400,
    )
    PUSH_RETRY_MAX_SECONDS: int = Field(
        default=3_600,
        validation_alias="PUSH_RETRY_MAX_SECONDS",
        ge=5,
        le=86_400,
    )
    PUSH_DELIVERY_RETENTION_DAYS: int = Field(
        default=90,
        validation_alias="PUSH_DELIVERY_RETENTION_DAYS",
        ge=1,
        le=365,
    )
    # ANAHÍ is served only by the backend. Keep this secret out of the
    # frontend build and source control.
    GEMINI_API_KEY: SecretStr | None = Field(
        default=None,
        validation_alias="GEMINI_API_KEY",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-3.5-flash-lite",
        validation_alias="GEMINI_MODEL",
    )
    GEMINI_TIMEOUT_SECONDS: float = Field(
        default=15,
        validation_alias="GEMINI_TIMEOUT_SECONDS",
        ge=1,
        le=60,
    )
    ANAHI_RATE_LIMIT: str = Field(
        default="20/minute",
        validation_alias="ANAHI_RATE_LIMIT",
        pattern=r"^[1-9][0-9]*/(second|minute|hour|day)s?$",
    )
    CORS_ORIGINS: str = Field(
        default=LOCAL_CORS_ORIGINS,
        validation_alias="CORS_ORIGINS",
    )
    TIMEZONE: str = Field(
        default="America/Sao_Paulo",
        validation_alias="TIMEZONE",
    )

    @field_validator("APP_ACCESS_TOKEN", mode="before")
    @classmethod
    def normalize_access_token(cls, value):
        if value is None:
            return None
        if isinstance(value, SecretStr):
            value = value.get_secret_value()
        if not isinstance(value, str):
            raise ValueError("APP_ACCESS_TOKEN must be a string")
        value = value.strip()
        return value or None

    @field_validator("GEMINI_API_KEY", mode="before")
    @classmethod
    def normalize_gemini_api_key(cls, value):
        if value is None:
            return None
        if isinstance(value, SecretStr):
            value = value.get_secret_value()
        if not isinstance(value, str):
            raise ValueError("GEMINI_API_KEY must be a string")
        value = value.strip()
        return value or None

    @field_validator("SENTRY_DSN", mode="before")
    @classmethod
    def normalize_sentry_dsn(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("SENTRY_DSN must be a string")
        value = value.strip()
        return value or None

    @field_validator("GEMINI_MODEL")
    @classmethod
    def validate_gemini_model(cls, value: str) -> str:
        model = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", model):
            raise ValueError("GEMINI_MODEL contains invalid characters")
        return model

    @model_validator(mode="after")
    def validate_runtime_settings(self):
        if self.APP_ACCESS_TOKEN is None:
            if not self.ALLOW_INSECURE_NO_ACCESS_TOKEN:
                raise ValueError(
                    "APP_ACCESS_TOKEN is required unless "
                    "ALLOW_INSECURE_NO_ACCESS_TOKEN=true"
                )
            if not self.database_bootstrap_enabled:
                raise ValueError(
                    "ALLOW_INSECURE_NO_ACCESS_TOKEN is only allowed with "
                    "DEBUG=true and SQLite"
                )
        has_public_vapid = bool(self.VAPID_PUBLIC_KEY and self.VAPID_PUBLIC_KEY.strip())
        has_private_vapid = self.VAPID_PRIVATE_KEY is not None and bool(
            self.VAPID_PRIVATE_KEY.get_secret_value().strip()
        )
        if has_public_vapid != has_private_vapid:
            raise ValueError(
                "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together"
            )
        if has_public_vapid and not self.VAPID_SUBJECT.startswith(("mailto:", "https://")):
            raise ValueError("VAPID_SUBJECT must start with mailto: or https://")
        if self.PUSH_RETRY_BASE_SECONDS > self.PUSH_RETRY_MAX_SECONDS:
            raise ValueError(
                "PUSH_RETRY_BASE_SECONDS cannot exceed PUSH_RETRY_MAX_SECONDS"
            )
        if self.PUSH_DELIVERY_TTL_HOURS < self.PUSH_REMINDER_RECOVERY_HOURS:
            raise ValueError(
                "PUSH_DELIVERY_TTL_HOURS cannot be shorter than "
                "PUSH_REMINDER_RECOVERY_HOURS"
            )

        try:
            ZoneInfo(self.TIMEZONE)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown TIMEZONE: {self.TIMEZONE}") from exc

        # Evaluate the property during startup so invalid origins fail fast.
        _ = self.cors_origins
        return self

    @property
    def database_url(self) -> str:
        configured_url = self.DATABASE_URL or self.DATABASE_URL_SYNC
        if configured_url:
            # Select installed database drivers explicitly. Railway exposes
            # PostgreSQL as postgresql:// and older providers may use postgres://.
            if configured_url.startswith("mysql://"):
                return configured_url.replace("mysql://", "mysql+pymysql://", 1)
            if configured_url.startswith("postgres://"):
                return configured_url.replace(
                    "postgres://",
                    "postgresql+psycopg://",
                    1,
                )
            if configured_url.startswith("postgresql://"):
                return configured_url.replace(
                    "postgresql://",
                    "postgresql+psycopg://",
                    1,
                )
            return configured_url
        if self.DB_HOST and self.DB_HOST not in {"sqlite", ":memory:"}:
            username = quote_plus(self.DB_USER)
            password = quote_plus(self.DB_PASSWORD)
            database_name = quote(self.DB_NAME, safe="")
            return (
                f"mysql+pymysql://{username}:{password}"
                f"@{self.DB_HOST}:{self.DB_PORT}/{database_name}"
            )
        return "sqlite:///./ritmo.db"

    @property
    def database_bootstrap_enabled(self) -> bool:
        return self.DEBUG and make_url(self.database_url).get_backend_name() == "sqlite"

    @property
    def access_token(self) -> str | None:
        if self.APP_ACCESS_TOKEN is None:
            return None
        return self.APP_ACCESS_TOKEN.get_secret_value()

    @property
    def gemini_api_key(self) -> str | None:
        if self.GEMINI_API_KEY is None:
            return None
        return self.GEMINI_API_KEY.get_secret_value().strip() or None

    @property
    def push_enabled(self) -> bool:
        return bool(
            self.VAPID_PUBLIC_KEY
            and self.VAPID_PRIVATE_KEY
            and self.VAPID_PUBLIC_KEY.strip()
            and self.VAPID_PRIVATE_KEY.get_secret_value().strip()
        )

    @property
    def vapid_private_key(self) -> str | None:
        if self.VAPID_PRIVATE_KEY is None:
            return None
        return self.VAPID_PRIVATE_KEY.get_secret_value().strip() or None

    @property
    def cors_origins(self) -> list[str]:
        raw = self.CORS_ORIGINS.strip()
        if not raw:
            raise ValueError("CORS_ORIGINS must contain at least one origin")

        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError("CORS_ORIGINS contains invalid JSON") from exc
            if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
                raise ValueError("CORS_ORIGINS JSON must be a list of strings")
            origins = parsed
        else:
            origins = raw.split(",")

        normalized: list[str] = []
        for item in origins:
            origin = item.strip().rstrip("/")
            parsed_origin = urlsplit(origin)
            if (
                origin == "*"
                or parsed_origin.scheme not in {"http", "https"}
                or not parsed_origin.netloc
                or parsed_origin.path
                or parsed_origin.query
                or parsed_origin.fragment
            ):
                raise ValueError(f"Invalid CORS origin: {item!r}")
            if origin not in normalized:
                normalized.append(origin)

        if not normalized:
            raise ValueError("CORS_ORIGINS must contain at least one origin")
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()
