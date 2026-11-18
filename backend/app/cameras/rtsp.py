import asyncio
from urllib.parse import urlsplit
from .base import CameraProvider, StreamInfo


class RTSPProvider(CameraProvider):
    async def connect(self) -> None:
        return None

    async def disconnect(self) -> None:
        return None

    async def test_connection(self) -> bool:
        if not self.camera.host:
            return False
        port = urlsplit(self.camera.rtsp_url).port if self.camera.rtsp_url else self.camera.port
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(self.camera.host, port or 554), timeout=5)
            writer.close()
            await writer.wait_closed()
            return reader is not None
        except (OSError, asyncio.TimeoutError):
            return False

    async def get_status(self) -> str:
        return "online" if await self.test_connection() else "offline"

    async def get_stream_info(self) -> StreamInfo:
        return StreamInfo()
