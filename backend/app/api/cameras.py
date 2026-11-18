import httpx
from pydantic import AnyHttpUrl, BaseModel, Field, ValidationError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.security import encrypt_secret
from ..cameras.discovery import discover_onvif_devices
from ..cameras.factory import provider_for
from ..database import get_db
from ..models.camera import Camera
from ..schemas.camera import CameraCreate, CameraRead, CameraStatus, CameraUpdate, DiscoveryResult
from ..auth.rbac import require_minimum_role
from ..models.auth import User
from ..services.audit import write_audit

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraImportRequest(BaseModel):
    endpoint: AnyHttpUrl
    api_key: str = Field(min_length=1, max_length=500)


@router.get("", response_model=list[CameraRead])
async def list_cameras(_: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> list[Camera]:
    result = await db.execute(select(Camera).order_by(Camera.created_at.desc()))
    return list(result.scalars())


@router.post("", response_model=CameraRead, status_code=status.HTTP_201_CREATED)
async def create_camera(payload: CameraCreate, request: Request, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> Camera:
    camera_data = payload.model_dump(exclude={"password"})
    camera = Camera(**camera_data, encrypted_password=encrypt_secret(payload.password))
    db.add(camera)
    await write_audit(db, request, user, "camera.created", "camera")
    await db.commit()
    await db.refresh(camera)
    return camera


@router.post("/discover", response_model=list[DiscoveryResult])
async def discover_cameras(_: User = Depends(require_minimum_role("operator"))) -> list[DiscoveryResult]:
    return await discover_onvif_devices()


@router.post("/import")
async def import_cameras(
    payload: CameraImportRequest,
    request: Request,
    user: User = Depends(require_minimum_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(str(payload.endpoint), headers={"X-API-Key": payload.api_key})
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Could not reach the camera API") from error

    if not response.is_success:
        raise HTTPException(status_code=502, detail=f"Camera API returned HTTP {response.status_code}")
    try:
        camera_data = response.json()
    except ValueError as error:
        raise HTTPException(status_code=502, detail="Camera API did not return valid JSON") from error
    if not isinstance(camera_data, list):
        raise HTTPException(status_code=422, detail="Camera API must return a JSON array")
    if len(camera_data) > 100:
        raise HTTPException(status_code=422, detail="Camera API returned more than 100 cameras")

    candidates: list[CameraCreate] = []
    for index, item in enumerate(camera_data):
        try:
            candidates.append(CameraCreate.model_validate(item))
        except ValidationError as error:
            raise HTTPException(status_code=422, detail=f"Camera at index {index} is invalid; name and host are required") from error

    existing_rows = await db.execute(select(Camera.host, Camera.port, Camera.protocol))
    existing = {(host.casefold(), port, protocol) for host, port, protocol in existing_rows}
    imported = 0
    for candidate in candidates:
        identity = (candidate.host.casefold(), candidate.port, candidate.protocol)
        if identity in existing:
            continue
        data = candidate.model_dump(exclude={"password"})
        db.add(Camera(**data, encrypted_password=encrypt_secret(candidate.password)))
        existing.add(identity)
        imported += 1

    if imported:
        await write_audit(db, request, user, "camera.api_imported", str(imported))
        await db.commit()
    return {"imported": imported, "skipped": len(candidates) - imported}


async def get_camera(camera_id: int, db: AsyncSession) -> Camera:
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


@router.get("/{camera_id}", response_model=CameraRead)
async def read_camera(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> Camera:
    return await get_camera(camera_id, db)


@router.put("/{camera_id}", response_model=CameraRead)
async def update_camera(camera_id: int, payload: CameraUpdate, request: Request, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> Camera:
    camera = await get_camera(camera_id, db)
    data = payload.model_dump(exclude_unset=True, exclude={"password"})
    for key, value in data.items():
        setattr(camera, key, value)
    if payload.password:
        camera.encrypted_password = encrypt_secret(payload.password)
    await write_audit(db, request, user, "camera.updated", str(camera_id))
    await db.commit()
    await db.refresh(camera)
    return camera


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(camera_id: int, request: Request, user: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    camera = await get_camera(camera_id, db)
    await db.delete(camera)
    await write_audit(db, request, user, "camera.deleted", str(camera_id))
    await db.commit()


@router.post("/{camera_id}/test")
async def test_camera(camera_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    camera = await get_camera(camera_id, db)
    provider = provider_for(camera)
    connected = await provider.test_connection()
    return {"camera_id": camera.id, "status": "reachable" if connected else "unreachable", "message": "Provider validation passed" if connected else "No usable stream endpoint configured"}


@router.get("/{camera_id}/status", response_model=CameraStatus)
async def camera_status(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> CameraStatus:
    camera = await get_camera(camera_id, db)
    provider = provider_for(camera)
    info = await provider.get_stream_info()
    return CameraStatus(camera_id=camera.id, status=await provider.get_status(), protocol=camera.protocol, resolution=info.resolution, fps=info.fps)
