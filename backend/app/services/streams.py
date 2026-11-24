import asyncio
import base64
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, AsyncIterator
from urllib.parse import quote, urlsplit, urlunsplit

import cv2

from ..auth.security import decrypt_secret
from ..config import get_settings
from ..models.camera import Camera

logger = logging.getLogger(__name__)

capture_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="stream-capture")
media_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="media-write")


@dataclass(frozen=True)
class StreamProbe:
    status: str
    message: str
    resolution: str | None = None
    fps: float | None = None
    preview: str | None = None


def build_stream_url(camera: Any) -> str:
    source = camera.main_stream or camera.rtsp_url
    if not source:
        if camera.protocol == "ONVIF" and camera.onvif_url:
            source = camera.onvif_url
        elif camera.protocol in {"HTTP", "MJPEG"}:
            source = f"http://{camera.host}:{camera.port}/"
        else:
            source = f"rtsp://{camera.host}:{camera.port}/"
    if camera.username:
        password = ""
        if getattr(camera, "encrypted_password", None):
            try:
                password = decrypt_secret(camera.encrypted_password) or ""
            except Exception:
                password = ""
        if "password" in getattr(camera, "__fields__", {}):
            password = getattr(camera, "password", None) or password
        parts = urlsplit(source)
        if "@" not in parts.netloc and parts.scheme in {"rtsp", "http", "https"}:
            netloc = f"{quote(camera.username, safe='')}:{quote(password, safe='')}@{parts.netloc}"
            source = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return source


def _error_hint(source: str, detail: str) -> str:
    if not source:
        return "Add an RTSP URL, HTTP stream URL, or ONVIF endpoint."
    if detail:
        return detail
    if source.startswith("rtsp"):
        return "Check that RTSP is enabled and that the IP, port, username, and password are correct. The camera did not send a frame in time."
    if source.startswith("http"):
        return "Check that the HTTP/MJPEG URL is reachable and does not require a browser session. The camera did not send a frame in time."
    return "The camera did not send a usable video frame. Check the stream URL and network reachability."


def probe_stream_sync(camera: Any, timeout: float = 6.0) -> StreamProbe:
    source = build_stream_url(camera)
    capture = None
    try:
        capture = cv2.VideoCapture(source)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        deadline = time.monotonic() + timeout
        frame = None
        while time.monotonic() < deadline:
            ok, current = capture.read()
            if ok and current is not None and current.size:
                frame = current
                break
            time.sleep(0.1)
        if frame is None:
            return StreamProbe(status="unreachable", message=_error_hint(source, ""))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or frame.shape[1])
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or frame.shape[0])
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
        preview = f"data:image/jpeg;base64,{base64.b64encode(encoded.tobytes()).decode()}" if ok else None
        return StreamProbe(status="reachable", message="Camera connected and a live frame was received.", resolution=f"{width}x{height}", fps=fps or None, preview=preview)
    except Exception as error:
        return StreamProbe(status="unreachable", message=_error_hint(source, str(error)))
    finally:
        if capture is not None:
            capture.release()


async def probe_camera(camera: Any, timeout: float = 6.0) -> StreamProbe:
    return await asyncio.wait_for(asyncio.to_thread(probe_stream_sync, camera, timeout), timeout + 2)


async def capture_jpeg(camera: Any) -> bytes | None:
    probe = await probe_camera(camera, timeout=4)
    if probe.preview is None:
        return None
    return base64.b64decode(probe.preview.split(",", 1)[1])


class StreamReader:
    def __init__(self, camera: Camera) -> None:
        self.camera = camera
        self.frame: Any = None
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.task: asyncio.Task[None] | None = None
        self.status = "stopped"
        self.error = ""
        self.restart_count = 0
        self.last_frame_at = 0.0
        self.version = 0
        self.fps = float(get_settings().detection_fps or 5.0)

    async def start(self) -> None:
        if self.task is None or self.task.done():
            self.status = "starting"
            self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self.stop_event.set()
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        self.task = None
        self.status = "stopped"

    async def _loop(self) -> None:
        loop = asyncio.get_running_loop()
        while not self.stop_event.is_set():
            try:
                await loop.run_in_executor(capture_executor, self._read_until_failure)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.error = str(error)
            if self.stop_event.is_set():
                break
            self.status = "reconnecting"
            self.restart_count += 1
            await asyncio.sleep(min(10, 1 + self.restart_count))

    def _read_until_failure(self) -> None:
        source = build_stream_url(self.camera)
        capture = cv2.VideoCapture(source)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not capture.isOpened():
            capture.release()
            self.error = "Camera stream could not be opened"
            return
        self.status = "online"
        self.error = ""
        reported = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        target_fps = reported if 1.0 <= reported <= 60.0 else 15.0
        self.fps = target_fps
        delay = 1.0 / target_fps
        try:
            while not self.stop_event.is_set():
                started = time.monotonic()
                ok, frame = capture.read()
                if not ok or frame is None:
                    break
                with self.lock:
                    self.frame = frame
                    self.last_frame_at = time.monotonic()
                    self.version += 1
                remaining = delay - (time.monotonic() - started)
                if remaining > 0:
                    time.sleep(remaining)
        finally:
            capture.release()

    def latest(self) -> Any | None:
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    async def wait_frame(self, after_version: int = 0, timeout: float = 2.0) -> tuple[Any | None, int]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.lock:
                if self.version > after_version and self.frame is not None:
                    return self.frame.copy(), self.version
            await asyncio.sleep(0.02)
        return None, after_version

    def jpeg(self) -> bytes | None:
        frame = self.latest()
        if frame is None:
            return None
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        return encoded.tobytes() if ok else None


class FrameHub:
    def __init__(self) -> None:
        self.readers: dict[int, StreamReader] = {}
        self.lock = asyncio.Lock()

    async def acquire(self, camera: Camera) -> StreamReader:
        async with self.lock:
            reader = self.readers.get(camera.id)
            if reader is None:
                reader = StreamReader(camera)
                self.readers[camera.id] = reader
            reader.camera = camera
            await reader.start()
            return reader

    async def get(self, camera: Camera) -> StreamReader:
        return await self.acquire(camera)

    def status(self, camera_id: int) -> dict[str, object]:
        reader = self.readers.get(camera_id)
        if reader is None:
            return {"status": "unknown", "message": None, "restart_count": 0}
        age = time.monotonic() - reader.last_frame_at if reader.last_frame_at else None
        status = reader.status
        if status == "online" and age is not None and age > 8:
            status = "reconnecting"
        return {"status": status, "message": reader.error or None, "restart_count": reader.restart_count}

    async def stop(self, camera_id: int) -> None:
        async with self.lock:
            reader = self.readers.pop(camera_id, None)
        if reader:
            await reader.stop()

    async def stop_all(self) -> None:
        for camera_id in list(self.readers):
            await self.stop(camera_id)

    async def mjpeg(self, camera: Camera) -> AsyncIterator[bytes]:
        reader = await self.acquire(camera)
        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
        while True:
            image = reader.jpeg()
            if image is not None:
                yield boundary + image + b"\r\n"
            await asyncio.sleep(0.05)


frame_hub = FrameHub()
