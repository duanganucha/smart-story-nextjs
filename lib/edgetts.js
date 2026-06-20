// Free neural TTS via Microsoft Edge (edge-tts python package). Outputs MP3.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileP = promisify(execFile);
const PY = process.env.PYTHON || 'python3';
const VOICE_TH = { female: process.env.EDGE_TTS_VOICE_TH || 'th-TH-PremwadeeNeural', male: 'th-TH-NiwatNeural' };
const VOICE_EN = { female: process.env.EDGE_TTS_VOICE_EN || 'en-US-AriaNeural', male: 'en-US-GuyNeural' };
const RATE = { slow: '-20%', normal: '+0%', fast: '+25%' };

// Returns an MP3 Buffer. Retries — edge-tts occasionally returns NoAudioReceived.
export async function synthesizeEdge(text, language, opts = {}) {
  const set = language === 'english' ? VOICE_EN : VOICE_TH;
  const voice = set[opts.gender === 'male' ? 'male' : 'female'];
  const rate = RATE[opts.speed] || RATE.normal;
  const base = path.join(os.tmpdir(), `edge_${Date.now()}_${process.pid}`);
  const txt = base + '.txt';
  const mp3 = base + '.mp3';
  await writeFile(txt, text, 'utf8');
  try {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execFileP(PY, ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--file', txt, '--write-media', mp3], { timeout: 180000 });
        const buf = await readFile(mp3).catch(() => Buffer.alloc(0));
        if (buf.length > 0) return buf;
        lastErr = new Error('edge-tts returned empty audio');
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw lastErr || new Error('edge-tts failed');
  } finally {
    unlink(txt).catch(() => {});
    unlink(mp3).catch(() => {});
  }
}
