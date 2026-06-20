// Insert 2 extra scene images into an existing story, preserving its current images.
// Usage: node --env-file=.env.local scripts-insert-77.mjs <storyId> <count>
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getPool } from './lib/db.js';

const execFileP = promisify(execFile);
const PY = process.env.PYTHON || 'python3';
const TEXT_SCRIPT = process.env.SUT_TEXT_SCRIPT || path.join(os.homedir(), 'bin', 'sut-gen-text.py');
const IMG_SCRIPT = process.env.SUT_IMG_SCRIPT || path.join(os.homedir(), 'bin', 'sut-genimg.py');
const STYLE = ', children book illustration, soft warm colors, friendly, cute, consistent character design and art style across the whole series';
const arHint = (ar) => ar === '1:1' ? ', square 1:1 composition' : ar === '9:16' ? ', tall vertical 9:16 portrait composition' : ', wide 16:9 cinematic landscape composition';

// Render one scene image via sut-genimg.py, with retries (mirrors lib/scenes.js).
async function generateOneScene(id, n, prompt, opts = {}) {
  const dir = path.join(process.cwd(), 'public', 'scenes', String(id));
  await mkdir(dir, { recursive: true });
  const nn = String(n).padStart(2, '0');
  const file = path.join(dir, `scene_${nn}.png`);
  const fullPrompt = prompt + STYLE + arHint(opts.aspectRatio);
  let lastErr;
  for (let a = 0; a < 3; a++) {
    try {
      await execFileP(PY, [IMG_SCRIPT, '--ratio', opts.aspectRatio || '16:9', fullPrompt, file], { maxBuffer: 4 * 1024 * 1024, timeout: 200000 });
      const st = await stat(file).catch(() => null);
      if (!st || st.size < 200) throw new Error('image file missing/too small');
      return { n, prompt, path: `/scenes/${id}/scene_${nn}.png?v=${Date.now()}` };
    } catch (e) { lastErr = e; if (a < 2) await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw lastErr || new Error('image generation failed');
}

const id = Number(process.argv[2] || 77);
const addN = Number(process.argv[3] || 2);

const pool = getPool();
const [rows] = await pool.query('SELECT title, story, scenes, aspect_ratio FROM stories WHERE id = ?', [id]);
if (!rows.length) { console.error('story not found'); process.exit(1); }
const { title, story, aspect_ratio } = rows[0];
let scenes = rows[0].scenes;
if (typeof scenes === 'string') scenes = JSON.parse(scenes);
scenes = scenes || [];
console.log(`story ${id}: ${scenes.length} existing scenes -> adding ${addN}`);

// Ask SUT to invent `addN` extra in-between moments that match the existing storyboard.
const existing = scenes.map((s, i) => `${i + 1}. ${s.prompt || ''}`).join('\n');
const ask =
  `Here is an existing ${scenes.length}-scene children's-book storyboard (English image prompts) for the story "${title}".\n` +
  `${existing}\n\n` +
  `Invent EXACTLY ${addN} NEW additional "in-between" illustration moments that enrich this same story ` +
  `(extra beats that could be inserted between the existing scenes). Keep the SAME main character appearance and art style. ` +
  `Return ONLY a JSON array of ${addN} concise ENGLISH image-generation prompt strings, no markdown.\n` +
  `Story: ${story}`;

const { stdout } = await execFileP(PY, [TEXT_SCRIPT, ask], { maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
let raw = stdout.trim().replace(/```json/g, '').replace(/```/g, '').trim();
let prompts;
try { prompts = JSON.parse(raw); } catch { const m = raw.match(/\[[\s\S]*\]/); prompts = m ? JSON.parse(m[0]) : []; }
prompts = (prompts || []).map(String).filter(Boolean).slice(0, addN);
if (prompts.length < addN) { console.error('not enough prompts returned:', prompts); process.exit(1); }
console.log('new prompts:', prompts);

// Render new images with file numbers continuing after the current max scene file index.
const maxN = scenes.reduce((m, s) => Math.max(m, s.n || 0), 0);
const created = [];
for (let k = 0; k < addN; k++) {
  const fileN = maxN + 1 + k; // e.g. 7, 8 -> scene_07.png, scene_08.png
  console.log(`rendering new image -> scene_${String(fileN).padStart(2, '0')}.png`);
  const one = await generateOneScene(id, fileN, prompts[k], { engine: 'sut', aspectRatio: aspect_ratio });
  created.push(one);
}

// Insert the new scenes spread through the storyboard (after positions chosen to interleave).
const out = [...scenes];
// place new scene k at evenly spaced positions in the second/first halves
const positions = [];
for (let k = 0; k < addN; k++) {
  // distribute: 1/3 and 2/3 of the way through for 2 inserts
  positions.push(Math.round((scenes.length * (k + 1)) / (addN + 1)) + k);
}
created.forEach((c, k) => { out.splice(positions[k], 0, c); });

// Renumber n by position for a clean 1..N display (file paths are kept as-is).
const renum = out.map((s, i) => ({ ...s, n: i + 1 }));
await pool.query('UPDATE stories SET scenes = ?, status = ?, stage = ?, error = NULL WHERE id = ?',
  [JSON.stringify(renum), 'done', 'เสร็จ', id]);

console.log('final order:');
renum.forEach((s) => console.log(`  ${s.n} -> ${s.path}`));
console.log('DONE');
process.exit(0);
