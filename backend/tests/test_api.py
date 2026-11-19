from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from app.auth.security import hash_password
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.auth import User


@pytest.fixture(autouse=True)
async def database():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_camera_validation(client):
    username = f"validation-user-{uuid4().hex[:8]}"
    async with SessionLocal() as db:
        db.add(User(username=username, password_hash=hash_password("validation-password"), role="admin"))
        await db.commit()
    login = await client.post("/api/auth/login", json={"username": username, "password": "validation-password"})
    assert login.status_code == 200
    response = await client.post("/api/cameras", json={"name": "", "host": "camera"})
    assert response.status_code == 422
