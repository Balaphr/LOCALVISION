import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from .api import alerts, audit, auth, cameras, integrations, media, monitoring, operations, realtime, settings as settings_api, sharing, storage, surveillance, system, users, zones
from .config import get_settings
from .database import Base, SessionLocal, engine
from .models import Camera, Role, Session, User  # noqa: F401
from .services.schema import ensure_surveillance_columns
from .services.storage import LocalStorage
from .services.surveillance import surveillance_worker
from .auth.security import hash_password
from sqlalchemy import select

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("localvision")
settings = get_settings()
rate_windows: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    LocalStorage().prepare()
    await ensure_surveillance_columns(engine)
    if settings.surveillance_worker_enabled:
        await surveillance_worker.start()
    if settings.admin_username and settings.admin_password:
        from .models.auth import User
        async with SessionLocal() as session:
            existing = (await session.execute(select(User).where(User.username == settings.admin_username))).scalar_one_or_none()
            if not existing:
                session.add(User(username=settings.admin_username, password_hash=hash_password(settings.admin_password), role="admin"))
                await session.commit()
    yield
    await surveillance_worker.stop()
    await engine.dispose()


app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.url.path.endswith("/login"):
        now = time.monotonic()
        forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        key = forwarded or (request.client.host if request.client else "unknown")
        window = rate_windows[key]
        while window and now - window[0] > 60: window.popleft()
        if len(window) >= 60:
            return JSONResponse(status_code=429, content={"detail": "Too many login attempts"})
        window.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(system.router)
app.include_router(monitoring.router)
app.include_router(cameras.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(operations.router)
app.include_router(integrations.router)
app.include_router(settings_api.router)
app.include_router(media.router)
app.include_router(realtime.router)
app.include_router(zones.router)
app.include_router(audit.router)
app.include_router(alerts.router)
app.include_router(sharing.router)
app.include_router(storage.router)
app.include_router(surveillance.router)

if settings.environment == "production":
    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if not (frontend_dist / "index.html").is_file():
        raise RuntimeError(f"Production frontend build not found: {frontend_dist}")
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
