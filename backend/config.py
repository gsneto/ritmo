import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, quote_plus, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    DEBUG: bool = Field(default=True, validation_alias="RITMO_DEBUG")
    APP_ACCESS_TOKEN: SecretStr | None = Field(
        default=None,
        validation_alias="APP_ACCESS_TOKEN",
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

    @model_validator(mode="after")
    def validate_runtime_settings(self):
        if not self.DEBUG and self.APP_ACCESS_TOKEN is None:
            raise ValueError("APP_ACCESS_TOKEN is required when DEBUG=false")
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

        try:
            ZoneInfo(self.TIMEZONE)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown TIMEZONE: {self.TIMEZONE}") from exc

        # Evaluate the property during startup so invalid origins fail fast.
        self.cors_origins
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
    def access_token(self) -> str | None:
        if self.APP_ACCESS_TOKEN is None:
            return None
        return self.APP_ACCESS_TOKEN.get_secret_value()

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


@lru_cache()
def get_settings() -> Settings:
    return Settings()
