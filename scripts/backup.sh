#!/usr/bin/env bash
set -euo pipefail
backup_dir="${1:-backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$backup_dir"
cp -n .env "$backup_dir/.env" 2>/dev/null || true
[ -f backend/localvision.db ] && cp backend/localvision.db "$backup_dir/localvision.db" || true
echo "Configuration backup written to $backup_dir"
