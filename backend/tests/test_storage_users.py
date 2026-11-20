from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.security import hash_password
from app.database import Base, get_db
from app.main import app
from app.models.auth import User
from app.models.camera import Camera
from app.models.operations import Event


@pytest.fixture(autouse=True)
async def database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session_factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


async def create_user(session_factory, role: str) -> tuple[str, str]:
    username = f"{role}-{uuid4().hex[:8]}"
    password = "test-password"
    async with session_factory() as db:
        db.add(User(username=username, password_hash=hash_password(password), role=role))
        await db.commit()
    return username, password


async def sign_in(username: str, password: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    response = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return client


@pytest.mark.asyncio
async def test_user_management_is_admin_only(database):
    admin_name, admin_password = await create_user(database, "admin")
    viewer_name, viewer_password = await create_user(database, "viewer")
    admin = await sign_in(admin_name, admin_password)
    viewer = await sign_in(viewer_name, viewer_password)

    assert (await viewer.get("/api/users")).status_code == 403
    assert (await viewer.get("/api/storage/overview")).status_code == 403

    username = f"operator-{uuid4().hex[:8]}"
    created = await admin.post("/api/users", json={"username": username, "password": "new-password", "role": "operator", "is_active": True})
    assert created.status_code == 201
    assert created.json()["permissions"]["cameras.manage"] is True
    user_id = created.json()["id"]

    updated = await admin.patch(f"/api/users/{user_id}", json={"role": "viewer", "is_active": False, "permissions": {"alerts.manage": True}})
    assert updated.status_code == 200
    assert updated.json()["role"] == "viewer"
    assert updated.json()["is_active"] is False
    assert updated.json()["permissions"]["cameras.manage"] is False
    assert updated.json()["permissions"]["alerts.manage"] is True

    self_update = await admin.patch("/api/users/1", json={"role": "viewer"})
    assert self_update.status_code in {400, 404}

    deleted = await admin.delete(f"/api/users/{user_id}")
    assert deleted.status_code == 204
    assert (await admin.get("/api/users")).json() == [item for item in (await admin.get("/api/users")).json() if item["id"] != user_id]
    await admin.aclose()
    await viewer.aclose()


@pytest.mark.asyncio
async def test_storage_server_crud_and_overview(database, tmp_path):
    admin_name, admin_password = await create_user(database, "admin")
    admin = await sign_in(admin_name, admin_password)

    created = await admin.post("/api/storage/servers", json={
        "name": "Test mount",
        "kind": "local_mount",
        "endpoint": "",
        "base_path": str(tmp_path),
        "auth_method": "none",
        "enabled": True,
    })
    assert created.status_code == 201
    server_id = created.json()["id"]
    assert "secret" not in created.json()

    tested = await admin.post(f"/api/storage/servers/{server_id}/test")
    assert tested.status_code == 200
    assert tested.json()["status"] == "online"
    assert tested.json()["usage"]["total_bytes"] > 0

    overview = await admin.get("/api/storage/overview")
    assert overview.status_code == 200
    assert overview.json()["servers"][0]["last_status"] == "online"
    assert overview.json()["totals"]["total_bytes"] > 0

    updated = await admin.patch(f"/api/storage/servers/{server_id}", json={"name": "Renamed mount", "enabled": False})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed mount"
    assert updated.json()["enabled"] is False

    removed = await admin.delete(f"/api/storage/servers/{server_id}")
    assert removed.status_code == 204
    await admin.aclose()


@pytest.mark.asyncio
async def test_camera_data_isolation_and_sharing(database):
    admin_name, admin_password = await create_user(database, "admin")
    owner_name, owner_password = await create_user(database, "operator")
    viewer_name, viewer_password = await create_user(database, "viewer")
    outsider_name, outsider_password = await create_user(database, "viewer")
    admin = await sign_in(admin_name, admin_password)
    owner = await sign_in(owner_name, owner_password)
    viewer = await sign_in(viewer_name, viewer_password)
    outsider = await sign_in(outsider_name, outsider_password)

    created = await owner.post("/api/cameras", json={"name": "Owner camera", "host": "192.0.2.20"})
    assert created.status_code == 201
    camera_id = created.json()["id"]

    async with database() as db:
        db.add(Event(camera_id=camera_id, kind="entrance_approach", object_name="person", confidence=0.8, occurred_at=datetime.now(timezone.utc), description="Shared event"))
        await db.commit()

    assert [camera["id"] for camera in (await owner.get("/api/cameras")).json()] == [camera_id]
    assert (await outsider.get("/api/cameras")).json() == []
    assert (await outsider.get("/api/events")).json()["items"] == []
    assert (await outsider.get(f"/api/cameras/{camera_id}")).status_code == 404

    shared = await owner.post(f"/api/cameras/{camera_id}/shares", json={"username": viewer_name, "permission": "viewer"})
    assert shared.status_code == 201
    assert [camera["id"] for camera in (await viewer.get("/api/cameras")).json()] == [camera_id]
    assert (await viewer.get("/api/events")).json()["items"][0]["description"] == "Shared event"
    assert (await viewer.get(f"/api/cameras/{camera_id}")).status_code == 200

    assert (await outsider.post(f"/api/cameras/{camera_id}/shares", json={"username": outsider_name, "permission": "viewer"})).status_code == 403
    assert (await admin.get(f"/api/cameras/{camera_id}")).status_code == 200
    await admin.aclose()
    await owner.aclose()
    await viewer.aclose()
    await outsider.aclose()
