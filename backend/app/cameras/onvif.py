import asyncio
from urllib.parse import urlsplit
from .base import CameraProvider, StreamInfo


class ONVIFProvider(CameraProvider):
    async def connect(self) -> None:
        return None

    async def disconnect(self) -> None:
        return None

    async def test_connection(self) -> bool:
        if not self.camera.host:
            return False
        endpoint = urlsplit(self.camera.onvif_url) if self.camera.onvif_url else None
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(self.camera.host, endpoint.port if endpoint and endpoint.port else 80), timeout=5)
            writer.close()
            await writer.wait_closed()
            return reader is not None
        except (OSError, asyncio.TimeoutError):
            return False

    async def get_status(self) -> str:
        return "online" if await self.test_connection() else "offline"

    async def get_stream_info(self) -> StreamInfo:
        return StreamInfo()
