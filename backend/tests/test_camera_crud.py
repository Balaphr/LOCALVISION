import pytest
from httpx import ASGITransport, AsyncClient
from app.auth.security import hash_password
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.auth import User


@pytest.fixture(autouse=True)
async def database():
    get_settings().encryption_key = "test-only-encryption-key"
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client


@pytest.mark.asyncio
async def test_camera_crud(client):
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
async def test_authentication(client):
    async with SessionLocal() as db:
        db.add(User(username="admin", password_hash=hash_password("correct-password"), role="admin"))
        await db.commit()
    response = await client.post("/api/auth/login", json={"username": "admin", "password": "correct-password"})
    assert response.status_code == 200
    assert (await client.get("/api/auth/me")).json()["role"] == "admin"
    assert (await client.post("/api/auth/logout")).status_code == 204
