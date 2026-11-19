from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Protocol = Literal["RTSP", "ONVIF", "HTTP", "MJPEG", "Other"]


class CameraBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=200)
    manufacturer: str = Field(default="Generic", max_length=80)
    model: str = Field(default="", max_length=120)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=554, ge=1, le=65535)
    protocol: Protocol = "RTSP"
    rtsp_url: str | None = None
    onvif_url: str | None = None
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=255, exclude=True)
    main_stream: str | None = None
    sub_stream: str | None = None
    enabled: bool = True
    recording_enabled: bool = True
    ai_enabled: bool = True

    @field_validator("rtsp_url", "onvif_url", "main_stream", "sub_stream", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return value or None


class CameraCreate(CameraBase):
    pass


class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=200)
    manufacturer: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=120)
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    protocol: Protocol | None = None
    rtsp_url: str | None = None
    onvif_url: str | None = None
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=255, exclude=True)
    main_stream: str | None = None
    sub_stream: str | None = None
    enabled: bool | None = None
    recording_enabled: bool | None = None
    ai_enabled: bool | None = None


class CameraRead(CameraBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    password: None = None
    created_at: datetime
    updated_at: datetime


class CameraStatus(BaseModel):
    camera_id: int
    status: Literal["online", "offline", "unknown"]
    protocol: str
    resolution: str | None = None
    fps: float | None = None
    message: str | None = None


class DiscoveryResult(BaseModel):
    ip: str
    manufacturer: str | None = None
    model: str | None = None
    onvif_endpoint: str | None = None
    rtsp_url: str | None = None
    port: int = 80
    error: str | None = None


class OnvifInspectionRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=500)
    username: str | None = None
    password: str | None = None


class CameraTestResult(BaseModel):
    camera_id: int | None = None
    status: Literal["reachable", "unreachable"]
    message: str
    resolution: str | None = None
    fps: float | None = None
    preview: str | None = None
    hints: str | None = None
