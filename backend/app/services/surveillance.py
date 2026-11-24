import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
from sqlalchemy import select

from ..ai.activity import describe_activity, in_entrance_zone
from ..ai.detector import detector
from ..ai.tracking import Tracker, Track
from ..alerts.base import AlertMessage
from ..alerts.webhook import WebhookProvider
from ..auth.security import decrypt_secret
from ..config import get_settings
from ..database import SessionLocal
from ..models.camera import Camera
from ..models.operations import Alert, Event, Integration, Recording
from ..models.zones import DetectionZone
from ..api.realtime import hub
from .storage import LocalStorage
from .streams import frame_hub, media_executor

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CameraConfig:
    id: int
    name: str
    location: str
    protocol: str
    host: str
    port: int
    rtsp_url: str | None
    onvif_url: str | None
    username: str | None
    encrypted_password: str | None
    main_stream: str | None
    sub_stream: str | None
    recording_enabled: bool
    ai_enabled: bool

    @classmethod
    def from_model(cls, camera: Camera) -> "CameraConfig":
        return cls(
            id=camera.id,
            name=camera.name,
            location=camera.location,
            protocol=camera.protocol,
            host=camera.host,
            port=camera.port,
            rtsp_url=camera.rtsp_url,
            onvif_url=camera.onvif_url,
            username=camera.username,
            encrypted_password=camera.encrypted_password,
            main_stream=camera.main_stream,
            sub_stream=camera.sub_stream,
            recording_enabled=camera.recording_enabled,
            ai_enabled=camera.ai_enabled,
        )


class SurveillanceWorker:
    def __init__(self) -> None:
        self.running = False
        self.supervisor: asyncio.Task[None] | None = None
        self.monitors: dict[int, asyncio.Task[None]] = {}
        self.status: dict[int, dict[str, object]] = {}
        self.zone_cache: dict[int, tuple[float, list[DetectionZone]]] = {}
        self.event_tasks: set[asyncio.Task[None]] = set()
        self.event_semaphore = asyncio.Semaphore(4)

    async def start(self) -> None:
        if self.running:
            return
        self.running = True
        self.supervisor = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self.running = False
        if self.supervisor is not None:
            self.supervisor.cancel()
        for task in list(self.monitors.values()):
            task.cancel()
        for task in list(self.event_tasks):
            task.cancel()
        await frame_hub.stop_all()

    async def _supervise(self) -> None:
        while self.running:
            try:
                async with SessionLocal() as db:
                    rows = (await db.execute(select(Camera).where(Camera.enabled.is_(True)))).scalars()
                    cameras = [CameraConfig.from_model(row) for row in rows]
                wanted = {camera.id for camera in cameras if camera.ai_enabled or camera.recording_enabled}
                for camera_id in list(self.monitors):
                    if camera_id not in wanted:
                        self.monitors.pop(camera_id).cancel()
                        await frame_hub.stop(camera_id)
                for camera in cameras:
                    if camera.id in wanted and camera.id not in self.monitors:
                        self.monitors[camera.id] = asyncio.create_task(self._monitor(camera))
                await hub.broadcast({"type": "surveillance_status", "cameras": len(wanted), "running": True})
            except Exception as error:
                logger.warning("Surveillance supervisor error: %s", error)
            await asyncio.sleep(3)

    async def _monitor(self, camera: CameraConfig) -> None:
        settings = get_settings()
        tracker = Tracker()
        reader = await frame_hub.acquire(camera)
        sample_interval = 1.0 / max(settings.detection_fps, 0.1)
        buffer: deque[tuple[float, Any]] = deque(maxlen=max(20, int(settings.detection_fps * settings.clip_buffer_seconds) + 5))
        last_inference = 0.0
        last_buffered = 0.0
        last_event: dict[int, float] = {}
        version = 0
        try:
            while self.running:
                frame, version = await reader.wait_frame(version, timeout=1)
                if frame is None:
                    self.status[camera.id] = {"status": reader.status, "message": reader.error}
                    continue
                self.status[camera.id] = {"status": "online", "message": None}
                now = time.monotonic()
                if camera.recording_enabled and now - last_buffered >= sample_interval:
                    buffer.append((now, frame))
                    last_buffered = now
                if not camera.ai_enabled or now - last_inference < sample_interval:
                    await asyncio.sleep(0.02)
                    continue
                last_inference = now
                detections = await detector.detect(frame, settings.detection_confidence)
                persons = [detection for detection in detections if detection.label == "person"]
                bags = [detection.label for detection in detections if detection.label in {"backpack", "handbag", "suitcase", "bag", "package", "parcel"}]
                tracks = tracker.update(persons)
                zones = await self._zones(camera.id)
                relevant = [track for track in tracks if in_entrance_zone(track, zones, frame.shape[1], frame.shape[0])]
                if not relevant:
                    continue
                pending = [track for track in relevant if now - last_event.get(track.id, 0) >= settings.event_cooldown_seconds]
                if not pending:
                    continue
                description = await describe_activity(pending, bags, reader.jpeg())
                frames = list(buffer)
                clip_fps = 1.0 / sample_interval
                for track in pending:
                    last_event[track.id] = now
                    self._spawn_event(self._run_event(camera, track, description, frame, frames, clip_fps))
        except asyncio.CancelledError:
            pass
        except Exception as error:
            logger.warning("Camera %s monitor stopped: %s", camera.id, error)
            self.status[camera.id] = {"status": "error", "message": str(error)}

    def _spawn_event(self, coroutine: Any) -> None:
        task = asyncio.create_task(coroutine)
        self.event_tasks.add(task)
        task.add_done_callback(self.event_tasks.discard)

    async def _run_event(self, camera: CameraConfig, track: Track, description: str, frame: Any, frames: list[tuple[float, Any]], fps: float) -> None:
        async with self.event_semaphore:
            try:
                await self._record_event(camera, track, description, frame, frames, fps)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Camera %s event write failed: %s", camera.id, error)

    async def _zones(self, camera_id: int) -> list[DetectionZone]:
        cached = self.zone_cache.get(camera_id)
        now = time.monotonic()
        if cached is not None and now - cached[0] < 5.0:
            return cached[1]
        async with SessionLocal() as db:
            zones = list((await db.execute(select(DetectionZone).where(DetectionZone.camera_id == camera_id))).scalars())
        self.zone_cache[camera_id] = (now, zones)
        return zones

    async def _record_event(self, camera: CameraConfig, track: Track, description: str, frame: Any, frames: list[tuple[float, Any]], fps: float) -> None:
        storage = LocalStorage()
        timestamp = datetime.now(timezone.utc)
        snapshot = storage.snapshot_path(camera.id, timestamp, f"{timestamp.strftime('%H%M%S')}_{track.id}.jpg")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(media_executor, cv2.imwrite, str(snapshot), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        clip_path: Path | None = None
        recording_id: int | None = None
        if camera.recording_enabled and frames:
            clip_path = storage.recording_path(camera.id, timestamp, f"event_{timestamp.strftime('%H%M%S')}_{track.id}.mp4")
            await loop.run_in_executor(media_executor, self._write_clip, frames, clip_path, fps)
            if clip_path.exists() and clip_path.stat().st_size > 0:
                async with SessionLocal() as db:
                    recording = Recording(camera_id=camera.id, path=storage.relative(clip_path), started_at=timestamp, duration_seconds=len(frames) / max(fps, 1), size_bytes=clip_path.stat().st_size, kind="event", status="complete", ended_at=timestamp)
                    db.add(recording)
                    await db.commit()
                    await db.refresh(recording)
                    recording_id = recording.id
        async with SessionLocal() as db:
            event = Event(
                camera_id=camera.id,
                kind="entrance_approach",
                object_name="person",
                confidence=track.confidence,
                occurred_at=timestamp,
                snapshot_path=storage.relative(snapshot),
                recording_id=recording_id,
                bounding_box=track.to_json(),
                duration_seconds=track.duration,
                description=description,
                track_id=str(track.id),
                clip_path=storage.relative(clip_path) if clip_path else None,
            )
            alert = Alert(camera_id=camera.id, kind="entrance_approach", message=f"{camera.name}: {description}", status="open")
            db.add(event)
            db.add(alert)
            await db.commit()
            await db.refresh(event)
            await db.refresh(alert)
            event_id = event.id
            alert_id = alert.id
        message = {
            "type": "detection",
            "event_id": event_id,
            "camera_id": camera.id,
            "camera_name": camera.name,
            "description": description,
            "confidence": track.confidence,
            "bounding_box": track.to_json(),
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
            "occurred_at": timestamp.isoformat(),
            "snapshot_url": f"/api/media/file/{storage.relative(snapshot)}",
        }
        await hub.broadcast(message)
        await self._deliver_webhooks(message)
        logger.info("Recorded person event camera=%s track=%s description=%s", camera.id, track.id, description)

    @staticmethod
    def _write_clip(frames: list[tuple[float, Any]], output: Path, fps: float) -> None:
        if not frames:
            return
        height, width = frames[0][1].shape[:2]
        writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), max(fps, 1.0), (width, height))
        if not writer.isOpened():
            return
        try:
            for _, frame in frames:
                if frame.shape[:2] == (height, width):
                    writer.write(frame)
        finally:
            writer.release()

    async def _deliver_webhooks(self, message: dict[str, object]) -> None:
        async with SessionLocal() as db:
            integrations = list((await db.execute(select(Integration).where(Integration.enabled.is_(True)))).scalars())
            targets = [(item.endpoint, item.auth_method, decrypt_secret(item.encrypted_secret) if item.encrypted_secret else None) for item in integrations]
        for endpoint, auth_method, secret in targets:
            headers: dict[str, str] = {}
            if secret:
                if auth_method == "bearer":
                    headers["Authorization"] = f"Bearer {secret}"
                elif auth_method == "api_key":
                    headers["X-API-Key"] = secret
            try:
                await WebhookProvider(endpoint, headers).send(AlertMessage(str(message["type"]), str(message["description"]), message))
            except Exception as error:
                logger.warning("Webhook delivery failed: %s", error)


surveillance_worker = SurveillanceWorker()
