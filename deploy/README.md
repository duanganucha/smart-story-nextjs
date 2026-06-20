# Deploy "หมีอ่าน" backend (Next.js + MySQL) to a production Windows server

Self-contained **standalone build + PM2** deployment. The app must be reachable
over **HTTPS** with a public domain so the iOS/Android apps (and Apple App
Review) can load stories, images, and audio.

```
local mac  ──build-dist.sh──►  dist/  ──copy──►  Windows server  ──setup-windows.ps1──►  PM2 ◄─ Caddy (HTTPS) ◄─ phones
```

---

## A. On the build machine (mac)

```bash
cd smart-story-nextjs
bash deploy/build-dist.sh
```

This runs `next build` (standalone), assembles **`dist/`** with the server,
`.next/static`, `public/` (audio + images), PM2 config, the Windows setup
script, and a database dump (`dist/db/smart_story_ai.sql`).

Copy the **whole `dist/` folder** to the Windows server (RDP copy, robocopy,
scp, or a zip). `public/` may be large (story audio/images) — that's expected.

> If the DB dump was skipped, run it explicitly:
> `bash deploy/db-export.sh dist/db`

---

## B. On the Windows server — one-time prerequisites

1. **Node.js LTS (≥18)** — https://nodejs.org (installs `node` + `npm`).
2. **MySQL Server 8** — https://dev.mysql.com/downloads/installer/ (note the root password).
3. **Caddy** (for automatic HTTPS) — https://caddyserver.com/download (single `caddy.exe`).
   *(Alternative: IIS + Application Request Routing — see section E.)*

---

## C. On the Windows server — deploy

Open **PowerShell as Administrator**, `cd` into the copied `dist\` folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 `
    -MysqlRootPassword "YOUR_MYSQL_ROOT_PW" `
    -AppDbPassword     "STRONG_APP_PW"
```

The script: installs **PM2 + pm2-windows-startup**, creates the database + app
user, imports the dump, writes `.env.production`, opens the firewall for 3100,
and starts the app under PM2 with boot persistence.

Then **edit `.env.production`** and confirm:
- `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` (must match the app's OAuth clients)
- `GEMINI_API_KEY` (only if generating new stories on the server — optional)

Reload after editing env:
```powershell
pm2 restart smart-story --update-env
```

Verify locally:
```powershell
curl http://localhost:3100/api/stories
```

Useful PM2 commands: `pm2 status`, `pm2 logs smart-story`, `pm2 restart smart-story`, `pm2 monit`.

---

## D. HTTPS with Caddy (recommended — auto TLS)

1. Point your domain (e.g. `api.bearrytales.com`) A-record to the server's public IP.
2. Open inbound **TCP 80 + 443** on the Windows firewall **and** the router/NAT.
3. Edit `Caddyfile` — replace `api.bearrytales.com` with your domain.
4. Run Caddy (it fetches + renews Let's Encrypt certs automatically):
   ```powershell
   caddy run --config .\Caddyfile          # test in foreground
   ```
   To keep it running on boot, install it as a service (e.g. with `nssm install caddy`).
5. Confirm: open `https://api.bearrytales.com/api/stories` in a browser.

---

## E. HTTPS with IIS (alternative)

If you prefer IIS instead of Caddy:
1. Install **URL Rewrite** + **Application Request Routing (ARR)**.
2. Create a site bound to your domain with an HTTPS binding (cert via win-acme/Certify).
3. Enable ARR proxy and add a reverse-proxy rule to `http://localhost:3100`.
4. Set `X-Forwarded-Proto = https` in the inbound rule's server variables.

---

## F. Point the mobile apps at production

Once HTTPS is live, rebuild the apps with the production URL (no code edit needed):

```bash
# iOS
flutter build ipa --release --dart-define=API_BASE_URL=https://api.bearrytales.com
# Android
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.bearrytales.com
```

(Or hard-code `_kProdBaseUrlFallback` in `lib/providers/api_provider.dart`.)

---

## G. Updating later (new build / new stories)

- **New app code:** re-run `build-dist.sh` on mac → copy `dist\` over → on server
  `pm2 restart smart-story`. (Copy `.next/`, `server.js`, `public/`; keep the
  server's `.env.production`.)
- **New stories only:** re-export the DB (`db-export.sh`) + copy new files under
  `public/` to the server's `public/`, then `pm2 restart smart-story`.

## Notes
- Content **generation** (Gemini / SUT / Python) is admin-only and **not** required
  to serve the app. You can keep generating stories locally and sync DB + `public/`
  to the server, or set `GEMINI_API_KEY` on the server to generate there.
- Story audio/images are plain files under `public/` — they are served directly
  by Next.js, so they must be copied to the server alongside the build.
