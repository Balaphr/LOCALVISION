from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from ..cameras.factory import provider_for
from ..database import get_db
from ..models.camera import Camera
from datetime import datetime, timezone
from ..config import get_settings
from ..services.storage import LocalStorage
from ..services.media import MediaManager

router = APIRouter(prefix="/api", tags=["media"])
media_manager = MediaManager()


@router.get("/cameras/{camera_id}/live")
async def live(camera_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera = await db.get(Camera, camera_id)
    if not camera: return {"status": "not_found"}
    session = await media_manager.start(camera)
    return {"camera_id": camera_id, "status": session.status, "transport": "webrtc", "webrtc_gateway": f"{get_settings().webrtc_gateway_url}/api/streams/{camera_id}/webrtc", "fallback": ["hls", "mjpeg"], "fanout_port": session.udp_port}


@router.get("/cameras/{camera_id}/snapshot")
async def snapshot(camera_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera = await db.get(Camera, camera_id)
    if not camera: return {"camera_id": camera_id, "status": "not_found"}
    timestamp = datetime.now(timezone.utc)
    path = LocalStorage().snapshot_path(camera_id, timestamp, f"{timestamp.strftime('%H%M%S')}.jpg")
    await media_manager.snapshot(camera, str(path))
    return {"camera_id": camera_id, "status": "ready", "path": str(path)}
