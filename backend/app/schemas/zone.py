from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class ZoneInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    zone_type: Literal["detection", "ignore", "restricted", "line"]
    points: list[list[float]] = Field(min_length=2)
    enabled: bool = True
    object_filters: list[str] = []
    confidence_threshold: float = Field(default=0.5, ge=0, le=1)
    direction: Literal["any", "a_to_b", "b_to_a"] | None = None

    @field_validator("points")
    @classmethod
    def valid_points(cls, value: list[list[float]]) -> list[list[float]]:
        if any(len(point) != 2 or any(coordinate < 0 or coordinate > 1 for coordinate in point) for point in value):
            raise ValueError("points must contain normalized x/y pairs between 0 and 1")
        return value


class ZoneRead(ZoneInput):
    id: int
    camera_id: int
    created_at: datetime
    updated_at: datetime
