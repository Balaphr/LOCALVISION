from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.access import accessible_camera_ids, get_accessible_camera
from ..auth.rbac import require_minimum_role
from ..database import get_db
from ..models.auth import User
from ..models.operations import Alert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(user: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    camera_ids = await accessible_camera_ids(user, db)
    alerts = (await db.execute(select(Alert).where(Alert.camera_id.in_(camera_ids)).order_by(Alert.created_at.desc()).limit(100))).scalars()
    return [{"id": alert.id, "camera_id": alert.camera_id, "kind": alert.kind, "message": alert.message, "status": alert.status, "created_at": alert.created_at} for alert in alerts]


@router.patch("/{alert_id}")
async def acknowledge_alert(alert_id: int, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.camera_id is None and user.role != "admin":
        raise HTTPException(status_code=404, detail="Alert not found")
    await get_accessible_camera(alert.camera_id, user, db, "manage")
    alert.status = "acknowledged"
    await db.commit()
    return {"id": alert.id, "status": alert.status}
