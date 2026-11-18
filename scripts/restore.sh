#!/usr/bin/env bash
set -euo pipefail
backup_dir="${1:?Usage: restore.sh <backup-directory>}"
[ -f "$backup_dir/.env" ] && cp "$backup_dir/.env" .env
[ -f "$backup_dir/localvision.db" ] && cp "$backup_dir/localvision.db" backend/localvision.db
echo "Configuration restore complete. Recordings were not restored."
