from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

StorageKind = Literal["remote_api", "local_mount"]
AuthMethod = Literal["none", "bearer", "basic", "api_key"]


class StorageIntegrationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: StorageKind
    endpoint: str = ""
    base_path: str | None = None
    bucket: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    auth_method: AuthMethod = "none"
    secret: str | None = None
    enabled: bool = True


class StorageIntegrationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    kind: StorageKind | None = None
    endpoint: str | None = None
    base_path: str | None = None
    bucket: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    auth_method: AuthMethod | None = None
    secret: str | None = None
    enabled: bool | None = None


class StorageIntegrationRead(BaseModel):
    id: int
    name: str
    kind: str
    endpoint: str
    base_path: str | None
    bucket: str | None
    region: str | None
    auth_method: str
    enabled: bool
    last_status: str
    last_error: str | None
    last_checked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class StorageUsageRead(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    percent_used: float
    source: str


class StorageProbeRead(BaseModel):
    status: str
    message: str
    usage: StorageUsageRead | None = None
    checked_at: datetime


class StorageServerRead(StorageIntegrationRead):
    usage: StorageUsageRead | None = None


class CameraStorageRead(BaseModel):
    id: int
    name: str
    status: str
    protocol: str
    owner: str | None
    used_bytes: int
    available_bytes: int
    percent_used: float


class StorageOverviewRead(BaseModel):
    local: StorageUsageRead
    servers: list[StorageServerRead]
    cameras: list[CameraStorageRead]
    totals: StorageUsageRead
    camera_count: int
