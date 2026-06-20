import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const ids = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

async function verifyToken(provider, idToken) {
  if (provider === 'google') {
    const aud = ids(process.env.GOOGLE_CLIENT_IDS);
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      ...(aud.length ? { audience: aud } : {}),
    });
    return { sub: payload.sub, email: payload.email || null, name: payload.name || null, avatar: payload.picture || null };
  }
  if (provider === 'apple') {
    const aud = ids(process.env.APPLE_CLIENT_IDS);
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      ...(aud.length ? { audience: aud } : {}),
    });
    return { sub: payload.sub, email: payload.email || null, name: null, avatar: null };
  }
  throw new Error('unknown provider');
}

export async function POST(req) {
  const { provider, idToken, name, email } = await req.json().catch(() => ({}));
  if (!provider || !idToken) {
    return NextResponse.json({ error: 'provider and idToken are required' }, { status: 400 });
  }

  let info;
  try {
    info = await verifyToken(provider, idToken);
  } catch (e) {
    return NextResponse.json({ error: 'ยืนยัน token ไม่สำเร็จ: ' + String(e?.message || e) }, { status: 401 });
  }

  const finalEmail = info.email || email || null;
  const finalName = info.name || name || (finalEmail ? finalEmail.split('@')[0] : null) || 'ผู้ใช้';
  const pool = getPool();
  await pool.query(
    `INSERT INTO users (provider, provider_sub, email, name, avatar_url)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       name = COALESCE(name, VALUES(name)),
       avatar_url = COALESCE(VALUES(avatar_url), avatar_url),
       last_login_at = CURRENT_TIMESTAMP`,
    [provider, info.sub, finalEmail, finalName, info.avatar]
  );
  const [rows] = await pool.query(
    'SELECT id, provider, email, name, avatar_url FROM users WHERE provider = ? AND provider_sub = ?',
    [provider, info.sub]
  );
  return NextResponse.json(rows[0]);
}
