import httpx
from pydantic import AnyHttpUrl, BaseModel, Field, ValidationError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import urlsplit
from ..auth.security import encrypt_secret
from ..cameras.discovery import discover_onvif_devices
from ..cameras.onvif_client import inspect_onvif_device
from ..database import get_db
from ..models.camera import Camera
from ..schemas.camera import CameraCreate, CameraRead, CameraStatus, CameraTestResult, CameraUpdate, DiscoveryResult, OnvifInspectionRequest
from ..services.streams import frame_hub, probe_camera
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


@router.post("/test", response_model=CameraTestResult)
async def test_camera_draft(payload: CameraCreate, _: User = Depends(require_minimum_role("operator"))) -> CameraTestResult:
    draft = Camera(**payload.model_dump(exclude={"password"}), encrypted_password=encrypt_secret(payload.password))
    result = await probe_camera(draft)
    return CameraTestResult(status=result.status, message=result.message, resolution=result.resolution, fps=result.fps, preview=result.preview, hints=None if result.status == "reachable" else result.message)


@router.post("/onvif/inspect", response_model=DiscoveryResult)
async def inspect_onvif(payload: OnvifInspectionRequest, _: User = Depends(require_minimum_role("operator"))) -> DiscoveryResult:
    parsed = urlsplit(payload.endpoint)
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=422, detail="Enter a valid ONVIF endpoint URL")
    device = await inspect_onvif_device(host, parsed.port or 80, payload.username, payload.password, payload.endpoint)
    return DiscoveryResult(ip=device.ip, manufacturer=device.manufacturer, model=device.model, onvif_endpoint=device.endpoint, rtsp_url=device.rtsp_url, port=parsed.port or 80, error=device.error)


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


@router.post("/{camera_id}/test", response_model=CameraTestResult)
async def test_camera(camera_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> CameraTestResult:
    camera = await get_camera(camera_id, db)
    result = await probe_camera(camera)
    return CameraTestResult(camera_id=camera.id, status=result.status, message=result.message, resolution=result.resolution, fps=result.fps, preview=result.preview, hints=None if result.status == "reachable" else result.message)


@router.get("/{camera_id}/status", response_model=CameraStatus)
async def camera_status(camera_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> CameraStatus:
    camera = await get_camera(camera_id, db)
    live = frame_hub.status(camera.id)
    if live["status"] in {"online", "reconnecting"}:
        return CameraStatus(camera_id=camera.id, status="online" if live["status"] == "online" else "offline", protocol=camera.protocol, message=str(live["message"]) if live["message"] else None)
    result = await probe_camera(camera, timeout=3)
    return CameraStatus(camera_id=camera.id, status="online" if result.status == "reachable" else "offline", protocol=camera.protocol, resolution=result.resolution, fps=result.fps, message=result.message)
