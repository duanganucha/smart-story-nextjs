import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { rm, unlink } from 'fs/promises';
import path from 'path';
import { getPool } from '@/lib/db';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const audList = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

// Verify an OAuth idToken and return its provider subject id, mirroring
// /api/auth so the same account is identified. Returns null on any failure.
async function verifyIdToken(provider, idToken) {
  if (!provider || !idToken) return null;
  try {
    if (provider === 'google') {
      const aud = audList(process.env.GOOGLE_CLIENT_IDS);
      const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        ...(aud.length ? { audience: aud } : {}),
      });
      return { provider: 'google', sub: payload.sub };
    }
    if (provider === 'apple') {
      const aud = audList(process.env.APPLE_CLIENT_IDS);
      const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
        issuer: 'https://appleid.apple.com',
        ...(aud.length ? { audience: aud } : {}),
      });
      return { provider: 'apple', sub: payload.sub };
    }
  } catch {
    return null;
  }
  return null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Permanently delete a user account and ALL associated data
// (App Store Guideline 5.1.1(v) / Google Play Account deletion).
//
// Removes, for the given user:
//   - every story they own (DB row + audio/image files + public/scenes/<id> dir)
//   - their per-story "loves"
//   - the user record itself
//
// The client (logged-in session) sends { userId, email }. Both must match the
// same row — a lightweight ownership check given the API is not yet token-gated.
// TODO: when the session-token system (lib/token.js) ships, require & verify the
// caller's bearer/idToken instead of trusting the posted userId+email.
export async function DELETE(req) {
  const { userId, email, provider, idToken } = await req.json().catch(() => ({}));
  const uid = Number(userId);
  if (!uid) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const pool = getPool();
  const [users] = await pool.query(
    'SELECT id, email, provider, provider_sub FROM users WHERE id = ?',
    [uid]
  );
  if (!users.length) {
    // Already gone — treat as success so the client can finish its flow.
    return NextResponse.json({ ok: true, deleted: uid, note: 'not found' });
  }
  const acct = users[0];

  // --- Ownership proof (was missing entirely — anyone could delete any uid) ---
  // Preferred: a verified OAuth idToken whose subject matches this account.
  // Legacy fallback for the shipped app, which sends userId+email but no token:
  // require the email and require it to MATCH — closing the old bypass where
  // omitting `email` skipped the check. When the app is updated to send an
  // idToken, drop the legacy branch.
  const verified = await verifyIdToken(provider, idToken);
  if (verified) {
    if (verified.provider !== acct.provider || String(verified.sub) !== String(acct.provider_sub)) {
      return NextResponse.json({ error: 'token does not match account' }, { status: 403 });
    }
  } else {
    if (idToken) {
      // A token was supplied but failed verification — never fall through to
      // the weaker email check in that case.
      return NextResponse.json({ error: 'invalid idToken' }, { status: 401 });
    }
    const dbEmail = acct.email;
    if (!email || !dbEmail || String(email) !== String(dbEmail)) {
      return NextResponse.json({ error: 'ownership check failed' }, { status: 403 });
    }
  }

  // Delete media files for every story the user owns.
  const [stories] = await pool.query(
    'SELECT id, audio_path, image_path FROM stories WHERE user_id = ?',
    [uid]
  );
  const delFile = async (p) => {
    if (p) {
      try { await unlink(path.join(process.cwd(), 'public', p.replace(/^\//, ''))); } catch {}
    }
  };
  for (const s of stories) {
    await delFile(s.audio_path);
    await delFile(s.image_path);
    try { await rm(path.join(process.cwd(), 'public', 'scenes', String(s.id)), { recursive: true, force: true }); } catch {}
  }

  // Remove DB rows. Order matters if FKs aren't ON DELETE CASCADE:
  // loves (by this user) → stories (owned) → the user.
  await pool.query('DELETE FROM story_loves WHERE user_id = ?', [uid]);
  await pool.query('DELETE FROM stories WHERE user_id = ?', [uid]);
  await pool.query('DELETE FROM users WHERE id = ?', [uid]);

  return NextResponse.json({ ok: true, deleted: uid, stories: stories.length });
}
