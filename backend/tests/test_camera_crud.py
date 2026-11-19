import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.security import hash_password
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.models.auth import User


@pytest.fixture(autouse=True)
async def database():
    get_settings().encryption_key = "test-only-encryption-key"
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


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client


@pytest.mark.asyncio
async def test_camera_crud(client, database):
    async with database() as db:
        db.add(User(username="camera-admin", password_hash=hash_password("camera-password"), role="admin"))
        await db.commit()
    login = await client.post("/api/auth/login", json={"username": "camera-admin", "password": "camera-password"})
    assert login.status_code == 200
    payload = {"name": "Front door", "host": "192.168.1.20", "protocol": "RTSP", "password": "camera-secret"}
    created = await client.post("/api/cameras", json=payload)
    assert created.status_code == 201
    camera = created.json()
    assert camera["name"] == "Front door"
    assert "encrypted_password" not in camera
    camera_id = camera["id"]
    assert (await client.get(f"/api/cameras/{camera_id}")).status_code == 200
    updated = await client.put(f"/api/cameras/{camera_id}", json={"name": "Front door updated"})
    assert updated.json()["name"] == "Front door updated"
    assert (await client.delete(f"/api/cameras/{camera_id}")).status_code == 204
    assert (await client.get(f"/api/cameras/{camera_id}")).status_code == 404


@pytest.mark.asyncio
async def test_authentication(client, database):
    async with database() as db:
        db.add(User(username="admin", password_hash=hash_password("correct-password"), role="admin"))
        await db.commit()
    response = await client.post("/api/auth/login", json={"username": "admin", "password": "correct-password"})
    assert response.status_code == 200
    assert (await client.get("/api/auth/me")).json()["role"] == "admin"
    assert (await client.post("/api/auth/logout")).status_code == 204
