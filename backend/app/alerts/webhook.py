import httpx
from .base import AlertMessage, NotificationProvider


class WebhookProvider(NotificationProvider):
    name = "webhook"

    def __init__(self, endpoint: str, headers: dict[str, str] | None = None):
        self.endpoint = endpoint
        self.headers = headers or {}

    async def send(self, message: AlertMessage) -> bool:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(self.endpoint, json={"kind": message.kind, "message": message.message, "metadata": message.metadata or {}}, headers=self.headers)
        return response.is_success

    async def test(self) -> bool:
        return bool(self.endpoint)
