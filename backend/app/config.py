from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "LocalVision API"
    version: str = "0.1.0"
    environment: str = "development"
    database_url: str = "sqlite+aiosqlite:///./localvision.db"
    secret_key: str = ""
    encryption_key: str = ""
    cookie_secure: bool | None = None
    cors_origins: str = "http://localhost:5173"
    storage_path: Path = Path("storage")
    session_hours: int = 24
    ffmpeg_bin: str = "ffmpeg"
    webrtc_gateway_url: str = "http://127.0.0.1:1984"
    media_udp_host: str = "127.0.0.1"
    media_udp_port_start: int = 12000
    recording_segment_seconds: int = 600
    retention_days: int = 7
    low_storage_percent: int = 10
    onvif_discovery_enabled: bool = False
    admin_username: str = ""
    admin_password: str = ""
    allow_guest_mode: bool = False
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_configured(self) -> bool:
        return bool(self.secret_key and self.encryption_key)

    @property
    def secure_cookies(self) -> bool:
        return self.cookie_secure if self.cookie_secure is not None else self.environment != "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
