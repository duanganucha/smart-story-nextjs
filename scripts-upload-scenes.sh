#!/usr/bin/env bash
# Upload full-resolution scene images to the production server via the
# /api/scenes/upload endpoint (Basic Auth). Idempotent: skips a file when the
# server already serves a copy of the exact same byte size.
#
#   bash scripts-upload-scenes.sh            # all stories
#   bash scripts-upload-scenes.sh 79 80 92   # only these story ids
set -uo pipefail

BASE="https://bearrytales.datainfo.cloud"
AUTH='duanganucha@hotmail.com:1669'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/public/scenes"

ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  ids=( $(ls "$ROOT" | sort -n) )
fi

total=0; uploaded=0; skipped=0; failed=0
for id in "${ids[@]}"; do
  dir="$ROOT/$id"
  [ -d "$dir" ] || continue
  for f in "$dir"/scene_*.png; do
    [ -f "$f" ] || continue
    fn="$(basename "$f")"
    total=$((total+1))
    lsize=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
    ssize=$(curl -s -o /dev/null -w "%{size_download}" "$BASE/scenes/$id/$fn" 2>/dev/null)
    if [ "$lsize" = "$ssize" ]; then
      skipped=$((skipped+1)); continue
    fi
    ok=""
    for attempt in 1 2 3; do
      code=$(curl -s -o /tmp/up_resp.json -w "%{http_code}" -u "$AUTH" \
        -F "id=$id" -F "filename=$fn" -F "image=@$f;type=image/png" \
        "$BASE/api/scenes/upload" 2>/dev/null)
      if [ "$code" = "200" ]; then ok=1; break; fi
      sleep 2
    done
    if [ -n "$ok" ]; then
      uploaded=$((uploaded+1))
      printf "  ↑ %s/%s  %sKB -> %sKB\n" "$id" "$fn" "$((ssize/1024))" "$((lsize/1024))"
    else
      failed=$((failed+1))
      printf "  ✗ FAILED %s/%s (http %s) %s\n" "$id" "$fn" "$code" "$(cat /tmp/up_resp.json 2>/dev/null)"
    fi
  done
done
echo "---"
echo "total=$total uploaded=$uploaded skipped(same)=$skipped failed=$failed"
