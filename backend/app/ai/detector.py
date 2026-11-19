import asyncio
import logging
from typing import Any
from ..config import get_settings
from .base import AIProvider, Detection
from .hog import HOGDetector
from .yolo import YOLOProvider

logger = logging.getLogger(__name__)


class HybridDetector(AIProvider):
    name = "local-hybrid"

    def __init__(self) -> None:
        settings = get_settings()
        self.yolo = YOLOProvider(settings.yolo_model_path)
        self.hog = HOGDetector()
        self.yolo_available = True
        self.active = self.yolo.name

    async def detect(self, frame: Any, confidence: float | None = None) -> list[Detection]:
        threshold = confidence if confidence is not None else get_settings().detection_confidence
        if self.yolo_available:
            try:
                return await asyncio.wait_for(self.yolo.detect(frame, threshold), timeout=8)
            except asyncio.TimeoutError:
                self.yolo_available = False
                self.active = self.hog.name
                logger.warning("YOLO inference timed out; using local HOG person detector")
            except Exception as error:
                self.yolo_available = False
                self.active = self.hog.name
                logger.warning("YOLO unavailable (%s); using local HOG person detector", error)
        return await self.hog.detect(frame, threshold)

    async def health(self) -> bool:
        return True

    def status(self) -> dict[str, object]:
        return {"provider": self.name, "model": self.yolo.model_name, "active": self.active, "status": "ready", "local_only": True}


detector = HybridDetector()
