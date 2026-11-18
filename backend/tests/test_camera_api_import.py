import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import cameras as cameras_api
from app.database import Base, get_db
from app.auth.security import hash_password
from app.config import get_settings
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


async def login_as_admin(client: AsyncClient, session_factory) -> None:
    async with session_factory() as db:
        db.add(User(username="admin", password_hash=hash_password("test-password"), role="admin"))
        await db.commit()
    response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-password"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_import_cameras_from_api_and_skip_duplicates(client, database, monkeypatch):
    await login_as_admin(client, database)
    payload = [{"name": "Gate", "host": "192.168.1.25", "port": 554, "protocol": "RTSP"}]

    class MockApiClient:
        def __init__(self, timeout):
            assert timeout == 10

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, endpoint, headers):
            assert endpoint == "https://camera.example/api/cameras"
            assert headers == {"X-API-Key": "example-key"}
            return httpx.Response(200, json=payload, request=httpx.Request("GET", endpoint))

    monkeypatch.setattr(cameras_api.httpx, "AsyncClient", MockApiClient)
    request = {"endpoint": "https://camera.example/api/cameras", "api_key": "example-key"}

    first = await client.post("/api/cameras/import", json=request)
    assert first.status_code == 200
    assert first.json() == {"imported": 1, "skipped": 0}

    second = await client.post("/api/cameras/import", json=request)
    assert second.status_code == 200
    assert second.json() == {"imported": 0, "skipped": 1}

    cameras = await client.get("/api/cameras")
    assert [camera["name"] for camera in cameras.json()] == ["Gate"]


@pytest.mark.asyncio
async def test_import_rejects_non_array_response_without_creating_cameras(client, database, monkeypatch):
    await login_as_admin(client, database)

    class MockApiClient:
        def __init__(self, timeout):
            assert timeout == 10

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, endpoint, headers):
            return httpx.Response(200, json={"cameras": []}, request=httpx.Request("GET", endpoint))

    monkeypatch.setattr(cameras_api.httpx, "AsyncClient", MockApiClient)
    response = await client.post(
        "/api/cameras/import",
        json={"endpoint": "https://camera.example/api/cameras", "api_key": "example-key"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Camera API must return a JSON array"
    assert (await client.get("/api/cameras")).json() == []
