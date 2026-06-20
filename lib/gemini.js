// Gemini generation helpers (ported from the n8n Smart Story AI workflow)
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set in .env.local');
  return k;
}

async function gemini(model, body) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini ${model} HTTP ${res.status}`);
  }
  return data;
}

function partsText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('');
}

// Generic text generation via Gemini API (used e.g. for scene-prompt splitting)
export async function geminiText(prompt) {
  const data = await gemini('gemini-2.5-flash', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
  return partsText(data);
}

// 1) Describe an image -> Thai description
export async function describeImage(base64, mime) {
  const data = await gemini('gemini-2.5-flash', {
    contents: [
      {
        parts: [
          { text: 'อธิบายภาพนี้อย่างละเอียด บอกสิ่งที่เห็น สี สัตว์ คน หรือวัตถุที่ปรากฏในภาพ ตอบเป็นภาษาไทย' },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
  return partsText(data);
}

// 2) Generate a children's story from a description/topic -> { title, story, moral[] }
export async function generateStory({ description, student_name, story_type, language, paragraphs, age, category }) {
  const langInstruction = language === 'english' ? 'Respond in English.' : 'ตอบเป็นภาษาไทย';
  const prompt = `คุณเป็นนักเล่านิทานสำหรับเด็ก จากรายละเอียดต่อไปนี้: "${description}"

กรุณาสร้าง${story_type}สำหรับ${student_name} โดย:
- มีชื่อเรื่องที่น่าสนใจ${category ? ` แนวเรื่อง/หมวด: ${category}` : ''}
- เนื้อเรื่องยาว ${paragraphs || 6} ย่อหน้า เหมาะสำหรับเด็กอายุ ${age || '6-8'} ปี (ปรับคำศัพท์ ความยาวประโยค และความซับซ้อนให้เหมาะกับช่วงวัย)
- มีข้อคิด (moral) 3 ข้อ
- เขียนเนื้อเรื่องในแต่ละย่อหน้าให้มีรายละเอียดการดำเนินเรื่องอย่างเต็มที่ (ประมาณ 85-110 คำต่อหนึ่งย่อหน้า) และเมื่ออ่านออกเสียงรวมกันแล้วจะได้ความยาวการเล่าเรื่องรวมประมาณ 3 นาที (ความยาวรวมทั้งเรื่องประมาณ 650-850 คำ/คำหลักภาษาไทย)
- มีบทพูดหรือการพูดคุยของตัวละครหลักอย่างเด่นชัดและมีชีวิตชีวา โดยใช้เครื่องหมายอัญประกาศ ("...") ครอบคำพูดทุกครั้ง เช่น คำอุทานแสดงความตื่นเต้น ("โอ้โห!", "หอมจังเลย!") หรือการสนทนากันระหว่างตัวละครด้วยน้ำเสียงน่ารักและมีหางเสียง (เช่น "จ้ะ", "จ๋า", "นะ", "ครับ") เพื่อให้นิทานมีมิติและฟังสนุกขึ้น

${langInstruction}

ตอบในรูปแบบ JSON เท่านั้น โดยไม่มี markdown:
{
  "title": "ชื่อเรื่อง",
  "story": "เนื้อเรื่องทั้งหมด",
  "moral": ["ข้อคิดที่ 1", "ข้อคิดที่ 2", "ข้อคิดที่ 3"]
}`;

  const data = await gemini('gemini-2.5-flash', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
  });

  let raw = partsText(data).replace(/```json/g, '').replace(/```/g, '').trim();
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : { title: 'เรื่องราวพิเศษ', story: raw, moral: [] };
  }
  return {
    title: obj.title || '',
    story: obj.story || '',
    moral: Array.isArray(obj.moral) ? obj.moral : [],
  };
}

// 3) Text -> speech (Gemini TTS returns raw PCM; wrap into a WAV buffer)
export async function synthesizeWav(text, opts = {}) {
  const voiceName = opts.gender === 'male' ? 'Charon' : 'Aoede';
  const data = await gemini('gemini-2.5-flash-preview-tts', {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const ap = parts.find((p) => p.inlineData || p.inline_data);
  if (!ap) {
    throw new Error('No audio in TTS response (finishReason ' + (data?.candidates?.[0]?.finishReason) + ')');
  }
  const inline = ap.inlineData || ap.inline_data;
  const pcm = Buffer.from(inline.data, 'base64');
  return wavFromPcm(pcm);
}

// Image generation via Gemini API (image model). Returns a PNG/JPEG Buffer.
export async function genImageGemini(prompt) {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const data = await gemini(model, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const ip = parts.find((p) => p.inlineData || p.inline_data);
  if (!ip) throw new Error('Gemini image: no image returned (finishReason ' + (data?.candidates?.[0]?.finishReason) + ')');
  const inline = ip.inlineData || ip.inline_data;
  return Buffer.from(inline.data, 'base64');
}

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
