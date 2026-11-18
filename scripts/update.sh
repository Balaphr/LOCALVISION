#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/backend/.venv/bin/pip" install -r "$root/backend/requirements.txt"
cd "$root/frontend" && npm install && npm run build
echo "LocalVision updated. Existing external CCTV services were not modified."
