from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.permissions import normalize_permissions
from ..auth.rbac import require_permission
from ..auth.schemas import UserCreate, UserRecord, UserUpdate
from ..auth.security import hash_password
from ..database import get_db
from ..models.auth import Session, User
from ..models.sharing import CameraShare
from ..services.audit import write_audit

router = APIRouter(prefix="/api/users", tags=["users"])


async def active_admin_count(db: AsyncSession, excluded_id: int | None = None) -> int:
    statement = select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
    if excluded_id is not None:
        statement = statement.where(User.id != excluded_id)
    return int((await db.execute(statement)).scalar_one())


@router.get("", response_model=list[UserRecord])
async def list_users(_: User = Depends(require_permission("users.manage")), db: AsyncSession = Depends(get_db)) -> list[User]:
    return list((await db.execute(select(User).order_by(User.id))).scalars())


@router.post("", response_model=UserRecord, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, request: Request, admin: User = Depends(require_permission("users.manage")), db: AsyncSession = Depends(get_db)) -> User:
    if (await db.execute(select(User.id).where(User.username == payload.username))).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        permissions=normalize_permissions(payload.permissions, payload.role),
        is_active=payload.is_active,
    )
    db.add(user)
    await write_audit(db, request, admin, "user.created", payload.username)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRecord)
async def update_user(user_id: int, payload: UserUpdate, request: Request, admin: User = Depends(require_permission("users.manage")), db: AsyncSession = Depends(get_db)) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    new_role = payload.role or user.role
    new_active = payload.is_active if payload.is_active is not None else user.is_active
    if user.id == admin.id and (new_role != "admin" or not new_active):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot demote or disable your own admin account")
    if user.role == "admin" and user.is_active and (new_role != "admin" or not new_active):
        if await active_admin_count(db, excluded_id=user.id) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one active admin is required")
    if payload.username and payload.username != user.username:
        if (await db.execute(select(User.id).where(User.username == payload.username))).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
        user.username = payload.username
    if payload.password:
        user.password_hash = hash_password(payload.password)
    user.role = new_role
    user.is_active = new_active
    if payload.permissions is not None or payload.role is not None:
        user.permissions = normalize_permissions(payload.permissions if payload.permissions is not None else user.permissions, new_role)
    if not new_active:
        await db.execute(delete(Session).where(Session.user_id == user.id))
    await write_audit(db, request, admin, "user.updated", user.username)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, request: Request, admin: User = Depends(require_permission("users.manage")), db: AsyncSession = Depends(get_db)) -> None:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")
    if user.role == "admin" and user.is_active and await active_admin_count(db, excluded_id=user.id) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one active admin is required")
    await db.execute(delete(Session).where(Session.user_id == user.id))
    await db.execute(delete(CameraShare).where(CameraShare.user_id == user.id))
    await write_audit(db, request, admin, "user.deleted", user.username)
    await db.delete(user)
    await db.commit()


@router.post("/{user_id}/sessions/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_sessions(user_id: int, request: Request, admin: User = Depends(require_permission("users.manage")), db: AsyncSession = Depends(get_db)) -> None:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.execute(delete(Session).where(Session.user_id == user.id))
    await write_audit(db, request, admin, "user.sessions_revoked", user.username)
    await db.commit()
