from typing import Any
import asyncio
import cv2
from .base import AIProvider, Detection


class HOGDetector(AIProvider):
    name = "opencv-hog-person"

    def __init__(self) -> None:
        self._hog: Any = None

    def _detector(self) -> Any:
        if self._hog is None:
            self._hog = cv2.HOGDescriptor()
            self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        return self._hog

    async def detect(self, frame: Any, confidence: float = 0.5) -> list[Detection]:
        def infer() -> list[Detection]:
            detector = self._detector()
            rectangles, weights = detector.detectMultiScale(frame, winStride=(4, 4), padding=(8, 8), scale=1.03)
            result: list[Detection] = []
            for (x, y, width, height), weight in zip(rectangles, weights):
                score = min(0.99, max(0.5, float(weight)))
                if score >= confidence:
                    result.append(Detection("person", score, (float(x), float(y), float(x + width), float(y + height))))
            return result

        return await asyncio.to_thread(infer)

    async def health(self) -> bool:
        return True
