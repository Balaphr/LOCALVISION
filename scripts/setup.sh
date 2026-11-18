#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/storage" "$root/logs"
cp -n "$root/.env.example" "$root/.env" 2>/dev/null || true
echo "LocalVision directories and environment template are ready."
