from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..api.auth import current_user
from ..auth.schemas import UserCreate
from ..auth.rbac import require_minimum_role
from ..auth.security import hash_password
from ..database import get_db
from ..models.auth import User

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(_: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    users = (await db.execute(select(User).order_by(User.username))).scalars()
    return [{"id": user.id, "username": user.username, "role": user.role} for user in users]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _: User = Depends(require_minimum_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    if (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    if payload.role not in ("viewer", "operator", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    await db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    _: User = Depends(require_minimum_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == "admin":
        admin_count = (await db.execute(select(User).where(User.role == "admin"))).scalars().all()
        if len(admin_count) <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete the last admin")
    await db.delete(user)
    await db.commit()
