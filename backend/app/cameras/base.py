from abc import ABC, abstractmethod
from dataclasses import dataclass
from ..models.camera import Camera


@dataclass
class StreamInfo:
    resolution: str | None = None
    fps: float | None = None
    codec: str | None = None


class CameraProvider(ABC):
    def __init__(self, camera: Camera):
        self.camera = camera

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def test_connection(self) -> bool: ...

    @abstractmethod
    async def get_status(self) -> str: ...

    @abstractmethod
    async def get_stream_info(self) -> StreamInfo: ...
