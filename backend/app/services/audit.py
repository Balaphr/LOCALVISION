from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.auth import User
from ..models.operations import AuditLog


async def write_audit(db: AsyncSession, request: Request, user: User | None, action: str, resource: str | None = None) -> None:
    db.add(AuditLog(username=user.username if user else None, action=action, resource=resource, ip_address=request.client.host if request.client else None))
    await db.flush()