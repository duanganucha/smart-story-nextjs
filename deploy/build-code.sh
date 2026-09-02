#!/usr/bin/env bash
# สร้าง bundle เฉพาะโค้ด (~53 MB) สำหรับ deploy อัปเดตโค้ดอย่างเดียว
#
# ต่างจาก build-dist.sh: ตัวนั้นเตรียม dist/ เต็มรวม DB dump สำหรับติดตั้งครั้งแรก
# ตัวนี้ใช้ตอนแก้โค้ดแล้วอยากอัปขึ้น production เร็ว ๆ ไม่แตะ media/DB
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dist-code"
echo "==> 1/3 next build"
npm run build

echo "==> 2/3 ประกอบ $OUT/"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R .next/standalone/. "$OUT/"
mkdir -p "$OUT/.next"
cp -R .next/static "$OUT/.next/static"
cp deploy/ecosystem.config.js "$OUT/" 2>/dev/null || true

# ตัด media ออก — ไฟล์พวกนี้ใหญ่หลาย GB และ sync แยกต่างหาก
if [ -d "$OUT/public" ]; then
  rm -rf "$OUT/public/scenes" "$OUT/public/audio" \
         "$OUT/public/uploads" "$OUT/public/images" "$OUT/public/public" 2>/dev/null || true
fi

echo "==> 3/3 zip"
rm -f dist-code.zip
zip -qr dist-code.zip "$OUT"

du -sh "$OUT" dist-code.zip | sed 's/^/  /'
echo "เสร็จ → ทำต่อตาม deploy/guild_deploy.md"
