from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.rbac import require_permission
from ..auth.security import encrypt_secret
from ..database import get_db
from ..services.streams import frame_hub
from ..models.auth import User
from ..models.camera import Camera
from ..models.storage import StorageIntegration
from ..schemas.storage import (
    CameraStorageRead,
    StorageIntegrationCreate,
    StorageIntegrationRead,
    StorageIntegrationUpdate,
    StorageOverviewRead,
    StorageProbeRead,
    StorageServerRead,
    StorageUsageRead,
)
from ..services.audit import write_audit
from ..services.storage import LocalStorage, StorageUsage
from ..services.storage_integrations import camera_directory_usage, probe_storage, usage_payload

router = APIRouter(prefix="/api/storage", tags=["storage"])


def integration_read(integration: StorageIntegration) -> StorageIntegrationRead:
    return StorageIntegrationRead.model_validate(integration, from_attributes=True)


def validate_values(kind: str, endpoint: str | None, base_path: str | None) -> tuple[str, str | None]:
    if kind == "local_mount":
        raw_path = base_path or endpoint
        if not raw_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A mount path is required")
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        return str(path), str(path)
    if kind == "remote_api":
        parsed = urlsplit(endpoint or "")
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid http(s) endpoint is required")
        return endpoint or "", base_path
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported storage type")


async def persist_probe(db: AsyncSession, integration: StorageIntegration, request: Request | None = None, admin: User | None = None) -> StorageProbeRead:
    result = await probe_storage(integration)
    integration.last_status = result.status
    integration.last_error = None if result.status == "online" else result.message
    integration.last_checked_at = datetime.now(timezone.utc)
    if request and admin:
        await write_audit(db, request, admin, "storage.tested", integration.name)
    await db.commit()
    await db.refresh(integration)
    return StorageProbeRead(
        status=result.status,
        message=result.message,
        usage=StorageUsageRead.model_validate(usage_payload(result.usage, integration.kind)) if result.usage else None,
        checked_at=integration.last_checked_at,
    )


async def probe_all(db: AsyncSession, integrations: list[StorageIntegration]) -> dict[int, object]:
    if not integrations:
        return {}
    results = await asyncio.gather(*(probe_storage(integration) for integration in integrations), return_exceptions=True)
    mapped: dict[int, object] = {}
    for integration, result in zip(integrations, results):
        if isinstance(result, BaseException):
            integration.last_status = "error"
            integration.last_error = str(result)
            mapped[integration.id] = object()
            continue
        integration.last_status = result.status
        integration.last_error = None if result.status == "online" else result.message
        integration.last_checked_at = datetime.now(timezone.utc)
        mapped[integration.id] = result
    await db.commit()
    for integration in integrations:
        await db.refresh(integration)
    return mapped


@router.get("/overview", response_model=StorageOverviewRead)
async def storage_overview(_: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> StorageOverviewRead:
    local = LocalStorage().usage()
    integrations = list((await db.execute(select(StorageIntegration).where(StorageIntegration.enabled.is_(True)).order_by(StorageIntegration.id))).scalars())
    probes = await probe_all(db, integrations)
    servers: list[StorageServerRead] = []
    remote_total = remote_used = remote_free = 0
    remote_camera_usage: dict[int, int] = {}
    for integration in integrations:
        probe = probes.get(integration.id)
        usage = getattr(probe, "usage", None)
        if usage:
            if integration.kind == "remote_api":
                remote_total += usage.total_bytes
                remote_used += usage.used_bytes
                remote_free += usage.free_bytes
            remote_camera_usage.update(getattr(probe, "camera_usage", {}) or {})
        server = StorageServerRead.model_validate(integration, from_attributes=True)
        if usage:
            server.usage = StorageUsageRead.model_validate(usage_payload(usage, integration.kind))
        servers.append(server)
    cameras = list((await db.execute(select(Camera).order_by(Camera.id))).scalars())
    owners = dict((await db.execute(select(User.id, User.username))).all())
    camera_rows: list[CameraStorageRead] = []
    for camera in cameras:
        used = camera_directory_usage(LocalStorage().root, camera.id) + remote_camera_usage.get(camera.id, 0)
        available = local.free_bytes + remote_free
        total = used + available
        live = frame_hub.status(camera.id)
        live_status = live.get("status", "idle")
        status_value = live_status if live_status in {"online", "reconnecting", "offline"} else "idle"
        camera_rows.append(CameraStorageRead(id=camera.id, name=camera.name, status=status_value, protocol=camera.protocol, owner=owners.get(camera.owner_id) if camera.owner_id else None, used_bytes=used, available_bytes=available, percent_used=round(used * 100 / total, 2) if total else 0.0))
    totals = StorageUsage(local.total_bytes + remote_total, local.used_bytes + remote_used, local.free_bytes + remote_free)
    return StorageOverviewRead(
        local=StorageUsageRead.model_validate(usage_payload(local, "local")),
        servers=servers,
        cameras=camera_rows,
        totals=StorageUsageRead.model_validate(usage_payload(totals, "combined")),
        camera_count=len(cameras),
    )


@router.get("/servers", response_model=list[StorageIntegrationRead])
async def list_servers(_: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> list[StorageIntegrationRead]:
    integrations = (await db.execute(select(StorageIntegration).order_by(StorageIntegration.id))).scalars()
    return [integration_read(integration) for integration in integrations]


@router.post("/servers", response_model=StorageIntegrationRead, status_code=status.HTTP_201_CREATED)
async def create_server(payload: StorageIntegrationCreate, request: Request, admin: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> StorageIntegrationRead:
    endpoint, base_path = validate_values(payload.kind, payload.endpoint, payload.base_path)
    integration = StorageIntegration(
        name=payload.name,
        kind=payload.kind,
        endpoint=endpoint,
        base_path=base_path,
        bucket=payload.bucket,
        region=payload.region,
        auth_method=payload.auth_method,
        encrypted_secret=encrypt_secret(payload.secret),
        enabled=payload.enabled,
    )
    db.add(integration)
    await write_audit(db, request, admin, "storage.created", payload.name)
    await db.commit()
    await db.refresh(integration)
    return integration_read(integration)


@router.patch("/servers/{server_id}", response_model=StorageIntegrationRead)
async def update_server(server_id: int, payload: StorageIntegrationUpdate, request: Request, admin: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> StorageIntegrationRead:
    integration = await db.get(StorageIntegration, server_id)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage server not found")
    data = payload.model_dump(exclude_unset=True)
    kind = data.get("kind", integration.kind)
    endpoint, base_path = validate_values(kind, data.get("endpoint", integration.endpoint), data.get("base_path", integration.base_path))
    integration.name = data.get("name", integration.name)
    integration.kind = kind
    integration.endpoint = endpoint
    integration.base_path = base_path
    integration.bucket = data.get("bucket", integration.bucket)
    integration.region = data.get("region", integration.region)
    integration.auth_method = data.get("auth_method", integration.auth_method)
    if "secret" in data and data["secret"]:
        integration.encrypted_secret = encrypt_secret(data["secret"])
    if "enabled" in data and data["enabled"] is not None:
        integration.enabled = data["enabled"]
    integration.last_status = "untested"
    integration.last_error = None
    await write_audit(db, request, admin, "storage.updated", integration.name)
    await db.commit()
    await db.refresh(integration)
    return integration_read(integration)


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: int, request: Request, admin: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> None:
    integration = await db.get(StorageIntegration, server_id)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage server not found")
    await write_audit(db, request, admin, "storage.deleted", integration.name)
    await db.delete(integration)
    await db.commit()


@router.post("/servers/{server_id}/test", response_model=StorageProbeRead)
async def test_server(server_id: int, request: Request, admin: User = Depends(require_permission("storage.manage")), db: AsyncSession = Depends(get_db)) -> StorageProbeRead:
    integration = await db.get(StorageIntegration, server_id)
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage server not found")
    return await persist_probe(db, integration, request, admin)
