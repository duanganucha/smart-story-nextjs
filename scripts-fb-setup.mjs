/**
 * ตั้งค่า Facebook Page สำหรับอัปโหลดวิดีโอ
 *
 * ใช้ครั้งเดียวตอนติดตั้ง — รับ token ชั่วคราวจาก Graph API Explorer
 * แล้วแลกเป็น Page Token ถาวร เขียนลง .env.local ให้เลย
 *
 *   node --env-file=.env.local scripts-fb-setup.mjs <APP_ID> <APP_SECRET> <SHORT_TOKEN>
 */
import { readFile, writeFile } from 'fs/promises';

const G = 'https://graph.facebook.com/v25.0';
const [appId, appSecret, shortToken] = process.argv.slice(2);

if (!appId || !appSecret || !shortToken) {
  console.error(`
ใช้:  node --env-file=.env.local scripts-fb-setup.mjs <APP_ID> <APP_SECRET> <SHORT_TOKEN>

  APP_ID / APP_SECRET  → developers.facebook.com → App settings → Basic
  SHORT_TOKEN          → Graph API Explorer → Generate Access Token
`);
  process.exit(1);
}

const call = async (url, label) => {
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok || d.error) {
    throw new Error(`${label}: ${d.error?.message || JSON.stringify(d).slice(0, 200)}`);
  }
  return d;
};

// 1) token ชั่วคราว (1 ชม.) → token ผู้ใช้แบบยาว (60 วัน)
console.log('① แลก token ให้อายุยาวขึ้น...');
const long = await call(
  `${G}/oauth/access_token?grant_type=fb_exchange_token` +
  `&client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}` +
  `&fb_exchange_token=${encodeURIComponent(shortToken)}`,
  'แลก token ไม่สำเร็จ'
);

// 2) ดึงเพจ — Page Token ที่ได้จาก token ผู้ใช้แบบยาวจะ "ไม่มีวันหมดอายุ"
console.log('② ดึงรายชื่อเพจ...');
const pages = await call(
  `${G}/me/accounts?fields=id,name,access_token&access_token=${long.access_token}`,
  'ดึงเพจไม่สำเร็จ'
);

if (!pages.data?.length) {
  console.error('✗ บัญชีนี้ไม่มีเพจ หรือยังไม่ได้ให้สิทธิ์ pages_show_list');
  process.exit(1);
}

let page = pages.data[0];
if (pages.data.length > 1) {
  console.log('\n  พบหลายเพจ:');
  pages.data.forEach((p, i) => console.log(`    [${i + 1}] ${p.name}  (id ${p.id})`));
  const pick = Number(process.env.FB_PICK || 1);
  page = pages.data[pick - 1] || pages.data[0];
  console.log(`  → เลือก "${page.name}" (เปลี่ยนได้ด้วย FB_PICK=2 นำหน้าคำสั่ง)\n`);
}

// 3) ยืนยันว่า token ถาวรจริง — ป้องกันพังเงียบอีก 60 วันข้างหน้า
console.log('③ ตรวจอายุ token...');
const dbg = await call(
  `${G}/debug_token?input_token=${page.access_token}` +
  `&access_token=${appId}|${encodeURIComponent(appSecret)}`,
  'ตรวจ token ไม่สำเร็จ'
);
const exp = dbg.data?.expires_at;
const forever = !exp || exp === 0;
const scopes = dbg.data?.scopes || [];
const need = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const missing = need.filter((s) => !scopes.includes(s));

// 4) เขียนลง .env.local (แทนที่ค่าเดิมถ้ามี)
const path = new URL('.env.local', import.meta.url).pathname;
let env = await readFile(path, 'utf8');
const set = (k, v) => {
  env = new RegExp(`^${k}=.*$`, 'm').test(env)
    ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`)
    : env.replace(/\n*$/, `\n${k}=${v}\n`);
};
set('FB_PAGE_ID', page.id);
set('FB_PAGE_TOKEN', page.access_token);
await writeFile(path, env, 'utf8');

console.log(`
✓ เสร็จแล้ว
    เพจ        ${page.name}
    FB_PAGE_ID ${page.id}
    อายุ token ${forever ? 'ไม่มีวันหมดอายุ ✓' : '⚠ ' + new Date(exp * 1000).toLocaleString('th-TH')}
    สิทธิ์     ${missing.length ? '⚠ ยังขาด ' + missing.join(', ') : 'ครบ ✓'}
    เขียนลง    .env.local แล้ว

  ต่อไป: รีสตาร์ท dev server แล้วกดปุ่ม f ในหน้า /pipeline ได้เลย
`);
if (!forever) console.log('  ⚠ token ยังไม่ถาวร — มักเกิดจากใช้ token ของเพจมาแลก ให้ใช้ของ "User" แทน\n');
