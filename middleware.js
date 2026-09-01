import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ADMIN_USERS = "email:pass,email:pass" — controls who can access the web UI.
// No hardcoded fallback: if ADMIN_USERS is unset the admin surface is closed
// (every Basic-Auth check fails) rather than opening on a credential that
// anyone reading the source would know.

// REQUIRE_TOKEN=true → GET /api/* and media require a valid Bearer JWT.
// Keep false until the mobile app is updated to send the token.
const REQUIRE_TOKEN = process.env.REQUIRE_TOKEN === 'true';

function allowedUsers() {
  const raw = process.env.ADMIN_USERS || '';
  const map = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return map;
}

function unauthorized() {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Smart Story Admin", charset="UTF-8"' },
  });
}

function checkBasicAuth(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  let decoded = '';
  try { decoded = atob(m[1]); } catch { return false; }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const users = allowedUsers();
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  return users[user] !== undefined && users[user] === pass;
}

async function checkSessionCookie(req) {
  const token = req.cookies.get('ss_admin')?.value;
  if (!token || !process.env.JWT_SECRET) return false;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

async function checkBearerToken(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m || !process.env.JWT_SECRET) return false;
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  try {
    await jwtVerify(m[1], secret, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Mobile-app endpoints the logged-in app calls without Basic Auth.
  // /api/account is the in-app account-deletion endpoint (App Store 5.1.1(v)).
  const isMobileAuth =
    pathname === '/api/auth' || pathname === '/api/token' || pathname === '/api/account';
  const isRead = method === 'GET' || method === 'HEAD';
  const isApi = pathname.startsWith('/api/');
  const isMedia =
    pathname.startsWith('/scenes/') ||
    pathname.startsWith('/audio/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/public/');

  // Mobile auth/token endpoints — always open
  if (isMobileAuth) return NextResponse.next();

  // Dev-only convenience login (ปิดตายใน production ทั้งที่นี่และในตัว route เอง)
  if (pathname === '/api/dev-login' && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  // หน้า login และ API session — ต้องเข้าถึงได้โดยไม่ต้องล็อกอิน
  if (pathname === '/login' || pathname === '/api/session') return NextResponse.next();

  if (REQUIRE_TOKEN) {
    // Bearer JWT required for read APIs and media
    if (isMedia || (isApi && isRead)) {
      if (!(await checkBearerToken(req)))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.next();
    }
  } else {
    // Token gate off: read APIs and media are open
    if (isMedia || (isApi && isRead)) return NextResponse.next();
  }

  // Admin web pages + write APIs
  // รับได้ทั้ง cookie session (จากหน้า /login) และ Basic Auth (สคริปต์/เครื่องมือเดิม)
  if (await checkSessionCookie(req)) return NextResponse.next();
  if (checkBasicAuth(req)) return NextResponse.next();

  // เรียกจากหน้าเว็บ → พาไปหน้า login สวย ๆ แทน popup ของเบราว์เซอร์
  if (!isApi) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return unauthorized();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
