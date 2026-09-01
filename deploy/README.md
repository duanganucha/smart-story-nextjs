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
node scripts-gen-thumbs.mjs      # scene image variants — see section H
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
  Stories generated after the variant hook landed already carry their
  `_thumb`/`_med` files — copy the whole scene folder, not just the PNGs
  (see section H).

## H. Scene image variants (thumbnails) — required for fast loading

Every scene PNG (~2 MB, 1376x768) has two downscaled WebP companions written
beside it. The apps request these instead of the PNG, which is the difference
between a library grid pulling ~11 MB and pulling ~130 KB.

| File | Size | Used by |
|---|---|---|
| `scene_01.png` | ~1.9 MB | archive original; fallback if a variant is missing |
| `scene_01_med.webp` | ~100 KB | the player's main image |
| `scene_01_thumb.webp` | ~20 KB | library grid covers, filmstrip, low-res placeholder |

### New stories need no action

`renderImage()` in [`lib/scenes.js`](../lib/scenes.js) builds both variants right
after it writes a PNG. Every path goes through it — new story, "regenerate
storyboard", "regenerate one scene", SUT engine and Gemini engine alike — so any
story generated from now on ships with its variants. A variant that fails to
build is logged and skipped, never failing the story, because the apps fall back
to the PNG.

### Existing stories need a one-time backfill

Images generated before that hook existed have only the PNG. Build their
variants on the **mac**, before `build-dist.sh`:

```bash
cd smart-story-nextjs
node scripts-gen-thumbs.mjs           # every story missing variants
node scripts-gen-thumbs.mjs 41 79     # only these story ids
node scripts-gen-thumbs.mjs --force   # rebuild even if they already exist
```

Safe to re-run — it skips finished work and prints
`Nothing to do` when there is none. As a reference point, the initial backfill
turned 599 PNGs into 1198 variants (2330 MB read → 79 MB written) in a few
minutes with no failures.

### Getting them onto the server

`build-dist.sh` copies the whole `public/` tree, so **the variants travel with a
normal deploy** — no extra step, they are simply part of `dist/public/scenes/`.
Budget roughly **+80 MB** on top of the existing `dist/` size.

If you need to push variants to a **running** server without a full redeploy
(e.g. you backfilled a few old stories), use the upload script instead:

```bash
bash scripts-upload-thumbs.sh          # all stories
bash scripts-upload-thumbs.sh 79 92    # only these ids
```

It POSTs each file to `/api/scenes/upload` over Basic Auth and skips anything
the server already serves at the same byte size, so re-running is cheap. It is
the WebP companion to `scripts-upload-scenes.sh` (which pushes the PNGs).

> That endpoint must exist on the server first. A deploy predating it answers
> `404 Server action not found` — deploy the current build, then upload.

### `sharp` is native — the server needs its own binary

`lib/scenes.js` imports `sharp`, which ships a **platform-specific** binary.
A `dist/` built on a mac carries `@img/sharp-darwin-arm64`, which cannot load on
the Windows server: every API route then 500s with

```
Error: Could not load the "sharp" module using the win32-x64 runtime
```

Images still serve (they are static files) but `/api/stories` fails, so the apps
show an empty library. Fix it **on the server**, once per machine:

```powershell
cd D:\WEB_SITE\smart-story
npm install --no-save --os=win32 --cpu=x64 sharp
pm2 restart smart-story
```

Verify `node_modules\@img` contains `sharp-win32-x64`. Re-run this after any
deploy that replaces `node_modules` with the mac-built copy.

### Cache headers

[`next.config.js`](../next.config.js) serves `/scenes/*` and `/audio/*` with
`Cache-Control: public, max-age=31536000, immutable`. This is safe because a
regenerated scene is served under a **new** `?v=<timestamp>` URL, so bytes at a
given URL never change. Without it Next sends `max-age=0` and every cached image
still costs a revalidation round-trip.

The supplied `Caddyfile` is a plain `reverse_proxy` with no `header` directive,
so this passes through untouched. **After deploying, confirm it survived:**

```bash
curl -sI https://bearrytales.datainfo.cloud/scenes/92/scene_01_med.webp \
  | grep -i cache-control
# expect: Cache-Control: public, max-age=31536000, immutable
```

If it comes back `max-age=0`, something in front of Next (a changed Caddyfile,
or IIS per section E) is rewriting the header — fix it there, not in the app.

### Verifying a deploy

```bash
B=https://bearrytales.datainfo.cloud
for f in scene_01.png scene_01_med.webp scene_01_thumb.webp; do
  printf '%-22s ' "$f"
  curl -sI "$B/scenes/92/$f" | grep -iE '^HTTP|content-type' | tr -d '\r' | tr '\n' ' '
  echo
done
```

All three should return `200`, with the `.webp` files typed `image/webp`.
A `404` on the variants means `public/` was copied without them.

---

## Notes
- Content **generation** (Gemini / SUT / Python) is admin-only and **not** required
  to serve the app. You can keep generating stories locally and sync DB + `public/`
  to the server, or set `GEMINI_API_KEY` on the server to generate there.
- Story audio/images are plain files under `public/` — they are served directly
  by Next.js, so they must be copied to the server alongside the build.
- Each scene image ships as three files (PNG + two WebP variants). Copy whole
  scene folders; copying only `*.png` leaves the apps loading megabyte images.
  See section H.
