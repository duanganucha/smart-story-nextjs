import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { processStory } from '@/lib/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req) {
  const pool = getPool();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id');
  const viewerId = searchParams.get('viewer_id');
  const where = userId ? 'WHERE s.user_id = ?' : '';
  const params = userId ? [Number(userId)] : [];
  const viewerIdNum = viewerId ? Number(viewerId) : null;

  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, u.name AS owner_name, u.avatar_url AS owner_avatar,
            s.student_name, s.story_type, s.category, s.language, s.paragraphs, s.voice_speed, s.voice_gender, s.aspect_ratio, s.age_range,
            s.source_type, s.engine_story, s.engine_tts, s.engine_image, s.topic,
            s.image_description, s.title, s.story, s.moral, s.scenes, s.audio_path, s.image_path,
            s.status, s.stage, s.error, s.rating, s.views, s.created_at, s.updated_at,
            s.loves,
            IF(sl.user_id IS NOT NULL, 1, 0) AS is_loved
     FROM stories s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN story_loves sl ON sl.story_id = s.id AND sl.user_id = ?
     ${where} ORDER BY s.id DESC LIMIT 200`,
    [viewerIdNum, ...params]
  );
  return NextResponse.json(rows);
}

export async function POST(req) {
  const form = await req.formData();
  const student_name = (form.get('student_name') || 'นักเรียน').toString().trim() || 'นักเรียน';
  const story_type = (form.get('story_type') || 'นิทาน').toString().trim() || 'นิทาน';
  const CATEGORIES = ['ผจญภัย', 'แฟนตาซี', 'มิตรภาพ', 'สัตว์และธรรมชาติ', 'ความรู้และวิทยาศาสตร์', 'คุณธรรมและข้อคิด'];
  const category = CATEGORIES.includes(form.get('category')) ? form.get('category') : null;
  const language = (form.get('language') || 'thai').toString().trim() || 'thai';
  const topic = (form.get('topic') || '').toString().trim();
  const paragraphs = Math.min(10, Math.max(1, parseInt(form.get('paragraphs')) || 6));
  const voice_speed = ['slow', 'normal', 'fast'].includes(form.get('voice_speed')) ? form.get('voice_speed') : 'normal';
  const voice_gender = form.get('voice_gender') === 'male' ? 'male' : 'female';
  const aspect_ratio = ['16:9', '1:1', '9:16'].includes(form.get('aspect_ratio')) ? form.get('aspect_ratio') : '16:9';
  const age_range = ['3-5', '6-8', '9-12'].includes(form.get('age_range')) ? form.get('age_range') : '6-8';
  const user_id = parseInt(form.get('user_id')) || null;
  const image = form.get('image');
  const hasImage = image && typeof image.arrayBuffer === 'function' && image.size > 0;

  if (!hasImage && !topic) {
    return NextResponse.json({ error: 'ต้องใส่รูปภาพ หรือ หัวข้อ (topic) อย่างน้อยหนึ่งอย่าง' }, { status: 400 });
  }

  let imageBuffer = null;
  let mime = null;
  if (hasImage) {
    imageBuffer = Buffer.from(await image.arrayBuffer());
    mime = image.type || 'image/jpeg';
  }
  const source_type = hasImage ? 'image' : 'topic';

  const pool = getPool();
  const [r] = await pool.query(
    `INSERT INTO stories (user_id, student_name, story_type, category, language, source_type, topic, paragraphs, voice_speed, voice_gender, aspect_ratio, age_range, status, stage)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'queued', 'รอคิว')`,
    [user_id, student_name, story_type, category, language, source_type, topic || null, paragraphs, voice_speed, voice_gender, aspect_ratio, age_range]
  );
  const id = r.insertId;

  // Fire-and-forget: process in background so many jobs run in parallel.
  processStory(id, {
    student_name,
    story_type,
    category,
    language,
    topic,
    paragraphs,
    voice_speed,
    voice_gender,
    aspect_ratio,
    age_range,
    imageBuffer,
    mime,
  }).catch(() => {});

  return NextResponse.json({ id, status: 'queued' }, { status: 202 });
}
