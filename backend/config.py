from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "ritmo_db"
    DATABASE_URL: str | None = None
    DATABASE_URL_SYNC: str | None = None

    # App
    APP_NAME: str = "Ritmo API"
    DEBUG: bool = True

    @property
    def database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        if self.DATABASE_URL_SYNC:
            return self.DATABASE_URL_SYNC
        if self.DB_HOST == "sqlite" or self.DB_HOST == ":memory:":
            return "sqlite:///./ritmo.db"
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
