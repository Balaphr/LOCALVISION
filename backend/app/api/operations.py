from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models.operations import Event, Recording
from ..services.storage import LocalStorage
from ..auth.rbac import require_minimum_role
from ..models.auth import User

router = APIRouter(tags=["operations"])


def parse_datetime(value: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"Invalid {field} timestamp") from error


def recording_json(recording: Recording) -> dict[str, object]:
    return {"id": recording.id, "camera_id": recording.camera_id, "path": recording.path, "started_at": recording.started_at, "ended_at": recording.ended_at, "duration_seconds": recording.duration_seconds, "size_bytes": recording.size_bytes, "kind": recording.kind, "status": recording.status}


def event_json(event: Event) -> dict[str, object]:
    snapshot_url = f"/api/media/file/{event.snapshot_path}" if event.snapshot_path else None
    clip_url = f"/api/media/file/{event.clip_path}" if event.clip_path else None
    return {"id": event.id, "camera_id": event.camera_id, "kind": event.kind, "object_name": event.object_name, "confidence": event.confidence, "occurred_at": event.occurred_at, "snapshot_path": event.snapshot_path, "snapshot_url": snapshot_url, "clip_path": event.clip_path, "clip_url": clip_url, "recording_id": event.recording_id, "bounding_box": event.bounding_box, "duration_seconds": event.duration_seconds, "description": event.description, "track_id": event.track_id}


@router.get("/api/recordings")
async def recordings(_: User = Depends(require_minimum_role("viewer")), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), camera_id: int | None = None, date: str | None = None, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    query = select(Recording).order_by(Recording.started_at.desc()).offset((page - 1) * page_size).limit(page_size)
    if camera_id is not None: query = query.where(Recording.camera_id == camera_id)
    if date: query = query.where(Recording.started_at >= parse_datetime(date, "date"))
    result = await db.execute(query)
    return {"items": [recording_json(recording) for recording in result.scalars()], "page": page, "page_size": page_size}


@router.get("/api/cameras/{camera_id}/recordings")
async def camera_recordings(camera_id: int, _: User = Depends(require_minimum_role("viewer")), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await db.execute(select(Recording).where(Recording.camera_id == camera_id).order_by(Recording.started_at.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [recording_json(recording) for recording in result.scalars()], "page": page, "page_size": page_size}


@router.get("/api/recordings/{recording_id}/file")
async def recording_file(recording_id: int, _: User = Depends(require_minimum_role("viewer")), db: AsyncSession = Depends(get_db)) -> FileResponse:
    recording = await db.get(Recording, recording_id)
    if not recording: raise HTTPException(status_code=404, detail="Recording not found")
    path = (LocalStorage().root / recording.path).resolve()
    if not path.is_relative_to(LocalStorage().root.resolve()) or not path.is_file(): raise HTTPException(status_code=404, detail="Recording file not found")
    return FileResponse(path, media_type="video/mp4", content_disposition_type="inline")


@router.delete("/api/recordings/{recording_id}", status_code=204)
async def delete_recording(recording_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    recording = await db.get(Recording, recording_id)
    if not recording: raise HTTPException(status_code=404, detail="Recording not found")
    path = (LocalStorage().root / recording.path).resolve()
    if path.is_relative_to(LocalStorage().root.resolve()) and path.is_file(): path.unlink()
    await db.delete(recording); await db.commit()


def _filtered_events(
    page: int,
    page_size: int,
    camera_id: int | None,
    search: str | None,
    object_name: str | None,
    kind: str | None,
    start: str | None,
    end: str | None,
    min_confidence: float | None,
) -> object:
    query = select(Event).order_by(Event.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)
    if camera_id is not None:
        query = query.where(Event.camera_id == camera_id)
    if search:
        pattern = f"%{search}%"
        query = query.where(Event.description.ilike(pattern) | Event.kind.ilike(pattern) | Event.object_name.ilike(pattern))
    if object_name:
        query = query.where(Event.object_name.ilike(f"%{object_name}%"))
    if kind:
        query = query.where(Event.kind.ilike(f"%{kind}%"))
    if start:
        query = query.where(Event.occurred_at >= parse_datetime(start, "start"))
    if end:
        query = query.where(Event.occurred_at <= parse_datetime(end, "end"))
    if min_confidence is not None:
        query = query.where(Event.confidence >= min_confidence)
    return query


@router.get("/api/events")
async def events(
    _: User = Depends(require_minimum_role("viewer")),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    camera_id: int | None = None,
    search: str | None = None,
    object_name: str | None = None,
    kind: str | None = None,
    start: str | None = None,
    end: str | None = None,
    min_confidence: float | None = Query(None, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    query = _filtered_events(page, page_size, camera_id, search, object_name, kind, start, end, min_confidence)
    result = await db.execute(query)
    return {"items": [event_json(event) for event in result.scalars()], "page": page, "page_size": page_size}


@router.get("/api/detections")
async def detections(
    _: User = Depends(require_minimum_role("viewer")),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    camera_id: int | None = None,
    search: str | None = None,
    object_name: str | None = None,
    kind: str | None = None,
    start: str | None = None,
    end: str | None = None,
    min_confidence: float | None = Query(None, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    query = _filtered_events(page, page_size, camera_id, search, object_name, kind, start, end, min_confidence)
    query = query.where(Event.object_name.is_not(None))
    result = await db.execute(query)
    return {"items": [event_json(event) for event in result.scalars()], "page": page, "page_size": page_size}
