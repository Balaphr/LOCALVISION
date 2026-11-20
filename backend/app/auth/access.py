from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.auth import User
from ..models.camera import Camera
from ..models.sharing import CameraShare
from .permissions import has_permission


async def accessible_camera_ids(user: User, db: AsyncSession) -> list[int]:
    if user.role == "admin":
        return list((await db.execute(select(Camera.id).order_by(Camera.id))).scalars())
    owned = (await db.execute(select(Camera.id).where(Camera.owner_id == user.id))).scalars()
    shared = (await db.execute(select(CameraShare.camera_id).where(CameraShare.user_id == user.id))).scalars()
    return sorted(set(owned) | set(shared))


async def get_accessible_camera(camera_id: int, user: User, db: AsyncSession, access: str = "view") -> Camera:
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if user.role == "admin" or camera.owner_id == user.id:
        return camera
    share = (await db.execute(select(CameraShare).where(CameraShare.camera_id == camera_id, CameraShare.user_id == user.id))).scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if access == "manage":
        if share.permission != "operator" or not has_permission(user, "cameras.manage"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Camera is shared as read-only")
    return camera


async def require_camera_owner(camera_id: int, user: User, db: AsyncSession) -> Camera:
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if user.role != "admin" and camera.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the camera owner can manage sharing")
    return camera
