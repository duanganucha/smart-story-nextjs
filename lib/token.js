// Session tokens (guest + user) and signed/expiring media URLs.
// Used to gate the API and story media so only app clients holding a token
// (and freshly-signed media links) can read content. Not bullet-proof against
// a determined cloner (use Play Integrity / App Attest for that), but blocks
// casual scraping and hot-linking.
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';

const SECRET_STR = process.env.JWT_SECRET || 'dev-insecure-change-me';
const SECRET = new TextEncoder().encode(SECRET_STR);

// ---- session tokens (Bearer) ----
export async function signSession(payload, days = 30) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(SECRET);
}

export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

// Read "Authorization: Bearer <jwt>" from a request and verify it.
export async function getSession(req) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? await verifySession(m[1]) : null;
}

// ---- signed, expiring media URLs ----
// Produces "<path>?e=<expEpoch>&s=<hmac>" so leaked links stop working after TTL.
export function signMediaPath(path, ttlSec = 60 * 60 * 24) {
  if (!path) return path;
  const clean = ('/' + String(path).replace(/^\/+/, '')).split('?')[0];
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = mediaSig(clean, exp);
  const sep = clean.includes('?') ? '&' : '?';
  return `${clean}${sep}e=${exp}&s=${sig}`;
}

export function verifyMediaSig(pathname, exp, sig) {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = mediaSig(pathname, Number(exp));
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mediaSig(pathname, exp) {
  return crypto
    .createHmac('sha256', SECRET_STR)
    .update(`${pathname}.${exp}`)
    .digest('base64url');
}
