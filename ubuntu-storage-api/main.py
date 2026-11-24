import json
import math
import mimetypes
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

load_dotenv("/opt/localvision-storage/.env")

ROOT = Path(os.environ["STORAGE_ROOT"]).resolve()
STORAGE = ROOT / "Storage"
LEGACY_RECORDINGS = ROOT / "recordings"
RECORDINGS = STORAGE
SNAPSHOTS = ROOT / "snapshots"
API_KEY = os.environ["STORAGE_API_KEY"]
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 24 * 60 * 60

app = FastAPI(title="LocalVision Storage API", version="1.2.0")
bearer = HTTPBearer()
PERSON_CASCADES = [
    "haarcascade_fullbody.xml",
    "haarcascade_upperbody.xml",
    "haarcascade_frontalface_default.xml"
]
VEHICLE_CASCADES = ["haarcascade_car.xml"]
CASCADES = {}
MOTION_STATE = {}


def safe_camera(value: str, default: str = "Camera1") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value or "").strip("._")
    return cleaned or default


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(value or "").name).strip("._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not cleaned.lower().endswith(".mp4"):
        cleaned += ".mp4"
    return cleaned


def valid_date(value: str, default: bool = False) -> str:
    date = value or (datetime.now(timezone.utc).strftime("%Y-%m-%d") if default else "")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    return date


def parse_upload(body: bytes, content_type: str):
    match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type, re.IGNORECASE)
    boundary = (match.group(1) or match.group(2)).strip() if match else ""
    if not boundary:
        raise HTTPException(status_code=400, detail="Missing multipart boundary")

    delimiter = b"--" + boundary.encode()
    fields = {}
    filename = None
    content = None
    for part in body.split(delimiter)[1:]:
        if part.startswith(b"--"):
            break
        part = part.lstrip(b"\r\n")
        if part.endswith(b"\r\n"):
            part = part[:-2]
        raw_headers, separator, payload = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        headers = raw_headers.decode("utf-8", "replace").lower()
        name_match = re.search(r'name="([^"]*)"', headers)
        if not name_match:
            continue
        name = name_match.group(1)
        file_match = re.search(r'filename="([^"]*)"', headers)
        if file_match:
            filename = file_match.group(1)
            content = payload
        else:
            fields[name] = payload.decode("utf-8", "replace")

    if content is None:
        raise HTTPException(status_code=400, detail="Missing file upload")
    return fields, filename, content


def valid_duration(value: str) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid duration_seconds")
    if not math.isfinite(seconds) or seconds < 0 or seconds > MAX_DURATION_SECONDS:
        raise HTTPException(status_code=400, detail="Invalid duration_seconds")
    return seconds


def recording_id(camera: str, date: str, filename: str) -> str:
    return f"{camera}|{date}|{filename}"


def recording_roots() -> list:
    return [STORAGE, LEGACY_RECORDINGS]


def parse_recording_id(value: str):
    parts = value.split("|")
    if len(parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid recording id")
    return safe_camera(parts[0]), valid_date(parts[1]), safe_filename(parts[2])


def find_recording(camera: str, date: str, filename: str) -> Path:
    for root in recording_roots():
        candidate = (root / camera / date / filename).resolve()
        if not candidate.is_relative_to(root.resolve()):
            raise HTTPException(status_code=400, detail="Invalid path")
        if candidate.is_file():
            return candidate
    raise HTTPException(status_code=404, detail="Recording not found")


def camera_id_from_name(camera: str):
    match = re.fullmatch(r"Camera-(\d+)", camera, re.IGNORECASE)
    return int(match.group(1)) if match else None


def review_sidecar(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".review.json")


def read_review(path: Path) -> dict:
    sidecar = review_sidecar(path)
    if not sidecar.is_file():
        return {"review_status": "unreviewed", "reviewed_by": None, "reviewed_at": None, "review_notes": None}
    try:
        data = json.loads(sidecar.read_text("utf-8"))
    except (OSError, ValueError):
        return {"review_status": "unreviewed", "reviewed_by": None, "reviewed_at": None, "review_notes": None}
    return {
        "review_status": str(data.get("review_status", "unreviewed")),
        "reviewed_by": data.get("reviewed_by"),
        "reviewed_at": data.get("reviewed_at"),
        "review_notes": data.get("notes"),
    }


def write_review(path: Path, data: dict) -> dict:
    payload = {
        "review_status": str(data.get("status", "reviewed")),
        "reviewed_by": data.get("reviewed_by"),
        "reviewed_at": data.get("reviewed_at") or datetime.now(timezone.utc).isoformat(),
        "notes": data.get("notes"),
    }
    sidecar = review_sidecar(path)
    temp = sidecar.with_suffix(".tmp")
    temp.write_text(json.dumps(payload), "utf-8")
    os.replace(temp, sidecar)
    return payload


def load_cascade(name: str):
    if name not in CASCADES:
        candidate = Path(cv2.data.haarcascades) / name
        CASCADES[name] = cv2.CascadeClassifier(str(candidate)) if candidate.exists() else None
    return CASCADES[name]


def json_field(value: str, fallback):
    if not value:
        return fallback
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, type(fallback)) else fallback
    except (TypeError, ValueError):
        return fallback


def inside_zone(x: int, y: int, width: int, height: int, zones: list) -> bool:
    if not zones:
        return True
    for zone in zones:
        points = zone.get("points") if isinstance(zone, dict) else None
        if not isinstance(points, list) or len(points) < 3:
            continue
        contour = []
        for point in points:
            px = float(point[0])
            py = float(point[1])
            if px <= 1 and py <= 1:
                px *= width
                py *= height
            contour.append([px, py])
        result = cv2.pointPolygonTest(np.array(contour, dtype=np.float32), (float(x), float(y)), False)
        if result >= 0:
            return True
    return False


def classify_region(gray, x, y, width, height, frame_width, frame_height):
    region = gray[y:y + height, x:x + width]
    if region.size == 0:
        return "motion", 0.0
    best = ("motion", 0.0)
    for name in PERSON_CASCADES:
        cascade = load_cascade(name)
        if cascade is None:
            continue
        matches = cascade.detectMultiScale(region, scaleFactor=1.08, minNeighbors=3, minSize=(20, 40))
        if len(matches):
            confidence = min(0.99, 0.6 + 0.08 * len(matches))
            if confidence > best[1]:
                best = ("person", confidence)
    for name in VEHICLE_CASCADES:
        cascade = load_cascade(name)
        if cascade is None:
            continue
        matches = cascade.detectMultiScale(region, scaleFactor=1.1, minNeighbors=2, minSize=(40, 30))
        if len(matches):
            confidence = min(0.99, 0.62 + 0.08 * len(matches))
            if confidence > best[1]:
                best = ("vehicle", confidence)
    if best[1] == 0:
        ratio = width / max(1, height)
        if 1.15 <= ratio <= 3.2 and width >= frame_width * 0.08 and height >= frame_height * 0.06:
            best = ("vehicle", 0.62)
        elif 0.25 <= ratio <= 0.8 and height >= frame_height * 0.12:
            best = ("person", 0.58)
    return best


def analyze_frame(camera_id: int, camera: str, timestamp: str, frame_bytes: bytes, zones: list, settings: dict):
    frame = cv2.imdecode(np.frombuffer(frame_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=422, detail="Frame is not a valid image")
    height, width = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (21, 21), 0)
    previous = MOTION_STATE.get(camera_id)
    if previous is None or previous.shape != gray.shape:
        MOTION_STATE[camera_id] = gray
        difference = np.zeros_like(gray)
    else:
        difference = cv2.absdiff(previous, gray)
    MOTION_STATE[camera_id] = gray
    threshold = cv2.threshold(difference, 25, 255, cv2.THRESH_BINARY)[1]
    threshold = cv2.dilate(threshold, None, iterations=2)
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    minimum_area = max(600, int(width * height * float(settings.get("motion_threshold", 12)) / 1000))
    confidence_min = float(settings.get("detection_confidence", 0.55))
    max_objects = max(1, int(settings.get("max_objects", 5)))
    person_only = bool(settings.get("person_only", False))
    detections = []
    annotated = frame.copy()

    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < minimum_area:
            continue
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if not inside_zone(x + box_width // 2, y + box_height // 2, width, height, zones):
            continue
        label, confidence = classify_region(gray, x, y, box_width, box_height, width, height)
        if person_only and label != "person":
            continue
        if confidence < confidence_min:
            continue
        candidates.append((confidence, label, x, y, box_width, box_height, area))

    for confidence, label, x, y, box_width, box_height, area in sorted(candidates, reverse=True)[:max_objects]:
        detections.append({
            "label": label,
            "object_name": label,
            "confidence": round(confidence, 3),
            "bounding_box": {"x": x, "y": y, "width": box_width, "height": box_height, "area": area},
            "frame_width": width,
            "frame_height": height,
            "timestamp": timestamp,
            "description": f"{label} detected in the {('left' if x + box_width // 2 < width // 3 else 'right' if x + box_width // 2 > 2 * width // 3 else 'center')} area of the camera view"
        })
        cv2.rectangle(annotated, (x, y), (x + box_width, y + box_height), (0, 255, 0), 2)

    date_part = timestamp[:10]
    safe = safe_camera(camera)
    target_dir = SNAPSHOTS / safe / date_part
    target_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{safe}_{timestamp.replace(':', '-').replace('T', '_').replace('+', '_')}_{len(detections)}.jpg"
    target = target_dir / file_name
    cv2.imwrite(str(target), annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return detections, str(target.relative_to(ROOT))


@app.get("/")
def home():
    return {
        "service": "LocalVision Storage API",
        "status": "online",
        "version": "1.2.0",
        "health": "/api/health",
        "storage": "/api/storage",
        "storage_overview": "/api/storage/overview",
        "cameras": "/api/cameras",
        "recordings": "/api/recordings",
        "documentation": "/docs"
    }


def authenticate(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not secrets.compare_digest(credentials.credentials, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


@app.get("/api/health")
def health():
    return {
        "status": "online",
        "service": "LocalVision Storage",
        "time": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/storage")
@app.get("/api/storage/overview")
def storage(_: bool = Depends(authenticate)):
    usage = os.statvfs(ROOT)
    total = usage.f_blocks * usage.f_frsize
    free = usage.f_bavail * usage.f_frsize
    used = total - free
    return {
        "total_bytes": total,
        "used_bytes": used,
        "free_bytes": free,
        "used_percent": round(used / total * 100, 2) if total else 0
    }


@app.get("/api/cameras")
def cameras(_: bool = Depends(authenticate)):
    result = []
    counts: dict[str, int] = {}
    for root in recording_roots():
        if not root.exists():
            continue
        for folder in sorted(item for item in root.iterdir() if item.is_dir()):
            if folder.name not in counts:
                counts[folder.name] = 0
            counts[folder.name] += sum(1 for _ in folder.rglob("*.mp4"))
    for name in sorted(counts):
        result.append({
            "camera": name,
            "recording_directory_exists": True,
            "recording_files": counts[name]
        })
    return {"cameras": result}


LISTING_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
LISTING_TTL_SECONDS = 5.0


def iter_recording_files(root: Path, camera_name: str, date: str):
    base = (root / camera_name).resolve() if camera_name else root.resolve()
    if not base.is_relative_to(root.resolve()) or not base.exists():
        return
    for file in sorted(base.rglob("*.mp4"), reverse=True):
        relative = file.relative_to(root)
        parts = relative.parts
        if len(parts) >= 4 and len(parts[1]) == 4 and parts[1].isdigit():
            file_camera = parts[0]
            file_date = f"{parts[1]}-{parts[2]}-{parts[3]}"
        elif len(parts) >= 3:
            file_camera = parts[0]
            file_date = parts[1]
        elif len(parts) == 2:
            file_camera = camera_name or parts[0]
            file_date = parts[0]
        else:
            file_camera = camera_name or "Camera1"
            file_date = date or ""
        if camera_name and file_camera != camera_name:
            continue
        if date and file_date != date:
            continue
        yield file, file_camera, file_date, relative


@app.get("/api/recordings")
def recordings(camera: str = "", date: str = "", _: bool = Depends(authenticate)):
    camera_name = safe_camera(camera) if camera else ""
    if date:
        date = valid_date(date)
    cache_key = (camera_name, date)
    cached = LISTING_CACHE.get(cache_key)
    now = datetime.now(timezone.utc).timestamp()
    if cached and now - cached[0] < LISTING_TTL_SECONDS:
        return cached[1]

    seen: set[tuple[str, str, str]] = set()
    items = []
    for root in recording_roots():
        for file, file_camera, file_date, relative in iter_recording_files(root, camera_name, date):
            key = (file_camera, file_date, file.name)
            if key in seen:
                continue
            seen.add(key)
            review = read_review(file)
            stat = file.stat()
            items.append({
                "id": recording_id(file_camera, file_date, file.name),
                "name": file.name,
                "camera": file_camera,
                "camera_id": camera_id_from_name(file_camera),
                "date": file_date,
                "path": str(relative),
                "filename": file.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "mime_type": mimetypes.guess_type(file.name)[0] or "video/mp4",
                "review_status": review.get("review_status", "unreviewed"),
                "reviewed_by": review.get("reviewed_by"),
                "reviewed_at": review.get("reviewed_at"),
            })
    items.sort(key=lambda item: item["created_at"], reverse=True)
    payload = {"camera": camera_name, "date": date, "recordings": items}
    LISTING_CACHE[cache_key] = (now, payload)
    return payload


@app.delete("/api/recordings/{recording_id}")
def delete_recording(recording_id: str, _: bool = Depends(authenticate)):
    camera, date_value, filename = parse_recording_id(recording_id)
    path = find_recording(camera, date_value, filename)
    path.unlink(missing_ok=True)
    review_sidecar(path).unlink(missing_ok=True)
    return {"deleted": True, "id": recording_id}


@app.api_route("/api/recordings/{recording_id}/review", methods=["POST", "PATCH", "PUT"])
async def review_recording(recording_id: str, request: Request, _: bool = Depends(authenticate)):
    camera, date_value, filename = parse_recording_id(recording_id)
    path = find_recording(camera, date_value, filename)
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    payload = write_review(path, data)
    review = read_review(path)
    return {
        "id": recording_id,
        "camera": camera,
        "date": date_value,
        "filename": filename,
        "path": str(path.relative_to(ROOT)),
        "size_bytes": path.stat().st_size,
        "review_status": review.get("review_status", "unreviewed"),
        "reviewed_by": review.get("reviewed_by"),
        "reviewed_at": review.get("reviewed_at"),
        "review_notes": review.get("review_notes"),
        "notes": payload.get("notes"),
    }


@app.post("/api/storage/upload")
async def upload(request: Request, _: bool = Depends(authenticate)):
    fields, upload_filename, content = parse_upload(await request.body(), request.headers.get("content-type", ""))
    duration = valid_duration(fields.get("duration_seconds", ""))
    camera_name = safe_camera(fields.get("camera", "Camera1"))
    date_value = valid_date(fields.get("date", ""), default=True)
    time_value = fields.get("time", "")
    filename = safe_filename(upload_filename or "")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload exceeds size limit")
    target = (RECORDINGS / camera_name / date_value / filename).resolve()
    if not target.is_relative_to(RECORDINGS.resolve()):
        raise HTTPException(status_code=400, detail="Invalid path")
    if target.exists():
        raise HTTPException(status_code=409, detail="Recording already exists")

    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("wb", delete=False, dir=target.parent, prefix=".upload-", suffix=".part") as output:
            temp_path = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temp_path, target)
        except FileExistsError:
            raise HTTPException(status_code=409, detail="Recording already exists")
        temp_path.unlink(missing_ok=True)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    stat = target.stat()
    created_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
    return {
        "id": recording_id(camera_name, date_value, filename),
        "camera": camera_name,
        "date": date_value,
        "time": time_value,
        "filename": filename,
        "name": filename,
        "path": str(target.relative_to(ROOT)),
        "size_bytes": stat.st_size,
        "created_at": created_at,
        "mime_type": mimetypes.guess_type(filename)[0] or "video/mp4",
        "duration_seconds": duration
    }


@app.post("/api/storage/ai/detect")
async def ai_detect(request: Request, _: bool = Depends(authenticate)):
    fields, _, content = parse_upload(await request.body(), request.headers.get("content-type", ""))
    if not content:
        raise HTTPException(status_code=422, detail="A frame is required")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Frame exceeds size limit")
    camera_id = int(fields.get("camera_id", "0") or 0)
    if camera_id <= 0:
        raise HTTPException(status_code=422, detail="camera_id is required")
    camera = safe_camera(fields.get("camera", "Camera1"), default=f"Camera{camera_id}")
    timestamp = fields.get("timestamp") or datetime.now(timezone.utc).isoformat()
    zones = json_field(fields.get("zones", ""), [])
    settings = json_field(fields.get("settings", ""), {})
    if not isinstance(settings, dict):
        settings = {}
    detections, snapshot_path = analyze_frame(camera_id, camera, timestamp, content, zones, settings)
    return {
        "camera_id": camera_id,
        "camera": camera,
        "timestamp": timestamp,
        "detections": detections,
        "count": len(detections),
        "snapshot_path": snapshot_path
    }


@app.get("/api/storage/ai/snapshot")
def ai_snapshot(path: str, _: bool = Depends(authenticate)):
    cleaned = Path(path or "")
    if cleaned.is_absolute() or ".." in cleaned.parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    target = (SNAPSHOTS / cleaned).resolve()
    if not target.is_relative_to(SNAPSHOTS.resolve()) or not target.is_file():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(target, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=60"})


@app.get("/api/recordings/file/{camera}/{date}/{filename}")
def playback(camera: str, date: str, filename: str, _: bool = Depends(authenticate)):
    camera_name = safe_camera(camera)
    date_value = valid_date(date)
    filename_value = safe_filename(filename)
    file_path = (RECORDINGS / camera_name / date_value / filename_value).resolve()
    if not file_path.is_relative_to(RECORDINGS.resolve()):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(
        file_path,
        media_type="video/mp4",
        filename=filename_value,
        headers={"Accept-Ranges": "bytes"}
    )
