from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: tuple[float, float, float, float]


class AIProvider(ABC):
    name: str

    @abstractmethod
    async def detect(self, frame: Any, confidence: float = 0.5) -> list[Detection]: ...

    @abstractmethod
    async def health(self) -> bool: ...
