import { NextResponse } from 'next/server';
import path from 'path';
import { access } from 'fs/promises';
import { getPool } from '@/lib/db';
import { facebook } from '@/lib/publishers/facebook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VIDEO_DIR =
  process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

/**
 * โพสต์ภาพปกพร้อมแคปชันขึ้นเพจ Facebook
 *
 * ต่างจาก /api/publish ตรงที่โพสต์เป็น "รูปภาพ" ไม่ใช่วิดีโอ
 * ได้ reach คนละทางกัน และใช้ปกที่ทำไว้แล้วให้เกิดประโยชน์
 *
 * แคปชันดึงจาก story_captions ที่เขียนไว้ล่วงหน้า (scripts-gen-captions.py)
 * เพื่อไม่ให้ทุกโพสต์หน้าตาเหมือนกัน ซึ่ง Facebook จะลด reach
 *
 * body: { story_id, with_links?: true }
 */
/**
 * ดูตัวอย่างก่อนโพสต์ — คืนแคปชัน ปก และลิงก์ที่จะแนบ
 * ใช้ตรรกะเดียวกับ POST เพื่อให้สิ่งที่เห็นตรงกับสิ่งที่จะโพสต์จริง
 */
export async function GET(req) {
  const sid = Number(new URL(req.url).searchParams.get('story_id'));
  if (!Number.isInteger(sid) || sid <= 0) {
    return NextResponse.json({ error: 'story_id ไม่ถูกต้อง' }, { status: 400 });
  }
  const pool = getPool();

  const [[story]] = await pool.query(
    `SELECT id, title FROM stories WHERE id = ?`, [sid]);
  if (!story) return NextResponse.json({ error: 'ไม่พบเรื่องนี้' }, { status: 404 });

  const [[cap]] = await pool.query(
    `SELECT caption, hook_style, used_at FROM story_captions
     WHERE story_id = ? AND variant = 'photo'`, [sid]);

  const { readdir } = await import('fs/promises');
  let thumb = null;
  try {
    for (const f of await readdir(VIDEO_DIR)) {
      if (f.startsWith(`${sid}_`) && f.toLowerCase().endsWith('.thumb.jpg')) { thumb = f; break; }
    }
  } catch {}

  const [[dup]] = await pool.query(
    `SELECT remote_url FROM publish_jobs
     WHERE story_id = ? AND platform='facebook' AND layout='photo'
       AND status IN ('uploading','processing','done') LIMIT 1`, [sid]);

  const links = await pickLinks(pool, sid);

  return NextResponse.json({
    story_id: sid,
    title: story.title,
    caption: cap?.caption || null,
    hook_style: cap?.hook_style || null,
    thumb,
    links,
    posted_url: dup?.remote_url || null,
    ready: !!(cap?.caption && thumb && !dup),
  });
}

/** เลือกลิงก์คลิปเต็ม — Facebook มาก่อน YouTube (ดูเหตุผลใน POST) */
async function pickLinks(pool, sid) {
  const [rows] = await pool.query(
    `SELECT platform, layout, remote_url FROM publish_jobs
     WHERE story_id = ? AND status IN ('done','processing')
       AND remote_url IS NOT NULL AND layout <> 'photo'
     ORDER BY id DESC`, [sid]);
  const fbFull = rows.find((r) => r.platform === 'facebook' && r.layout === 'landscape')
              || rows.find((r) => r.platform === 'facebook' && r.layout === 'portrait');
  if (fbFull) return [{ label: '▶ ดูนิทานฉบับเต็ม', url: fbFull.remote_url }];
  const yt = rows.find((r) => r.platform === 'youtube');
  return yt ? [{ label: '▶ ดูนิทานฉบับเต็มบน YouTube', url: yt.remote_url }] : [];
}

export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }); }

  const sid = Number(body.story_id);
  if (!Number.isInteger(sid) || sid <= 0) {
    return NextResponse.json({ error: 'story_id ไม่ถูกต้อง' }, { status: 400 });
  }

  const ready = facebook.configured();
  if (!ready.ready) {
    return NextResponse.json(
      { error: `Facebook ยังไม่ตั้งค่า — ขาด ${ready.missing.join(', ')}` },
      { status: 400 });
  }

  const pool = getPool();

  const [[story]] = await pool.query(
    `SELECT id, title, youtube_title FROM stories WHERE id = ?`, [sid]);
  if (!story) {
    return NextResponse.json({ error: 'ไม่พบเรื่องนี้' }, { status: 404 });
  }

  const [[cap]] = await pool.query(
    `SELECT caption FROM story_captions WHERE story_id = ? AND variant = 'photo'`, [sid]);
  if (!cap?.caption) {
    return NextResponse.json(
      { error: 'ยังไม่มีแคปชัน — รัน scripts-gen-captions.py ก่อน' }, { status: 400 });
  }

  // หาไฟล์ปก — ต้องมีไฟล์จริงถึงโพสต์ได้
  const { readdir } = await import('fs/promises');
  let thumb = null;
  try {
    for (const f of await readdir(VIDEO_DIR)) {
      if (f.startsWith(`${sid}_`) && f.toLowerCase().endsWith('.thumb.jpg')) { thumb = f; break; }
    }
  } catch {}
  if (!thumb || !(await exists(path.join(VIDEO_DIR, thumb)))) {
    return NextResponse.json(
      { error: 'ยังไม่มีปกคลิป — สร้างปกก่อน' }, { status: 400 });
  }

  // กันโพสต์ซ้ำ
  const [[dup]] = await pool.query(
    `SELECT id, remote_url FROM publish_jobs
     WHERE story_id = ? AND platform = 'facebook' AND layout = 'photo'
       AND status IN ('uploading','processing','done') LIMIT 1`, [sid]);
  if (dup) {
    return NextResponse.json(
      { error: 'เรื่องนี้โพสต์ภาพไปแล้ว', url: dup.remote_url }, { status: 409 });
  }

  // ลิงก์อ้างอิงไปคลิปเต็ม — ให้คนที่เห็นภาพไปดูต่อได้
  //
  // ลำดับความสำคัญ: คลิปเต็มบน Facebook มาก่อน YouTube เสมอ
  //   1) ลิงก์ในแพลตฟอร์มเดียวกันไม่โดนลด reach เลย
  //      (ลิงก์ YouTube โดนลดหนักสุดเพราะเป็นคู่แข่งตรง ๆ)
  //   2) คนดูไม่ต้องออกจากแอป Facebook → ดูจบมากกว่า
  //   3) ยอดวิวสะสมอยู่บนเพจเราเอง ช่วยให้ระบบดันคลิปถัดไป
  // ใช้ YouTube ต่อเมื่อยังไม่มีคลิปเต็มบน Facebook
  const links = body.with_links === false ? [] : await pickLinks(pool, sid);

  const [ins] = await pool.query(
    `INSERT INTO publish_jobs (story_id, platform, layout, status, privacy, title, started_at)
     VALUES (?, 'facebook', 'photo', 'uploading', 'public', ?, NOW())`,
    [sid, story.youtube_title || story.title]);
  const jobId = ins.insertId;

  try {
    // ⚠️ ไม่ส่ง links เข้าแคปชัน — Facebook ลด reach โพสต์ที่มีลิงก์ออก
    // นอกแพลตฟอร์ม โดยเฉพาะ YouTube ซึ่งเป็นคู่แข่งตรง ๆ
    // ย้ายไปโพสต์เป็นคอมเมนต์แทน (คอมเมนต์ไม่โดนลด)
    const out = await facebook.postPhoto({
      photoPath: path.join(VIDEO_DIR, thumb),
      caption: cap.caption,
    });

    if (links.length) {
      try {
        await facebook.comment(out.remote_id,
          links.map((l) => `${l.label}\n${l.url}`).join('\n\n'));
      } catch {
        // แปะลิงก์ไม่สำเร็จไม่ควรทำให้ทั้งงานล้ม — โพสต์ขึ้นแล้ว
      }
    }
    await pool.query(
      `UPDATE publish_jobs SET status='done', remote_id=?, remote_url=?,
              progress=100, ended_at=NOW() WHERE id=?`,
      [out.remote_id, out.remote_url, jobId]);
    await pool.query(
      `UPDATE story_captions SET used_at = NOW()
       WHERE story_id = ? AND variant = 'photo'`, [sid]);

    return NextResponse.json({ ok: true, job_id: jobId, ...out, links: links.length });
  } catch (e) {
    const msg = String(e.message || e).slice(0, 500);
    await pool.query(
      `UPDATE publish_jobs SET status='error', error=?, ended_at=NOW() WHERE id=?`,
      [msg, jobId]).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
