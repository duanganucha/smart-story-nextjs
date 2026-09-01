'use client';

import { useEffect, useRef, useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [next, setNext] = useState('/');
  const emailRef = useRef(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('next');
    if (p && p.startsWith('/') && !p.startsWith('//')) setNext(p);
    emailRef.current?.focus();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'เข้าสู่ระบบไม่สำเร็จ');
      window.location.replace(next);
    } catch (e) {
      setError(String(e.message || e));
      setBusy(false);
    }
  }

  async function demo() {
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/dev-login', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ใช้ได้เฉพาะโหมด dev');
      window.location.replace(next);
    } catch (e) {
      setError(String(e.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="lwrap">
      <div className="lcard">
        <div className="brand">
          <div className="logo">📖</div>
          <h1>Smart Story <span className="em">AI</span></h1>
          <p className="tag">ระบบจัดการนิทานและวิดีโอ</p>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="email">อีเมล</label>
          <input
            id="email" ref={emailRef} type="email" autoComplete="username"
            placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} required
          />

          <label htmlFor="pw">รหัสผ่าน</label>
          <div className="pwrap">
            <input
              id="pw" type={show ? 'text' : 'password'} autoComplete="current-password"
              placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)} required
            />
            <button type="button" className="eye" onClick={() => setShow((s) => !s)}
                    tabIndex={-1} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
              {show ? '🙈' : '👁'}
            </button>
          </div>

          {error && <div className="lerr">{error}</div>}

          <button type="submit" className="go" disabled={busy}>
            {busy ? <><span className="spin" />กำลังเข้าสู่ระบบ…</> : 'เข้าสู่ระบบ'}
          </button>
        </form>

        {process.env.NODE_ENV !== 'production' && (
          <>
            <div className="divider"><span>หรือ</span></div>
            <button className="demo" onClick={demo} disabled={busy}>
              🔑 Demo login <span className="devtag">dev</span>
            </button>
          </>
        )}

        <p className="foot">เข้าถึงได้เฉพาะผู้ดูแลระบบ</p>
      </div>

      <style jsx>{`
        .lwrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(1100px 600px at 12% -10%, rgba(245, 158, 11, 0.16), transparent 60%),
            radial-gradient(900px 520px at 108% 15%, rgba(56, 189, 248, 0.16), transparent 55%),
            linear-gradient(180deg, #0b1220, #0f172a 55%);
        }
        .lcard {
          width: 100%;
          max-width: 400px;
          background: rgba(30, 41, 59, 0.82);
          backdrop-filter: blur(14px);
          border: 1px solid var(--line);
          border-radius: 20px;
          padding: 34px 30px 26px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
        }
        .brand { text-align: center; margin-bottom: 22px; }
        .logo {
          width: 60px; height: 60px; margin: 0 auto 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 30px; border-radius: 17px;
          background: linear-gradient(135deg, var(--accent), #fbbf24);
          box-shadow: 0 8px 22px rgba(245, 158, 11, 0.3);
        }
        .brand h1 { font-size: 22px; margin: 0 0 4px; }
        .tag { color: var(--muted); font-size: 13px; margin: 0; }

        /* เขียนทับสไตล์ input จาก globals.css ให้เข้ากับการ์ดนี้ */
        form :global(label) {
          display: block;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: .01em;
          color: #cbd5e1;
          margin: 16px 0 7px;
        }
        form :global(input) {
          width: 100%;
          box-sizing: border-box;
          height: 46px;
          padding: 0 14px;
          font-size: 14.5px;
          font-family: inherit;
          color: #e2e8f0;
          background: rgba(11, 19, 36, .85);
          border: 1px solid #3a4a63;
          border-radius: 11px;
          outline: none;
          transition: border-color .15s, box-shadow .15s, background .15s;
        }
        form :global(input::placeholder) { color: #64748b; }
        form :global(input:hover) { border-color: #465875; }
        form :global(input:focus) {
          border-color: var(--accent);
          background: rgba(11, 19, 36, 1);
          box-shadow: 0 0 0 3px rgba(245, 158, 11, .16);
        }
        /* ปิดพื้นหลังเหลืองของ autofill ใน Chrome */
        form :global(input:-webkit-autofill),
        form :global(input:-webkit-autofill:focus) {
          -webkit-text-fill-color: #e2e8f0;
          -webkit-box-shadow: 0 0 0 1000px #0b1324 inset;
          caret-color: #e2e8f0;
        }

        .pwrap { position: relative; }
        .pwrap :global(input) { padding-right: 46px; }
        .eye {
          position: absolute;
          right: 4px;
          top: 0;
          height: 46px;
          width: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: 0;
          border-radius: 9px;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          opacity: .6;
        }
        .eye:hover { opacity: 1; background: rgba(255, 255, 255, .05); }

        .lerr {
          margin-top: 14px; padding: 10px 12px; font-size: 13px;
          color: #fecaca; background: rgba(127, 29, 29, 0.35);
          border: 1px solid #7f1d1d; border-radius: 10px;
        }
        .go {
          margin-top: 22px; width: 100%; height: 48px; padding: 0; border: 0;
          border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 700;
          font-family: inherit; color: #111;
          background: linear-gradient(90deg, var(--accent), #fbbf24);
          display: flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 6px 18px rgba(245, 158, 11, .22);
          transition: filter .15s, box-shadow .15s;
        }
        .go:hover:not(:disabled) { filter: brightness(1.06); }
        .go:disabled { opacity: .6; cursor: not-allowed; }

        .divider {
          display: flex; align-items: center; gap: 12px;
          margin: 20px 0 14px; color: var(--muted); font-size: 12px;
        }
        .divider::before, .divider::after {
          content: ''; flex: 1; height: 1px; background: var(--line);
        }
        .demo {
          width: 100%; height: 46px; padding: 0; cursor: pointer; font-size: 14px;
          font-family: inherit; color: #e2e8f0;
          background: #0b1324; border: 1px solid var(--line); border-radius: 10px;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .demo:hover:not(:disabled) { border-color: var(--accent2); background: #111c33; }
        .demo:disabled { opacity: .6; cursor: not-allowed; }
        .devtag {
          font-size: 10px; padding: 2px 7px; border-radius: 999px;
          background: #3f2d12; color: #fcd34d; font-weight: 600;
        }
        .foot {
          text-align: center; color: var(--muted);
          font-size: 12px; margin: 20px 0 0;
        }
      `}</style>
    </div>
  );
}
