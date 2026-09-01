#!/usr/bin/env bash
# One-time deploy of the /api/scenes/upload endpoint to the production server.
# REQUIRES network access to the server (SSH to 14.11.0.9 — i.e. run while on
# the office LAN / VPN). After this runs once, scene images can be pushed from
# anywhere over the public HTTPS API with scripts-upload-scenes.sh.
#
#   bash scripts-deploy-scenes-endpoint.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
HOST="waiwai@14.11.0.9"
export SSHPASS='!22Wauiowe#$0309'
SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
SCP="sshpass -e scp -o StrictHostKeyChecking=no"

echo "==> 1/4 build standalone"
npm run build

echo "==> 2/4 package .next + server.js"
rm -rf /tmp/ssdeploy && mkdir -p /tmp/ssdeploy/.next
cp .next/standalone/server.js /tmp/ssdeploy/server.js
cp -R .next/standalone/.next/. /tmp/ssdeploy/.next/
cp -R .next/static /tmp/ssdeploy/.next/static
cp .next/standalone/package.json /tmp/ssdeploy/package.json 2>/dev/null || true
( cd /tmp/ssdeploy && tar czf /tmp/ssdeploy.tgz server.js package.json .next )

echo "==> 3/4 scp + extract on server (backup old .next)"
$SCP /tmp/ssdeploy.tgz "$HOST:D:/WEB_SITE/smart-story/_deploy.tgz"
$SSH "$HOST" 'cd /d D:\WEB_SITE\smart-story & if exist .next.bak rmdir /s /q .next.bak & move .next .next.bak & tar -xzf _deploy.tgz & del /q _deploy.tgz & if exist .next\server\app\api\scenes\upload\route.js (echo UPLOAD_ROUTE_OK) else (echo UPLOAD_ROUTE_MISSING)'

echo "==> 4/4 restart pm2"
$SSH "$HOST" 'pm2 restart smart-story'
echo "Done. Verify: curl -o /dev/null -w '%{http_code}' -u user:pass -F id=0 https://bearrytales.datainfo.cloud/api/scenes/upload  (expect 400, not 404)"
