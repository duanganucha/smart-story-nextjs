#!/usr/bin/env bash
#
# db-export.sh — dump the local smart_story_ai database to a .sql file.
# Usage: bash deploy/db-export.sh [out_dir]
#
set -euo pipefail
OUT_DIR="${1:-./dist/db}"
mkdir -p "$OUT_DIR"

DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-12345678}"
DB_NAME="${DB_NAME:-smart_story_ai}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"

# find mysqldump (native macOS MySQL install path, or PATH)
DUMP="$(command -v mysqldump || true)"
[ -z "$DUMP" ] && [ -x /usr/local/mysql/bin/mysqldump ] && DUMP=/usr/local/mysql/bin/mysqldump
[ -z "$DUMP" ] && { echo "mysqldump not found"; exit 1; }

echo "==> Dumping $DB_NAME -> $OUT_DIR/smart_story_ai.sql"
"$DUMP" \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASSWORD" \
  --default-character-set=utf8mb4 \
  --single-transaction --routines --triggers --events \
  --add-drop-table --databases "$DB_NAME" \
  > "$OUT_DIR/smart_story_ai.sql"

echo "==> Wrote $(du -sh "$OUT_DIR/smart_story_ai.sql" | cut -f1)"
