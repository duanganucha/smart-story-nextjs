import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_DIR =
  process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

/**
 * สถานะความพร้อมของแต่ละเรื่องก่อนสร้างวิดีโอ
 *
 * 4 ขั้น (คงที่ ไม่ได้เพิ่มลดบ่อย จึงคำนวณตรง ๆ ไม่ต้องมีตารางแยก):
 *   s1_story → s2_audio → s3_scenes → s4_video
 * แต่ละขั้น: done | pending | error
 */
export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, title, story_type, category, status, stage, error,
            paragraphs, audio_path, scenes, story,
            engine_story, engine_tts, engine_image,
            views, loves, created_at, updated_at
     FROM stories ORDER BY id ASC`
  );

  // วิดีโอที่สร้างแล้ว — ดูจากไฟล์จริงในโฟลเดอร์ out/
  // แยกแนวตั้ง/แนวนอนจากท้ายชื่อไฟล์ (_landscape.mp4 = แนวนอน)
  // 4 แบบ: แนวตั้ง/แนวนอน × เบิร์นซับ/ไม่เบิร์น
  const madeV = new Map();    // แนวตั้ง เบิร์น
  const madeVn = new Map();   // แนวตั้ง ไม่เบิร์น
  const madeH = new Map();    // แนวนอน เบิร์น
  const madeHn = new Map();   // แนวนอน ไม่เบิร์น
  const madeR = new Map();    // คลิปสั้น (_reel) — ตัดให้ไม่เกิน 90 วิ สำหรับ Reels
  const srtSet = new Set();   // ชื่อไฟล์ .srt ที่มีอยู่ (ไม่รวมนามสกุล)
  const chapByStory = new Map();  // id → { count, accurate }
  const thumbByStory = new Map(); // id → ชื่อไฟล์ปก
  const srtByStory = new Map(); // id → จำนวนไฟล์ซับ
  try {
    const all = await readdir(VIDEO_DIR);
    for (const f of all) {
      if (f.toLowerCase().endsWith('.thumb.jpg')) {
        const m = f.match(/^(\d+)_/);
        if (m) {
          // เก็บเวลาแก้ไขไว้ทำ cache-buster ให้เบราว์เซอร์โหลดปกใหม่
          let mt = 0;
          try { mt = (await stat(path.join(VIDEO_DIR, f))).mtimeMs; } catch {}
          thumbByStory.set(Number(m[1]), { file: f, v: Math.round(mt) });
        }
        continue;
      }
      if (f.toLowerCase().endsWith('.srt')) {
        srtSet.add(f.slice(0, -4));
        const m = f.match(/^(\d+)_/);
        if (m) {
          const id = Number(m[1]);
          srtByStory.set(id, (srtByStory.get(id) || 0) + 1);
        }
      }
    }
    // อ่านไฟล์ chapters (เก็บจุดตัดฉากจากความเงียบจริงตอนเรนเดอร์)
    for (const f of all) {
      if (!f.endsWith('.chapters.json')) continue;
      const m = f.match(/^(\d+)_/);
      if (!m || chapByStory.has(Number(m[1]))) continue;
      try {
        const d = JSON.parse(await readFile(path.join(VIDEO_DIR, f), 'utf8'));
        chapByStory.set(Number(m[1]),
          { count: d.count || 0, accurate: Boolean(d.accurate) });
      } catch {}
    }
    for (const f of all) {
      if (!f.toLowerCase().endsWith('.mp4')) continue;
      const m = f.match(/^(\d+)_/);
      if (!m) continue;
      const id = Number(m[1]);
      // _reel ต้องเช็คก่อน ไม่งั้นจะตกไปกอง "แนวตั้ง เบิร์น" แล้วทับไฟล์เต็ม
      if (/_reel\.mp4$/i.test(f)) { madeR.set(id, f); continue; }
      const land = /_landscape(_nosub)?\.mp4$/i.test(f);
      const nosub = /_nosub\.mp4$/i.test(f);
      if (land && nosub) madeHn.set(id, f);
      else if (land) madeH.set(id, f);
      else if (nosub) madeVn.set(id, f);
      else madeV.set(id, f);
    }
  } catch {
    // ยังไม่เคยสร้างวิดีโอ — ไม่ใช่ข้อผิดพลาด
  }

  const clips = rows.map((r) => {
    let sceneCount = 0;
    let sceneOk = 0;
    try {
      const arr = Array.isArray(r.scenes) ? r.scenes : JSON.parse(r.scenes || '[]');
      sceneCount = arr.length;
      sceneOk = arr.filter((s) => s && s.path).length;
    } catch {}

    const paraCount = (r.story || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean).length;

    const failed = r.status === 'error';
    const busy = r.status === 'processing' || r.status === 'queued';

    const s1_story = r.story ? 'done' : failed ? 'error' : busy ? 'running' : 'pending';
    const s2_audio = r.audio_path ? 'done' : failed ? 'error' : busy ? 'running' : 'pending';
    const s3_scenes = sceneOk > 0 ? 'done' : failed ? 'error' : busy ? 'running' : 'pending';
    const s4_video = (madeV.has(r.id) || madeVn.has(r.id)) ? 'done' : 'pending';
    const s5_land = (madeH.has(r.id) || madeHn.has(r.id)) ? 'done' : 'pending';

    return {
      id: r.id,
      title: r.title || `เรื่อง #${r.id}`,
      story_type: r.story_type,
      category: r.category,
      status: r.status,
      stage: r.stage,
      error: r.error,
      paragraphs: paraCount || r.paragraphs || 0,
      scene_count: sceneCount,
      scene_ok: sceneOk,
      engine_story: r.engine_story,
      engine_tts: r.engine_tts,
      engine_image: r.engine_image,
      views: r.views,
      loves: r.loves,
      updated_at: r.updated_at,
      video_file: madeV.get(r.id) || null,
      video_file_h: madeH.get(r.id) || null,
      video_file_ns: madeVn.get(r.id) || null,    // แนวตั้ง ไม่เบิร์น
      video_file_hns: madeHn.get(r.id) || null,   // แนวนอน ไม่เบิร์น
      video_file_reel: madeR.get(r.id) || null,   // คลิปสั้น <=90 วิ (Facebook Reels)
      // ไฟล์ซับ: นับรวม และเช็คทีละแบบว่ามีคู่ครบไหม
      srt_count: srtByStory.get(r.id) || 0,
      chapters: chapByStory.get(r.id) || null,
      thumb: thumbByStory.get(r.id)?.file || null,
      thumb_v: thumbByStory.get(r.id)?.v || 0,
      srt: {
        pv: madeV.has(r.id) && srtSet.has(madeV.get(r.id).slice(0, -4)),
        pn: madeVn.has(r.id) && srtSet.has(madeVn.get(r.id).slice(0, -4)),
        lv: madeH.has(r.id) && srtSet.has(madeH.get(r.id).slice(0, -4)),
        ln: madeHn.has(r.id) && srtSet.has(madeHn.get(r.id).slice(0, -4)),
      },
      s1_story,
      s2_audio,
      s3_scenes,
      s4_video,
      s5_land,
      // พร้อมสร้างวิดีโอ = มีครบทั้งเนื้อเรื่อง เสียง และฉากอย่างน้อย 1 ภาพ
      ready: Boolean(r.story && r.audio_path && sceneOk > 0),
    };
  });

  return NextResponse.json({ clips, video_dir: VIDEO_DIR });
}
