from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.rbac import require_roles
from ..database import get_db
from ..models.auth import User
from ..models.operations import AuditLog

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


@router.get("")
async def list_audit_logs(_: User = Depends(require_roles("admin")), page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [{"id": item.id, "username": item.username, "action": item.action, "resource": item.resource, "ip_address": item.ip_address, "created_at": item.created_at} for item in result.scalars()], "page": page, "page_size": page_size}
