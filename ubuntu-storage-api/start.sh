#!/usr/bin/env bash
set -euo pipefail
if [ -z "${STORAGE_API_KEY:-}" ]; then
  echo "STORAGE_API_KEY is required" >&2
  exit 1
fi
export STORAGE_ROOT="${STORAGE_ROOT:-/var/lib/localvision/storage}"
export STORAGE_HOST="${STORAGE_HOST:-127.0.0.1}"
export STORAGE_PORT="${STORAGE_PORT:-8090}"
exec python3 "$(dirname "$0")/server.py"
