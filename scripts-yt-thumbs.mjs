/**
 * อัปปกคลิปขึ้น YouTube ย้อนหลัง — ให้ทุกคลิปที่อัปไปแล้วมีปกที่เราออกแบบเอง
 *
 * ทำไมต้องมีสคริปต์แยก:
 *   ตอนอัปคลิป ถ้าช่องยังไม่ผ่านการยืนยันตัวตน YouTube จะปฏิเสธการตั้งปก
 *   แต่ตัววิดีโอขึ้นไปแล้ว (โค้ดใน youtube.js จับ error ไว้ไม่ให้ทั้งงานล้ม)
 *   พอยืนยันผ่านแล้วจึงใช้ตัวนี้ตามใส่ปกย้อนหลังทีเดียว
 *
 *   node --env-file=.env.local scripts-yt-thumbs.mjs           # ทุกคลิปที่ยังไม่มีปก
 *   node --env-file=.env.local scripts-yt-thumbs.mjs --check   # เช็คสิทธิ์อย่างเดียว
 *   node --env-file=.env.local scripts-yt-thumbs.mjs 2 3 5     # เฉพาะเรื่องที่ระบุ
 */
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';

const VIDEO_DIR = process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const onlyIds = args.filter((a) => /^\d+$/.test(a)).map(Number);

async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
      refresh_token: process.env.YT_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`ขอ token ไม่สำเร็จ: ${d.error_description || d.error}`);
  return d.access_token;
}

async function setThumb(access, videoId, file) {
  const img = await readFile(file);
  const r = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    { method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'image/jpeg' },
      body: img });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${r.status}`);
  }
}

const access = await token();

// เช็คสิทธิ์ก่อน — ถ้ายังไม่ผ่านจะได้ไม่ยิงรัวแล้วโดนปฏิเสธทุกตัว
const probe = await fetch(
  'https://www.googleapis.com/youtube/v3/videos?part=id&myRating=none&maxResults=1',
  { headers: { Authorization: `Bearer ${access}` } });
if (!probe.ok) console.log('⚠️  ตรวจสิทธิ์เบื้องต้นไม่ผ่าน แต่จะลองต่อ');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'smart_story_ai',
  charset: 'utf8mb4',
});

// คลิปที่อัปขึ้น YouTube สำเร็จแล้ว
const [rows] = await conn.query(
  `SELECT j.story_id, MAX(j.remote_id) AS remote_id, MAX(s.title) AS title
   FROM publish_jobs j
   JOIN stories s ON s.id = j.story_id
   WHERE j.platform='youtube' AND j.status IN ('done','processing')
     AND j.remote_id IS NOT NULL
   GROUP BY j.story_id
   ORDER BY j.story_id`);

const targets = onlyIds.length
  ? rows.filter((r) => onlyIds.includes(r.story_id)) : rows;

if (!targets.length) {
  console.log('ยังไม่มีคลิปบน YouTube — อัปคลิปก่อน');
  await conn.end();
  process.exit(0);
}

// จับคู่ไฟล์ปก
const files = await readdir(VIDEO_DIR).catch(() => []);
const thumbOf = (sid) =>
  files.find((f) => f.startsWith(`${sid}_`) && f.toLowerCase().endsWith('.thumb.jpg'));

console.log(`คลิปบน YouTube: ${targets.length} เรื่อง\n`);

if (checkOnly) {
  const t = targets[0];
  const f = thumbOf(t.story_id);
  if (!f) { console.log('เรื่องแรกยังไม่มีไฟล์ปก'); await conn.end(); process.exit(0); }
  try {
    await setThumb(access, t.remote_id, path.join(VIDEO_DIR, f));
    console.log('🎉 สิทธิ์ผ่านแล้ว — รันสคริปต์นี้ใหม่แบบไม่ใส่ --check เพื่ออัปทั้งหมด');
  } catch (e) {
    console.log('⏳ ยังไม่ผ่าน —', String(e.message).slice(0, 100));
  }
  await conn.end();
  process.exit(0);
}

let ok = 0, skip = 0, fail = 0;
for (const t of targets) {
  const f = thumbOf(t.story_id);
  if (!f) { console.log(`  – #${t.story_id} ไม่มีไฟล์ปก`); skip++; continue; }
  try {
    await setThumb(access, t.remote_id, path.join(VIDEO_DIR, f));
    console.log(`  ✓ #${t.story_id} ${t.title.slice(0, 40)}`);
    ok++;
  } catch (e) {
    console.log(`  ✗ #${t.story_id} ${String(e.message).slice(0, 70)}`);
    fail++;
    // สิทธิ์ยังไม่ผ่าน = ทุกตัวจะพังเหมือนกัน ไม่ต้องยิงต่อให้เปลือง quota
    if (/permission/i.test(e.message)) {
      console.log('\n⏳ ช่องยังไม่ผ่านการยืนยันตัวตน — หยุดก่อน');
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 400));   // เว้นจังหวะกัน rate limit
}

console.log(`\n${'='.repeat(46)}`);
console.log(`สำเร็จ ${ok} · ข้าม ${skip} · ล้มเหลว ${fail}`);
await conn.end();
