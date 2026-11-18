import asyncio
import logging
import shlex
from dataclasses import dataclass
from urllib.parse import quote, urlsplit, urlunsplit
from ..models.camera import Camera
from ..auth.security import decrypt_secret
from ..config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class IngestSession:
    camera_id: int
    process: asyncio.subprocess.Process | None = None
    viewers: int = 0
    status: str = "stopped"
    udp_port: int | None = None
    restart_count: int = 0
    monitor_task: asyncio.Task[None] | None = None


class MediaManager:
    """Owns one ingest session per camera; consumers attach to that session."""
    def __init__(self) -> None:
        self.sessions: dict[int, IngestSession] = {}
        self._lock = asyncio.Lock()

    def _source_url(self, camera: Camera) -> str:
        source = camera.rtsp_url or f"rtsp://{camera.host}:{camera.port}/"
        if camera.username and camera.encrypted_password and "@" not in urlsplit(source).netloc:
            parts = urlsplit(source)
            password = quote(decrypt_secret(camera.encrypted_password) or "", safe="")
            source = urlunsplit((parts.scheme, f"{quote(camera.username, safe='')}:{password}@{parts.netloc}", parts.path, parts.query, parts.fragment))
        return source

    def _command(self, camera: Camera, port: int) -> list[str]:
        settings = get_settings()
        return [settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000", "-i", self._source_url(camera), "-map", "0:v:0", "-c:v", "copy", "-f", "mpegts", f"udp://{settings.media_udp_host}:{port}?pkt_size=1316"]

    async def _monitor(self, camera: Camera, session: IngestSession) -> None:
        while session.status != "stopped":
            if session.process is None or session.process.returncode is not None:
                session.status = "reconnecting"
                session.restart_count += 1
                session.process = await asyncio.create_subprocess_exec(*self._command(camera, session.udp_port or 0), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            await session.process.wait()
            if session.status != "stopped":
                await asyncio.sleep(min(30, 2 + session.restart_count))

    async def start(self, camera: Camera) -> IngestSession:
        async with self._lock:
            session = self.sessions.setdefault(camera.id, IngestSession(camera.id))
            if session.status == "running":
                return session
            session.status = "starting"
            session.udp_port = get_settings().media_udp_port_start + camera.id
            session.process = await asyncio.create_subprocess_exec(*self._command(camera, session.udp_port), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            session.status = "running"
            session.monitor_task = asyncio.create_task(self._monitor(camera, session))
            logger.info("Started single-ingest session camera_id=%s", camera.id)
            return session

    async def stop(self, camera_id: int) -> None:
        async with self._lock:
            session = self.sessions.get(camera_id)
            if session and session.monitor_task:
                session.status = "stopped"
                session.monitor_task.cancel()
            if session and session.process:
                session.process.terminate()
                await session.process.wait()
            if session:
                session.status = "stopped"

    def status(self, camera_id: int) -> str:
        return self.sessions.get(camera_id, IngestSession(camera_id)).status

    async def snapshot(self, camera: Camera, output: str) -> None:
        session = await self.start(camera)
        if session.udp_port is None:
            raise RuntimeError("Camera ingest has no local fan-out port")
        settings = get_settings()
        process = await asyncio.create_subprocess_exec(settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-i", f"udp://{settings.media_udp_host}:{session.udp_port}?overrun_nonfatal=1&fifo_size=1000000", "-frames:v", "1", "-y", output, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        await process.wait()
        if process.returncode != 0:
            raise RuntimeError("FFmpeg snapshot extraction failed")
