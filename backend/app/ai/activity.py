import base64
import json
from typing import Any

import httpx

from ..config import get_settings
from ..ai.tracking import Track

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


def point_in_polygon(point: tuple[float, float], points: list[Any]) -> bool:
    if len(points) < 3:
        return False
    x, y = point
    inside = False
    index = 0
    previous = len(points) - 1
    while index < len(points):
        current = points[index]
        previous_point = points[previous]
        try:
            x1, y1 = float(current["x"]), float(current["y"])
            x2, y2 = float(previous_point["x"]), float(previous_point["y"])
        except (KeyError, TypeError, ValueError):
            index += 1
            previous = index - 1
            continue
        if ((y1 > y) != (y2 > y)) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = index
        index += 1
    return inside


def in_entrance_zone(track: Track, zones: list[Any]) -> bool:
    if not zones:
        center_x, center_y = track.center
        return 0.15 < center_x < 0.85 and center_y > 0.45 if center_x <= 1 and center_y <= 1 else True
    for zone in zones:
        if not getattr(zone, "enabled", True):
            continue
        if getattr(zone, "zone_type", "detection") in {"ignore", "restricted"} and getattr(zone, "zone_type", "") != "detection":
            continue
        filters = getattr(zone, "object_filters", None) or []
        if filters and "person" not in filters:
            continue
        if point_in_polygon(track.center, getattr(zone, "points", []) or []):
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
