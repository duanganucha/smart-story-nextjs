// Generate 10 Thai children's stories (age 3-5) TEXT via SUT (sut-gen-story.py),
// insert into local MySQL. Images + audio are added later when an image engine
// is available (SUT imagen removed / Gemini capped). Run:
//   node --env-file=.env.local scripts-gen-10-stories.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
const exec = promisify(execFile);

const SCRIPT = `${process.env.HOME}/bin/sut-gen-story.py`;
const MODEL = 'google/gemini-3-flash-preview'; // current SUT model (old gemini-3.5-flash removed)

// 10 diverse, wholesome topics for ages 3-5, each with a distinct voice for varied tone later.
const TOPICS = [
  { topic: 'หมีน้อยหัดแบ่งปันขนมกับเพื่อน', category: 'มิตรภาพ', gender: 'female', voice: 'Leda' },
  { topic: 'กระต่ายน้อยกล้าหาญไปโรงเรียนวันแรก', category: 'ความกล้าหาญ', gender: 'male', voice: 'Puck' },
  { topic: 'ลูกเป็ดน้อยหัดแปรงฟันก่อนนอน', category: 'สุขนิสัย', gender: 'female', voice: 'Aoede' },
  { topic: 'ช้างน้อยใจดีช่วยเพื่อนเก็บของเล่น', category: 'น้ำใจ', gender: 'male', voice: 'Fenrir' },
  { topic: 'ลูกแมวเหมียวหลงทางแล้วหาทางกลับบ้าน', category: 'ครอบครัว', gender: 'female', voice: 'Kore' },
  { topic: 'นกน้อยเรียนรู้การรอคอยอย่างอดทน', category: 'ความอดทน', gender: 'female', voice: 'Callirrhoe' },
  { topic: 'ลูกหมูน้อยเก็บห้องให้สะอาดเรียบร้อย', category: 'ความรับผิดชอบ', gender: 'male', voice: 'Charon' },
  { topic: 'เต่าน้อยรู้จักพูดคำว่าขอบคุณ', category: 'มารยาท', gender: 'female', voice: 'Autonoe' },
  { topic: 'กระรอกน้อยแบ่งลูกโอ๊กให้เพื่อนๆ', category: 'การแบ่งปัน', gender: 'male', voice: 'Orus' },
  { topic: 'ลูกสิงโตน้อยหัดกล่าวคำขอโทษ', category: 'การให้อภัย', gender: 'female', voice: 'Zephyr' },
];

function parseStory(stdout) {
  const i = stdout.indexOf('{');
  const j = stdout.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('no JSON in output');
  return JSON.parse(stdout.slice(i, j + 1));
}

async function genOne(t) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout } = await exec(SCRIPT, [
        '--topic', t.topic, '--age', '3-5', '--paragraphs', '6',
        '--category', t.category, '--type', 'นิทาน', '--lang', 'thai',
        '--model', MODEL,
      ], { timeout: 180000, maxBuffer: 1024 * 1024 });
      const obj = parseStory(stdout);
      if (!obj.story || obj.story.length < 200) throw new Error('story too short');
      return obj;
    } catch (e) {
      console.log(`  attempt ${attempt} failed: ${String(e.message).slice(0, 80)}`);
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const pool = await mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '12345678', database: process.env.DB_NAME || 'smart_story_ai',
  charset: 'utf8mb4',
});

let ok = 0, fail = 0;
const newIds = [];
for (let n = 0; n < TOPICS.length; n++) {
  const t = TOPICS[n];
  console.log(`[${n + 1}/10] generating: ${t.topic}`);
  const obj = await genOne(t);
  if (!obj) { fail++; console.log(`  ✗ FAILED ${t.topic}`); continue; }
  const [res] = await pool.query(
    `INSERT INTO stories
      (student_name, story_type, category, language, paragraphs, paragraph_count,
       voice_gender, voice_speed, aspect_ratio, image_ratio, age_range, age_group,
       source_type, engine_story, topic, title, story, moral, image_description,
       tts_voice, status, stage)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['นักเรียน', 'นิทาน', t.category, 'thai', 6, 6,
     t.gender, 'normal', '16:9', '16:9', '3-5', '3-5',
     'topic', 'sut', t.topic, obj.title || t.topic, obj.story,
     JSON.stringify(obj.moral || []), obj.image_description || '',
     t.voice, 'done', 'เนื้อเรื่องเสร็จ (รอภาพ/เสียง)']
  );
  ok++; newIds.push(res.insertId);
  console.log(`  ✓ id=${res.insertId} "${obj.title}" (voice=${t.voice})`);
}
console.log(`\n=== DONE: inserted=${ok} failed=${fail} ids=[${newIds.join(',')}] ===`);
await pool.end();
