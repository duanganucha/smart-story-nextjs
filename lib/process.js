// Background orchestration of a story job, provider-aware (see lib/config.js).
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { getPool } from './db';
import { generateStoryViaSut } from './generate';
import { describeImage as geminiDescribe, generateStory as geminiStory, synthesizeWav } from './gemini';
import { synthesizeWavLocal } from './localtts';
import { synthesizeEdge } from './edgetts';
import { generateScenePrompts, generateSceneImages, generateOneScene } from './scenes';
import { getConfig } from './config';

const SCENE_COUNT = Number(process.env.SCENE_COUNT || 6);

const TTS_LABEL = { gemini: 'Gemini TTS', local: 'Local (macOS)', edge: 'Edge TTS' };

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
    if (wav && wav.length > 44) {
      pcmChunks.push(wav.subarray(44));
    }
    if (i < wavBuffers.length - 1) {
      pcmChunks.push(silenceBuffer);
    }
  }

  const combinedPcm = Buffer.concat(pcmChunks);
  return wavFromPcm(combinedPcm, sampleRate);
}

// engine: 'gemini' (API) | 'local' (macOS say) | 'edge' (edge-tts). Returns { buffer, ext }.
async function makeTts(engine, story, language, opts = {}) {
  const paragraphs = story.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

  if (paragraphs.length <= 1) {
    if (engine === 'local') return { buffer: await synthesizeWavLocal(story, language, opts), ext: 'wav' };
    if (engine === 'edge') return { buffer: await synthesizeEdge(story, language, opts), ext: 'mp3' };
    return { buffer: await synthesizeWav(story, opts), ext: 'wav' };
  }

  if (engine === 'local') {
    const bufs = [];
    for (const p of paragraphs) {
      bufs.push(await synthesizeWavLocal(p, language, opts));
    }
    return { buffer: concatenateWavs(bufs, 1.6), ext: 'wav' };
  }

  if (engine === 'edge') {
    const set = language === 'english' ? { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' } : { female: 'th-TH-PremwadeeNeural', male: 'th-TH-NiwatNeural' };
    const voice = set[opts.gender === 'male' ? 'male' : 'female'];
    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language === 'english' ? 'en-US' : 'th-TH'}">`;
    for (let i = 0; i < paragraphs.length; i++) {
      ssml += `<voice name="${voice}">${paragraphs[i]}</voice>`;
      if (i < paragraphs.length - 1) {
        ssml += `<break time="1600ms"/>`;
      }
    }
    ssml += `</speak>`;
    return { buffer: await synthesizeEdge(ssml, language, opts), ext: 'mp3' };
  }

  // default: gemini
  const bufs = await Promise.all(paragraphs.map((p) => synthesizeWav(p, opts)));
  return { buffer: concatenateWavs(bufs, 1.6), ext: 'wav' };
}

async function patch(pool, id, obj) {
  const fields = Object.keys(obj);
  if (!fields.length) return;
  await pool.query(
    `UPDATE stories SET ${fields.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
    [...fields.map((k) => obj[k]), id]
  );
}

export async function processStory(id, ctx) {
  const pool = getPool();
  try {
    const cfg = await getConfig();
    // record which engine generated each part (for quality comparison later)
    await patch(pool, id, {
      status: 'processing',
      stage: 'เริ่มประมวลผล',
      engine_story: cfg.engine_story,
      engine_tts: cfg.engine_tts,
      engine_image: cfg.engine_image,
    });

    // Save uploaded image (if any) for record + reuse
    let imagePath = null;
    let base64 = null;
    const mime = ctx.mime || 'image/jpeg';
    if (ctx.imageBuffer) {
      const idir = path.join(process.cwd(), 'public', 'uploads');
      await mkdir(idir, { recursive: true });
      const ext = mime.split('/')[1] || 'jpg';
      const iname = `img_${id}_${Date.now()}.${ext}`;
      imagePath = path.join(idir, iname);
      await writeFile(imagePath, ctx.imageBuffer);
      base64 = ctx.imageBuffer.toString('base64');
      await patch(pool, id, { image_path: `/uploads/${iname}` });
    }

    // ---- STORY (+ vision) ----
    let title, story, moral, image_description = null;
    if (cfg.engine_story === 'gemini') {
      let description = ctx.topic;
      if (ctx.imageBuffer) {
        await patch(pool, id, { stage: 'วิเคราะห์ภาพ (Gemini API)' });
        description = await geminiDescribe(base64, mime);
        image_description = description;
        await patch(pool, id, { image_description });
      }
      await patch(pool, id, { stage: 'กำลังเขียนเรื่อง (Gemini API)' });
      ({ title, story, moral } = await geminiStory({
        description,
        student_name: ctx.student_name,
        story_type: ctx.story_type,
        language: ctx.language,
        paragraphs: ctx.paragraphs,
        age: ctx.age_range,
        category: ctx.category,
      }));
    } else {
      await patch(pool, id, { stage: ctx.imageBuffer ? 'วิเคราะห์ภาพ + เขียนเรื่อง (SUT)' : 'กำลังเขียนเรื่อง (SUT)' });
      const r = await generateStoryViaSut({
        topic: ctx.topic,
        imagePath,
        student_name: ctx.student_name,
        story_type: ctx.story_type,
        language: ctx.language,
        paragraphs: ctx.paragraphs,
        age: ctx.age_range,
        category: ctx.category,
      });
      title = r.title; story = r.story; moral = r.moral; image_description = r.image_description || null;
    }
    if (!story) throw new Error('สร้างเนื้อเรื่องไม่สำเร็จ (เนื้อเรื่องว่าง)');
    await patch(pool, id, { title, story, moral: JSON.stringify(moral), image_description });

    // ---- TTS + scene images (in parallel, per config) ----
    const labelParts = [];
    if (cfg.engine_tts !== 'off') labelParts.push('เสียง');
    if (cfg.engine_image !== 'off') labelParts.push('ฉากภาพ');
    if (labelParts.length) await patch(pool, id, { stage: 'กำลังสร้าง' + labelParts.join(' + ') });

    const tasks = [];
    if (cfg.engine_tts !== 'off') {
      tasks.push(
        (async () => {
          const { buffer, ext } = await makeTts(cfg.engine_tts, story, ctx.language, { speed: ctx.voice_speed, gender: ctx.voice_gender });
          const dir = path.join(process.cwd(), 'public', 'audio');
          await mkdir(dir, { recursive: true });
          const fn = `story_${id}_${Date.now()}.${ext}`;
          await writeFile(path.join(dir, fn), buffer);
          await patch(pool, id, { audio_path: `/audio/${fn}` });
        })()
      );
    }
    if (cfg.engine_image !== 'off') {
      tasks.push(
        (async () => {
          const promptEngine = cfg.engine_image === 'gemini' ? 'gemini' : 'sut';
          const sceneN = Number(ctx.paragraphs) || SCENE_COUNT; // 1 scene image per paragraph
          const prompts = await generateScenePrompts(title || '', story, sceneN, promptEngine);
          await patch(pool, id, { stage: `กำลังสร้างฉากภาพ 0/${prompts.length}` });
          const scenes = await generateSceneImages(
            id,
            prompts,
            async (d, t) => { await patch(pool, id, { stage: `กำลังสร้างฉากภาพ ${d}/${t}` }); },
            { engine: cfg.engine_image, aspectRatio: ctx.aspect_ratio }
          );
          await patch(pool, id, { scenes: JSON.stringify(scenes) });
        })()
      );
    }
    if (tasks.length) await Promise.all(tasks);

    await patch(pool, id, { status: 'done', stage: 'เสร็จ', error: null });
  } catch (e) {
    await patch(pool, id, { status: 'error', stage: 'ผิดพลาด', error: String(e?.message || e) }).catch(() => {});
  }
}

// Generate (or regenerate) only the scene storyboard for an existing story.
export async function processScenesOnly(id) {
  const pool = getPool();
  try {
    const cfg = await getConfig();
    if (cfg.engine_image === 'off') throw new Error('การสร้างฉากภาพถูกปิดอยู่ (เปลี่ยนได้ใน Config)');
    const [rows] = await pool.query('SELECT title, story, aspect_ratio, paragraphs FROM stories WHERE id = ?', [id]);
    if (!rows.length) return;
    const { title, story, aspect_ratio, paragraphs } = rows[0];
    if (!story) throw new Error('ยังไม่มีเนื้อเรื่องสำหรับสร้างฉาก');
    const sceneN = Number(paragraphs) || SCENE_COUNT; // 1 scene image per paragraph
    await patch(pool, id, { status: 'processing', stage: `กำลังสร้างฉากภาพ 0/${sceneN}`, error: null, engine_image: cfg.engine_image });
    const promptEngine = cfg.engine_image === 'gemini' ? 'gemini' : 'sut';
    const prompts = await generateScenePrompts(title || '', story, sceneN, promptEngine);
    const scenes = await generateSceneImages(
      id,
      prompts,
      async (d, t) => { await patch(pool, id, { stage: `กำลังสร้างฉากภาพ ${d}/${t}` }); },
      { engine: cfg.engine_image, aspectRatio: aspect_ratio }
    );
    await patch(pool, id, { scenes: JSON.stringify(scenes), status: 'done', stage: 'เสร็จ', error: null });
  } catch (e) {
    await patch(pool, id, { status: 'error', stage: 'ผิดพลาด', error: String(e?.message || e) }).catch(() => {});
  }
}

// Generate (or regenerate) only the narration audio for an existing story.
export async function processAudioOnly(id) {
  const pool = getPool();
  try {
    const cfg = await getConfig();
    if (cfg.engine_tts === 'off') throw new Error('การสร้างเสียงถูกปิดอยู่ (เปลี่ยนได้ใน Config)');
    const [rows] = await pool.query('SELECT story, language, voice_speed, voice_gender FROM stories WHERE id = ?', [id]);
    if (!rows.length) return;
    const { story, language, voice_speed, voice_gender } = rows[0];
    if (!story) throw new Error('ยังไม่มีเนื้อเรื่องสำหรับสร้างเสียง');
    await patch(pool, id, { status: 'processing', stage: 'กำลังสร้างเสียง (' + (TTS_LABEL[cfg.engine_tts] || 'TTS') + ')', error: null, engine_tts: cfg.engine_tts });
    const { buffer, ext } = await makeTts(cfg.engine_tts, story, language, { speed: voice_speed, gender: voice_gender });
    const dir = path.join(process.cwd(), 'public', 'audio');
    await mkdir(dir, { recursive: true });
    const fn = `story_${id}_${Date.now()}.${ext}`;
    await writeFile(path.join(dir, fn), buffer);
    await patch(pool, id, { audio_path: `/audio/${fn}`, status: 'done', stage: 'เสร็จ', error: null });
  } catch (e) {
    await patch(pool, id, { status: 'error', stage: 'ผิดพลาด', error: String(e?.message || e) }).catch(() => {});
  }
}

// Regenerate a single scene image (optionally with an edited prompt).
export async function regenerateScene(id, index, promptOverride) {
  const pool = getPool();
  const i = Number(index);
  try {
    const cfg = await getConfig();
    if (cfg.engine_image === 'off') throw new Error('การสร้างฉากภาพถูกปิดอยู่ (เปลี่ยนได้ใน Config)');
    const [rows] = await pool.query('SELECT scenes, aspect_ratio FROM stories WHERE id = ?', [id]);
    if (!rows.length) return;
    let scenes = rows[0].scenes;
    if (typeof scenes === 'string') { try { scenes = JSON.parse(scenes); } catch { scenes = []; } }
    scenes = scenes || [];
    if (i < 0 || i >= scenes.length) throw new Error('ลำดับฉากไม่ถูกต้อง');
    const prompt = (promptOverride && String(promptOverride).trim()) || scenes[i].prompt || '';
    const n = scenes[i].n || i + 1;
    await patch(pool, id, { status: 'processing', stage: `กำลังสร้างฉากภาพใหม่ #${n}`, error: null });
    const one = await generateOneScene(id, n, prompt, { engine: cfg.engine_image, aspectRatio: rows[0].aspect_ratio });
    scenes[i] = one;
    await pool.query('UPDATE stories SET scenes = ?, status = ?, stage = ? WHERE id = ?', [JSON.stringify(scenes), 'done', 'เสร็จ', id]);
  } catch (e) {
    await patch(pool, id, { status: 'done', stage: 'เสร็จ', error: `สร้างฉาก #${i + 1} ไม่สำเร็จ: ${String(e?.message || e)}` }).catch(() => {});
  }
}

// Reset a row and regenerate everything (reuses saved topic / uploaded image).
export async function retryStory(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM stories WHERE id = ?', [id]);
  if (!rows.length) return;
  const row = rows[0];
  await pool.query(
    `UPDATE stories SET status='queued', stage='รอคิว', title=NULL, story=NULL, moral=NULL, scenes=NULL, audio_path=NULL, error=NULL WHERE id=?`,
    [id]
  );
  let imageBuffer = null;
  let mime = null;
  if (row.image_path) {
    try {
      imageBuffer = await readFile(path.join(process.cwd(), 'public', row.image_path.replace(/^\//, '')));
      mime = 'image/' + (row.image_path.split('.').pop() || 'jpeg');
    } catch {}
  }
  processStory(id, {
    student_name: row.student_name,
    story_type: row.story_type,
    language: row.language,
    topic: row.topic,
    paragraphs: row.paragraphs,
    voice_speed: row.voice_speed,
    voice_gender: row.voice_gender,
    aspect_ratio: row.aspect_ratio,
    age_range: row.age_range,
    category: row.category,
    imageBuffer,
    mime,
  }).catch(() => {});
}
