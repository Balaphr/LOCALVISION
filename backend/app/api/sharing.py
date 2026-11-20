from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.access import require_camera_owner
from ..auth.rbac import require_minimum_role
from ..database import get_db
from ..models.auth import User
from ..models.sharing import CameraShare
from ..schemas.sharing import ShareCreate, ShareRead
from ..services.audit import write_audit

router = APIRouter(prefix="/api/cameras/{camera_id}/shares", tags=["sharing"])


@router.get("", response_model=list[ShareRead])
async def list_shares(camera_id: int, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> list[ShareRead]:
    await require_camera_owner(camera_id, user, db)
    result = await db.execute(select(CameraShare, User).join(User, User.id == CameraShare.user_id).where(CameraShare.camera_id == camera_id).order_by(CameraShare.id))
    return [ShareRead(id=share.id, camera_id=share.camera_id, username=user_row.username, role=user_row.role, permission=share.permission, created_at=share.created_at) for share, user_row in result]


@router.post("", response_model=ShareRead, status_code=201)
async def create_share(camera_id: int, payload: ShareCreate, request: Request, owner: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> ShareRead:
    await require_camera_owner(camera_id, owner, db)
    target = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    existing = (await db.execute(select(CameraShare).where(CameraShare.camera_id == camera_id, CameraShare.user_id == target.id))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=409, detail="Camera is already shared with this user")
    share = CameraShare(camera_id=camera_id, user_id=target.id, permission=payload.permission, created_by=owner.id)
    db.add(share); await write_audit(db, request, owner, "camera.shared", str(camera_id)); await db.commit(); await db.refresh(share)
    return ShareRead(id=share.id, camera_id=camera_id, username=target.username, role=target.role, permission=share.permission, created_at=share.created_at)


@router.delete("/{share_id}", status_code=204)
async def revoke_share(camera_id: int, share_id: int, request: Request, owner: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    await require_camera_owner(camera_id, owner, db)
    share = await db.get(CameraShare, share_id)
    if not share or share.camera_id != camera_id: raise HTTPException(status_code=404, detail="Share not found")
    await db.delete(share); await write_audit(db, request, owner, "camera.share_revoked", str(camera_id)); await db.commit()
