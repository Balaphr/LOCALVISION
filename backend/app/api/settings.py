from fastapi import APIRouter
from ..config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def settings() -> dict[str, object]:
    configured = get_settings()
    return {"environment": configured.environment, "storage_path": str(configured.storage_path), "version": configured.version, "secrets_configured": configured.is_configured}
