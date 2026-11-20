from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator
from ..auth.permissions import normalize_permissions

RoleName = Literal["admin", "operator", "viewer"]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8)
    role: RoleName = "viewer"
    permissions: dict[str, bool] | None = None
    is_active: bool = True

    @field_validator("permissions", mode="before")
    @classmethod
    def normalize(cls, value, info: ValidationInfo):
        if value is None:
            return None
        return normalize_permissions(value, info.data.get("role"))


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str | None = Field(default=None, min_length=8)
    role: RoleName | None = None
    permissions: dict[str, bool] | None = None
    is_active: bool | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    permissions: dict[str, bool]
    is_active: bool

    @field_validator("permissions", mode="before")
    @classmethod
    def normalize(cls, value, info: ValidationInfo):
        return normalize_permissions(value, info.data.get("role"))


class UserRecord(UserRead):
    created_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class LoginResponse(BaseModel):
    user: UserRead
    authenticated: bool = True


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class SessionRecord(BaseModel):
    id: str
    user_id: int
    expires_at: datetime
