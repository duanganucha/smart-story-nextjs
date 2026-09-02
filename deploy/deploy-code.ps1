$ErrorActionPreference = "Stop"
$base = "D:\WEB_SITE\smart-story"
$tmp  = "D:\WEB_SITE\_tmp_deploy"

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive "D:\WEB_SITE\dist-code.zip" -DestinationPath $tmp -Force
$src = Join-Path $tmp "dist-code"

if (-not (Test-Path (Join-Path $src "server.js")))     { throw "ไม่พบ server.js ในไฟล์ที่แตก" }
if (-not (Test-Path (Join-Path $src ".next\static")))  { throw "ไม่พบ .next\static" }
Write-Output "OK แตกไฟล์ครบ"

# .next ใหม่ทั้งก้อน (สำรองไว้แล้วเป็น .next.pre_*)
Remove-Item (Join-Path $base ".next") -Recurse -Force
Copy-Item (Join-Path $src ".next") $base -Recurse -Force
Copy-Item (Join-Path $src "server.js") $base -Force

# โค้ดฝั่ง server ที่ Next วางไว้นอก .next
foreach ($d in @("node_modules", "app", "lib", "components")) {
  $p = Join-Path $src $d
  if (Test-Path $p) { Copy-Item $p $base -Recurse -Force; Write-Output ("copied " + $d) }
}
foreach ($f in @("package.json", "middleware.js")) {
  $p = Join-Path $src $f
  if (Test-Path $p) { Copy-Item $p $base -Force; Write-Output ("copied " + $f) }
}
Write-Output "DEPLOY_FILES_DONE"
