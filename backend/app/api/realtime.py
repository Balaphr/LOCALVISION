from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["realtime"])


class ConnectionHub:
    def __init__(self) -> None: self.clients: set[WebSocket] = set()
    async def connect(self, websocket: WebSocket) -> None: await websocket.accept(); self.clients.add(websocket)
    def disconnect(self, websocket: WebSocket) -> None: self.clients.discard(websocket)
    async def broadcast(self, message: dict[str, object]) -> None:
        for client in tuple(self.clients):
            try: await client.send_json(message)
            except Exception: self.disconnect(client)

hub = ConnectionHub()


@router.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: hub.disconnect(websocket)
