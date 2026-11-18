#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python3 -m venv "$root/backend/.venv"
"$root/backend/.venv/bin/pip" install -r "$root/backend/requirements.txt"
cp -n "$root/.env.example" "$root/.env" 2>/dev/null || true
echo "Backend dependencies installed. Set secrets in $root/.env before starting."
