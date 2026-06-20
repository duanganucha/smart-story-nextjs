// Standalone image generator using Gemini (image model), one DISTINCT art style
// per story. Gemini text splits each story into scene prompts (saves chat tokens).
// Run from project root:  node --env-file=.env.local scripts-gen-images.mjs [id...]
import mysql from 'mysql2/promise';
import { writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = process.env.GEMINI_API_KEY;
const IMG_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// Distinct art style per story id (within a story it stays consistent)
const STYLE_MAP = {
  38: 'dreamy soft watercolor storybook art, glowing starry palette',
  39: '3D Pixar-style render, vibrant underwater colors, glossy',
  40: 'warm gouache painting, cozy kitchen tones, textured brush',
  41: 'classic Disney hand-drawn animation, lush green scenery',
  42: 'Thai temple-mural inspired illustration, gold and teal, ornate',
  43: 'cut-paper collage craft style, layered green forest tones',
  44: 'bright crayon and colored-pencil children drawing, playful',
  45: 'vintage 1950s picture-book lithograph, muted nostalgic colors',
  46: 'flat vector cartoon, bold clean shapes, friendly tech palette',
  47: 'dreamy pastel chalk art, soft rainbow gradients, whimsical',
  48: 'kawaii chibi sticker style, soft pink medical tones, cute',
  49: 'comic-book ink with halftone shading, bold action colors',
  50: 'impressionist soft-brush oil painting, golden rice-field light',
  51: 'felt and fabric puppet diorama, handmade soft textures',
  52: 'minimalist Scandinavian illustration, clean primary colors',
  53: 'oil pastel vivid illustration, warm animal-clinic tones',
  54: 'dramatic ink-and-wash seascape with soft color, cinematic',
  55: 'claymation plasticine stop-motion look, pastel bakery tones',
  56: 'low-poly 3D geometric render, bright science-lab palette',
  57: 'cheerful flat cartoon, postal blue and warm sunny colors',
};

const COMMON = ', children book illustration, friendly, cute, consistent main character design across all scenes, wide 16:9 cinematic landscape composition';

async function gemini(model, body) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

async function geminiText(prompt) {
  const data = await gemini('gemini-2.5-flash', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function genImage(prompt) {
  const data = await gemini(IMG_MODEL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const ip = parts.find((p) => p.inlineData || p.inline_data);
  if (!ip) throw new Error('no image (finishReason ' + data?.candidates?.[0]?.finishReason + ')');
  const inline = ip.inlineData || ip.inline_data;
  return Buffer.from(inline.data, 'base64');
}

async function scenePrompts(title, story, count) {
  const p = `Break the following children's story into EXACTLY ${count} sequential illustration scenes (a storyboard from beginning to end). ` +
    `Return ONLY a JSON array of ${count} strings, no markdown. Each string is a concise ENGLISH image-generation prompt for that scene. ` +
    `Keep the SAME main character appearance in every scene so they look continuous. Title: ${title}\nStory: ${story}`;
  const raw = (await geminiText(p)).trim().replace(/```json/g, '').replace(/```/g, '').trim();
  let arr;
  try { arr = JSON.parse(raw); } catch { const m = raw.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; }
  if (!Array.isArray(arr)) arr = [];
  arr = arr.map(String).filter(Boolean).slice(0, count);
  while (arr.length < count && arr.length > 0) arr.push(arr[arr.length - 1]);
  return arr;
}

async function genWithRetry(fullPrompt, file, attempts = 3) {
  let last;
  for (let a = 0; a < attempts; a++) {
    try {
      const buf = await genImage(fullPrompt);
      if (!buf || buf.length < 200) throw new Error('empty image');
      await writeFile(file, buf);
      const st = await stat(file).catch(() => null);
      if (!st || st.size < 200) throw new Error('file too small');
      return;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw last;
}

async function main() {
  if (!KEY) throw new Error('GEMINI_API_KEY missing');
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '12345678',
    database: process.env.DB_NAME || 'smart_story_ai', charset: 'utf8mb4',
  });

  const argIds = process.argv.slice(2).map(Number).filter(Boolean);
  const ids = argIds.length ? argIds : Object.keys(STYLE_MAP).map(Number).sort((a, b) => a - b);

  for (const id of ids) {
    const style = STYLE_MAP[id] || 'soft children book illustration';
    try {
      const [rows] = await pool.query('SELECT title, story, paragraphs FROM stories WHERE id = ?', [id]);
      if (!rows.length || !rows[0].story) { console.log(`#${id} skip (no story)`); continue; }
      const { title, story } = rows[0];
      const count = Number(rows[0].paragraphs) || 6;
      process.stdout.write(`#${id} "${title.slice(0, 26)}" [${style.slice(0, 24)}...] ${count} ฉาก: `);

      const prompts = await scenePrompts(title, story, count);
      const dir = path.join(process.cwd(), 'public', 'scenes', String(id));
      await mkdir(dir, { recursive: true });

      const scenes = [];
      for (let i = 0; i < prompts.length; i++) {
        const n = i + 1;
        const nn = String(n).padStart(2, '0');
        const file = path.join(dir, `scene_${nn}.png`);
        const fullPrompt = prompts[i] + ', ' + style + COMMON;
        try {
          await genWithRetry(fullPrompt, file);
          scenes.push({ n, prompt: prompts[i], path: `/scenes/${id}/scene_${nn}.png?v=${Date.now()}` });
          process.stdout.write(`${n}`);
        } catch (e) {
          scenes.push({ n, prompt: prompts[i], path: null, error: String(e?.message || e) });
          process.stdout.write(`x`);
        }
      }
      await pool.query('UPDATE stories SET scenes = ?, engine_image = ?, status = ?, stage = ? WHERE id = ?',
        [JSON.stringify(scenes), 'gemini', 'done', 'เสร็จ', id]);
      const ok = scenes.filter((s) => s.path).length;
      console.log(` -> ${ok}/${count} OK`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  await pool.end();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
