<#
  setup-windows.ps1  —  Deploy the Smart Story (หมีอ่าน) Next.js backend on a
  Windows production server using PM2.

  Run from inside the copied dist\ folder, in an ELEVATED PowerShell:

      powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 `
          -MysqlRootPassword "your_mysql_root_pw" `
          -AppDbPassword     "strong_app_pw"

  Prerequisites on the server (install first):
    * Node.js LTS (>=18)  ->  https://nodejs.org   (gives node + npm)
    * MySQL Server 8      ->  database engine
    * (HTTPS) Caddy or IIS+ARR — see README.md / Caddyfile
#>

param(
  [string]$MysqlRootPassword = "",
  [string]$AppDbUser         = "smartstory",
  [string]$AppDbPassword     = "",
  [string]$DbName            = "smart_story_ai",
  [int]   $Port              = 3100,
  [string]$MysqlBin          = ""   # e.g. "C:\Program Files\MySQL\MySQL Server 8.0\bin"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $here
Write-Host "==> dist folder: $here" -ForegroundColor Cyan

function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "'$cmd' not found on PATH. Install it first (see README.md)."
  }
}

# ---------- 1. Toolchain (already installed on this server: node, npm, mysql, pm2) ----------
Write-Host "==> 1/6 Checking existing toolchain" -ForegroundColor Green
Need node; Need npm
node -v; npm -v

# locate mysql.exe
if (-not $MysqlBin) {
  $cand = Get-ChildItem "C:\Program Files\MySQL\*\bin\mysql.exe" -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if ($cand) { $MysqlBin = Split-Path $cand.FullName -Parent }
}
$mysql = if ($MysqlBin) { Join-Path $MysqlBin "mysql.exe" } else { "mysql" }
Write-Host "    mysql: $mysql"

# ---------- 2. PM2 (already installed — only add the boot-startup helper if missing) ----------
Write-Host "==> 2/6 Verifying PM2" -ForegroundColor Green
Need pm2
pm2 -v
if (-not (Get-Command pm2-startup -ErrorAction SilentlyContinue)) {
  Write-Host "    installing pm2-windows-startup (boot persistence helper)"
  npm install -g pm2-windows-startup | Out-Host
} else {
  Write-Host "    pm2-windows-startup present"
}

# ---------- 3. Database ----------
Write-Host "==> 3/6 Creating database + user and importing dump" -ForegroundColor Green
if (-not $AppDbPassword) { throw "Provide -AppDbPassword" }
$rootArgs = @("-uroot")
if ($MysqlRootPassword) { $rootArgs += "-p$MysqlRootPassword" }

$sql = @"
CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$AppDbUser'@'localhost' IDENTIFIED BY '$AppDbPassword';
GRANT ALL PRIVILEGES ON $DbName.* TO '$AppDbUser'@'localhost';
FLUSH PRIVILEGES;
"@
$sql | & $mysql @rootArgs
Write-Host "    db + user ready"

$dump = Join-Path $here "db\smart_story_ai.sql"
if (Test-Path $dump) {
  Write-Host "    importing $dump ..."
  Get-Content $dump -Raw | & $mysql @rootArgs --default-character-set=utf8mb4
  Write-Host "    import done"
} else {
  Write-Host "    (no db\smart_story_ai.sql found — skipping import)" -ForegroundColor Yellow
}

# ---------- 4. .env.production ----------
Write-Host "==> 4/6 Preparing .env.production" -ForegroundColor Green
$envFile = Join-Path $here ".env.production"
if (-not (Test-Path $envFile)) {
  Copy-Item ".env.production.example" $envFile
  (Get-Content $envFile) `
    -replace '^DB_USER=.*',     "DB_USER=$AppDbUser" `
    -replace '^DB_PASSWORD=.*', "DB_PASSWORD=$AppDbPassword" `
    -replace '^DB_NAME=.*',     "DB_NAME=$DbName" |
    Set-Content $envFile -Encoding UTF8
  Write-Host "    created .env.production (review GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS / GEMINI_API_KEY)" -ForegroundColor Yellow
} else {
  Write-Host "    .env.production already exists — leaving as-is"
}

# ---------- 5. Firewall (app port, optional if proxy is local) ----------
Write-Host "==> 5/6 Firewall rule for port $Port (LAN)" -ForegroundColor Green
if (-not (Get-NetFirewallRule -DisplayName "SmartStory $Port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "SmartStory $Port" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
}

# ---------- 6. Start under PM2 ----------
Write-Host "==> 6/6 Starting under PM2" -ForegroundColor Green
pm2 delete smart-story 2>$null | Out-Null
pm2 start ecosystem.config.js
pm2 save
pm2-startup install    # register PM2 resurrect on boot

Write-Host ""
Write-Host "==> Backend is running on http://localhost:$Port" -ForegroundColor Cyan
Write-Host "    Test:  curl http://localhost:$Port/api/stories"
Write-Host "    Logs:  pm2 logs smart-story"
Write-Host ""
Write-Host "NEXT: put HTTPS in front (Caddy auto-TLS — see Caddyfile/README.md)," -ForegroundColor Yellow
Write-Host "      then build the app with --dart-define=API_BASE_URL=https://your-domain" -ForegroundColor Yellow
