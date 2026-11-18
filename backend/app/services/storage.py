from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import shutil
from datetime import datetime, timezone
from ..config import get_settings


@dataclass(frozen=True)
class StorageUsage:
    total_bytes: int
    used_bytes: int
    free_bytes: int


class LocalStorage:
    def __init__(self, root: Path | None = None):
        self.root = root or get_settings().storage_path

    def prepare(self) -> None:
        for directory in ("recordings", "snapshots", "events", "backups", "logs"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)

    def recording_path(self, camera_id: int, timestamp: datetime, filename: str) -> Path:
        path = self.root / "recordings" / str(camera_id) / timestamp.strftime("%Y/%m/%d")
        path.mkdir(parents=True, exist_ok=True)
        return path / filename

    def snapshot_path(self, camera_id: int, timestamp: datetime, filename: str) -> Path:
        path = self.root / "snapshots" / str(camera_id) / timestamp.strftime("%Y/%m/%d")
        path.mkdir(parents=True, exist_ok=True)
        return path / filename

    def usage(self) -> StorageUsage:
        total, used, free = shutil.disk_usage(self.root)
        return StorageUsage(total, used, free)

    def is_low(self, threshold_percent: int) -> bool:
        current = self.usage()
        return current.total_bytes > 0 and current.free_bytes * 100 < current.total_bytes * threshold_percent

    def cleanup_before(self, cutoff: datetime) -> int:
        removed = 0
        recordings = self.root / "recordings"
        if not recordings.exists():
            return removed
        for path in recordings.rglob("*.mp4"):
            if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
        return removed
