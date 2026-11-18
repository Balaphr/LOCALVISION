import asyncio
from typing import Any
from .base import AIProvider, Detection


class YOLOProvider(AIProvider):
    name = "ultralytics-yolo"

    def __init__(self, model_name: str = "yolo11n.pt") -> None:
        self.model_name = model_name
        self._model = None

    def _load(self) -> None:
        if self._model is None:
            from ultralytics import YOLO
            self._model = YOLO(self.model_name)

    async def detect(self, frame: Any, confidence: float = 0.5) -> list[Detection]:
        def infer() -> list[Detection]:
            self._load()
            results = self._model.predict(frame, conf=confidence, verbose=False)
            detections: list[Detection] = []
            for result in results:
                for box in result.boxes:
                    detections.append(Detection(str(result.names[int(box.cls)]), float(box.conf), tuple(float(value) for value in box.xyxy[0])))
            return detections
        return await asyncio.to_thread(infer)

    async def health(self) -> bool:
        try:
            await asyncio.to_thread(self._load)
            return True
        except (ImportError, OSError):
            return False
