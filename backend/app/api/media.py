from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.rbac import require_minimum_role
from ..config import get_settings
from ..database import get_db
from ..models.auth import User
from ..models.camera import Camera
from ..services.storage import LocalStorage
from ..services.streams import capture_jpeg, frame_hub

router = APIRouter(prefix="/api", tags=["media"])


@router.get("/cameras/{camera_id}/live")
async def live(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera = await db.get(Camera, camera_id)
    if not camera:
        return {"status": "not_found"}
    await frame_hub.acquire(camera)
    return {"camera_id": camera_id, "status": "running", "transport": "mjpeg", "stream_url": f"/api/cameras/{camera_id}/stream.mjpeg", "webrtc_gateway": f"{get_settings().webrtc_gateway_url}/api/streams/{camera_id}/webrtc"}


@router.get("/cameras/{camera_id}/stream.mjpeg")
async def stream(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return StreamingResponse(frame_hub.mjpeg(camera), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store"})


@router.get("/cameras/{camera_id}/preview.jpg")
async def preview(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> Response:
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    reader = frame_hub.readers.get(camera_id)
    image = reader.jpeg() if reader else None
    if image is None:
        image = await capture_jpeg(camera)
    if image is None:
        raise HTTPException(status_code=502, detail="Camera did not return a frame")
    return Response(content=image, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/cameras/{camera_id}/snapshot")
async def snapshot(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera = await db.get(Camera, camera_id)
    if not camera:
        return {"camera_id": camera_id, "status": "not_found"}
    timestamp = datetime.now(timezone.utc)
    image = await capture_jpeg(camera)
    if image is None:
        return {"camera_id": camera_id, "status": "unavailable", "message": "Camera did not return a frame"}
    path = LocalStorage().snapshot_path(camera_id, timestamp, f"{timestamp.strftime('%H%M%S')}.jpg")
    path.write_bytes(image)
    relative = LocalStorage().relative(path)
    return {"camera_id": camera_id, "status": "ready", "path": str(path), "url": f"/api/media/file/{relative}"}


@router.get("/media/file/{relative_path:path}")
async def media_file(relative_path: str, _: User = Depends(require_minimum_role("viewer"))) -> FileResponse:
    root = LocalStorage().root.resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")
    suffix = path.suffix.lower()
    media_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "video/mp4" if suffix == ".mp4" else "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name)
