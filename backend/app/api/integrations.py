from datetime import datetime
from pydantic import BaseModel, Field
import base64
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.security import encrypt_secret
from ..database import get_db
from ..models.operations import Integration
from ..auth.rbac import require_minimum_role
from ..models.auth import User

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


class IntegrationInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=40)
    endpoint: str = Field(min_length=1)
    auth_method: str = "none"
    secret: str | None = Field(default=None, max_length=500, exclude=True)
    enabled: bool = False


class IntegrationRead(BaseModel):
    id: int
    name: str
    kind: str
    endpoint: str
    auth_method: str
    enabled: bool
    created_at: datetime


@router.get("", response_model=list[IntegrationRead])
async def list_integrations(_: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> list[Integration]:
    return list((await db.execute(select(Integration).order_by(Integration.id))).scalars())


@router.post("", response_model=IntegrationRead, status_code=201)
async def create_integration(payload: IntegrationInput, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> Integration:
    integration = Integration(**payload.model_dump(exclude={"secret"}), encrypted_secret=encrypt_secret(payload.secret))
    db.add(integration); await db.commit(); await db.refresh(integration); return integration


@router.delete("/{integration_id}", status_code=204)
async def delete_integration(integration_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    integration = await db.get(Integration, integration_id)
    if not integration: raise HTTPException(status_code=404, detail="Integration not found")
    await db.delete(integration); await db.commit()


@router.post("/{integration_id}/test")
async def test_integration(integration_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    integration = await db.get(Integration, integration_id)
    if not integration: raise HTTPException(status_code=404, detail="Integration not found")
    headers: dict[str, str] = {}
    if integration.auth_method == "bearer" and integration.encrypted_secret:
        from ..auth.security import decrypt_secret
        headers["Authorization"] = f"Bearer {decrypt_secret(integration.encrypted_secret)}"
    elif integration.auth_method == "api_key" and integration.encrypted_secret:
        from ..auth.security import decrypt_secret
        headers["X-API-Key"] = decrypt_secret(integration.encrypted_secret) or ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(integration.endpoint, headers=headers)
        return {"ok": response.is_success, "status_code": response.status_code, "error": None if response.is_success else response.text[:300]}
    except httpx.HTTPError as error:
        return {"ok": False, "status_code": None, "error": str(error)}
