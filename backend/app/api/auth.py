from datetime import datetime, timedelta, timezone
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.schemas import LoginRequest, LoginResponse, UserRead
from ..auth.security import verify_password
from ..config import get_settings
from ..database import get_db
from ..models.auth import Session, User
from ..services.audit import write_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    user = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    token = secrets.token_urlsafe(48)
    session = Session(id=token, user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=get_settings().session_hours))
    db.add(session)
    await write_audit(db, request, user, "login", "session")
    await db.commit()
    cookie_options = {"httponly": True, "secure": get_settings().secure_cookies, "samesite": "lax"}
    if payload.remember_me:
        cookie_options["max_age"] = get_settings().session_hours * 3600
    response.set_cookie("localvision_session", token, **cookie_options)
    return LoginResponse(user=UserRead.model_validate(user, from_attributes=True))


@router.post("/guest", response_model=LoginResponse)
async def guest_login(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    if not get_settings().allow_guest_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guest mode is disabled")
    user = (await db.execute(select(User).where(User.username == "guest"))).scalar_one_or_none()
    if not user:
        user = User(username="guest", password_hash="guest-session", role="viewer")
        db.add(user)
        await db.flush()
    token = secrets.token_urlsafe(48)
    db.add(Session(id=token, user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    await write_audit(db, request, user, "guest_login", "session")
    await db.commit()
    response.set_cookie("localvision_session", token, httponly=True, secure=get_settings().secure_cookies, samesite="lax", max_age=3600)
    return LoginResponse(user=UserRead.model_validate(user, from_attributes=True))


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get("localvision_session")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = await db.get(Session, token)
    expires_at = session.expires_at.replace(tzinfo=timezone.utc) if session and session.expires_at.tzinfo is None else session.expires_at if session else None
    if not session or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.get(User, session.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    token = request.cookies.get("localvision_session")
    if token:
        session = await db.get(Session, token)
        if session:
            user = await db.get(User, session.user_id)
            await write_audit(db, request, user, "logout", "session")
            await db.delete(session)
            await db.commit()
    response.delete_cookie("localvision_session")


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(current_user)) -> User:
    return user
