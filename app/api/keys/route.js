import { NextResponse } from 'next/server';
import { readFile, writeFile, copyFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENV_PATH = path.join(process.cwd(), '.env.local');

/**
 * จัดการ API key จากหน้าเว็บ — อ่าน/เขียน .env.local
 *
 * ค่าที่มีอยู่จะถูก "ปิดบัง" ไม่ส่งกลับเต็ม ๆ (ส่งแค่ 4 ตัวท้าย)
 * เพื่อไม่ให้ความลับรั่วผ่าน response แม้จะอยู่หลัง auth แล้วก็ตาม
 */
const KEYS = [
  { group: 'AI', icon: '✨', test: 'gemini', color: '#8b5cf6',
    links: [
      { label: 'ขอ API Key', url: 'https://aistudio.google.com/apikey' },
      { label: 'ดูโควตา/บิล', url: 'https://aistudio.google.com/app/billing' },
    ],
    items: [
      { key: 'GEMINI_API_KEY', label: 'Gemini API Key', secret: true,
        help: 'ใช้สร้างเนื้อเรื่อง ภาพ และเสียง' },
    ]},
  { group: 'Facebook', icon: 'f', test: 'facebook', color: '#1877f2',
    links: [
      { label: 'จัดการแอป', url: 'https://developers.facebook.com/apps/' },
      { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' },
      { label: 'หา Page ID', url: 'https://www.facebook.com/pages/?category=your_pages' },
    ],
    items: [
      { key: 'FB_PAGE_ID', label: 'Page ID' },
      { key: 'FB_PAGE_TOKEN', label: 'Page Access Token', secret: true,
        help: 'ต้องผ่าน App Review และมีสิทธิ์ ADMIN บนเพจ' },
    ]},
  { group: 'YouTube', icon: '▶', test: 'youtube', color: '#ff0000',
    links: [
      { label: 'Cloud Console', url: 'https://console.cloud.google.com/apis/credentials' },
      { label: 'เปิด YouTube API', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      { label: 'ขอ Refresh Token', url: 'https://developers.google.com/oauthplayground/' },
    ],
    items: [
      { key: 'YT_CLIENT_ID', label: 'Client ID',
        help: 'สร้าง OAuth 2.0 Client ชนิด Desktop app' },
      { key: 'YT_CLIENT_SECRET', label: 'Client Secret', secret: true },
      { key: 'YT_REFRESH_TOKEN', label: 'Refresh Token', secret: true,
        help: 'scope: youtube.upload + youtube.force-ssl' },
    ]},
  { group: 'TikTok', icon: '♪', test: 'tiktok', color: '#25f4ee',
    links: [
      { label: 'จัดการแอป', url: 'https://developers.tiktok.com/apps' },
      { label: 'คู่มือ Direct Post', url: 'https://developers.tiktok.com/doc/content-posting-api-get-started' },
    ],
    items: [
      { key: 'TIKTOK_CLIENT_KEY', label: 'Client Key' },
      { key: 'TIKTOK_CLIENT_SECRET', label: 'Client Secret', secret: true },
      { key: 'TIKTOK_ACCESS_TOKEN', label: 'Access Token', secret: true,
        help: 'ต้องผ่าน audit ก่อนโพสต์สาธารณะได้ (2-4 สัปดาห์)' },
    ]},
];

const ALLOWED = new Set(KEYS.flatMap((g) => g.items.map((i) => i.key)));

function mask(v) {
  if (!v) return '';
  return v.length <= 8 ? '••••' : '••••••••' + v.slice(-4);
}

export async function GET() {
  let env = {};
  try {
    const raw = await readFile(ENV_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {}

  const groups = KEYS.map((g) => ({
    group: g.group,
    icon: g.icon,
    test: g.test,
    color: g.color,
    links: g.links || [],
    items: g.items.map((i) => ({
      ...i,
      set: Boolean(env[i.key]),
      preview: env[i.key] ? mask(env[i.key]) : '',
    })),
  }));

  return NextResponse.json({ groups, path: ENV_PATH });
}

/** บันทึกค่า — ส่งเฉพาะคีย์ที่ต้องการเปลี่ยน, ค่าว่าง = ลบทิ้ง */
export async function PUT(req) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }); }

  const updates = body.values || {};
  const bad = Object.keys(updates).filter((k) => !ALLOWED.has(k));
  if (bad.length) {
    return NextResponse.json(
      { error: `ไม่อนุญาตให้แก้: ${bad.join(', ')}` }, { status: 400 });
  }

  let raw = '';
  try { raw = await readFile(ENV_PATH, 'utf8'); } catch {}

  // สำรองไฟล์เดิมก่อนเขียนทับ — กันพลาดแล้วกู้ไม่ได้
  try { await copyFile(ENV_PATH, ENV_PATH + '.bak'); } catch {}

  const lines = raw.split('\n');
  const seen = new Set();

  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || !(m[1] in updates)) return line;
    seen.add(m[1]);
    const v = String(updates[m[1]] ?? '').trim();
    return v ? `${m[1]}=${v}` : null;   // ค่าว่าง = ลบบรรทัดทิ้ง
  }).filter((x) => x !== null);

  // คีย์ใหม่ที่ยังไม่มีในไฟล์ — เพิ่มต่อท้าย
  const added = Object.entries(updates)
    .filter(([k, v]) => !seen.has(k) && String(v ?? '').trim())
    .map(([k, v]) => `${k}=${String(v).trim()}`);

  if (added.length) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('# เพิ่มจากหน้าตั้งค่า', ...added);
  }

  await writeFile(ENV_PATH, out.join('\n'), 'utf8');

  // อัปเดต process.env ทันทีเพื่อให้ publisher ตรวจเจอโดยไม่ต้องรีสตาร์ท
  // (ใช้ได้กับโค้ดที่อ่าน process.env ตอนเรียก ไม่ใช่ตอน import)
  for (const [k, v] of Object.entries(updates)) {
    const s = String(v ?? '').trim();
    if (s) process.env[k] = s;
    else delete process.env[k];
  }

  return NextResponse.json({
    ok: true,
    changed: Object.keys(updates).length,
    note: 'บางค่าอาจต้องรีสตาร์ทเซิร์ฟเวอร์จึงจะมีผลเต็มที่',
  });
}
