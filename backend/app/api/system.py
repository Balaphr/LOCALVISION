from fastapi import APIRouter
from ..config import get_settings

router = APIRouter(tags=["system"])


@router.get("/api/health")
async def health() -> dict[str, str]:
    settings = get_settings()
    return {"status": "ok", "version": settings.version}


@router.get("/api/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}


@router.get("/api/version")
async def version() -> dict[str, str]:
    return {"version": get_settings().version}
