import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ทดสอบว่าคีย์ใช้งานได้จริงหรือไม่
 *
 * ยิงคำขอที่ "เบาที่สุด" ของแต่ละเจ้า — ไม่สร้างเนื้อหา ไม่เปลืองโควตา
 * แยกให้ชัดระหว่าง "คีย์ผิด" กับ "คีย์ถูกแต่เครดิตหมด/ยังไม่ได้สิทธิ์"
 */

const TIMEOUT = 15000;

async function req(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

const TESTS = {
  /** Gemini — เรียก generateContent สั้นที่สุด เพื่อให้เจอปัญหาเครดิตด้วย */
  async gemini() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { ok: false, msg: 'ยังไม่ได้ตั้งค่า' };
    const r = await req(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'hi' }] }],
          generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 5 },
        }),
      }
    );
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, msg: 'ใช้งานได้' };

    const m = d?.error?.message || `HTTP ${r.status}`;
    if (/API key not valid|API_KEY_INVALID/i.test(m)) {
      return { ok: false, msg: 'คีย์ไม่ถูกต้อง' };
    }
    if (/quota|credit|billing|exceeded|depleted/i.test(m)) {
      // คีย์ถูกต้อง แต่ใช้ไม่ได้ตอนนี้ — แยกให้ผู้ใช้รู้ว่าไม่ต้องเปลี่ยนคีย์
      return { ok: false, warn: true, msg: 'คีย์ถูกต้อง แต่เครดิต/โควตาหมด' };
    }
    return { ok: false, msg: m.slice(0, 120) };
  },

  /** YouTube — แลก refresh token แล้วดูข้อมูลช่อง (quota 1 unit) */
  async youtube() {
    const { YT_CLIENT_ID: id, YT_CLIENT_SECRET: sec, YT_REFRESH_TOKEN: rt } = process.env;
    const missing = [!id && 'Client ID', !sec && 'Client Secret', !rt && 'Refresh Token']
      .filter(Boolean);
    if (missing.length) return { ok: false, msg: 'ยังไม่ได้ตั้ง: ' + missing.join(', ') };

    const tr = await req('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id, client_secret: sec,
        refresh_token: rt, grant_type: 'refresh_token',
      }),
    });
    const td = await tr.json().catch(() => ({}));
    if (!tr.ok) {
      const e = td.error_description || td.error || `HTTP ${tr.status}`;
      if (/invalid_grant/i.test(String(td.error))) {
        return { ok: false, msg: 'Refresh Token หมดอายุหรือถูกเพิกถอน' };
      }
      if (/invalid_client/i.test(String(td.error))) {
        return { ok: false, msg: 'Client ID หรือ Secret ไม่ถูกต้อง' };
      }
      return { ok: false, msg: String(e).slice(0, 120) };
    }

    const cr = await req(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${td.access_token}` } }
    );
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok) {
      return { ok: false, msg: (cd?.error?.message || `HTTP ${cr.status}`).slice(0, 120) };
    }
    const name = cd.items?.[0]?.snippet?.title;
    return { ok: true, msg: name ? `เชื่อมกับช่อง "${name}"` : 'ใช้งานได้' };
  },

  /** TikTok — ขอข้อมูลผู้ใช้ (endpoint ที่บังคับใช้ก่อนโพสต์อยู่แล้ว) */
  async tiktok() {
    const tok = process.env.TIKTOK_ACCESS_TOKEN;
    if (!tok) return { ok: false, msg: 'ยังไม่ได้ตั้ง Access Token' };
    const r = await req('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });
    const d = await r.json().catch(() => ({}));
    const code = d?.error?.code;
    if (r.ok && (code === 'ok' || !code)) {
      const n = d?.data?.creator_nickname;
      return { ok: true, msg: n ? `เชื่อมกับบัญชี "${n}"` : 'ใช้งานได้' };
    }
    if (/access_token_invalid|invalid_access_token/i.test(String(code))) {
      return { ok: false, msg: 'Access Token ไม่ถูกต้องหรือหมดอายุ' };
    }
    if (/scope_not_authorized|scope_permission_missed/i.test(String(code))) {
      return { ok: false, warn: true, msg: 'ยังไม่ได้สิทธิ์ video.publish (ต้องผ่าน audit)' };
    }
    return { ok: false, msg: (d?.error?.message || code || `HTTP ${r.status}`).slice(0, 120) };
  },

  /** Facebook — ดูชื่อเพจจาก Page ID + token */
  async facebook() {
    const { FB_PAGE_ID: id, FB_PAGE_TOKEN: tok } = process.env;
    const missing = [!id && 'Page ID', !tok && 'Page Token'].filter(Boolean);
    if (missing.length) return { ok: false, msg: 'ยังไม่ได้ตั้ง: ' + missing.join(', ') };

    const r = await req(
      `https://graph.facebook.com/v25.0/${id}?fields=name,category&access_token=${tok}`
    );
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.name) return { ok: true, msg: `เชื่อมกับเพจ "${d.name}"` };

    const m = d?.error?.message || `HTTP ${r.status}`;
    if (/expired|Session has expired/i.test(m)) {
      return { ok: false, msg: 'Token หมดอายุ — ต้องขอใหม่' };
    }
    if (/permission|OAuth/i.test(m)) {
      return { ok: false, warn: true, msg: 'สิทธิ์ไม่พอ — ตรวจ App Review และสิทธิ์ ADMIN' };
    }
    return { ok: false, msg: String(m).slice(0, 120) };
  },
};

/** POST { platform: 'gemini' | 'youtube' | 'tiktok' | 'facebook' | 'all' } */
export async function POST(req_) {
  let body = {};
  try { body = await req_.json(); } catch {}
  const which = String(body.platform || 'all');

  const keys = which === 'all' ? Object.keys(TESTS) : [which];
  if (keys.some((k) => !TESTS[k])) {
    return NextResponse.json({ error: 'ไม่รู้จักแพลตฟอร์มนี้' }, { status: 400 });
  }

  const out = {};
  await Promise.all(keys.map(async (k) => {
    const t0 = Date.now();
    try {
      out[k] = { ...(await TESTS[k]()), ms: Date.now() - t0 };
    } catch (e) {
      const msg = e?.name === 'AbortError'
        ? 'หมดเวลารอ (เชื่อมต่อไม่ได้)'
        : String(e.message || e).slice(0, 120);
      out[k] = { ok: false, msg, ms: Date.now() - t0 };
    }
  }));

  return NextResponse.json({ results: out });
}
