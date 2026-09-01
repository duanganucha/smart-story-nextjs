import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// วิดีโอถูกสร้างโดย bearrytales-video/make-video.py และเก็บไว้นอก public/
// (ไฟล์ใหญ่ ไม่ควรอยู่ในโค้ด repo) จึงต้องมี API อ่านรายการและสตรีมให้
export const VIDEO_DIR =
  process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

/** ดึง story id จากชื่อไฟล์รูปแบบ "<id>_<ชื่อเรื่อง>.mp4" */
function parseId(name) {
  const m = name.match(/^(\d+)_/);
  return m ? Number(m[1]) : null;
}

export async function GET() {
  let names = [];
  try {
    names = (await readdir(VIDEO_DIR)).filter((f) => f.toLowerCase().endsWith('.mp4'));
  } catch {
    // ยังไม่ได้สร้างวิดีโอเลย — ไม่ถือว่าผิดพลาด
    return NextResponse.json({ videos: [], dir: VIDEO_DIR });
  }

  const files = [];
  for (const name of names) {
    try {
      const st = await stat(path.join(VIDEO_DIR, name));
      files.push({ name, id: parseId(name), size: st.size, mtime: st.mtimeMs });
    } catch {}
  }

  // เติมข้อมูลเรื่องจากฐานข้อมูล (ชื่อ ยอดวิว หัวใจ) ให้การ์ดแสดงผลได้ครบ
  const ids = files.map((f) => f.id).filter((x) => Number.isInteger(x));
  let meta = {};
  if (ids.length) {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT id, title, story_type, category, views, loves, rating
         FROM stories WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      meta = Object.fromEntries(rows.map((r) => [r.id, r]));
    } catch {
      // ฐานข้อมูลล่มก็ยังดูวิดีโอได้ แค่ไม่มีข้อมูลประกอบ
    }
  }

  const videos = files
    .map((f) => ({
      ...f,
      title: meta[f.id]?.title || f.name.replace(/^\d+_/, '').replace(/\.mp4$/i, ''),
      story_type: meta[f.id]?.story_type ?? null,
      category: meta[f.id]?.category ?? null,
      views: meta[f.id]?.views ?? null,
      loves: meta[f.id]?.loves ?? null,
      rating: meta[f.id]?.rating ?? null,
      url: `/api/videos/${encodeURIComponent(f.name)}`,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json({ videos, dir: VIDEO_DIR });
}
