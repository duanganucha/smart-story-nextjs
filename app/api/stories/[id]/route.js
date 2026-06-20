import { NextResponse } from 'next/server';
import { rm, unlink } from 'fs/promises';
import path from 'path';
import { getPool } from '@/lib/db';
import { processScenesOnly, processAudioOnly, retryStory, regenerateScene } from '@/lib/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Actions: { action: 'retry' | 'scenes' }
export async function POST(req, { params }) {
  const { id } = await params;
  const sid = Number(id);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === 'scenes') {
    processScenesOnly(sid).catch(() => {}); // background
    return NextResponse.json({ ok: true, id: sid, action });
  }
  if (action === 'audio') {
    processAudioOnly(sid).catch(() => {}); // background
    return NextResponse.json({ ok: true, id: sid, action });
  }
  if (action === 'retry') {
    await retryStory(sid); // resets row + fires background processing
    return NextResponse.json({ ok: true, id: sid, action });
  }
  if (action === 'scene') {
    regenerateScene(sid, body.index, body.prompt).catch(() => {}); // background, single scene
    return NextResponse.json({ ok: true, id: sid, action, index: body.index });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export async function PATCH(req, { params }) {
  const { id } = await params;
  const sid = Number(id);
  const body = await req.json().catch(() => ({}));
  const fields = {};
  if (typeof body.title === 'string') fields.title = body.title;
  if (typeof body.story === 'string') fields.story = body.story;
  if (Array.isArray(body.moral)) fields.moral = JSON.stringify(body.moral.filter((x) => String(x).trim()));
  // reorder scenes: client sends the reordered scenes array; renumber n by position
  if (Array.isArray(body.scenes)) fields.scenes = JSON.stringify(body.scenes.map((s, i) => ({ ...s, n: i + 1 })));

  if (typeof body.rating === 'number') fields.rating = body.rating;
  if (typeof body.views === 'number') fields.views = body.views;

  const incrementViews = body.increment_views === true;

  // Per-user love toggle via story_loves table
  const pool = getPool();
  const lovingUserId = body.user_id ? Number(body.user_id) : null;
  if (lovingUserId && body.is_loved !== undefined) {
    const wantLove = body.is_loved === true || body.is_loved === 1;
    if (wantLove) {
      await pool.query(
        'INSERT IGNORE INTO story_loves (story_id, user_id) VALUES (?, ?)',
        [sid, lovingUserId]
      );
    } else {
      await pool.query(
        'DELETE FROM story_loves WHERE story_id = ? AND user_id = ?',
        [sid, lovingUserId]
      );
    }
    // Recount loves from junction table
    const [[{ cnt }]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM story_loves WHERE story_id = ?',
      [sid]
    );
    fields.loves = cnt;
  }

  const keys = Object.keys(fields);
  if (!keys.length && !incrementViews) {
    return NextResponse.json({ error: 'no editable fields' }, { status: 400 });
  }

  let queryStr = 'UPDATE stories SET ';
  const queryParams = [];
  const updateParts = keys.map((k) => {
    queryParams.push(fields[k]);
    return `\`${k}\` = ?`;
  });

  if (incrementViews) {
    updateParts.push('`views` = `views` + 1');
  }

  queryStr += updateParts.join(', ') + ' WHERE id = ?';
  queryParams.push(sid);

  await pool.query(queryStr, queryParams);
  const [rows] = await pool.query(
    `SELECT s.*, IF(sl.user_id IS NOT NULL, 1, 0) AS is_loved
     FROM stories s
     LEFT JOIN story_loves sl ON sl.story_id = s.id AND sl.user_id = ?
     WHERE s.id = ?`,
    [lovingUserId || 0, sid]
  );
  return NextResponse.json(rows[0] || { ok: true });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  const sid = Number(id);
  const pool = getPool();
  const [rows] = await pool.query('SELECT audio_path, image_path FROM stories WHERE id = ?', [sid]);
  if (rows.length) {
    const r = rows[0];
    const del = async (p) => {
      if (p) {
        try { await unlink(path.join(process.cwd(), 'public', p.replace(/^\//, ''))); } catch {}
      }
    };
    await del(r.audio_path);
    await del(r.image_path);
    try { await rm(path.join(process.cwd(), 'public', 'scenes', String(sid)), { recursive: true, force: true }); } catch {}
  }
  await pool.query('DELETE FROM stories WHERE id = ?', [sid]);
  return NextResponse.json({ ok: true, deleted: sid });
}
