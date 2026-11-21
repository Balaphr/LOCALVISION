#!/usr/bin/env bash
set -euo pipefail
umask 077

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSTALL_DIR="${LOCALVISION_DIR:-/opt/localvision}"
PORT="${LOCALVISION_PORT:-8000}"
SERVICE_USER="${LOCALVISION_USER:-localvision}"
APP_DOMAIN="${LOCALVISION_APP_DOMAIN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
CORS="${LOCALVISION_CORS_ORIGINS:-}"
DOMAIN_EXPLICIT=0
USER_EXPLICIT=0
if [[ -n "$APP_DOMAIN" ]]; then DOMAIN_EXPLICIT=1; fi
if [[ -n "$ADMIN_USERNAME" ]]; then USER_EXPLICIT=1; fi

if [[ "$(id -u)" -ne 0 ]]; then
    printf 'Run this script as root: sudo bash %s\n' "${BASH_SOURCE[0]}" >&2
    exit 1
fi
if [[ -z "$APP_DOMAIN" ]]; then
    APP_DOMAIN="localhost"
fi
if [[ -z "$CORS" ]]; then
    CORS="https://${APP_DOMAIN}"
fi
if [[ -z "$ADMIN_USERNAME" ]]; then
    ADMIN_USERNAME="admin"
fi
if [[ "$SOURCE_ROOT/" == "$INSTALL_DIR/"* ]]; then
    printf 'Source checkout cannot be inside %s.\n' "$INSTALL_DIR" >&2
    exit 1
fi
if [[ ! -f "$SOURCE_ROOT/backend/app/main.py" || ! -f "$SOURCE_ROOT/frontend/package.json" ]]; then
    printf 'Run this script from a LocalVision checkout.\n' >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip python3-dev build-essential \
    openssl curl ca-certificates ffmpeg git

if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)'; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y --no-install-recommends nodejs
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

if [[ -L "$INSTALL_DIR" ]]; then
    printf 'Install directory is a symlink; refusing to write: %s\n' "$INSTALL_DIR" >&2
    exit 1
fi
mkdir -p "$INSTALL_DIR"
install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$INSTALL_DIR/backend/storage"

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
    -cf - . | tar -C "$INSTALL_DIR" -xf -

BACKEND_DIR="$INSTALL_DIR/backend"
FRONTEND_DIR="$INSTALL_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"
CACHE_DIR="$INSTALL_DIR/.cache"
mkdir -p "$CACHE_DIR/pip" "$CACHE_DIR/npm" "$CACHE_DIR/tmp"
export PIP_CACHE_DIR="$CACHE_DIR/pip"
export npm_config_cache="$CACHE_DIR/npm"
export npm_config_update_notifier=false
export npm_config_audit=false
export npm_config_fund=false
export TMPDIR="$CACHE_DIR/tmp"

generated_password=""
if [[ ! -f "$ENV_FILE" ]]; then
    secret_key="$(openssl rand -hex 32)"
    encryption_key="$(openssl rand -hex 32)"
    if [[ -z "$ADMIN_PASSWORD" ]]; then
        ADMIN_PASSWORD="$(openssl rand -hex 24)"
        generated_password="$ADMIN_PASSWORD"
    fi
    cat > "$ENV_FILE" <<EOF
ENVIRONMENT=production
DATABASE_URL=sqlite+aiosqlite:///./localvision.db
SECRET_KEY=${secret_key}
ENCRYPTION_KEY=${encryption_key}
COOKIE_SECURE=true
CORS_ORIGINS=${CORS}
STORAGE_PATH=storage
SESSION_HOURS=24
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALLOW_GUEST_MODE=false
SURVEILLANCE_WORKER_ENABLED=true
EOF
fi

set_env() {
    local key="$1" value="$2" file="$3"
    if grep -Eq "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

set_env ENVIRONMENT production "$ENV_FILE"
set_env DATABASE_URL 'sqlite+aiosqlite:///./localvision.db' "$ENV_FILE"
set_env STORAGE_PATH storage "$ENV_FILE"
set_env COOKIE_SECURE true "$ENV_FILE"
if [[ "$DOMAIN_EXPLICIT" -eq 1 || -n "${LOCALVISION_CORS_ORIGINS:-}" ]]; then
    set_env CORS_ORIGINS "$CORS" "$ENV_FILE"
fi
if [[ "$USER_EXPLICIT" -eq 1 ]]; then
    set_env ADMIN_USERNAME "$ADMIN_USERNAME" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

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

sed -e "s|/opt/localvision|${INSTALL_DIR}|g" \
    -e "s|--port 8000|--port ${PORT}|g" \
    "$SOURCE_ROOT/systemd/localvision-api.service.example" \
    > /etc/systemd/system/localvision-api.service

if [[ -n "$TUNNEL_TOKEN" ]]; then
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64) arch=amd64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) printf 'Unsupported architecture: %s\n' "$arch" >&2; exit 1 ;;
    esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" \
        -o /usr/local/bin/cloudflared
    chmod 755 /usr/local/bin/cloudflared
    install -d -m 700 /etc/localvision
    printf 'TUNNEL_TOKEN=%s\n' "$TUNNEL_TOKEN" > /etc/localvision/cloudflared.env
    chmod 600 /etc/localvision/cloudflared.env
    install -m 644 "$SOURCE_ROOT/systemd/localvision-cloudflared.service.example" \
        /etc/systemd/system/localvision-cloudflared.service
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$ENV_FILE"

systemctl daemon-reload
systemctl enable --now localvision-api
if [[ -n "$TUNNEL_TOKEN" ]]; then
    systemctl enable --now localvision-cloudflared
fi

for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null

printf '\nLocalVision deployed to %s\n' "$INSTALL_DIR"
printf 'API port: %s\n' "$PORT"
if [[ -n "$generated_password" ]]; then
    printf 'Initial admin username: %s\n' "$ADMIN_USERNAME"
    printf 'Initial admin password (shown only once): %s\n' "$generated_password"
fi
printf 'Open https://%s and sign in.\n' "$APP_DOMAIN"
printf 'Logs: journalctl -u localvision-api -f\n'
