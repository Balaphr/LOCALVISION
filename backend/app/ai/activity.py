import base64
import json
from typing import Any

import httpx

from ..ai.tracking import Track
from ..config import get_settings

BAG_LABELS = {"backpack", "handbag", "suitcase", "bag", "package", "parcel"}
ALLOWED_ACTIVITIES = [
    "Person approaching the main door.",
    "Person standing near the entrance.",
    "Person ringing the doorbell.",
    "Person knocking on the door.",
    "Person carrying a package.",
    "Person delivering a parcel.",
    "Person entering the property.",
    "Person leaving the property.",
    "Person waiting outside.",
    "Person walking away.",
    "Multiple people detected.",
]

Point = tuple[float, float]


def _normalize_points(value: Any) -> list[Point]:
    points: list[Point] = []
    for item in value or []:
        try:
            if isinstance(item, dict):
                point = (float(item["x"]), float(item["y"]))
            else:
                point = (float(item[0]), float(item[1]))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        points.append(point)
    return points


def point_in_polygon(point: Point, points: list[Any]) -> bool:
    polygon = _normalize_points(points)
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = current
        x2, y2 = previous
        if ((y1 > y) != (y2 > y)) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def _distance_to_segment(point: Point, start: Point, end: Point) -> float:
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    ratio = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_squared))
    closest_x = x1 + ratio * dx
    closest_y = y1 + ratio * dy
    return ((px - closest_x) ** 2 + (py - closest_y) ** 2) ** 0.5


def _cross_product(start: Point, end: Point, point: Point) -> float:
    return (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])


def _segments_intersect(first_start: Point, first_end: Point, second_start: Point, second_end: Point) -> bool:
    first_side = _cross_product(second_start, second_end, first_start)
    second_side = _cross_product(second_start, second_end, first_end)
    third_side = _cross_product(first_start, first_end, second_start)
    fourth_side = _cross_product(first_start, first_end, second_end)
    return ((first_side > 0 and second_side < 0) or (first_side < 0 and second_side > 0)) and ((third_side > 0 and fourth_side < 0) or (third_side < 0 and fourth_side > 0))


def _line_crossed(track: Track, points: list[Any], frame_width: int, frame_height: int) -> bool:
    line = _normalize_points(points)
    if len(line) < 2:
        return False
    width = max(frame_width, 1)
    height = max(frame_height, 1)
    history: list[Point] = []
    for item in track.history[-8:]:
        try:
            history.append((float(item["x"]) / width, float(item["y"]) / height))
        except (KeyError, TypeError, ValueError):
            continue
    if not history:
        history.append((track.center[0] / width, track.center[1] / height))
    for index in range(1, len(history)):
        for segment_index in range(1, len(line)):
            if _segments_intersect(history[index - 1], history[index], line[segment_index - 1], line[segment_index]):
                return True
    center = history[-1]
    return any(_distance_to_segment(center, line[index - 1], line[index]) <= 0.02 for index in range(1, len(line)))


def in_entrance_zone(track: Track, zones: list[Any], frame_width: int = 0, frame_height: int = 0) -> bool:
    if not zones:
        return True
    width = max(frame_width, 1)
    height = max(frame_height, 1)
    center = (track.center[0] / width, track.center[1] / height)
    for zone in zones:
        if not getattr(zone, "enabled", True):
            continue
        filters = getattr(zone, "object_filters", None) or []
        if filters and "person" not in filters:
            continue
        zone_type = getattr(zone, "zone_type", "detection")
        points = getattr(zone, "points", []) or []
        if zone_type == "ignore":
            if point_in_polygon(center, points):
                return False
            continue
        if zone_type == "line":
            if _line_crossed(track, points, width, height):
                return True
            continue
        if point_in_polygon(center, points):
            return True
    return False


def _motion(track: Track) -> tuple[float, float]:
    history = track.history
    if len(history) < 2:
        return 0.0, 0.0
    recent = history[-1]
    older = history[max(0, len(history) - 12)]
    dx = recent["x"] - older["x"]
    dy = recent["y"] - older["y"]
    area_change = recent["area"] - older["area"]
    return dx, dy + area_change * 0.002


def rule_based_description(tracks: list[Track], bag_labels: list[str]) -> str:
    if len(tracks) > 1:
        return "Multiple people detected."
    if not tracks:
        return "No person currently detected."
    track = tracks[0]
    dx, motion = _motion(track)
    has_bag = bool(bag_labels)
    if motion > 18:
        return "Person approaching the main door."
    if motion < -18:
        return "Person walking away."
    if has_bag and abs(dx) < 45:
        return "Person delivering a parcel."
    if has_bag:
        return "Person carrying a package."
    if track.duration > 12:
        return "Person waiting outside."
    if track.duration > 3 and abs(motion) <= 18:
        return "Person standing near the entrance."
    if dx > 6:
        return "Person entering the property."
    if dx < -6:
        return "Person leaving the property."
    return "Person standing near the entrance."


async def describe_activity(tracks: list[Track], bag_labels: list[str], jpeg: bytes | None = None) -> str:
    fallback = rule_based_description(tracks, bag_labels)
    settings = get_settings()
    if not settings.activity_description_endpoint or jpeg is None:
        return fallback
    prompt = (
        "Describe the visible activity in this surveillance frame using exactly one of these sentences: "
        + " | ".join(ALLOWED_ACTIVITIES)
        + ". Return JSON with a single key 'description'."
    )
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                settings.activity_description_endpoint,
                json={
                    "model": settings.activity_description_model,
                    "prompt": prompt,
                    "stream": False,
                    "images": [base64.b64encode(jpeg).decode()],
                },
            )
        response.raise_for_status()
        content = response.text
        try:
            data = json.loads(content)
            candidate = str(data.get("description") or data.get("response") or "")
        except ValueError:
            candidate = content.strip().strip('"')
        for allowed in ALLOWED_ACTIVITIES:
            if allowed.rstrip(".").casefold() in candidate.casefold():
                return allowed
    except Exception:
        return fallback
    return fallback
