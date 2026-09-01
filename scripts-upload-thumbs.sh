#!/usr/bin/env bash
# Upload the generated WebP variants (_thumb / _med) to the production server
# via /api/scenes/upload (Basic Auth). Companion to scripts-upload-scenes.sh,
# which pushes the full-resolution PNGs.
#
# Run scripts-gen-thumbs.mjs first so the local files exist.
#
#   bash scripts-upload-thumbs.sh            # all stories
#   bash scripts-upload-thumbs.sh 79 80 92   # only these story ids
#
# Idempotent: skips a file when the server already serves the exact same byte
# size, so re-running only pushes what is missing or changed.
set -uo pipefail

BASE="${BASE:-https://bearrytales.datainfo.cloud}"
AUTH="${AUTH:-duanganucha@hotmail.com:1669}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/public/scenes"

ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  ids=( $(ls "$ROOT" | sort -n) )
fi

total=0; uploaded=0; skipped=0; failed=0; bytes=0
for id in "${ids[@]}"; do
  dir="$ROOT/$id"
  [ -d "$dir" ] || continue
  for f in "$dir"/scene_*_thumb.webp "$dir"/scene_*_med.webp; do
    [ -f "$f" ] || continue
    fn="$(basename "$f")"
    total=$((total+1))
    lsize=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
    # A 404 returns an error page, so its size never matches the real file.
    ssize=$(curl -s -o /dev/null -w "%{size_download}" "$BASE/scenes/$id/$fn" 2>/dev/null)
    if [ "$lsize" = "$ssize" ]; then
      skipped=$((skipped+1)); continue
    fi
    ok=""
    for attempt in 1 2 3; do
      code=$(curl -s -o /tmp/up_thumb_resp.json -w "%{http_code}" -u "$AUTH" \
        -F "id=$id" -F "filename=$fn" -F "image=@$f;type=image/webp" \
        "$BASE/api/scenes/upload" 2>/dev/null)
      if [ "$code" = "200" ]; then ok=1; break; fi
      sleep 2
    done
    if [ -n "$ok" ]; then
      uploaded=$((uploaded+1)); bytes=$((bytes+lsize))
      printf "  ↑ %s/%s  %sKB\n" "$id" "$fn" "$((lsize/1024))"
    else
      failed=$((failed+1))
      printf "  ✗ FAILED %s/%s (http %s) %s\n" "$id" "$fn" "$code" "$(cat /tmp/up_thumb_resp.json 2>/dev/null)"
    fi
  done
done
echo "---"
printf "total=%s uploaded=%s skipped(same)=%s failed=%s  (%.1f MB sent)\n" \
  "$total" "$uploaded" "$skipped" "$failed" "$(echo "$bytes/1048576" | bc -l)"
