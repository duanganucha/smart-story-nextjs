// Revise stories with Gemini so each is EXACTLY 8 paragraphs and ~3 minutes when
// read aloud in Thai. Keeps title, characters, theme and moral. Updates DB.
// Run:  node --env-file=.env.local scripts-revise-stories.mjs [id...]
import mysql from 'mysql2/promise';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = process.env.GEMINI_API_KEY;

async function gemini(model, body) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

function buildPrompt(title, story, age) {
  return `คุณเป็นนักเล่านิทานสำหรับเด็ก ช่วยเกลาและขยายนิทานเรื่องนี้ใหม่ โดยคงโครงเรื่อง ตัวละคร ชื่อเรื่อง และแก่นเดิมไว้ทั้งหมด

ชื่อเรื่อง: "${title}"
เนื้อเรื่องเดิม:
${story}

ข้อกำหนดสำคัญ:
- ต้องมี "8 ย่อหน้าพอดี" (คั่นแต่ละย่อหน้าด้วยบรรทัดว่าง 1 บรรทัด)
- แต่ละย่อหน้ายาวประมาณ 90-110 คำภาษาไทย เมื่ออ่านออกเสียงรวมกันต้องได้ความยาวประมาณ 3 นาที (รวมทั้งเรื่องประมาณ 750-880 คำ)
- เหมาะกับเด็กอายุ ${age || '6-8'} ปี (ปรับคำศัพท์และความซับซ้อนให้พอดีกับวัย)
- มีบทพูดของตัวละครที่มีชีวิตชีวา ใช้อัญประกาศ ("...") ครอบคำพูดทุกครั้ง มีคำอุทาน เช่น "โอ้โห!" และหางเสียงน่ารัก เช่น "จ้ะ", "จ๋า", "นะ", "ครับ", "ค่ะ"
- ดำเนินเรื่องให้ลื่นไหล มีจุดเริ่ม ปัญหา การแก้ไข และจบอย่างอบอุ่น
- ห้ามใส่หัวข้อย่อย เลขย่อหน้า หรือ markdown ใดๆ ตอบกลับเป็น "เนื้อเรื่อง 8 ย่อหน้า" ล้วนๆ เท่านั้น`;
}

function countParas(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function stripTitle(paras, title) {
  // Drop a leading paragraph that is just the title (Gemini sometimes echoes it).
  const norm = (s) => s.replace(/\s+/g, '').replace(/["“”]/g, '');
  if (paras.length && norm(paras[0]) === norm(title)) return paras.slice(1);
  return paras;
}

async function reviseOne(title, story, age, attempts = 3) {
  let last;
  for (let a = 0; a < attempts; a++) {
    const out = await gemini('gemini-2.5-flash', {
      contents: [{ parts: [{ text: buildPrompt(title, story, age) }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    });
    const cleaned = out.replace(/```/g, '').trim();
    const paras = stripTitle(countParas(cleaned), title);
    if (paras.length === 8) return paras.join('\n\n');
    last = `got ${paras.length} paragraphs`;
    // nudge: if close, keep best; else retry
    if (a === attempts - 1 && paras.length >= 7) return paras.slice(0, 8).join('\n\n');
  }
  throw new Error('could not get 8 paragraphs: ' + last);
}

async function main() {
  if (!KEY) throw new Error('GEMINI_API_KEY missing');
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '12345678',
    database: process.env.DB_NAME || 'smart_story_ai', charset: 'utf8mb4',
  });

  const argIds = process.argv.slice(2).map(Number).filter(Boolean);
  const ids = argIds.length ? argIds : [48, 49, 50, 51, 52, 53, 54, 55, 56, 57];

  for (const id of ids) {
    try {
      const [rows] = await pool.query('SELECT title, story, age_range FROM stories WHERE id = ?', [id]);
      if (!rows.length || !rows[0].story) { console.log(`#${id} skip (no story)`); continue; }
      const { title, story, age_range } = rows[0];
      process.stdout.write(`#${id} "${title.slice(0, 28)}" (อายุ ${age_range}) ... `);
      const revised = await reviseOne(title, story, age_range);
      const words = revised.replace(/\s+/g, '').length;
      await pool.query('UPDATE stories SET story = ?, paragraphs = 8, audio_path = NULL, scenes = NULL WHERE id = ?', [revised, id]);
      console.log(`OK 8 ย่อหน้า (~${words} อักขระ)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  await pool.end();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
