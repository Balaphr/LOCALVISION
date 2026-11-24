import base64
import hmac
import mimetypes
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse

ROOT = Path(os.environ.get("STORAGE_ROOT", "/var/lib/localvision/storage")).resolve()
API_KEY = os.environ.get("STORAGE_API_KEY", "")
VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v"}
app = FastAPI(title="LocalVision Storage API", version="1.0.0")
bearer = HTTPBearer(auto_error=True)


def require_key(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    if not API_KEY or not hmac.compare_digest(credentials.credentials, API_KEY):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials.credentials


def encode_id(path: Path) -> str:
    return base64.urlsafe_b64encode(str(path).encode()).decode().rstrip("=")


def safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value or "").strip("._")
    return cleaned or fallback


def safe_date(value: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cleaned = re.sub(r"[^0-9-]+", "", value or "")
    return cleaned or today


def recording_path(camera: str, date: str, filename: str) -> Path:
    target = ROOT / "recordings" / safe_name(camera, "Camera1") / safe_date(date) / Path(filename).name
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def recording_entry(path: Path) -> dict[str, Any]:
    relative = path.relative_to(ROOT)
    parts = relative.parts
    camera = parts[1] if len(parts) > 2 and parts[0] == "recordings" else "Camera1"
    date = parts[2] if len(parts) > 3 and parts[0] == "recordings" else ""
    if not date:
        date = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
    stat = path.stat()
    match = re.fullmatch(r"Camera-(\d+)", camera, re.IGNORECASE)
    return {
        "id": encode_id(relative),
        "camera": camera,
        "camera_id": int(match.group(1)) if match else None,
        "date": date,
        "filename": path.name,
        "name": path.name,
        "path": str(relative),
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "mime_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
    }


def recordings(camera: str = "", date: str = "") -> list[dict[str, Any]]:
    root = ROOT / "recordings"
    if not root.exists():
        return []
    items = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        entry = recording_entry(path)
        if camera and camera not in {entry["camera"], str(entry.get("camera_id") or "")}:
            continue
        if date and date not in entry["date"]:
            continue
        items.append(entry)
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


def overview_payload() -> dict[str, Any]:
    ROOT.mkdir(parents=True, exist_ok=True)
    disk = shutil.disk_usage(ROOT)
    files = recordings()
    cameras: dict[str, dict[str, int]] = {}
    for item in files:
        entry = cameras.setdefault(str(item["camera"]), {"used_bytes": 0, "recording_count": 0})
        entry["used_bytes"] += int(item["size_bytes"])
        entry["recording_count"] += 1
    return {
        "total_bytes": disk.total,
        "used_bytes": disk.used,
        "available_bytes": disk.free,
        "cameras": cameras,
        "recording_count": len(files),
        "root": str(ROOT),
    }


@app.get("/")
def home() -> dict[str, Any]:
    return {"name": "LocalVision Storage API", "version": "1.0.0"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "root": str(ROOT)}


@app.get("/api/storage/overview")
@app.get("/api/storage")
def storage(_: str = Depends(require_key)) -> dict[str, Any]:
    return overview_payload()


@app.get("/api/cameras")
def cameras(_: str = Depends(require_key)) -> list[dict[str, Any]]:
    payload = overview_payload()
    return [{"name": name, **usage} for name, usage in payload["cameras"].items()]


@app.get("/api/recordings")
def list_recordings(camera: str = "Camera1", date: str = "", _: str = Depends(require_key)) -> dict[str, Any]:
    return {"files": recordings(camera, date)}


@app.get("/api/recordings/file/{camera}/{date}/{filename}")
def recording_file(camera: str, date: str, filename: str, _: str = Depends(require_key)) -> FileResponse:
    target = recording_path(camera, date, filename)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(target, media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream")


@app.post("/api/storage/upload", status_code=201)
async def upload(file: UploadFile = File(...), camera: str = Form("Camera1"), date: str = Form(""), _: str = Depends(require_key)) -> dict[str, Any]:
    target = recording_path(camera, date, file.filename or "recording.mp4")
    with target.open("wb") as output:
        while True:
            chunk = await file.read(65536)
            if not chunk:
                break
            output.write(chunk)
    return recording_entry(target)
