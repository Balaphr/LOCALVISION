from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ai.activity import rule_based_description
from app.ai.base import Detection
from app.ai.tracking import Tracker, Track
from app.auth.security import encrypt_secret, hash_password
from app.database import Base, get_db
from app.main import app
from app.models.auth import User
from app.models.camera import Camera
from app.models.operations import Alert, Event
from app.services.streams import build_stream_url


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


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client


async def login(client, session_factory):
    username = f"surveillance-{uuid4().hex[:8]}"
    async with session_factory() as db:
        db.add(User(username=username, password_hash=hash_password("test-password"), role="admin"))
        await db.commit()
    response = await client.post("/api/auth/login", json={"username": username, "password": "test-password"})
    assert response.status_code == 200


def test_build_stream_url_injects_credentials():
    camera = Camera(name="Door", host="192.168.1.50", port=554, protocol="RTSP", username="admin", encrypted_password=encrypt_secret("secret"))
    assert "admin:secret@" in build_stream_url(camera)


def test_tracker_preserves_identity_and_activity_descriptions():
    tracker = Tracker()
    first = tracker.update([Detection("person", 0.9, (10, 10, 110, 210))])[0]
    second = tracker.update([Detection("person", 0.9, (14, 12, 114, 212))])[0]
    assert first.id == second.id
    approaching = Track(1, "person", (20, 20, 100, 180), 0.9)
    approaching.history = [
        {"x": 50, "y": 100, "area": 1000, "at": 0},
        {"x": 50, "y": 100, "area": 21000, "at": 1},
    ]
    assert "approaching" in rule_based_description([approaching], [])
    assert rule_based_description([approaching, Track(2, "person", (0, 0, 10, 10), 0.8)], []) == "Multiple people detected."


@pytest.mark.asyncio
async def test_events_search_and_alert_acknowledge(client, database):
    await login(client, database)
    async with database() as db:
        db.add(Event(camera_id=1, kind="entrance_approach", object_name="person", confidence=0.94, occurred_at=datetime.now(timezone.utc), description="Person approaching the main door.", track_id="7"))
        db.add(Alert(kind="entrance_approach", message="Front door: Person approaching the main door.", status="open"))
        await db.commit()
    events = await client.get("/api/events?search=approaching")
    assert events.status_code == 200
    item = events.json()["items"][0]
    assert item["description"] == "Person approaching the main door."
    assert item["track_id"] == "7"
    detections = await client.get("/api/detections?min_confidence=0.9")
    assert len(detections.json()["items"]) == 1
    alerts = await client.get("/api/alerts")
    alert_id = alerts.json()[0]["id"]
    updated = await client.patch(f"/api/alerts/{alert_id}")
    assert updated.json()["status"] == "acknowledged"
