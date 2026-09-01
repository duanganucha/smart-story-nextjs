import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ล็อกอินอัตโนมัติสำหรับ "โหมด dev เท่านั้น"
 *
 * ใช้บัญชีแรกใน ADMIN_USERS แล้วออก cookie เดียวกับการล็อกอินปกติ
 * ปิดตายใน production — ทั้งที่นี่และใน middleware
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'ใช้ได้เฉพาะโหมด dev' }, { status: 404 });
  }

  const first = (process.env.ADMIN_USERS || '').split(',')[0] || '';
  const i = first.indexOf(':');
  if (i <= 0) {
    return NextResponse.json({ error: 'ไม่พบ ADMIN_USERS ใน .env.local' }, { status: 500 });
  }
  const email = first.slice(0, i).trim();

  const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
  const token = await new SignJWT({ email, role: 'admin', dev: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const res = NextResponse.json({ ok: true, email });
  res.cookies.set('ss_admin', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
