import os
import platform
import shutil
try:
    import psutil
except ImportError:
    psutil = None
from fastapi import APIRouter
from ..config import get_settings
from ..services.storage import LocalStorage

router = APIRouter(tags=["monitoring"])


def snapshot() -> dict[str, object]:
    usage = LocalStorage().usage()
    settings = get_settings()
    return {"api": "ok", "media": "not_started", "recording": "not_started", "ai": "not_loaded", "storage": {"total_bytes": usage.total_bytes, "used_bytes": usage.used_bytes, "free_bytes": usage.free_bytes, "low": LocalStorage().is_low(settings.low_storage_percent)}, "cpu": psutil.cpu_percent() if psutil else None, "ram": psutil.virtual_memory().percent if psutil else None, "gpu": None, "network": None, "host": platform.node()}


@router.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "version": get_settings().version, "components": snapshot()}


@router.get("/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}


@router.get("/metrics")
async def metrics() -> dict[str, object]:
    return snapshot()


@router.get("/api/storage")
async def storage() -> dict[str, object]:
    return snapshot()["storage"]


@router.get("/api/system")
async def system() -> dict[str, object]:
    return snapshot()


@router.get("/api/ai")
async def ai() -> dict[str, object]:
    return {"provider": "ultralytics-yolo", "model": "yolo11n", "status": "not_loaded", "local_only": True}
