from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.access import get_accessible_camera
from ..database import get_db
from ..models.auth import User
from ..models.camera import Camera
from ..models.zones import DetectionZone
from ..schemas.zone import ZoneInput, ZoneRead
from ..auth.rbac import require_minimum_role

router = APIRouter(prefix="/api/cameras/{camera_id}/zones", tags=["ai-zones"])


@router.get("", response_model=list[ZoneRead])
async def list_zones(camera_id: int, user: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> list[DetectionZone]:
    await get_accessible_camera(camera_id, user, db)
    return list((await db.execute(select(DetectionZone).where(DetectionZone.camera_id == camera_id).order_by(DetectionZone.id))).scalars())


@router.post("", response_model=ZoneRead, status_code=201)
async def create_zone(camera_id: int, payload: ZoneInput, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> DetectionZone:
    await get_accessible_camera(camera_id, user, db, "manage")
    zone = DetectionZone(camera_id=camera_id, **payload.model_dump())
    db.add(zone); await db.commit(); await db.refresh(zone); return zone


@router.put("/{zone_id}", response_model=ZoneRead)
async def update_zone(camera_id: int, zone_id: int, payload: ZoneInput, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> DetectionZone:
    await get_accessible_camera(camera_id, user, db, "manage")
    zone = await db.get(DetectionZone, zone_id)
    if not zone or zone.camera_id != camera_id: raise HTTPException(status_code=404, detail="Zone not found")
    for key, value in payload.model_dump().items(): setattr(zone, key, value)
    await db.commit(); await db.refresh(zone); return zone


@router.delete("/{zone_id}", status_code=204)
async def delete_zone(camera_id: int, zone_id: int, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    await get_accessible_camera(camera_id, user, db, "manage")
    zone = await db.get(DetectionZone, zone_id)
    if not zone or zone.camera_id != camera_id: raise HTTPException(status_code=404, detail="Zone not found")
    await db.delete(zone); await db.commit()
