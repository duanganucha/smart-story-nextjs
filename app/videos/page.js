'use client';

import { useEffect, useMemo, useState } from 'react';
import KeysDialog from '../KeysDialog';

function fmtSize(b) {
  if (!b && b !== 0) return '';
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString('th-TH', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function VideosPage() {
  const [showKeys, setShowKeys] = useState(false);
  const [videos, setVideos] = useState([]);
  const [dir, setDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/videos', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setVideos(d.videos || []);
      setDir(d.dir || '');
    } catch (e) {
      setError('โหลดรายการวิดีโอไม่สำเร็จ: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.replace('/login');
  }

  useEffect(() => { load(); }, []);

  // ปิดตัวเล่นด้วยปุ่ม Esc
  useEffect(() => {
    if (!playing) return;
    const onKey = (e) => e.key === 'Escape' && setPlaying(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return videos;
    return videos.filter(
      (v) => v.title.toLowerCase().includes(s) || String(v.id ?? '').includes(s)
    );
  }, [videos, q]);

  const totalSize = videos.reduce((a, v) => a + (v.size || 0), 0);

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>วิดีโอ<span className="em">นิทาน</span></h1>
          <p className="sub">
            วิดีโอแนวตั้ง 1080×1920 พร้อมโพสต์ Facebook / YouTube Shorts / TikTok
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="cfgbtn" href="/">← หน้าหลัก</a>
          <button className="cfgbtn" onClick={() => setShowKeys(true)}
                  title="จัดการ API Key">🔑</button>
          <a className="cfgbtn" href="/pipeline">📊 สถานะ</a>
          <a className="cfgbtn" href="/insights">📈 แนวโน้ม</a>
          <button className="cfgbtn" onClick={logout} title="ออกจากระบบ">🚪 ออกจากระบบ</button>
          <button className="cfgbtn" onClick={load} disabled={loading}>
            {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
          </button>
        </div>
      </div>

      {showKeys && <KeysDialog onClose={() => setShowKeys(false)} />}

      {error && <div className="card err" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: 2 }}>
            <input
              type="text"
              placeholder="ค้นหาชื่อเรื่อง หรือ id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="meta" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <span>{shown.length} วิดีโอ</span>
            {totalSize > 0 && <span>· {fmtSize(totalSize)}</span>}
          </div>
        </div>
        {dir && <div className="hint">โฟลเดอร์: {dir}</div>}
      </div>

      {loading && videos.length === 0 && (
        <div className="card meta"><span className="spin" />กำลังโหลด…</div>
      )}

      {!loading && videos.length === 0 && !error && (
        <div className="card">
          <p style={{ margin: '0 0 8px' }}>ยังไม่มีวิดีโอ</p>
          <div className="hint">
            สร้างได้ด้วยคำสั่ง:<br />
            <code>cd bearrytales-video &amp;&amp; python3 make-video.py --list</code><br />
            <code>python3 make-video.py 92</code> (เรื่องเดียว) หรือ{' '}
            <code>--all</code> (ทุกเรื่อง)
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="vgrid">
          {shown.map((v) => (
            <div key={v.name} className="vcard">
              <button className="vthumb" onClick={() => setPlaying(v)} title="เล่นวิดีโอ">
                <video src={`${v.url}#t=1`} preload="metadata" muted playsInline />
                <span className="vplay">▶</span>
              </button>
              <div className="vbody">
                <div className="t" title={v.title}>{v.title}</div>
                <div className="meta">
                  {v.id != null && <span>#{v.id}</span>}
                  <span>{fmtSize(v.size)}</span>
                  <span>{fmtDate(v.mtime)}</span>
                </div>
                <div className="meta" style={{ marginTop: 4 }}>
                  {v.category && <span className="badge topic">{v.category}</span>}
                  {v.views != null && <span>👁 {v.views}</span>}
                  {v.loves != null && <span>♥ {v.loves}</span>}
                </div>
                <div className="vact">
                  <button className="refresh" onClick={() => setPlaying(v)}>เล่น</button>
                  <a className="refresh" href={v.url} download={v.name}>ดาวน์โหลด</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {playing && (
        <div className="modal-overlay" onClick={() => setPlaying(null)}>
          <div className="vmodal" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">{playing.title}</div>
              <button className="refresh" onClick={() => setPlaying(null)}>ปิด ✕</button>
            </div>
            {/* key บังคับให้ React สร้าง element ใหม่เมื่อเปลี่ยนเรื่อง ไม่งั้นวิดีโอเก่าค้าง */}
            <video key={playing.url} src={playing.url} controls autoPlay playsInline />
            <div className="meta" style={{ marginTop: 8, justifyContent: 'center' }}>
              <span>{playing.name}</span>
              <span>· {fmtSize(playing.size)}</span>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .vgrid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 16px;
        }
        .vcard {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .vcard:hover { border-color: var(--accent2); }
        .vthumb {
          position: relative;
          padding: 0;
          border: 0;
          background: #0b1324;
          cursor: pointer;
          display: block;
          width: 100%;
          aspect-ratio: 9 / 16;
          overflow: hidden;
        }
        .vthumb video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .vplay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 34px;
          color: #fff;
          text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
          background: rgba(0, 0, 0, 0.15);
          opacity: 0.85;
        }
        .vthumb:hover .vplay { opacity: 1; background: rgba(0, 0, 0, 0.3); }
        .vbody { padding: 12px; display: flex; flex-direction: column; gap: 2px; }
        .vbody .t {
          font-size: 14px;
          line-height: 1.4;
          margin-bottom: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .vact { display: flex; gap: 8px; margin-top: 10px; }
        .vact > * { flex: 1; text-align: center; text-decoration: none; }
        .vmodal {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px;
          max-width: min(460px, 94vw);
          width: 100%;
        }
        .vmodal video {
          width: 100%;
          max-height: 74vh;
          border-radius: 10px;
          background: #000;
          display: block;
        }
      `}</style>
    </div>
  );
}
