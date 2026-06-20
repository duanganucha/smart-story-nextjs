// Image generator v2 — CHARACTER-CONSISTENT storyboards via Gemini 2.5 Flash Image.
// Technique: (1) build a fixed character/style "bible" per story, (2) generate scene 1,
// (3) feed scene 1 back as a reference image into every later scene so the same
// character/design/colors carry through. One distinct art style per story.
// Run:  node --env-file=.env.local scripts-gen-images-v2.mjs [id...]
import mysql from 'mysql2/promise';
import { writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = process.env.GEMINI_API_KEY;
const IMG_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const STYLE_MAP = {
  38: 'dreamy soft watercolor storybook art, glowing starry palette',
  39: '3D Pixar-style render, vibrant underwater colors, glossy',
  40: 'warm gouache painting, cozy kitchen tones, textured brush',
  41: 'classic Disney hand-drawn animation, lush green scenery',
  42: 'simple clean minimal children book illustration, flat soft shapes, few uncluttered details, gentle pastel colors, lots of empty space',
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
  58: '3D Pixar-style render, icy blue and white polar palette, glossy, soft snowy light',
  59: 'warm 3D animation, friendly cadet training camp, earthy green and khaki tones, soft daylight',
  60: 'warm watercolor storybook, nostalgic train station, golden afternoon light, cozy family mood',
  61: 'soft hand-drawn storybook illustration, lush green banana grove, expressive cute, gentle moonlit-to-morning contrast',
  62: 'nostalgic vintage Thai schoolbook illustration, warm flat colors, clean friendly lines, 1980s children reader aesthetic, sunny rural village',
  63: 'warm Thai folktale storybook illustration, rustic rice farm, soft cool-morning light, earthy gentle tones',
  64: 'warm cozy storybook illustration, bright tidy home interior, soft cheerful pastel colors, sunny day',
  65: 'dreamy soft storybook illustration, magical night backyard garden, glowing golden fireflies, deep blue and warm glow, starry sky',
  66: 'cute 3D Pixar-style animation, sunny vegetable garden with underground soil cross-section view, friendly faces, warm earthy brown and bright veggie colors',
  67: 'whimsical storybook illustration, cozy inventor study full of gadgets and floating imaginative chalk doodles, warm vintage golden colors, dreamy wonder',
  68: 'warm classic fable storybook illustration, green pastoral hillside with fluffy white sheep and a village below, soft natural daylight',
  69: 'warm heartfelt children book illustration, sunny green vegetable garden at a cozy rural home, golden warm light, loving family across generations',
  70: 'bright cheerful 3D animation, kid maker workshop full of colorful gadgets gears tools and inventions, sunny energetic vibe',
  71: 'classic children book illustration, soft warm colors, friendly and cute, sunny flower garden with sunflowers',
  72: 'simple cute children book illustration, clean soft rounded shapes, warm friendly colors, minimal uncluttered background, sunny home backyard',
  73: 'bright cheerful children book illustration, clear blue ocean and sandy beach, colorful friendly sea animals, fresh aqua and sunny tones',
  74: 'bright cheerful anime-style cartoon illustration, glowing magical rainbow door, vibrant adventurous colors, whimsical wonder',
  75: 'bright cheerful anime-style cartoon illustration, glowing magical pocket bag with gadgets, vibrant playful colors, whimsical',
};

const COMMON = ', children book illustration, friendly, cute, wide 16:9 cinematic landscape composition. IMPORTANT: do NOT render any text, words, letters, captions, titles, labels, watermarks or signage with readable words in the image.';

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

function textOf(data) {
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

// Gemini text returns empty candidates intermittently/randomly. Be robust:
// many attempts, growing backoff, model fallback, and a tiny per-attempt nonce
// to break any deterministic empty-response streak.
const TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
async function geminiText(prompt, attempts = 9) {
  let lastErr = 'empty';
  for (let a = 0; a < attempts; a++) {
    const model = TEXT_MODELS[a % TEXT_MODELS.length];
    const nonce = a === 0 ? '' : `\n(rev ${a})`; // vary input slightly on retries
    try {
      const t = textOf(await gemini(model, {
        contents: [{ parts: [{ text: prompt + nonce }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }));
      if (t.trim()) return t;
    } catch (e) { lastErr = String(e?.message || e); }
    await new Promise((r) => setTimeout(r, 1000 + a * 800)); // backoff
  }
  throw new Error('geminiText failed: ' + lastErr);
}

// Excerpt that keeps the ending: first chunk + " ... " + last paragraph (arc intact).
function smartExcerpt(story, max) {
  if (story.length <= max) return story;
  const paras = story.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paras[paras.length - 1] || '';
  const head = story.slice(0, Math.max(200, max - last.length - 8));
  return `${head} ... ${last}`;
}

// Some story texts deterministically trigger Gemini's empty-response. Try the prompt
// with progressively shorter story excerpts until we get a non-empty reply.
async function geminiTextShrink(buildPrompt, story) {
  const sizes = [1600, 1100, 700, 400];
  let lastErr;
  for (const sz of sizes) {
    try {
      const t = await geminiText(buildPrompt(smartExcerpt(story, sz)), 4);
      if (t.trim()) return t;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('geminiTextShrink: all excerpts empty');
}

// One fixed visual description of the main character(s) + palette, reused every scene.
async function characterBible(title, story) {
  const build = (s) => `Read this Thai children's story and write a SHORT, FIXED visual "character sheet" in ENGLISH for its main character(s), to keep them identical across all illustrations. ` +
    `Specify exactly: species/who, age, body proportions, skin/fur color, hair (style+color), clothing (items+colors), and 1-2 distinctive features. Also give a 1-line color palette for the world. ` +
    `Be concrete and visual. Max 90 words, no markdown, no preamble.\nTitle: ${title}\nStory: ${s}`;
  return (await geminiTextShrink(build, story)).replace(/```/g, '').trim();
}

// N sequential scene ACTIONS (what happens), character look comes from the bible+reference.
async function sceneActions(title, story, count) {
  const build = (s) => `Break this children's story into EXACTLY ${count} sequential storyboard scenes from beginning to end. ` +
    `Return ONLY a JSON array of ${count} strings, no markdown. Each string = a concise ENGLISH description of the ACTION/SETTING/EMOTION in that scene (do NOT re-describe the character's fixed look; focus on what they DO and where). ` +
    `Title: ${title}\nStory: ${s}`;
  const raw = (await geminiTextShrink(build, story)).trim().replace(/```json/g, '').replace(/```/g, '').trim();
  let arr;
  try { arr = JSON.parse(raw); } catch { const m = raw.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; }
  if (!Array.isArray(arr)) arr = [];
  arr = arr.map(String).filter(Boolean).slice(0, count);
  while (arr.length < count && arr.length > 0) arr.push(arr[arr.length - 1]);
  return arr;
}

// Generate one image. refImages: array of base64 PNG strings used as visual anchors.
async function genImage(promptText, refImages = []) {
  const parts = [];
  for (const b64 of refImages) parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
  parts.push({ text: promptText });
  const data = await gemini(IMG_MODEL, {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  const ps = data?.candidates?.[0]?.content?.parts || [];
  const ip = ps.find((p) => p.inlineData || p.inline_data);
  if (!ip) throw new Error('no image (finishReason ' + data?.candidates?.[0]?.finishReason + ')');
  const inline = ip.inlineData || ip.inline_data;
  return Buffer.from(inline.data, 'base64');
}

async function genWithRetry(promptText, refImages, file, attempts = 3) {
  let last;
  for (let a = 0; a < attempts; a++) {
    try {
      const buf = await genImage(promptText, refImages);
      if (!buf || buf.length < 200) throw new Error('empty image');
      await writeFile(file, buf);
      const st = await stat(file).catch(() => null);
      if (!st || st.size < 200) throw new Error('file too small');
      return buf;
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
      const para = Number(rows[0].paragraphs) || 6;
      // SCENES_PER_STORY='para' -> 1 image per paragraph; else fixed number (clamped 4-8, default 5).
      const env = process.env.SCENES_PER_STORY;
      const count = env === 'para' ? para : Math.min(Math.max(Number(env || 5), 4), 8);
      process.stdout.write(`#${id} "${title.slice(0, 24)}" [${style.slice(0, 18)}...] ${count} ฉาก: `);

      const bible = await characterBible(title, story);
      const actions = await sceneActions(title, story, count);
      const dir = path.join(process.cwd(), 'public', 'scenes', String(id));
      await mkdir(dir, { recursive: true });

      // Rotate camera/framing AGGRESSIVELY so each illustration looks clearly different
      // (vary zoom level, angle, and which element fills the frame).
      const SHOTS = [
        'wide establishing shot, the whole setting visible, character fairly small in frame',
        'extreme close-up zoomed in on one small detail or the character\'s face filling the frame',
        'low ground-level angle looking steeply up, dramatic perspective',
        'high bird\'s-eye view looking straight down from above',
        'over-the-shoulder view from behind the character looking at what they see',
        'very far wide landscape shot, character tiny against a big environment, lots of sky/scenery',
        'tight side-on action shot at a dynamic diagonal angle, mid-movement',
        'medium shot from a brand-new spot with a different background and warm side-lighting',
      ];

      const scenes = [];
      let anchorB64 = null; // scene 1 acts as the character anchor for later scenes
      for (let i = 0; i < actions.length; i++) {
        const n = i + 1;
        const nn = String(n).padStart(2, '0');
        const file = path.join(dir, `scene_${nn}.png`);
        const shot = SHOTS[i % SHOTS.length];
        let promptText, refs = [];
        const ONE_SCENE = ' Render ONE single full-bleed illustration of this one moment only — NOT a character sheet, NOT split panels, no side reference strip, no multiple frames.';
        const VARY = ' Make this illustration look CLEARLY DIFFERENT from a plain centered portrait: change the zoom level, the angle, and which element fills the frame (sometimes a detail, sometimes the wide scenery). Do not center the same subject the same way every time.';
        if (i === 0) {
          promptText = `A children's book illustration. The main character must look exactly like this: ${bible}. ` +
            `Art style: ${style}${COMMON}. Camera: ${shot}. Depict: ${actions[i]}.${VARY}${ONE_SCENE}`;
        } else {
          promptText = `Create a NEW, DIFFERENT children's book illustration. Use the reference image ONLY to copy the character's IDENTITY — same face, hair, clothing and colors. ` +
            `Do NOT reuse the reference's composition, pose, camera angle, zoom or background; those MUST change to fit the new moment. ` +
            `Keep the identical art style (${style}). The character must look exactly like: ${bible}. ` +
            `Camera/framing for THIS scene: ${shot}. Setting & action: ${actions[i]}.${VARY}${COMMON}${ONE_SCENE}`;
          refs = [anchorB64];
        }
        try {
          const buf = await genWithRetry(promptText, refs, file);
          if (i === 0) anchorB64 = buf.toString('base64');
          scenes.push({ n, prompt: actions[i], path: `/scenes/${id}/scene_${nn}.png?v=${Date.now()}` });
          process.stdout.write(`${n}`);
        } catch (e) {
          scenes.push({ n, prompt: actions[i], path: null, error: String(e?.message || e) });
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
