#!/usr/bin/env bash
set -euo pipefail
umask 077

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TARGET_PARENT="${LOCALVISION_TARGET_PARENT:-/media/manoranjitham/Admin2}"
TARGET_ROOT="${TARGET_PARENT%/}/LocalVision"

for command_name in python3 node npm openssl tar mountpoint realpath ffmpeg; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'Missing prerequisite: %s\n' "$command_name" >&2
        exit 1
    fi
done

python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || {
    echo "Python 3.11 or newer is required." >&2
    exit 1
}
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)' || {
    echo "Node.js 20.19+ or 22.12+ is required." >&2
    exit 1
}

unset APP_NAME VERSION ENVIRONMENT DATABASE_URL SECRET_KEY ENCRYPTION_KEY COOKIE_SECURE CORS_ORIGINS
unset STORAGE_PATH SESSION_HOURS FFMPEG_BIN WEBRTC_GATEWAY_URL MEDIA_UDP_HOST
unset MEDIA_UDP_PORT_START RECORDING_SEGMENT_SECONDS RETENTION_DAYS LOW_STORAGE_PERCENT
unset ONVIF_DISCOVERY_ENABLED ADMIN_USERNAME ADMIN_PASSWORD ALLOW_GUEST_MODE PYTHONPATH PYTHONHOME

if [[ ! -d "$TARGET_PARENT" ]] || ! mountpoint -q "$TARGET_PARENT"; then
    printf 'Expected mounted deployment volume at %s; refusing to write.\n' "$TARGET_PARENT" >&2
    exit 1
fi

TARGET_PARENT="$(realpath "$TARGET_PARENT")"
TARGET_ROOT="${TARGET_PARENT}/LocalVision"
if [[ ! -f "$SOURCE_ROOT/frontend/package.json" || ! -f "$SOURCE_ROOT/backend/app/main.py" ]]; then
    echo "Run this script from a LocalVision project checkout." >&2
    exit 1
fi
if [[ "$SOURCE_ROOT" != "$TARGET_ROOT" && "$TARGET_ROOT/" == "$SOURCE_ROOT/"* ]]; then
    echo "The target cannot be inside the source checkout; choose a separate source folder." >&2
    exit 1
fi

mkdir -p "$TARGET_ROOT"
if [[ -L "$TARGET_ROOT" ]]; then
    printf 'Target directory is a symlink; refusing to write: %s\n' "$TARGET_ROOT" >&2
    exit 1
fi
if [[ -d "$TARGET_ROOT" ]] && find "$TARGET_ROOT" \
    \( -path "$TARGET_ROOT/backend/.venv" -o -path "$TARGET_ROOT/backend/storage" \
       -o -path "$TARGET_ROOT/frontend/node_modules" -o -path "$TARGET_ROOT/frontend/dist" \
       -o -path "$TARGET_ROOT/.cache" \) -prune -o -type l -print -quit | grep -q .; then
    printf 'Target contains a source-path symlink; refusing to write: %s\n' "$TARGET_ROOT" >&2
    exit 1
fi
if [[ "$SOURCE_ROOT" != "$TARGET_ROOT" ]]; then
    tar -C "$SOURCE_ROOT" \
        --exclude='./.git' \
        --exclude='./.env' \
        --exclude='./.cache' \
        --exclude='*/.env' \
        --exclude='*/.venv' \
        --exclude='*/node_modules' \
        --exclude='*/dist' \
        --exclude='./backend/storage' \
        --exclude='./backend/logs' \
        --exclude='*.db' \
        --exclude='__pycache__' \
        --exclude='.pytest_cache' \
        -cf - . | tar -C "$TARGET_ROOT" -xf -
fi

BACKEND_DIR="$TARGET_ROOT/backend"
FRONTEND_DIR="$TARGET_ROOT/frontend"
CACHE_DIR="$TARGET_ROOT/.cache"
ENV_FILE="$BACKEND_DIR/.env"
mkdir -p "$CACHE_DIR/pip" "$CACHE_DIR/npm" "$CACHE_DIR/tmp"
export PIP_CACHE_DIR="$CACHE_DIR/pip"
export npm_config_cache="$CACHE_DIR/npm"
export npm_config_update_notifier=false
export npm_config_audit=false
export npm_config_fund=false
export TMPDIR="$CACHE_DIR/tmp"

if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$BACKEND_DIR/localvision.db" ]]; then
        echo "A database exists but backend/.env does not. Create the env file manually to preserve the existing admin credentials." >&2
        exit 1
    fi
    secret_key="$(openssl rand -hex 32)"
    encryption_key="$(openssl rand -hex 32)"
    admin_password="$(openssl rand -hex 24)"
    cat > "$ENV_FILE" <<EOF
ENVIRONMENT=production
DATABASE_URL=sqlite+aiosqlite:///./localvision.db
SECRET_KEY=${secret_key}
ENCRYPTION_KEY=${encryption_key}
COOKIE_SECURE=false
CORS_ORIGINS=http://192.168.1.25:8082
STORAGE_PATH=storage
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin_password}
ALLOW_GUEST_MODE=false
EOF
    chmod 600 "$ENV_FILE"
    printf 'Created project-local backend/.env.\nInitial admin username: admin\nInitial admin password (shown only once): %s\n' "$admin_password"
else
    chmod 600 "$ENV_FILE"
    for required_key in ENVIRONMENT DATABASE_URL SECRET_KEY ENCRYPTION_KEY COOKIE_SECURE STORAGE_PATH ADMIN_USERNAME ADMIN_PASSWORD; do
        if ! grep -Eq "^${required_key}=.+" "$ENV_FILE"; then
            printf 'Set a non-empty %s in %s, then rerun this script.\n' "$required_key" "$ENV_FILE" >&2
            exit 1
        fi
    done
    if ! grep -qx 'ENVIRONMENT=production' "$ENV_FILE"; then
        printf 'Set ENVIRONMENT=production in %s.\n' "$ENV_FILE" >&2
        exit 1
    fi
    if ! grep -qx 'COOKIE_SECURE=false' "$ENV_FILE"; then
        printf 'For the selected HTTP LAN deployment, set COOKIE_SECURE=false in %s.\n' "$ENV_FILE" >&2
        exit 1
    fi
    if ! grep -qx 'DATABASE_URL=sqlite+aiosqlite:///./localvision.db' "$ENV_FILE" ||
       ! grep -qx 'STORAGE_PATH=storage' "$ENV_FILE"; then
        printf 'Keep DATABASE_URL=sqlite+aiosqlite:///./localvision.db and STORAGE_PATH=storage in %s so data stays inside the project.\n' "$ENV_FILE" >&2
        exit 1
    fi
fi

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    python3 -m venv "$BACKEND_DIR/.venv"
fi
"$BACKEND_DIR/.venv/bin/python" -m pip install --disable-pip-version-check \
    --cache-dir "$CACHE_DIR/pip" -r "$BACKEND_DIR/requirements.txt"

(
    cd "$FRONTEND_DIR"
    npm ci --cache "$CACHE_DIR/npm" --no-audit --no-fund
    npm run build
)

(
    cd "$BACKEND_DIR"
    .venv/bin/alembic upgrade head
)

printf '\nDeployment prepared in %s\n' "$TARGET_ROOT"
printf 'Start LocalVision with: bash "%s/scripts/run-ubuntu.sh"\n' "$TARGET_ROOT"
