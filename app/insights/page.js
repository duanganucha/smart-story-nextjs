'use client';

import { useEffect, useState } from 'react';
import KeysDialog from '../KeysDialog';

/** แถบเปรียบเทียบแนวนอน — อ่านง่ายกว่ากราฟวงกลมเมื่อเทียบหลายหมวด */
function Bars({ rows, valueKey = 'avg_views', unit = 'วิว/เรื่อง', minStories = 1 }) {
  const shown = rows.filter((r) => r.stories >= minStories);
  const max = Math.max(...shown.map((r) => Number(r[valueKey]) || 0), 1);
  if (!shown.length) return <div className="meta">ยังไม่มีข้อมูลพอ</div>;
  return (
    <div className="bars">
      {shown.map((r) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <div key={r.name} className="barrow">
            <div className="blabel" title={r.name}>{r.name}</div>
            <div className="btrack">
              <div className="bfill" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="bval">{v} <span>{unit}</span></div>
            <div className="bcount">{r.stories} เรื่อง</div>
          </div>
        );
      })}
      <style jsx>{`
        .bars { display: flex; flex-direction: column; gap: 9px; }
        .barrow {
          display: grid;
          grid-template-columns: 168px 1fr 96px 68px;
          align-items: center; gap: 10px; font-size: 13px;
        }
        .blabel {
          color: #e2e8f0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .btrack { background: #0b1324; border-radius: 999px; height: 20px; overflow: hidden; }
        .bfill {
          height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, var(--accent2), #818cf8);
          min-width: 3px; transition: width .35s ease;
        }
        .bval { text-align: right; color: #e2e8f0; font-variant-numeric: tabular-nums; }
        .bval span { color: var(--muted); font-size: 11px; }
        .bcount { text-align: right; color: var(--muted); font-size: 12px; }
        @media (max-width: 640px) {
          .barrow { grid-template-columns: 110px 1fr 74px; }
          .bcount { display: none; }
        }
      `}</style>
    </div>
  );
}

export default function InsightsPage() {
  const [showKeys, setShowKeys] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/insights', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setD(await r.json());
    } catch (e) {
      setErr('โหลดข้อมูลไม่สำเร็จ: ' + e.message);
    }
  }

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.replace('/login');
  }

  useEffect(() => { load(); }, []);

  const t = d?.totals || {};
  const enough = Number(t.views || 0) >= 500;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>แนวโน้ม<span className="em">ความนิยม</span></h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            ดูว่านิทานแบบไหนคนดูเยอะ เพื่อวางแผนว่าควรผลิตแนวไหนต่อ
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="cfgbtn" href="/">← หน้าหลัก</a>
          <button className="cfgbtn" onClick={() => setShowKeys(true)}
                  title="จัดการ API Key">🔑</button>
          <a className="cfgbtn" href="/pipeline">📊 สถานะ</a>
          <a className="cfgbtn" href="/videos">🎬 วิดีโอ</a>
          <button className="cfgbtn" onClick={logout}>🚪 ออก</button>
        </div>
      </div>

      {showKeys && <KeysDialog onClose={() => setShowKeys(false)} />}

      {err && <div className="card err" style={{ marginBottom: 16 }}>{err}</div>}
      {!d && !err && <div className="card meta"><span className="spin" />กำลังโหลด…</div>}

      {d && (
        <>
          {!enough && (
            <div className="card warnbox">
              <b>ข้อมูลยังน้อย — อ่านผลอย่างระมัดระวัง</b>
              <div className="hint" style={{ marginTop: 6 }}>
                ตอนนี้มียอดดูรวม {t.views} ครั้งจาก {t.stories} เรื่อง
                ตัวเลขระดับนี้ยังบอกแนวโน้มได้ไม่ชัด โดยเฉพาะหมวดที่มีเรื่องเดียว
                ควรรอให้มียอดดูสัก 500+ ครั้งจึงจะเชื่อถือได้
              </div>
            </div>
          )}

          <div className="stats">
            <div className="chip"><span>นิทานทั้งหมด</span><b>{t.stories}</b></div>
            <div className="chip info"><span>ยอดดูรวม</span><b>{t.views}</b></div>
            <div className="chip warn"><span>หัวใจรวม</span><b>{t.loves}</b></div>
            {Number(t.error) > 0 &&
              <div className="chip bad"><span>ผิดพลาด</span><b>{t.error}</b></div>}
          </div>

          <div className="card">
            <h3>หมวดไหนคนดูเยอะที่สุด</h3>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              เรียงตาม<b> ยอดดูเฉลี่ยต่อเรื่อง</b> ไม่ใช่ยอดรวม —
              เพราะบางหมวดมีเรื่องเยอะกว่าจึงได้ยอดรวมสูงโดยปริยาย
              (แสดงเฉพาะหมวดที่มีอย่างน้อย 3 เรื่อง)
            </div>
            <Bars rows={d.by_category} minStories={3} />
          </div>

          <div className="card">
            <h3>ช่วงอายุไหนได้รับความนิยม</h3>
            <Bars rows={d.by_age} minStories={1} />
          </div>

          <div className="card">
            <h3>เรื่องยอดนิยม</h3>
            <table className="itable">
              <thead>
                <tr><th style={{width:44}}>#</th><th>เรื่อง</th>
                    <th style={{width:78}}>หมวด</th>
                    <th style={{width:56}}>อายุ</th>
                    <th style={{width:56}}>ดู</th>
                    <th style={{width:56}}>หัวใจ</th></tr>
              </thead>
              <tbody>
                {d.top_stories.map((s, i) => (
                  <tr key={s.id}>
                    <td className="rank">{i + 1}</td>
                    <td>{s.title}</td>
                    <td className="c">{s.category
                      ? <span className="badge topic">{s.category}</span>
                      : <span className="dim">-</span>}</td>
                    <td className="c dim">{s.age_range || '-'}</td>
                    <td className="c num">{s.views}</td>
                    <td className="c num">{s.loves}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card privacy">
            <b>🔒 ไม่เก็บข้อมูลส่วนบุคคล</b>
            <div className="hint" style={{ marginTop: 6 }}>
              หน้านี้นับเฉพาะว่า “นิทานแบบไหนถูกดู” เท่านั้น
              ไม่บันทึกว่าใครเป็นคนดู ไม่เก็บ IP หรือรหัสอุปกรณ์
              จึงไม่กระทบ Privacy Policy ของแอปบนสโตร์
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .chip {
          display: flex; align-items: center; gap: 8px;
          background: var(--card); border: 1px solid var(--line);
          border-radius: 999px; padding: 8px 16px; font-size: 13px;
        }
        .chip span { color: var(--muted); }
        .chip b { font-size: 15px; }
        .chip.info { border-color: rgba(56,189,248,.35); }
        .chip.info b { color: var(--accent2); }
        .chip.warn { border-color: rgba(245,158,11,.35); }
        .chip.warn b { color: var(--accent); }
        .chip.bad { border-color: rgba(239,68,68,.35); }
        .chip.bad b { color: var(--err); }

        h3 { margin: 0 0 10px; font-size: 15px; color: var(--accent2); }
        .warnbox { border-color: rgba(245,158,11,.4); background: rgba(245,158,11,.07); }
        .privacy { border-color: rgba(34,197,94,.3); background: rgba(34,197,94,.05); }

        .itable { width: 100%; border-collapse: collapse; font-size: 13px; }
        .itable :global(th) {
          text-align: left; padding: 9px 8px; color: var(--muted);
          font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--line);
        }
        .itable :global(td) { padding: 9px 8px; border-bottom: 1px solid #26334a; }
        .itable :global(tr:last-child td) { border-bottom: 0; }
        .rank { color: var(--muted); font-variant-numeric: tabular-nums; }
        .c { text-align: center; }
        .num { font-variant-numeric: tabular-nums; color: #e2e8f0; }
        .dim { color: var(--muted); }
      `}</style>
    </div>
  );
}
