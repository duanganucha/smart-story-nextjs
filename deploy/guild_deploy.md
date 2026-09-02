# Deploy โค้ดขึ้น production (อัปเดตเร็ว ไม่แตะ media/DB)

> ใช้ตอน**แก้โค้ดแล้วอยากอัปขึ้นเซิร์ฟเวอร์** — ใช้เวลา ~5 นาที
> ติดตั้งครั้งแรกทั้งระบบให้ใช้ [README.md](README.md) แทน
> บันทึกจากการ deploy จริง 2026-09-02

---

## 🔴 กฎข้อเดียวที่ห้ามลืม

**ทุกครั้งที่ทับ `node_modules` ต้องติดตั้ง `sharp` ฝั่ง Windows ใหม่เสมอ**

```powershell
npm install --no-save --os=win32 --cpu=x64 sharp
```

**ทำไม:** `lib/scenes.js` ใช้ `sharp` ซึ่งเป็น native binary เฉพาะแพลตฟอร์ม
บิลด์จาก mac จะพก `@img/sharp-darwin-arm64` ขึ้นไป → Windows โหลดไม่ได้ →
**ทุก API route ตอบ 500** แต่หน้าเว็บกับรูปยังเสิร์ฟได้ปกติ

อาการจึงหลอกมาก: เปิดเว็บได้ แต่แอปมือถือโหลดนิทานไม่ขึ้น
เห็น error จริงได้ที่ `pm2 logs smart-story --err` เท่านั้น

> เจอกับดักนี้มาแล้ว 2 ครั้ง (1 ก.ย. และ 2 ก.ย.) — เสียเวลาไล่หาสาเหตุทั้งสองครั้ง

---

## ข้อมูลเซิร์ฟเวอร์

| | |
|---|---|
| SSH | `ssh winserver` (alias ใน `~/.ssh/config` → `waiwai@14.11.0.9`) |
| ที่อยู่แอป | `D:\WEB_SITE\smart-story` |
| PM2 | `smart-story` · fork mode · พอร์ต 3100 |
| หน้าเว็บ | https://bearrytales.datainfo.cloud |
| Node บนเซิร์ฟเวอร์ | v24.16.0 |

> ⚠️ เซิร์ฟเวอร์รัน PM2 **19 แอป** — แตะเฉพาะ `smart-story` เท่านั้น
> ⚠️ SSH เข้าได้เฉพาะจาก LAN

---

## ขั้นตอน

### 1. Build บน mac

```bash
cd smart-story-nextjs
bash deploy/build-code.sh
```

ได้ `dist-code.zip` ประมาณ **15 MB** (ตัว `dist/` เต็มคือ ~4 GB เพราะรวม media)

### 2. สำรองของเดิมก่อน

```bash
TS=$(date +%Y%m%d_%H%M%S)
ssh winserver "powershell -NoProfile -Command \"\$b='D:\WEB_SITE\smart-story'; Copy-Item \$b'\.next' \$b'\.next.pre_$TS' -Recurse -Force; Copy-Item \$b'\server.js' \$b'\server.js.pre_$TS' -Force; Write-Output 'backup ok'\""
echo "สำรองไว้ที่ .next.pre_$TS"
```

**จดชื่อโฟลเดอร์สำรองไว้** เผื่อต้องย้อนกลับ

### 3. อัปไฟล์ + แตก

```bash
scp dist-code.zip winserver:"D:/WEB_SITE/dist-code.zip"
scp deploy/deploy-code.ps1 winserver:"D:/WEB_SITE/deploy.ps1"
ssh winserver 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\WEB_SITE\deploy.ps1'
```

ต้องเห็น `DEPLOY_FILES_DONE`

### 4. 🔴 ติดตั้ง sharp ฝั่ง Windows

```bash
ssh winserver 'cd /d D:\WEB_SITE\smart-story && npm install --no-save --os=win32 --cpu=x64 sharp'
```

### 5. รีสตาร์ท

```bash
ssh winserver 'pm2 restart smart-story'
```

> ถ้าแก้ `.env.production` ด้วย ต้องใช้ `pm2 delete smart-story && pm2 start ecosystem.config.js && pm2 save`
> เพราะ `pm2 restart` **ไม่อ่าน env ใหม่**

### 6. ตรวจว่าใช้งานได้จริง

```bash
for p in /api/stories /api/config /privacy; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://bearrytales.datainfo.cloud$p" --max-time 25
done
```

**ต้องได้ 200 ทั้งหมด** โดยเฉพาะ `/api/stories` ซึ่งเป็นตัวจับกับดัก sharp

> ⚠️ **อย่าดูแค่ status code** — เคยเจอ `/privacy` ตอบ 200 แต่ส่งหน้า login กลับมา
> เช็คเนื้อหาด้วย: `curl -s .../privacy | grep "นโยบายความเป็นส่วนตัว"`

---

## ย้อนกลับเมื่อพัง

```bash
ssh winserver "powershell -NoProfile -Command \"\$b='D:\WEB_SITE\smart-story'; Remove-Item \$b'\.next' -Recurse -Force; Copy-Item \$b'\.next.pre_XXXX' \$b'\.next' -Recurse -Force\""
ssh winserver 'cd /d D:\WEB_SITE\smart-story && npm install --no-save --os=win32 --cpu=x64 sharp'
ssh winserver 'pm2 restart smart-story'
```

แทน `XXXX` ด้วย timestamp ที่จดไว้ตอนขั้นที่ 2

**ดูรายการสำรองทั้งหมด:**
```bash
ssh winserver 'powershell -NoProfile -Command "Get-ChildItem D:\WEB_SITE\smart-story -Directory -Filter \".next*\" | Select-Object Name,LastWriteTime | Sort-Object LastWriteTime"'
```

> การย้อนกลับ **ต้องลง sharp ใหม่ด้วย** ถ้าเคยทับ `node_modules` ไปแล้ว
> (เจอมาแล้ว: ย้อน `.next` กลับแต่ API ยัง 500 เพราะ `node_modules` ยังเป็นของ mac)

---

## อ่าน log

```bash
ssh winserver 'pm2 logs smart-story --lines 40 --nostream --err'   # error
ssh winserver 'pm2 logs smart-story --lines 40 --nostream --out'   # stdout
ssh winserver 'pm2 jlist'                                          # สถานะ JSON
```

---

## อาการ → สาเหตุ

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| **API 500 ทุก route** แต่หน้าเว็บ 200 | `sharp` เป็นบิลด์ mac | `npm install --no-save --os=win32 --cpu=x64 sharp` |
| `EvalError: Code generation from strings disallowed` | มาคู่กับ sharp พัง (middleware ล้มตาม) | แก้ sharp แล้วหาย |
| `Cannot read properties of undefined (reading 'output')` | เหมือนข้างบน | เหมือนข้างบน |
| หน้าเว็บขึ้นหน้า login ทั้งที่ควรเปิดสาธารณะ | โค้ดเก่ายังรันอยู่ / ยังไม่ได้ deploy | deploy ใหม่ |
| แก้ env แล้วไม่มีผล | `pm2 restart` ไม่อ่าน env ใหม่ | `pm2 delete` + `pm2 start ecosystem.config.js` |
| PM2 restart วน / status errored | ดู `pm2 logs --err` | มักเป็น sharp หรือ env หาย |

---

## ไม่ได้ deploy อะไรบ้าง

สคริปต์นี้อัปเฉพาะ **โค้ด** — ของพวกนี้ต้องทำแยก:

| | วิธี |
|---|---|
| รูป/เสียงนิทาน (`public/`) | `bash scripts-upload-scenes.sh [id...]` |
| ฐานข้อมูล | `bash deploy/db-export.sh` แล้ว import เอง |
| `.env.production` | แก้บนเซิร์ฟเวอร์โดยตรง (**ASCII ไม่มี BOM**) |

> `.env.production` ต้องเป็น **ASCII ไม่มี BOM** — `ecosystem.config.js` อ่านเป็น utf8
> ถ้ามี BOM คีย์แรกจะเพี้ยนและแอปอ่าน env ไม่ได้

---

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|---|---|
| [build-code.sh](build-code.sh) | build bundle เฉพาะโค้ด |
| [deploy-code.ps1](deploy-code.ps1) | แตกไฟล์และวางทับบนเซิร์ฟเวอร์ |
| [build-dist.sh](build-dist.sh) | build เต็ม (ติดตั้งครั้งแรก) |
| [README.md](README.md) | ติดตั้งครั้งแรกทั้งระบบ |
