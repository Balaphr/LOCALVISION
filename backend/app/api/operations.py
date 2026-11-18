from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models.operations import Event, Recording
from ..auth.rbac import require_minimum_role
from ..models.auth import User

router = APIRouter(tags=["operations"])


def recording_json(recording: Recording) -> dict[str, object]:
    return {"id": recording.id, "camera_id": recording.camera_id, "path": recording.path, "started_at": recording.started_at, "ended_at": recording.ended_at, "duration_seconds": recording.duration_seconds, "size_bytes": recording.size_bytes, "kind": recording.kind, "status": recording.status}


def event_json(event: Event) -> dict[str, object]:
    return {"id": event.id, "camera_id": event.camera_id, "kind": event.kind, "object_name": event.object_name, "confidence": event.confidence, "occurred_at": event.occurred_at, "snapshot_path": event.snapshot_path, "recording_id": event.recording_id, "bounding_box": event.bounding_box, "duration_seconds": event.duration_seconds}


@router.get("/api/recordings")
async def recordings(_: User = Depends(require_minimum_role("viewer")), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), camera_id: int | None = None, date: str | None = None, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    query = select(Recording).order_by(Recording.started_at.desc()).offset((page - 1) * page_size).limit(page_size)
    if camera_id is not None: query = query.where(Recording.camera_id == camera_id)
    if date: query = query.where(Recording.started_at >= datetime.fromisoformat(date))
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
    path = Path(recording.path).resolve()
    if not path.is_file(): raise HTTPException(status_code=404, detail="Recording file not found")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@router.delete("/api/recordings/{recording_id}", status_code=204)
async def delete_recording(recording_id: int, _: User = Depends(require_minimum_role("operator")), db: AsyncSession = Depends(get_db)) -> None:
    recording = await db.get(Recording, recording_id)
    if not recording: raise HTTPException(status_code=404, detail="Recording not found")
    path = Path(recording.path)
    if path.is_file(): path.unlink()
    await db.delete(recording); await db.commit()


@router.get("/api/events")
async def events(_: User = Depends(require_minimum_role("viewer")), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), camera_id: int | None = None, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    query = select(Event).order_by(Event.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)
    if camera_id is not None: query = query.where(Event.camera_id == camera_id)
    result = await db.execute(query)
    return {"items": [event_json(event) for event in result.scalars()], "page": page, "page_size": page_size}


@router.get("/api/detections")
async def detections(_: User = Depends(require_minimum_role("viewer")), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await db.execute(select(Event).where(Event.object_name.is_not(None)).order_by(Event.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [event_json(event) for event in result.scalars()], "page": page, "page_size": page_size}
