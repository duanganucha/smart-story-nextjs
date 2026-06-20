// Generate a continuous storyboard: N scene prompts from the story, then an image per scene.
// Scene prompts via sut-gen-text.py; images via sut-genimg.py (SUT GenAI).
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { genImageGemini, geminiText } from './gemini';

const execFileP = promisify(execFile);
const PY = process.env.PYTHON || 'python3';
const TEXT_SCRIPT = process.env.SUT_TEXT_SCRIPT || path.join(os.homedir(), 'bin', 'sut-gen-text.py');
const IMG_SCRIPT = process.env.SUT_IMG_SCRIPT || path.join(os.homedir(), 'bin', 'sut-genimg.py');
const IMG_ATTEMPTS = Number(process.env.SCENE_IMG_ATTEMPTS || 3);

const STYLE = ', children book illustration, soft warm colors, friendly, cute, consistent character design and art style across the whole series';

function aspectHint(ar) {
  if (ar === '1:1') return ', square 1:1 composition';
  if (ar === '9:16') return ', tall vertical 9:16 portrait composition';
  return ', wide 16:9 cinematic landscape composition';
}

// Render one image to `file`, retrying transient failures (timeout / empty / channel errors).
async function renderImage(engine, fullPrompt, file, aspectRatio, attempts = IMG_ATTEMPTS) {
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      if (engine === 'gemini') {
        const buf = await genImageGemini(fullPrompt);
        if (!buf || buf.length < 200) throw new Error('empty image from Gemini');
        await writeFile(file, buf);
      } else {
        await execFileP(PY, [IMG_SCRIPT, '--ratio', aspectRatio || '16:9', fullPrompt, file], { maxBuffer: 4 * 1024 * 1024, timeout: 200000 });
      }
      const st = await stat(file).catch(() => null);
      if (!st || st.size < 200) throw new Error('image file missing/too small');
      return; // success
    } catch (e) {
      lastErr = e;
      if (a < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr || new Error('image generation failed');
}

// Ask the LLM to split the story into `count` sequential English image prompts.
// engine: 'sut' (sut-gen-text.py) | 'gemini' (Gemini API text)
export async function generateScenePrompts(title, story, count = 6, engine = 'sut') {
  const prompt =
    `Break the following children's story into EXACTLY ${count} sequential illustration scenes (a storyboard from beginning to end). ` +
    `Return ONLY a JSON array of ${count} strings, no markdown. Each string is a concise ENGLISH image-generation prompt for that scene. ` +
    `Keep the SAME main character appearance and art style in every scene so they look continuous. ` +
    `Title: ${title}\nStory: ${story}`;

  let stdout;
  if (engine === 'gemini') {
    stdout = await geminiText(prompt);
  } else {
    ({ stdout } = await execFileP(PY, [TEXT_SCRIPT, prompt], { maxBuffer: 8 * 1024 * 1024, timeout: 120000 }));
  }
  let raw = stdout.trim().replace(/```json/g, '').replace(/```/g, '').trim();
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    arr = m ? JSON.parse(m[0]) : [];
  }
  if (!Array.isArray(arr)) arr = [];
  // pad/trim to count
  arr = arr.map((x) => String(x)).filter(Boolean).slice(0, count);
  while (arr.length < count && arr.length > 0) arr.push(arr[arr.length - 1]);
  return arr;
}

// Generate one image per prompt (limited concurrency). Returns [{n, prompt, path|null, error?}].
// opts.engine: 'sut' (sut-genimg.py) | 'gemini' (Gemini API image)
export async function generateSceneImages(id, prompts, onProgress, opts = {}) {
  const engine = opts.engine || 'sut';
  const concurrency = opts.concurrency || 4;
  const arHint = aspectHint(opts.aspectRatio);
  const dir = path.join(process.cwd(), 'public', 'scenes', String(id));
  await mkdir(dir, { recursive: true });
  const results = new Array(prompts.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < prompts.length) {
      const i = next++;
      const n = i + 1;
      const nn = String(n).padStart(2, '0');
      const file = path.join(dir, `scene_${nn}.png`);
      try {
        const fullPrompt = prompts[i] + STYLE + arHint;
        await renderImage(engine, fullPrompt, file, opts.aspectRatio);
        results[i] = { n, prompt: prompts[i], path: `/scenes/${id}/scene_${nn}.png?v=${Date.now()}` };
      } catch (e) {
        results[i] = { n, prompt: prompts[i], path: null, error: String(e?.message || e) };
      }
      done++;
      if (onProgress) await onProgress(done, prompts.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length) }, () => worker()));
  return results;
}

// Regenerate a single scene image (scene number n), overwriting its file.
export async function generateOneScene(id, n, prompt, opts = {}) {
  const engine = opts.engine || 'sut';
  const arHint = aspectHint(opts.aspectRatio);
  const dir = path.join(process.cwd(), 'public', 'scenes', String(id));
  await mkdir(dir, { recursive: true });
  const nn = String(n).padStart(2, '0');
  const file = path.join(dir, `scene_${nn}.png`);
  const fullPrompt = prompt + STYLE + arHint;
  await renderImage(engine, fullPrompt, file, opts.aspectRatio);
  // cache-buster so the browser reloads the overwritten image
  return { n, prompt, path: `/scenes/${id}/scene_${nn}.png?v=${Date.now()}` };
}
