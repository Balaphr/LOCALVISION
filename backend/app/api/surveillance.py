from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from ..ai.detector import detector
from ..auth.access import accessible_camera_ids
from ..auth.rbac import require_minimum_role
from ..database import get_db
from ..models.auth import User
from ..services.surveillance import surveillance_worker
from ..services.streams import frame_hub

router = APIRouter(prefix="/api/surveillance", tags=["surveillance"])


@router.get("/status")
async def status(user: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera_ids = set(await accessible_camera_ids(user, db))
    return {
        "running": surveillance_worker.running,
        "detector": detector.status(),
        "cameras": {str(camera_id): frame_hub.status(camera_id) for camera_id in sorted(surveillance_worker.monitors) if camera_id in camera_ids},
    }
