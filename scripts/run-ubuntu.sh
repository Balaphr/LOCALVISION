#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HOST="${LOCALVISION_HOST:-192.168.1.25}"
PORT="${LOCALVISION_PORT:-8082}"
BACKEND_DIR="$PROJECT_ROOT/backend"

unset APP_NAME VERSION ENVIRONMENT DATABASE_URL SECRET_KEY ENCRYPTION_KEY COOKIE_SECURE CORS_ORIGINS
unset STORAGE_PATH SESSION_HOURS FFMPEG_BIN WEBRTC_GATEWAY_URL MEDIA_UDP_HOST
unset MEDIA_UDP_PORT_START RECORDING_SEGMENT_SECONDS RETENTION_DAYS LOW_STORAGE_PERCENT
unset ONVIF_DISCOVERY_ENABLED ADMIN_USERNAME ADMIN_PASSWORD ALLOW_GUEST_MODE PYTHONPATH PYTHONHOME

if [[ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
    echo "Deployment dependencies are missing; run scripts/deploy-ubuntu.sh first." >&2
    exit 1
fi
if [[ ! -f "$PROJECT_ROOT/frontend/dist/index.html" ]]; then
    echo "Frontend build is missing; run scripts/deploy-ubuntu.sh first." >&2
    exit 1
fi
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    echo "Missing project-local backend/.env; run scripts/deploy-ubuntu.sh first." >&2
    exit 1
fi
if ! grep -qx 'ENVIRONMENT=production' "$BACKEND_DIR/.env" ||
   ! grep -qx 'COOKIE_SECURE=false' "$BACKEND_DIR/.env"; then
    echo "For this HTTP LAN deployment, backend/.env must contain ENVIRONMENT=production and COOKIE_SECURE=false." >&2
    exit 1
fi
if ! grep -qx 'DATABASE_URL=sqlite+aiosqlite:///./localvision.db' "$BACKEND_DIR/.env" ||
   ! grep -qx 'STORAGE_PATH=storage' "$BACKEND_DIR/.env"; then
    echo "Keep the database and storage paths project-local in backend/.env." >&2
    exit 1
fi
if ! command -v ss >/dev/null 2>&1; then
    echo "Missing prerequisite: ss (from iproute2)." >&2
    exit 1
fi
if ss -H -ltn "sport = :${PORT}" | grep -q .; then
    printf 'Port %s is already in use. No existing process was stopped.\n' "$PORT" >&2
    exit 1
fi

cd "$BACKEND_DIR"
exec .venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT"
