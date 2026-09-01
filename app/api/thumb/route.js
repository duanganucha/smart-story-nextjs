import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SCRIPT_DIR =
  process.env.VIDEO_SCRIPT_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video');
const PYTHON = process.env.PYTHON || 'python3';

/**
 * สร้างปกคลิป YouTube (1280×720) ด้วย make-thumb.py
 *
 * ปกใช้เวลาแค่ไม่กี่วินาที (ไม่มี zoompan เหมือนวิดีโอ) จึงรันตรง
 * ไม่ต้องเข้าคิวเหมือน render_jobs
 *
 * body: { ids: [92, 51], scene?: 1 }
 */
export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }); }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (!ids.length) {
    return NextResponse.json({ error: 'ยังไม่ได้เลือกเรื่อง' }, { status: 400 });
  }
  if (ids.length > 30) {
    return NextResponse.json({ error: 'สร้างได้ครั้งละไม่เกิน 30 เรื่อง' }, { status: 400 });
  }

  const scene = Number(body.scene) || 1;
  const side = body.side === 'right' ? 'right' : 'left';
  const THEMES = ['forest', 'night', 'berry', 'sunset', 'ocean', 'ink', 'auto'];
  const theme = THEMES.includes(body.theme) ? body.theme : 'auto';
  // opacity = 0 → ให้สคริปต์เลือกเองตามความสว่างของภาพ
  const opacity = body.opacity ? Math.max(0.2, Math.min(0.95, Number(body.opacity))) : 0;

  const preview = body.preview === true;
  const args = ['-u', 'make-thumb.py', ...ids.map(String),
                '--scene', String(scene), '--side', side,
                '--theme', theme, '--opacity', String(opacity)];
  if (preview) args.push('--preview');

  const out = await new Promise((resolve) => {
    let text = '';
    try {
      const p = spawn(PYTHON, args, { cwd: SCRIPT_DIR });
      p.stdout.on('data', (b) => { text += b.toString(); });
      p.stderr.on('data', (b) => { text += b.toString(); });
      p.on('close', (code) => resolve({ code, text }));
      p.on('error', (e) => resolve({ code: -1, text: String(e.message || e) }));
    } catch (e) {
      resolve({ code: -1, text: String(e.message || e) });
    }
  });

  if (out.code !== 0) {
    return NextResponse.json(
      { error: 'สร้างปกไม่สำเร็จ', detail: out.text.trim().slice(-400) },
      { status: 500 });
  }

  // นับผลจากบรรทัด "✓ #<id>"
  const made = [...out.text.matchAll(/✓ #(\d+)/g)].map((m) => Number(m[1]));
  const skipped = [...out.text.matchAll(/[⚠✗] #(\d+)/g)].map((m) => Number(m[1]));

  if (preview) {
    // สคริปต์พิมพ์ชื่อไฟล์พรีวิวออกมาบรรทัดที่ขึ้นต้นด้วย PREVIEW:
    const m = out.text.match(/PREVIEW:(.+)/);
    return NextResponse.json({
      ok: true,
      preview: m ? `/api/videos/${encodeURIComponent(m[1].trim())}` : null,
      theme: (out.text.match(/· (\w+)/) || [])[1] || null,
    });
  }

  return NextResponse.json({
    ok: true, made, skipped,
    log: out.text.trim().slice(-600),
  });
}
