import { NextResponse } from 'next/server';
import path from 'path';
import { getPool } from '@/lib/db';
import { getPublisher, platformStatus, PLATFORMS } from '@/lib/publishers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// เพดานอัปโหลดต่อวันต่อแพลตฟอร์ม — กันเผลอกดรัวจนถูกตีเป็น spam
//
// YouTube ปี 2026 เข้มเรื่อง "mass-produced content": อัป 3+ คลิป/วัน
// ที่เป็น AI ล้วนเสี่ยงถูกระงับช่อง แม้โควตา API จะยอมให้ถึง 100 ครั้ง/วัน
// (โควตาเทคนิค ≠ สิ่งที่ปลอดภัย)
const DAILY_LIMIT = {
  youtube: Number(process.env.YT_DAILY_LIMIT || 2),
  tiktok: Number(process.env.TIKTOK_DAILY_LIMIT || 3),
  facebook: Number(process.env.FB_DAILY_LIMIT || 3),
};

const VIDEO_DIR =
  process.env.VIDEO_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video', 'out');

/**
 * สถานะการเผยแพร่: แพลตฟอร์มไหนตั้งค่าแล้ว + เรื่องไหนอัปไปที่ไหนแล้ว
 * ใช้ให้ UI แสดงเครื่องหมาย ✓ หน้าปุ่มที่อัปเสร็จแล้ว
 */
export async function GET(req) {
  const pool = getPool();
  const sid = new URL(req.url).searchParams.get('story_id');

  let jobs = [];
  try {
    const [rows] = sid
      ? await pool.query(
          `SELECT * FROM publish_jobs WHERE story_id=? ORDER BY id DESC`, [Number(sid)])
      : await pool.query(
          `SELECT * FROM publish_jobs
           WHERE status IN ('queued','uploading','processing')
              OR ended_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           ORDER BY id DESC LIMIT 500`);
    jobs = rows;
  } catch {
    // ตารางยังไม่ถูกสร้าง — ไม่ถือเป็นข้อผิดพลาด
  }

  // สรุปว่าเรื่องไหนอัปสำเร็จไปที่ไหนแล้ว (story_id → { youtube:{...} })
  const done = {};
  for (const j of jobs) {
    if (j.status !== 'done') continue;
    (done[j.story_id] ||= {})[j.platform] = {
      layout: j.layout, url: j.remote_url, at: j.ended_at,
    };
  }

  // จำนวนที่อัปไปแล้ววันนี้ต่อแพลตฟอร์ม — ให้ UI เตือนก่อนเต็มเพดาน
  const today = {};
  for (const p of Object.keys(DAILY_LIMIT)) {
    today[p] = {
      used: jobs.filter((j) => j.platform === p &&
        ['queued', 'uploading', 'processing', 'done'].includes(j.status) &&
        new Date(j.created_at) >= new Date(new Date().toDateString())).length,
      limit: DAILY_LIMIT[p],
    };
  }

  return NextResponse.json({ platforms: platformStatus(), jobs, done, today });
}

/** สั่งอัปโหลด — body: { story_id, platform, layout, privacy? } */
export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }); }

  const sid = Number(body.story_id);
  const platform = String(body.platform || '');
  const layout = body.layout === 'landscape' ? 'landscape' : 'portrait';

  if (!Number.isInteger(sid)) {
    return NextResponse.json({ error: 'story_id ไม่ถูกต้อง' }, { status: 400 });
  }
  const def = PLATFORMS.find((p) => p.key === platform);
  if (!def) {
    return NextResponse.json({ error: 'ไม่รู้จักแพลตฟอร์มนี้' }, { status: 400 });
  }
  if (!def.layouts.includes(layout)) {
    return NextResponse.json(
      { error: `${def.label} ไม่รองรับวิดีโอ${layout === 'portrait' ? 'แนวตั้ง' : 'แนวนอน'}` },
      { status: 400 });
  }

  const pub = getPublisher(platform);
  const cfg = pub.configured();
  if (!cfg.ready) {
    return NextResponse.json({
      error: `${def.label} ยังไม่ได้ตั้งค่า — ขาด ${cfg.missing.join(', ')} ใน .env.local`,
      missing: cfg.missing,
      note: cfg.note,
    }, { status: 428 });   // 428 = ต้องตั้งค่าก่อน
  }

  // ดึง metadata จาก API ที่มีอยู่แล้ว (ใช้ตัวเดียวกับที่ dialog แสดง)
  const origin = new URL(req.url).origin;
  const mRes = await fetch(`${origin}/api/publish-meta/${sid}`, {
    headers: { cookie: req.headers.get('cookie') || '' },
  });
  if (!mRes.ok) {
    return NextResponse.json({ error: 'ดึงข้อมูลเรื่องไม่สำเร็จ' }, { status: 500 });
  }
  const meta = await mRes.json();

  // ตั้งเวลาเผยแพร่ (ไม่บังคับ) — YouTube รับเฉพาะเมื่อ privacyStatus เป็น private
  // รูปแบบ ISO 8601 พร้อม timezone เช่น 2026-09-02T19:00:00+07:00
  if (body.publish_at) {
    const at = new Date(body.publish_at);
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: 'รูปแบบวันเวลาไม่ถูกต้อง' }, { status: 400 });
    }
    if (at.getTime() < Date.now() + 60_000) {
      return NextResponse.json(
        { error: 'เวลาเผยแพร่ต้องเป็นอนาคต (อย่างน้อย 1 นาทีข้างหน้า)' },
        { status: 400 });
    }
    meta.status = { ...meta.status, privacyStatus: 'private',
                    publishAt: at.toISOString() };
  }
  const files = meta.files?.[layout];

  // เลือกไฟล์ให้เหมาะกับแพลตฟอร์ม:
  //   YouTube  รับไฟล์ซับแยกได้ → ใช้ตัวไม่เบิร์น เพื่อให้แปลอัตโนมัติได้ 100+ ภาษา
  //   Reels/TikTok ไม่รับไฟล์ซับ และคนส่วนใหญ่ดูแบบปิดเสียง → ต้องเบิร์นซับติดภาพ
  if (files) {
    const wantBurned = platform !== 'youtube';

    // Facebook Reels รับไม่เกิน 90 วินาที — คลิปนิทานยาว 2-5 นาที
    // ถ้าส่งคลิปเต็มไป Facebook รับไฟล์แต่จัดเป็น "วิดีโอธรรมดา"
    // ซึ่งไม่ได้ reach จากฟีด Reels เลย จึงต้องใช้ตัวที่ตัดมาแล้ว
    // (สร้างด้วย bearrytales-video/make-reel.py)
    const wantReel = platform === 'facebook' && layout === 'portrait';

    const pick = wantReel
      ? (files.video_reel || files.video_burned || files.video_nosub)
      : wantBurned
        ? (files.video_burned || files.video_nosub)
        : (files.video_nosub || files.video_burned);
    if (pick) {
      files.video = pick;
      files.nosub = pick === files.video_nosub;
      files.is_reel = pick === files.video_reel;
    }
    // ซับแยกส่งเฉพาะ YouTube — แพลตฟอร์มอื่นเบิร์นมาในภาพแล้ว
    if (wantBurned) files.srt = null;
  }

  if (!files?.video) {
    return NextResponse.json(
      { error: `ยังไม่มีวิดีโอ${layout === 'portrait' ? 'แนวตั้ง' : 'แนวนอน'}ของเรื่องนี้` },
      { status: 400 });
  }

  const pool = getPool();

  // นับงานที่อัปไปแล้ววันนี้ (รวมที่กำลังทำอยู่)
  const cap = DAILY_LIMIT[platform] ?? 2;
  const [[{ used }]] = await pool.query(
    `SELECT COUNT(*) AS used FROM publish_jobs
     WHERE platform=? AND status IN ('queued','uploading','processing','done')
       AND created_at >= CURDATE()`,
    [platform]
  );
  if (used >= cap) {
    return NextResponse.json({
      error: `วันนี้อัปขึ้น ${def.label} ครบ ${cap} คลิปแล้ว — ` +
             `อัปมากเกินไปเสี่ยงถูกตีเป็นสแปม ลองใหม่พรุ่งนี้`,
      limit: cap, used,
    }, { status: 429 });
  }

  let jobId;
  try {
    const [r] = await pool.query(
      `INSERT INTO publish_jobs (story_id, platform, layout, status, privacy, title, publish_at)
       VALUES (?,?,?,'uploading',?,?,?)`,
      [sid, platform, layout, body.privacy || 'private', meta.snippet.title,
       body.publish_at ? new Date(body.publish_at) : null]
    );
    jobId = r.insertId;
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'เรื่องนี้กำลังอัปโหลดอยู่แล้ว' }, { status: 409 });
    }
    throw e;
  }

  await pool.query(`UPDATE publish_jobs SET started_at=NOW() WHERE id=?`, [jobId]);

  // อัปโหลดเบื้องหลัง — ตอบ 202 กลับทันที ไม่ให้ผู้ใช้รอ
  (async () => {
    try {
      const out = await pub.upload({
        videoPath: path.join(VIDEO_DIR, files.video),
        srtPath: files.srt ? path.join(VIDEO_DIR, files.srt) : null,
        thumbPath: meta.thumb ? path.join(VIDEO_DIR, meta.thumb) : null,
        snippet: meta.snippet,
        status: meta.status,
        layout,
        privacy: body.privacy,
        onProgress: (p) => {
          pool.query(`UPDATE publish_jobs SET progress=? WHERE id=?`, [p, jobId])
              .catch(() => {});
        },
      });
      await pool.query(
        `UPDATE publish_jobs
         SET status=?, remote_id=?, remote_url=?, progress=100, ended_at=NOW()
         WHERE id=?`,
        [out.pending ? 'processing' : 'done', out.remote_id, out.remote_url, jobId]
      );

      // คลิปสั้นบน Facebook: แปะลิงก์คลิปเต็มไว้ในคอมเมนต์
      // ใส่ในคอมเมนต์ไม่ใช่แคปชัน เพราะ Facebook ลด reach โพสต์ที่มี
      // ลิงก์ออกนอกแพลตฟอร์มในตัวโพสต์ แต่ลิงก์ในคอมเมนต์ไม่โดนลด
      if (platform === 'facebook' && files.is_reel && out.remote_id) {
        try {
          const [full] = await pool.query(
            `SELECT platform, remote_url FROM publish_jobs
             WHERE story_id = ? AND status IN ('done','processing')
               AND remote_url IS NOT NULL AND layout <> 'photo' AND id <> ?
             ORDER BY FIELD(platform,'facebook','youtube'), id DESC LIMIT 1`,
            [sid, jobId]);
          if (full.length) {
            // ชี้ไปคลิปเต็มบน Facebook ก่อนเสมอ — ลิงก์ในแพลตฟอร์มเดียวกัน
            // ไม่โดนลด reach และคนดูไม่ต้องออกจากแอป
            const where = full[0].platform === 'youtube' ? ' บน YouTube' : '';
            await pub.comment(out.remote_id,
              `🎬 ดูนิทานฉบับเต็ม${where}ได้ที่นี่\n${full[0].remote_url}`);
          }
        } catch {
          // แปะลิงก์ไม่สำเร็จไม่ควรทำให้ทั้งงานล้ม — คลิปขึ้นแล้ว
        }
      }
    } catch (e) {
      await pool.query(
        `UPDATE publish_jobs SET status='error', error=?, ended_at=NOW() WHERE id=?`,
        [String(e.message || e).slice(0, 500), jobId]
      ).catch(() => {});
    }
  })().catch(() => {});

  return NextResponse.json({ ok: true, job_id: jobId, platform, layout }, { status: 202 });
}
