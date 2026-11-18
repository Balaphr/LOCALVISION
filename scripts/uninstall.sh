#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$root/backend/.venv" "$root/frontend/node_modules" "$root/frontend/dist"
echo "LocalVision development dependencies removed. Configuration and recordings were preserved."
