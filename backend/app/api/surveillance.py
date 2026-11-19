from fastapi import APIRouter, Depends
from ..ai.detector import detector
from ..auth.rbac import require_minimum_role
from ..models.auth import User
from ..services.surveillance import surveillance_worker
from ..services.streams import frame_hub

router = APIRouter(prefix="/api/surveillance", tags=["surveillance"])


@router.get("/status")
async def status(_: User = Depends(require_minimum_role("viewer"))) -> dict[str, object]:
    return {
        "running": surveillance_worker.running,
        "detector": detector.status(),
        "cameras": {str(camera_id): frame_hub.status(camera_id) for camera_id in sorted(surveillance_worker.monitors)},
    }
