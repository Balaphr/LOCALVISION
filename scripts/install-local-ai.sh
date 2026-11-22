#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
install -m 0644 "$ROOT/bridge/server.mjs" /opt/localvision-media-bridge/server.mjs
install -m 0644 "$ROOT/ubuntu-storage-api/main.py" /opt/localvision-storage/app/main.py
/opt/localvision-storage/venv/bin/pip install -r "$ROOT/ubuntu-storage-api/requirements.txt"
systemctl restart localvision-storage.service
systemctl restart localvision-media-bridge.service
