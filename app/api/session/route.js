import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const SESSION_COOKIE = 'ss_admin';

function allowedUsers() {
  const raw = process.env.ADMIN_USERS || '';
  const map = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return map;
}

/** เข้าสู่ระบบด้วยฟอร์ม — ออก cookie session (แทน popup ของ Basic Auth) */
export async function POST(req) {
  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = String(body.email || '').trim();
    password = String(body.password || '');
  } catch {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
  }

  const users = allowedUsers();
  if (users[email] === undefined || users[email] !== password) {
    // ตอบข้อความเดียวกันทั้งกรณีอีเมลผิดและรหัสผิด เพื่อไม่ให้เดาว่ามีอีเมลนี้อยู่จริงไหม
    return NextResponse.json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  }

  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** ออกจากระบบ — ลบ cookie */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
