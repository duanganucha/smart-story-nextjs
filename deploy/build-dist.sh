#!/usr/bin/env bash
#
# build-dist.sh — Build a self-contained "dist/" folder to copy to the
# production Windows server and run under PM2.
#
# Run this on the BUILD machine (mac), from the project root:
#     bash deploy/build-dist.sh
#
# Produces ./dist/ containing:
#   server.js + node_modules  (Next.js standalone)
#   .next/static              (client assets)
#   public/                   (story audio + images served at /)
#   ecosystem.config.js       (PM2 app definition)
#   .env.production.example   (fill in on the server -> .env.production)
#   setup-windows.ps1         (run on the Windows server)
#   db/smart_story_ai.sql     (database dump, if mysqldump succeeds)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DIST="$ROOT/dist"

echo "==> 1/5 Clean dist/"
rm -rf "$DIST"
mkdir -p "$DIST"

echo "==> 2/5 next build (standalone)"
npm run build

echo "==> 3/5 Assemble standalone app"
# Next.js standalone output lands in .next/standalone (server.js + minimal node_modules)
cp -R .next/standalone/. "$DIST/"
# standalone does NOT include static assets or public/ — copy them in
mkdir -p "$DIST/.next"
cp -R .next/static "$DIST/.next/static"
[ -d public ] && cp -R public "$DIST/public"

echo "==> 4/5 Copy deploy helpers"
cp deploy/ecosystem.config.js       "$DIST/ecosystem.config.js"
cp deploy/.env.production.example    "$DIST/.env.production.example"
cp deploy/setup-windows.ps1          "$DIST/setup-windows.ps1"
cp deploy/Caddyfile                  "$DIST/Caddyfile"
cp deploy/README.md                  "$DIST/README.md"

echo "==> 5/5 Database dump"
bash deploy/db-export.sh "$DIST/db" || echo "   (db dump skipped — run deploy/db-export.sh manually)"

echo ""
echo "==> Done. dist size:"; du -sh "$DIST"
echo "Next: copy the whole dist/ folder to the Windows server, then run setup-windows.ps1 (see deploy/README.md)."
