from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
import asyncio
from ..models.camera import Camera
from ..config import get_settings
from .storage import LocalStorage


@dataclass(frozen=True)
class RecordingPolicy:
    segment_seconds: int = 600
    retention_days: int = 7
    mode: str = "continuous"


class RecordingManager:
    def __init__(self, storage: LocalStorage | None = None, policy: RecordingPolicy | None = None):
        self.storage = storage or LocalStorage()
        self.policy = policy or RecordingPolicy()

    def next_segment_path(self, camera: Camera) -> Path:
        now = datetime.now(timezone.utc)
        return self.storage.recording_path(camera.id, now, f"{now.strftime('%H%M%S')}.mp4")

    def retention_cutoff(self) -> datetime:
        from datetime import timedelta
        return datetime.now(timezone.utc) - timedelta(days=self.policy.retention_days)

    def cleanup(self) -> int:
        return self.storage.cleanup_before(self.retention_cutoff())

    async def start_segmenter(self, camera: Camera, ingest_port: int) -> asyncio.subprocess.Process:
        output = self.next_segment_path(camera)
        settings = get_settings()
        return await asyncio.create_subprocess_exec(settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-i", f"udp://{settings.media_udp_host}:{ingest_port}?overrun_nonfatal=1&fifo_size=1000000", "-map", "0", "-c", "copy", "-f", "segment", "-segment_time", str(self.policy.segment_seconds), "-reset_timestamps", "1", "-strftime", "1", str(output.with_name("%Y%m%d-%H%M%S.mp4")), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
