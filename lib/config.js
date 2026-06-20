import { getPool } from './db';

// engine_story: 'sut' (local SUT GenAI) | 'gemini' (Gemini API key)
// engine_tts:   'gemini' (Gemini API key) | 'off'
// engine_image: 'sut' (SUT Nano Banana) | 'gemini' (Gemini API image) | 'off'
export const DEFAULTS = { engine_story: 'sut', engine_tts: 'gemini', engine_image: 'sut' };

export async function getConfig() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT name, value FROM settings');
  const cfg = { ...DEFAULTS };
  for (const r of rows) if (r.name in cfg) cfg[r.name] = r.value;
  return cfg;
}

export async function setConfig(patch) {
  const pool = getPool();
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k] != null) {
      await pool.query(
        'INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [k, String(patch[k])]
      );
    }
  }
  return getConfig();
}
