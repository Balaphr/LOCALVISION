import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(os.environ.get("STORAGE_ROOT", "/var/lib/localvision/storage")).resolve()
API_KEY = os.environ.get("STORAGE_API_KEY", "")
HOST = os.environ.get("STORAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("STORAGE_PORT", "8090"))
VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v"}


def authorized(handler):
    header = handler.headers.get("Authorization", "")
    supplied = header[7:] if header.startswith("Bearer ") else handler.headers.get("X-API-Key", "")
    return bool(API_KEY) and hmac.compare_digest(supplied, API_KEY)


def send_json(handler, status, payload):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def encode_id(path):
    return base64.urlsafe_b64encode(str(path).encode()).decode().rstrip("=")


def decode_id(value):
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode()).decode()


def resolve_id(value):
    try:
        relative = Path(decode_id(value))
    except Exception:
        return None
    candidate = (ROOT / relative).resolve()
    if ROOT not in candidate.parents or not candidate.is_file():
        return None
    return candidate


def read_multipart(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    content_type = handler.headers.get("Content-Type", "")
    match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type)
    if not match or length <= 0:
        return {}
    boundary = (match.group(1) or match.group(2)).strip().encode()
    raw = handler.rfile.read(length)
    fields = {}
    for part in raw.split(b"--" + boundary)[1:-1]:
        part = part.strip(b"\r\n")
        header_blob, separator, body = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        name_match = re.search(rb'name="([^"]+)"', header_blob)
        if not name_match:
            continue
        name = name_match.group(1).decode(errors="replace")
        filename_match = re.search(rb'filename="([^"]*)"', header_blob)
        filename = filename_match.group(1).decode(errors="replace") if filename_match else None
        if body.endswith(b"\r\n"):
            body = body[:-2]
        fields[name] = {"filename": filename, "body": body}
    return fields


def safe_upload_path(camera, date, filename):
    camera = re.sub(r"[^A-Za-z0-9_.-]+", "_", camera or "Camera1").strip("._") or "Camera1"
    date = re.sub(r"[^0-9-]+", "", date or datetime.now(timezone.utc).strftime("%Y-%m-%d")) or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = Path(filename or "recording.mp4").name
    filename = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename).strip("._") or "recording.mp4"
    return ROOT / "recordings" / camera / date / filename


def recording_entries():
    items = []
    if not ROOT.exists():
        return items
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        relative = path.relative_to(ROOT)
        parts = relative.parts
        camera_id = None
        if len(parts) > 1 and parts[0].lower() in {"recordings", "recording"} and parts[1].isdigit():
            camera_id = int(parts[1])
        else:
            for part in parts:
                if part.isdigit():
                    camera_id = int(part)
                    break
        stat = path.stat()
        items.append({
            "id": encode_id(relative),
            "camera_id": camera_id,
            "name": path.name,
            "path": str(relative),
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            "mime_type": mimetypes.guess_type(path.name)[0] or "video/mp4"
        })
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


def usage_payload():
    disk = shutil.disk_usage(ROOT)
    recordings = recording_entries()
    cameras = {}
    for item in recordings:
        if item["camera_id"] is None:
            continue
        key = str(item["camera_id"])
        entry = cameras.setdefault(key, {"used_bytes": 0, "recording_count": 0})
        entry["used_bytes"] += item["size_bytes"]
        entry["recording_count"] += 1
    return {
        "total_bytes": disk.total,
        "used_bytes": disk.used,
        "available_bytes": disk.free,
        "cameras": cameras,
        "recording_count": len(recordings),
        "root": str(ROOT)
    }


def stream_file(handler, path, download=False):
    stat = path.stat()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    start, end = 0, stat.st_size - 1
    range_header = handler.headers.get("Range", "")
    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    status = 200
    if match:
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else end
        end = min(end, stat.st_size - 1)
        if start > end:
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{stat.st_size}")
            handler.end_headers()
            return
        status = 206
    length = end - start + 1
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Content-Length", str(length))
    if status == 206:
        handler.send_header("Content-Range", f"bytes {start}-{end}/{stat.st_size}")
    if download:
        handler.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    remaining = length
    with path.open("rb") as source:
        source.seek(start)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            try:
                handler.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return
            remaining -= len(chunk)


class StorageHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if not authorized(self):
            send_json(self, 401, {"detail": "Invalid or missing API key"})
            return
        if path == "/api/health":
            send_json(self, 200, {"status": "ok", "root": str(ROOT)})
            return
        if path == "/api/storage/overview":
            send_json(self, 200, usage_payload())
            return
        if path == "/api/recordings":
            send_json(self, 200, {"files": recording_entries()})
            return
        if path.startswith("/api/recordings/file/"):
            parts = path.split("/")
            if len(parts) == 8 and parts[7] in {"file", "download"}:
                target = safe_upload_path(unquote(parts[4]), unquote(parts[5]), unquote(parts[6]))
                if not target.is_file():
                    send_json(self, 404, {"detail": "Recording not found"})
                    return
                stream_file(self, target, download=parts[7] == "download")
                return
        if path.startswith("/api/recordings/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[4] in {"file", "download"}:
                target = resolve_id(unquote(parts[3]))
                if not target:
                    send_json(self, 404, {"detail": "Recording not found"})
                    return
                stream_file(self, target, download=parts[4] == "download")
                return
        send_json(self, 404, {"detail": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if not authorized(self):
            send_json(self, 401, {"detail": "Not authenticated"})
            return
        if path != "/api/storage/upload":
            send_json(self, 404, {"detail": "Not found"})
            return
        fields = read_multipart(self)
        upload = fields.get("file")
        if not upload or not upload.get("filename"):
            send_json(self, 422, {"detail": "A file is required"})
            return
        target = safe_upload_path(
            fields.get("camera", {}).get("body", b"Camera1").decode(errors="replace"),
            fields.get("date", {}).get("body", b"").decode(errors="replace"),
            upload["filename"]
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(upload["body"])
        stat = target.stat()
        relative = target.relative_to(ROOT)
        send_json(self, 201, {
            "id": encode_id(relative),
            "camera": target.parent.parent.name,
            "date": target.parent.name,
            "filename": target.name,
            "name": target.name,
            "path": str(relative),
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            "mime_type": mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        })

    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if not authorized(self):
            self.send_response(401)
            self.end_headers()
            return
        if path.startswith("/api/recordings/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[4] == "file":
                target = resolve_id(unquote(parts[3]))
                if target:
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
                    self.send_header("Content-Length", str(target.stat().st_size))
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    return
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("STORAGE_API_KEY is required")
    ROOT.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer((HOST, PORT), StorageHandler).serve_forever()
