from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..auth.access import accessible_camera_ids
from ..database import SessionLocal
from ..models.auth import Session, User

router = APIRouter(tags=["realtime"])


class ConnectionHub:
    def __init__(self) -> None:
        self.clients: dict[WebSocket, tuple[set[int], bool]] = {}

    async def connect(self, websocket: WebSocket, camera_ids: set[int], is_admin: bool) -> None:
        await websocket.accept()
        self.clients[websocket] = (camera_ids, is_admin)

    def disconnect(self, websocket: WebSocket) -> None:
        self.clients.pop(websocket, None)

    async def broadcast(self, message: dict[str, object]) -> None:
        camera_id = message.get("camera_id")
        for client, (camera_ids, is_admin) in tuple(self.clients.items()):
            if camera_id is None:
                if message.get("type") == "surveillance_status" and not is_admin:
                    continue
            elif not is_admin and camera_id not in camera_ids:
                continue
            try:
                await client.send_json(message)
            except Exception:
                self.disconnect(client)


hub = ConnectionHub()


async def websocket_user(websocket: WebSocket) -> tuple[set[int], bool] | None:
    token = websocket.cookies.get("localvision_session")
    if not token:
        return None
    async with SessionLocal() as db:
        session = await db.get(Session, token)
        if not session:
            return None
        expires_at = session.expires_at.replace(tzinfo=timezone.utc) if session.expires_at.tzinfo is None else session.expires_at
        if expires_at < datetime.now(timezone.utc):
            return None
        user = await db.get(User, session.user_id)
        if not user or not getattr(user, "is_active", True):
            return None
        camera_ids = set(await accessible_camera_ids(user, db))
        return camera_ids, user.role == "admin"


@router.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    identity = await websocket_user(websocket)
    if identity is None:
        await websocket.close(code=1008)
        return
    camera_ids, is_admin = identity
    await hub.connect(websocket, camera_ids, is_admin)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)
