import { NextResponse } from 'next/server';
import { signSession } from '@/lib/token';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Issues a short-lived "guest" session token so the app (including visitors who
// don't sign in) can read content, while outsiders without a token are blocked.
export async function POST() {
  const gid = 'g_' + crypto.randomBytes(12).toString('hex');
  const token = await signSession({ role: 'guest', gid }, 30);
  return NextResponse.json({ token, role: 'guest' });
}
