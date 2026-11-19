from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.rbac import require_minimum_role
from ..database import get_db
from ..models.auth import User
from ..models.operations import Alert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(_: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    alerts = (await db.execute(select(Alert).order_by(Alert.created_at.desc()).limit(100))).scalars()
    return [{"id": alert.id, "kind": alert.kind, "message": alert.message, "status": alert.status, "created_at": alert.created_at} for alert in alerts]


@router.patch("/{alert_id}")
async def acknowledge_alert(alert_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = "acknowledged"
    await db.commit()
    return {"id": alert.id, "status": alert.status}
