import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_DIR =
  process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

const CH = process.env.CHANNEL_NAME || 'หมีอ่าน BearryTales';

// ลิงก์แอป — Play Store สร้างจาก bundle id ได้เลย
// ส่วน App Store ต้องใช้ App ID (ตัวเลข) จาก App Store Connect → ตั้งใน .env.local
const APP_ANDROID = process.env.APP_PLAY_URL ||
  'https://play.google.com/store/apps/details?id=com.gooddayinnovation.smartStory';
const APP_IOS = process.env.APP_IOS_URL || null;

/**
 * ข้อมูลสำหรับอัปโหลดขึ้น YouTube ของเรื่องหนึ่ง
 *
 * รวม title / description / tags / ไฟล์วิดีโอ / ไฟล์ซับ ไว้ที่เดียว
 * ใช้ได้ทั้งการคัดลอกไปวางใน Studio และการยิงผ่าน YouTube Data API
 *
 * หมายเหตุ: ไม่ต้องแปลเป็นภาษาอื่น — YouTube แปล title/description/ซับ
 * ให้ผู้ชมอัตโนมัติตามภาษาของเขาเอง ขอแค่ระบุ defaultLanguage ให้ถูก
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const sid = Number(id);
  if (!Number.isInteger(sid)) {
    return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, title, youtube_title, story, moral, story_type, category, age_range,
            topic, student_name, paragraphs, audio_path
     FROM stories WHERE id = ?`, [sid]
  );
  if (!rows.length) {
    return NextResponse.json({ error: 'ไม่พบเรื่องนี้' }, { status: 404 });
  }
  const r = rows[0];

  const morals = (() => {
    try {
      const m = Array.isArray(r.moral) ? r.moral : JSON.parse(r.moral || '[]');
      return m.filter(Boolean);
    } catch { return []; }
  })();

  // ── บรรทัดแรกสำคัญที่สุด ────────────────────────────────────────
  // YouTube แสดงแค่ 2-3 บรรทัดแรกก่อนปุ่ม "ดูเพิ่มเติม" จึงต้องบอกให้ชัด
  // ว่าเรื่องนี้เกี่ยวกับอะไรและเหมาะกับใคร ไม่ใช่เนื้อเรื่องดิบที่ตัดค้างกลางประโยค
  const paras = (r.story || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);

  // ตัดที่จบประโยคจริง ไม่ตัดกลางคำ
  function cutAtSentence(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const stop = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('ๆ'));
    return (stop > max * 0.6 ? cut.slice(0, stop) : cut).trim() + '…';
  }

  const hook = [
    `🎧 นิทานเสียง${r.category ? `แนว${r.category} ` : ' '}สำหรับเด็กอายุ ${r.age_range || '3-8'} ขวบ`,
    `เรื่อง "${r.title}"${r.student_name && r.student_name !== 'นักเรียน'
      ? ` — นิทานของ${r.student_name}` : ''}`,
  ].join('\n');

  const intro = cutAtSentence(paras[0] || '', 200);

  // หาไฟล์วิดีโอและซับที่มีอยู่จริง
  const files = { portrait: null, landscape: null };
  let thumbFile = null;   // ปกคลิปใช้ร่วมกันทั้งสองแนว
  try {
    for (const f of await readdir(VIDEO_DIR)) {
      if (!f.startsWith(`${sid}_`)) continue;
      // ไฟล์มี 4 แบบ: [_landscape][_nosub] — ต้องแยกแนวให้ถูก
      // (ก่อนหน้านี้ _landscape_nosub ถูกจัดเข้า portrait ผิด)
      const isLand = /_landscape(_nosub)?\.(mp4|srt)$/i.test(f);
      const slot = isLand ? 'landscape' : 'portrait';
      const isNosub = /_nosub\.(mp4|srt)$/i.test(f);
      // _reel = คลิปสั้นที่ตัดมาให้ไม่เกิน 90 วิ (ลิมิต Facebook Reels)
      // ต้องแยกเก็บ ไม่งั้นจะทับไฟล์เต็มแล้วอัปคลิปสั้นไปทุกที่
      const isReel = /_reel\.(mp4|srt)$/i.test(f);
      const cur = files[slot] || {};
      if (f.toLowerCase().endsWith('.thumb.jpg')) { thumbFile = f; continue; }
      if (isReel) {
        if (f.toLowerCase().endsWith('.mp4')) files[slot] = { ...cur, video_reel: f };
        else files[slot] = { ...cur, srt_reel: f };
        continue;
      }
      if (f.toLowerCase().endsWith('.mp4')) {
        // เก็บทั้งสองแบบไว้ แล้วให้แต่ละแพลตฟอร์มเลือกเอง:
        //   YouTube  → ไม่เบิร์นซับ (แนบ .srt ให้ระบบแปลได้ 100+ ภาษา)
        //   Reels/TikTok → เบิร์นซับ (ไม่รองรับไฟล์ซับ + คนดูแบบปิดเสียง)
        if (isNosub) files[slot] = { ...cur, video_nosub: f };
        else files[slot] = { ...cur, video_burned: f };
      } else if (f.toLowerCase().endsWith('.srt')) {
        if (!cur.srt || isNosub) files[slot] = { ...cur, srt: f };
      }
    }
  } catch {}

  // ค่า video/nosub เดิมยังคงไว้เพื่อความเข้ากันได้ — ตั้งเป็นตัวไม่เบิร์นซับ
  // (ผู้เรียกที่ต้องการตัวเบิร์นซับให้ใช้ video_burned)
  for (const k of ['portrait', 'landscape']) {
    const v = files[k];
    if (!v) continue;
    const pick = v.video_nosub || v.video_burned || null;
    files[k] = { ...v, video: pick, nosub: !!v.video_nosub };
  }

  // ── แบ่งตอน (chapters) ────────────────────────────────────────────
  // YouTube แสดงแถบแบ่งตอนบน timeline ถ้าคำอธิบายมี timestamp
  // เงื่อนไข: ต้องเริ่มที่ 00:00, มีอย่างน้อย 3 ตอน, แต่ละตอนยาว >= 10 วินาที
  //
  // ใช้เวลาจากไฟล์ .srt ที่สร้างคู่กับวิดีโอ — ตรงกับที่เสียงเล่าจริง
  let chapters = [];
  let chapterMethod = null;
  const fmtTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
             : `${m}:${String(x).padStart(2, '0')}`;
  };
  try {
    // อ่านจากไฟล์ .chapters.json ที่ make-video.py เขียนไว้ตอนเรนเดอร์
    // ค่านี้มาจากการตรวจจับความเงียบจริงในไฟล์เสียง แม่นกว่าการเดาจาก .srt
    const vid = files.landscape?.video || files.portrait?.video;
    if (vid) {
      const cf = path.join(VIDEO_DIR, vid.replace(/\.mp4$/i, '.chapters.json'));
      const data = JSON.parse(await readFile(cf, 'utf8'));
      const list = data.chapters || [];
      // YouTube บังคับ: เริ่ม 0:00, อย่างน้อย 3 ตอน, ห่างกัน >= 10 วินาที
      const ok = list.length >= 3 && list[0].start < 1 &&
        list.every((c, i) => i === 0 || c.start - list[i - 1].start >= 10);
      if (ok) {
        chapters = list.map((c) => `${fmtTime(c.start)} ${c.title}`);
        chapterMethod = data.method || null;
      }
    }
  } catch {
    // ไม่มีไฟล์ chapters — ข้ามไป ไม่ถือเป็นข้อผิดพลาด
  }

  const tags = [...new Set([
    'นิทานเด็ก', 'นิทานก่อนนอน', 'นิทานไทย', 'การ์ตูนเด็ก', 'นิทานอีสป',
    r.category, r.story_type,
    r.age_range ? `นิทานเด็ก ${r.age_range} ขวบ` : null,
    // คำจากหัวข้อต้นฉบับ — มักเป็นคำค้นที่ตรงกับสิ่งที่คนหาจริง
    ...(r.topic || '').split(/\s+/).filter((w) => w.length >= 4).slice(0, 3),
    'bedtime story', 'kids story', 'thai fairy tale', 'story for kids',
    'BearryTales', 'หมีอ่าน',
  ].filter(Boolean))].slice(0, 15);

  const description = [
    hook,                       // 2 บรรทัดแรก — ส่วนที่ผู้ชมเห็นก่อนกด "ดูเพิ่มเติม"
    '',
    intro,                      // เกริ่นเนื้อเรื่อง
    '',
    morals.length ? '📖 ข้อคิดจากเรื่องนี้' : null,
    ...morals.map((m) => `• ${m}`),
    morals.length ? '' : null,
    `👶 เหมาะสำหรับเด็กอายุ ${r.age_range || '3-8'} ขวบ`,
    r.category ? `📚 หมวด: ${r.category}` : null,
    paras.length ? `📖 ${paras.length} ตอน · มีคำบรรยายเสียงตลอดเรื่อง` : null,
    '',
    '🌏 เปิดคำบรรยาย (CC) เพื่อดูซับภาษาของคุณได้กว่า 100 ภาษา',
    '',
    // แบ่งตอน — YouTube อ่าน timestamp เหล่านี้แล้วสร้างแถบแบ่งตอนบน timeline
    chapters.length ? '⏱ แบ่งตอน' : null,
    ...chapters,
    chapters.length ? '' : null,
    `🐻 ${CH} — นิทานสำหรับเด็ก พร้อมภาพประกอบและเสียงบรรยาย`,
    '',
    '📱 ฟังนิทานอีกกว่า 90 เรื่องในแอป "หมีอ่าน"',
    APP_IOS ? `   iOS: ${APP_IOS}` : null,
    `   Android: ${APP_ANDROID}`,
    '',
    '🤖 ภาพประกอบและเสียงบรรยายสร้างด้วย AI',
    '',
    tags.filter((x) => !/[a-z]/i.test(x)).slice(0, 6)
      .map((t) => '#' + t.replace(/\s+/g, '')).join(' '),
  ].filter((x) => x !== null).join('\n');

  // อ่านซับมาแสดงตัวอย่าง (ตัดไว้ไม่ให้ payload ใหญ่)
  let srtPreview = null;
  const anySrt = files.portrait?.srt || files.landscape?.srt;
  if (anySrt) {
    try {
      const raw = await readFile(path.join(VIDEO_DIR, anySrt), 'utf8');
      srtPreview = raw.length > 1200 ? raw.slice(0, 1200) + '\n…' : raw;
    } catch {}
  }

  return NextResponse.json({
    id: r.id,
    // ── ส่งตรงเข้า YouTube Data API (videos.insert) ได้เลย ──
    snippet: {
      // youtube_title = ชื่อที่ปรับให้คนค้นเจอ (มีคำนำ + ช่วงอายุ ไม่เกิน 100 ตัว)
      // ถ้ายังไม่ได้สร้างไว้ ค่อยใช้ชื่อในแอปแทน
      title: r.youtube_title || r.title || `นิทาน #${r.id}`,
      description,
      tags,
      categoryId: '24',           // Entertainment
      defaultLanguage: 'th',
      defaultAudioLanguage: 'th', // สำคัญ: บอก YouTube ว่าเสียงเป็นภาษาไทย
    },
    status: {
      privacyStatus: 'private',        // อัปเป็นส่วนตัวก่อน ตรวจแล้วค่อยเปิด
      selfDeclaredMadeForKids: true,   // คอนเทนต์สำหรับเด็ก — ต้องประกาศ
      // ประกาศว่าเป็นเนื้อหาที่สร้าง/ดัดแปลงด้วย AI (บังคับตามนโยบายปี 2026)
      // ภาพ เสียงบรรยาย และเนื้อเรื่องมาจาก AI ทั้งหมด
      containsSyntheticMedia: true,
    },
    files,
    thumb: thumbFile,
    chapters,
    chapter_method: chapterMethod,
    srt_preview: srtPreview,
    meta: {
      category: r.category,
      age_range: r.age_range,
      story_type: r.story_type,
      morals,
    },
  });
}
