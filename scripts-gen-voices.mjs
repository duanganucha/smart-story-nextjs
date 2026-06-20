// Standalone voice generator: re-synthesize narration with a chosen Gemini voice
// per story, with 1.6s pauses between paragraphs. Does NOT modify project code.
// Run from project root:  node --env-file=.env.local scripts-gen-voices.mjs
import mysql from 'mysql2/promise';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = process.env.GEMINI_API_KEY;
const SILENCE_S = 1.6;

// Per-story voice mapping (Gemini prebuilt voices)
const VOICE_MAP = {
  38: 'Leda',         // อวกาศ — สดใส วัยเด็ก (ญ)
  39: 'Aoede',        // ทะเล — โปร่งสบาย (ญ)
  40: 'Sulafat',      // อาหาร — อบอุ่น (ญ)
  41: 'Puck',         // ดนตรี — ร่าเริง (ช)
  42: 'Vindemiatrix', // ลอยกระทง — อ่อนโยน (ญ)
  43: 'Achird',       // ป่า — เป็นมิตร (ช)
  44: 'Autonoe',      // ศิลปะ — สว่างสดใส (ญ)
  45: 'Gacrux',       // ครอบครัว — สุขุม วัยผู้ใหญ่ (ช)
  46: 'Iapetus',      // หุ่นยนต์ — ชัดเจน เป็นกลาง (ช)
  47: 'Achernar',     // ความฝัน — นุ่มละมุน (ญ)
  48: 'Fenrir',       // หมอ — ตื่นเต้นกระตือรือร้น (ช เด็ก)
  49: 'Orus',         // นักดับเพลิง — หนักแน่นกล้าหาญ (ช)
  50: 'Schedar',      // ชาวนา — เรียบนิ่งสุขุม (ช)
  51: 'Laomedeia',    // ครู — ร่าเริงสดใส (ญ)
  52: 'Alnilam',      // ตำรวจ — หนักแน่นมั่นคง (ช)
  53: 'Despina',      // สัตวแพทย์ — นุ่มนวล (ญ)
  54: 'Algieba',      // ชาวประมง — ราบรื่นทุ้ม (ช)
  55: 'Callirrhoe',   // คนทำขนมปัง — สบายๆ อบอุ่น (ญ)
  56: 'Erinome',      // นักวิทยาศาสตร์ — ชัดเจน (ญ)
  57: 'Zubenelgenubi',// ไปรษณีย์ — เป็นกันเอง (ช เด็ก)
  58: 'Zephyr',       // เพนกวิน — สดใสร่าเริง
  59: 'Charon',       // ทหาร — หนักแน่นมั่นคง
  60: 'Sulafat',      // ครอบครัว/คุณตา — อบอุ่น
  61: 'Puck',         // ผีดงกล้วย — สนุกตื่นเต้น
  62: 'Laomedeia',    // แก๊งเพื่อนซี้ — ร่าเริงสดใส
  63: 'Rasalgethi',   // ชาวนากับงูเห่า — นักเล่านิทานสุขุม
  64: 'Autonoe',      // น้องแก้มช่วยแม่ — สดใสร่าเริง
  65: 'Achernar',     // หิ่งห้อยยามค่ำ — นุ่มละมุนฝันๆ
  66: 'Umbriel',      // แครอท+ไส้เดือน — เป็นกันเองสบายๆ
  67: 'Sadaltager',   // คุณลุงไอสไตล์ — ผู้รู้สุขุมอบอุ่น
  68: 'Pulcherrima',  // เด็กเลี้ยงแกะ — นักเล่านิทานชวนติดตาม
  69: 'Vindemiatrix', // หลานกับปู่ — อ่อนโยนอบอุ่น
  70: 'Fenrir',       // ก้องนักประดิษฐ์ — กระตือรือร้นสดใส
  71: 'Leda',         // ทานตะวัน+ผึ้งน้อย — สดใสวัยเด็ก
  72: 'Sulafat',      // โคบี้+มะลิ (เด็กน้อย) — อบอุ่นนุ่มนวล
  73: 'Despina',      // ขยะกับสัตว์ทะเล — นุ่มนวลใส่ใจ
  74: 'Puck',         // ประตูวิเศษ — สนุกตื่นเต้นผจญภัย
  75: 'Autonoe',      // กระเป๋าวิเศษ — สดใสร่าเริง
};

function wavFromPcm(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function concatenateWavs(wavBuffers, silenceSeconds = 1.6, sampleRate = 24000) {
  const pcmChunks = [];
  const silenceBytes = Math.round(sampleRate * 2 * silenceSeconds);
  const silenceBuffer = Buffer.alloc(silenceBytes);
  for (let i = 0; i < wavBuffers.length; i++) {
    const wav = wavBuffers[i];
    if (wav && wav.length > 44) pcmChunks.push(wav.subarray(44));
    if (i < wavBuffers.length - 1) pcmChunks.push(silenceBuffer);
  }
  return wavFromPcm(Buffer.concat(pcmChunks), sampleRate);
}

async function ttsOne(text, voiceName) {
  const res = await fetch(`${BASE}/gemini-2.5-flash-preview-tts:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const ap = parts.find((p) => p.inlineData || p.inline_data);
  if (!ap) throw new Error('No audio (finishReason ' + data?.candidates?.[0]?.finishReason + ')');
  const inline = ap.inlineData || ap.inline_data;
  return wavFromPcm(Buffer.from(inline.data, 'base64'));
}

async function ttsWithRetry(text, voiceName, attempts = 3) {
  let last;
  for (let a = 0; a < attempts; a++) {
    try { return await ttsOne(text, voiceName); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw last;
}

async function main() {
  if (!KEY) throw new Error('GEMINI_API_KEY missing (run with --env-file=.env.local)');
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '12345678',
    database: process.env.DB_NAME || 'smart_story_ai',
    charset: 'utf8mb4',
  });

  const argIds = process.argv.slice(2).map(Number).filter(Boolean);
  const ids = argIds.length ? argIds : Object.keys(VOICE_MAP).map(Number).sort((a, b) => a - b);
  const dir = path.join(process.cwd(), 'public', 'audio');
  await mkdir(dir, { recursive: true });

  for (const id of ids) {
    const voice = VOICE_MAP[id];
    try {
      const [rows] = await pool.query('SELECT title, story FROM stories WHERE id = ?', [id]);
      if (!rows.length || !rows[0].story) { console.log(`#${id} skip (no story)`); continue; }
      const paragraphs = rows[0].story.split(/\n+/).map((p) => p.trim()).filter(Boolean);
      process.stdout.write(`#${id} "${rows[0].title.slice(0, 30)}" voice=${voice} (${paragraphs.length} ย่อหน้า) ... `);

      const bufs = [];
      for (const p of paragraphs) bufs.push(await ttsWithRetry(p, voice));
      const buffer = concatenateWavs(bufs, SILENCE_S);

      const ts = Date.now();
      const fn = `story_${id}_${ts}.wav`;
      await writeFile(path.join(dir, fn), buffer);
      await pool.query('UPDATE stories SET audio_path = ?, tts_voice = ? WHERE id = ?', [`/audio/${fn}`, voice, id]);
      console.log(`OK -> /audio/${fn} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  await pool.end();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
