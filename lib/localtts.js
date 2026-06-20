// Local text-to-speech using macOS `say` + `afconvert` (no API key needed).
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileP = promisify(execFile);
// macOS Thai voices are female (Kanya/Narisa); use them as female/male tone variants
const VOICE_TH = { female: process.env.LOCAL_TTS_VOICE_TH || 'Kanya', male: 'Narisa' };
const VOICE_EN = { female: process.env.LOCAL_TTS_VOICE_EN || 'Samantha', male: 'Daniel' };
const RATE = { slow: 150, normal: 185, fast: 220 };

// Returns a WAV Buffer (16-bit PCM, 24kHz mono) — same shape as the Gemini path.
export async function synthesizeWavLocal(text, language, opts = {}) {
  const set = language === 'english' ? VOICE_EN : VOICE_TH;
  const voice = set[opts.gender === 'male' ? 'male' : 'female'];
  const rate = RATE[opts.speed] || RATE.normal;
  const base = path.join(os.tmpdir(), `ltts_${Date.now()}_${process.pid}`);
  const aiff = base + '.aiff';
  const wav = base + '.wav';
  try {
    await execFileP('say', ['-v', voice, '-r', String(rate), '-o', aiff, '--', text], { timeout: 180000 });
    await execFileP('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', aiff, wav], { timeout: 60000 });
    return await readFile(wav);
  } finally {
    unlink(aiff).catch(() => {});
    unlink(wav).catch(() => {});
  }
}
