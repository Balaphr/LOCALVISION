import os
import platform
import shutil
try:
    import psutil
except ImportError:
    psutil = None
from fastapi import APIRouter
from ..ai.detector import detector
from ..config import get_settings
from ..services.storage import LocalStorage
from ..services.surveillance import surveillance_worker

router = APIRouter(tags=["monitoring"])


def snapshot() -> dict[str, object]:
    usage = LocalStorage().usage()
    settings = get_settings()
    surveillance = "running" if surveillance_worker.running else "stopped"
    return {"api": "ok", "media": surveillance, "recording": surveillance, "ai": detector.active, "storage": {"total_bytes": usage.total_bytes, "used_bytes": usage.used_bytes, "free_bytes": usage.free_bytes, "low": LocalStorage().is_low(settings.low_storage_percent)}, "cpu": psutil.cpu_percent() if psutil else None, "ram": psutil.virtual_memory().percent if psutil else None, "gpu": None, "network": None, "host": platform.node()}


@router.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "version": get_settings().version, "components": snapshot()}


@router.get("/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}


@router.get("/metrics")
@router.get("/api/metrics")
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
    return detector.status()
