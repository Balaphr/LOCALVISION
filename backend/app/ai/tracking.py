from dataclasses import dataclass, field
from datetime import datetime, timezone
import time
from .base import Detection


def iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    width = max(0.0, right - left)
    height = max(0.0, bottom - top)
    intersection = width * height
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    label: str
    box: tuple[float, float, float, float]
    confidence: float
    hits: int = 1
    missed: int = 0
    history: list[dict[str, float]] = field(default_factory=list)
    first_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def center(self) -> tuple[float, float]:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)

    @property
    def area(self) -> float:
        return max(0.0, self.box[2] - self.box[0]) * max(0.0, self.box[3] - self.box[1])

    @property
    def duration(self) -> float:
        return (self.last_seen - self.first_seen).total_seconds()

    def to_json(self) -> dict[str, object]:
        return {
            "x": round(self.box[0], 2),
            "y": round(self.box[1], 2),
            "width": round(self.box[2] - self.box[0], 2),
            "height": round(self.box[3] - self.box[1], 2),
        }


class Tracker:
    def __init__(self, max_missed: int = 8, max_age: float = 6.0) -> None:
        self.max_missed = max_missed
        self.max_age = max_age
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, detections: list[Detection]) -> list[Track]:
        now = datetime.now(timezone.utc)
        unmatched = list(detections)
        for track in self.tracks:
            best: Detection | None = None
            best_score = 0.0
            for detection in unmatched:
                score = iou(track.box, detection.box)
                if score > best_score:
                    best_score = score
                    best = detection
            if best is not None and best_score >= 0.2:
                unmatched.remove(best)
                track.box = self._smooth(track.box, best.box)
                track.confidence = best.confidence
                track.label = best.label
                track.hits += 1
                track.missed = 0
                track.last_seen = now
                track.history.append({"x": track.center[0], "y": track.center[1], "area": track.area, "at": time.time()})
                track.history = track.history[-120:]
            else:
                track.missed += 1
        for detection in unmatched:
            track = Track(self._next_id, detection.label, detection.box, detection.confidence)
            track.history.append({"x": track.center[0], "y": track.center[1], "area": track.area, "at": time.time()})
            self._next_id += 1
            self.tracks.append(track)
        self.tracks = [track for track in self.tracks if track.missed <= self.max_missed and (now - track.last_seen).total_seconds() <= self.max_age]
        return [track for track in self.tracks if track.missed == 0]

    @staticmethod
    def _smooth(previous: tuple[float, float, float, float], current: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        return tuple(previous[index] * 0.35 + current[index] * 0.65 for index in range(4))
