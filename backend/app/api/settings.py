from fastapi import APIRouter, Depends
from ..auth.rbac import require_roles
from ..config import get_settings
from ..models.auth import User

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def settings(_: User = Depends(require_roles("admin"))) -> dict[str, object]:
    configured = get_settings()
    return {"environment": configured.environment, "storage_path": str(configured.storage_path), "version": configured.version, "secrets_configured": configured.is_configured}
