import { spawn } from 'child_process';
import path from 'path';
import { getPool } from '@/lib/db';

/**
 * คิวสร้างวิดีโอ — เก็บสถานะใน MySQL (ตาราง render_jobs)
 *
 * เก็บใน DB แทนหน่วยความจำ เพื่อให้คิวรอดเมื่อรีสตาร์ทเซิร์ฟเวอร์
 * รันทีละงานเพราะ ffmpeg กิน CPU เกือบเต็มอยู่แล้ว รันขนานไม่ช่วยให้เร็วขึ้น
 */

const SCRIPT_DIR =
  process.env.VIDEO_SCRIPT_DIR ||
  path.join(process.cwd(), '..', 'bearrytales-video');
const PYTHON = process.env.PYTHON || 'python3';

// ตัวจับเวลา/โปรเซสยังต้องอยู่ในหน่วยความจำ (เก็บใน globalThis กัน hot-reload กิน)
const g = globalThis;
if (!g.__vq) g.__vq = { proc: null, jobId: null, booted: false };
const S = g.__vq;

/**
 * งานที่ค้างสถานะ running แต่ไม่มีโปรเซสจริง = เซิร์ฟเวอร์ถูกรีสตาร์ทกลางคัน
 * คืนสถานะเป็น queued เพื่อให้ทำใหม่ (เรนเดอร์ซ้ำได้ ไม่มีผลข้างเคียง)
 */
async function recoverOrphans(pool) {
  if (S.booted) return;
  S.booted = true;
  await pool.query(
    `UPDATE render_jobs SET status='queued', started_at=NULL
     WHERE status='running'`
  ).catch(() => {});
}

export async function queueState() {
  const pool = getPool();
  await recoverOrphans(pool);
  const [rows] = await pool.query(
    `SELECT id, story_id, layout, status, error,
            UNIX_TIMESTAMP(started_at)*1000 AS started,
            UNIX_TIMESTAMP(ended_at)*1000   AS ended
     FROM render_jobs
     WHERE status IN ('queued','running')
        OR ended_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
     ORDER BY FIELD(status,'running','queued','error','done'), id`
  );
  const running = rows.find((r) => r.status === 'running');
  return {
    running: running ? `${running.story_id}:${running.layout}` : null,
    jobs: rows.map((r) => ({
      key: String(r.id),
      id: r.story_id,
      layout: r.layout,
      status: r.status,
      error: r.error || null,
      started: r.started || null,
      ended: r.ended || null,
    })),
  };
}

/** เพิ่มงานเข้าคิว — งานที่ค้างอยู่แล้วจะถูกข้าม (UNIQUE key กันซ้ำให้) */
export async function enqueue(ids, layouts, burn = true) {
  const pool = getPool();
  await recoverOrphans(pool);
  let added = 0;
  for (const id of ids) {
    for (const layout of layouts) {
      try {
        const [r] = await pool.query(
          `INSERT INTO render_jobs (story_id, layout, status, burn)
           VALUES (?, ?, 'queued', ?)`,
          [Number(id), layout, burn ? 1 : 0]
        );
        if (r.affectedRows) added++;
      } catch (e) {
        // ER_DUP_ENTRY = มีงานค้างอยู่แล้ว ไม่ถือเป็นข้อผิดพลาด
        if (e?.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
  }
  tick();
  return added;
}

export async function cancelPending() {
  const pool = getPool();
  const [r] = await pool.query(
    `UPDATE render_jobs SET status='canceled', ended_at=NOW()
     WHERE status='queued'`
  );
  return r.affectedRows || 0;
}

/** เริ่มงานถัดไปถ้าว่างอยู่ */
async function tick() {
  if (S.proc) return;
  const pool = getPool();

  const [[job]] = await pool.query(
    `SELECT id, story_id, layout, burn FROM render_jobs
     WHERE status='queued' ORDER BY id LIMIT 1`
  );
  if (!job) return;

  // กันสองคำขอแย่งงานเดียวกัน — อัปเดตสำเร็จเท่านั้นจึงได้สิทธิ์รัน
  const [upd] = await pool.query(
    `UPDATE render_jobs SET status='running', started_at=NOW()
     WHERE id=? AND status='queued'`,
    [job.id]
  );
  if (!upd.affectedRows) return;

  const args = ['-u', 'make-video.py', String(job.story_id)];
  if (job.layout === 'landscape') args.push('--layout', 'landscape');
  if (job.burn === 0) args.push('--no-burn');

  const finish = async (status, error) => {
    S.proc = null;
    S.jobId = null;
    await pool.query(
      `UPDATE render_jobs SET status=?, error=?, ended_at=NOW() WHERE id=?`,
      [status, error ? String(error).slice(-400) : null, job.id]
    ).catch(() => {});
    tick();
  };

  try {
    const p = spawn(PYTHON, args, { cwd: SCRIPT_DIR });
    S.proc = p;
    S.jobId = job.id;

    let tail = '';
    p.stdout.on('data', (b) => { tail = (tail + b.toString()).slice(-2000); });
    p.stderr.on('data', (b) => { tail = (tail + b.toString()).slice(-2000); });

    p.on('close', (code) => finish(code === 0 ? 'done' : 'error',
                                   code === 0 ? null : (tail.trim() || `exit ${code}`)));
    p.on('error', (e) => finish('error', e.message || e));
  } catch (e) {
    await finish('error', e.message || e);
  }
}

/** เรียกตอนเซิร์ฟเวอร์เริ่ม เพื่อทำงานที่ค้างอยู่ต่อ */
export async function resume() {
  const pool = getPool();
  await recoverOrphans(pool);
  tick();
}
