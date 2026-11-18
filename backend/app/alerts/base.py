from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class AlertMessage:
    kind: str
    message: str
    metadata: dict[str, object] | None = None


class NotificationProvider(ABC):
    name: str

    @abstractmethod
    async def send(self, message: AlertMessage) -> bool: ...

    @abstractmethod
    async def test(self) -> bool: ...
