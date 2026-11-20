from dataclasses import dataclass, field
from pathlib import Path
import base64
import shutil
from typing import Any
import httpx
from ..auth.security import decrypt_secret
from ..models.storage import StorageIntegration
from .storage import StorageUsage


@dataclass
class ProbeResult:
    status: str
    message: str
    usage: StorageUsage | None = None
    camera_usage: dict[int, int] = field(default_factory=dict)


def usage_payload(usage: StorageUsage, source: str) -> dict[str, int | float | str]:
    total = max(usage.total_bytes, 0)
    used = max(usage.used_bytes, 0)
    available = max(usage.free_bytes, 0)
    percent = round(used * 100 / total, 2) if total else 0.0
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": available,
        "percent_used": percent,
        "source": source,
    }


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    try:
        for child in path.rglob("*"):
            if child.is_file():
                try:
                    total += child.stat().st_size
                except OSError:
                    continue
    except OSError:
        return total
    return total


def camera_directory_usage(root: Path, camera_id: int) -> int:
    paths = [root / "recordings" / str(camera_id), root / "snapshots" / str(camera_id), root / str(camera_id)]
    return sum(directory_size(path) for path in paths)


def _first(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def parse_usage_payload(data: dict[str, Any]) -> tuple[StorageUsage | None, dict[int, int]]:
    values: dict[str, Any] = {}
    for key in ("data", "result", "storage", "usage"):
        nested = data.get(key)
        if isinstance(nested, dict):
            values.update(nested)
    values.update(data)
    total = _first(values, "total_bytes", "capacity_bytes", "total", "capacity")
    used = _first(values, "used_bytes", "used", "used_space")
    available = _first(values, "free_bytes", "available_bytes", "free", "available")
    if total is None and used is not None and available is not None:
        total = int(used) + int(available)
    if used is None and total is not None and available is not None:
        used = int(total) - int(available)
    if available is None and total is not None and used is not None:
        available = int(total) - int(used)
    usage = None
    if total is not None and used is not None and available is not None:
        try:
            usage = StorageUsage(int(total), int(used), int(available))
        except (TypeError, ValueError):
            usage = None
    cameras: dict[int, int] = {}
    camera_data = _first(values, "cameras", "camera_usage", "per_camera")
    if isinstance(camera_data, dict):
        for camera_key, camera_value in camera_data.items():
            try:
                camera_id = int(camera_key)
            except (TypeError, ValueError):
                continue
            if isinstance(camera_value, dict):
                amount = _first(camera_value, "used_bytes", "used", "bytes")
            else:
                amount = camera_value
            try:
                cameras[camera_id] = int(amount) if amount is not None else 0
            except (TypeError, ValueError):
                continue
    return usage, cameras


async def probe_storage(integration: StorageIntegration) -> ProbeResult:
    if integration.kind == "local_mount":
        raw_path = integration.base_path or integration.endpoint
        path = Path(raw_path).expanduser()
        if not path.exists() or not path.is_dir():
            return ProbeResult("offline", f"Path not found: {path}")
        try:
            total, used, free = shutil.disk_usage(path)
        except OSError as exc:
            return ProbeResult("error", str(exc))
        return ProbeResult("online", f"Mounted at {path}", StorageUsage(total, used, free))
    if integration.kind != "remote_api":
        return ProbeResult("error", f"Unsupported storage type: {integration.kind}")
    headers = {"Accept": "application/json"}
    secret = decrypt_secret(integration.encrypted_secret) if integration.encrypted_secret else None
    if integration.auth_method == "bearer" and secret:
        headers["Authorization"] = f"Bearer {secret}"
    elif integration.auth_method == "api_key" and secret:
        headers["X-API-Key"] = secret
    elif integration.auth_method == "basic" and secret:
        try:
            credentials = base64.b64encode(secret.encode()).decode()
        except Exception:
            credentials = base64.b64encode(secret.encode("utf-8", "ignore")).decode()
        headers["Authorization"] = f"Basic {credentials}"
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(integration.endpoint, headers=headers)
    except httpx.HTTPError as exc:
        return ProbeResult("offline", str(exc))
    if response.status_code >= 400:
        return ProbeResult("error", f"HTTP {response.status_code}: {response.text[:180]}")
    try:
        payload = response.json()
    except ValueError:
        return ProbeResult("error", "Storage API did not return valid JSON")
    if not isinstance(payload, dict):
        return ProbeResult("error", "Storage API response must be a JSON object")
    usage, cameras = parse_usage_payload(payload)
    if not usage:
        return ProbeResult("warning", "Storage API is reachable but did not report capacity", camera_usage=cameras)
    return ProbeResult("online", f"Connected to {integration.name}", usage, cameras)
