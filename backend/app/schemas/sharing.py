from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class ShareCreate(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    permission: Literal["viewer", "operator"] = "viewer"


class ShareRead(BaseModel):
    id: int
    camera_id: int
    username: str
    role: str
    permission: str
    created_at: datetime
