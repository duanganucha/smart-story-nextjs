'use client';

import { useEffect, useState } from 'react';
import { Toasts, useToasts } from './Toast';

/**
 * กล่องจัดการ API key — อ่าน/เขียน .env.local ผ่าน /api/keys
 * ค่าที่ตั้งไว้แล้วจะแสดงแบบปิดบัง เว้นว่างไว้ = ไม่เปลี่ยน
 */
export default function KeysDialog({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [show, setShow] = useState({});
  const [tests, setTests] = useState({});
  const [testing, setTesting] = useState({});
  const [toasts, pushToast, dismissToast] = useToasts();

  async function load() {
    try {
      const r = await fetch('/api/keys', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setGroups(d.groups || []);
    } catch (e) {
      setErr('โหลดไม่สำเร็จ: ' + e.message);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groupOf = (key) => groups.find((g) => g.test === key);

  function toastResult(key, res) {
    const g = groupOf(key);
    pushToast({
      kind: res.ok ? 'ok' : res.warn ? 'warn' : 'bad',
      title: `${g?.icon || ''} ${g?.group || key}`.trim(),
      msg: res.msg,
    });
  }

  async function runTest(platform) {
    setTesting((s) => ({ ...s, [platform]: true }));
    try {
      const r = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const d = await r.json();
      const res = d.results || {};
      setTests((s) => ({ ...s, ...res }));
      if (res[platform]) toastResult(platform, res[platform]);
    } catch (e) {
      const res = { ok: false, msg: String(e.message || e) };
      setTests((s) => ({ ...s, [platform]: res }));
      toastResult(platform, res);
    } finally {
      setTesting((s) => ({ ...s, [platform]: false }));
    }
  }

  async function testAll() {
    const all = groups.map((g) => g.test).filter(Boolean);
    setTesting(Object.fromEntries(all.map((k) => [k, true])));
    try {
      const r = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'all' }),
      });
      const d = await r.json();
      const res = d.results || {};
      setTests(res);
      const list = Object.entries(res);
      const ok = list.filter(([, v]) => v.ok).length;
      pushToast({
        kind: ok === list.length ? 'ok' : ok ? 'warn' : 'bad',
        title: 'ผลทดสอบทั้งหมด',
        msg: `ใช้งานได้ ${ok} จาก ${list.length} แพลตฟอร์ม`,
      });
      for (const [k, v] of list) if (!v.ok) toastResult(k, v);
    } catch (e) {
      pushToast({ kind: 'bad', title: 'ทดสอบไม่สำเร็จ', msg: String(e.message || e) });
    }
    finally { setTesting({}); }
  }

  async function save() {
    // ส่งเฉพาะช่องที่พิมพ์จริง — ช่องว่างแปลว่า "ไม่เปลี่ยน"
    const changed = Object.fromEntries(
      Object.entries(vals).filter(([, v]) => v !== undefined && v !== null)
    );
    if (!Object.keys(changed).length) { setMsg('ไม่มีอะไรเปลี่ยน'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: changed }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      setMsg(`✓ บันทึก ${d.changed} ค่าแล้ว — ${d.note}`);
      pushToast({ kind: 'ok', title: 'บันทึกแล้ว', msg: `${d.changed} ค่า · ${d.note}` });
      setVals({});
      load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Toasts items={toasts} onDismiss={dismissToast} />
    <div className="modal-overlay" onClick={onClose}>
      <div className="kbox" onClick={(e) => e.stopPropagation()}>
        <div className="player-head">
          <div className="t">🔑 API Keys</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="refresh" onClick={testAll}>ทดสอบทั้งหมด</button>
            <button className="refresh" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="khint">
          บันทึกลง <code>.env.local</code> · เว้นว่าง = ไม่เปลี่ยนค่าเดิม ·
          ใส่ช่องว่างแล้วบันทึก = ลบค่าทิ้ง
        </div>

        <div className="kscroll">
          <div className="kgrid">
            {groups.map((g) => {
              const res = g.test ? tests[g.test] : null;
              const busy = g.test ? testing[g.test] : false;
              const nset = g.items.filter((i) => i.set).length;
              return (
                <div key={g.group} className="kcard"
                     style={{ borderTopColor: g.color || '#38bdf8' }}>
                  <div className="kgtitle">
                    {g.icon && (
                      <span className="kicon" style={{ color: g.color }}>{g.icon}</span>
                    )}
                    <span className="kgname">{g.group}</span>
                    <span className={`kcount ${nset === g.items.length ? 'full' : ''}`}>
                      {nset}/{g.items.length}
                    </span>
                  </div>

                  {g.links?.length > 0 && (
                    <div className="klinks">
                      {g.links.map((l) => (
                        <a key={l.url} className="klink" href={l.url}
                           target="_blank" rel="noreferrer" title={l.url}>
                          {l.label} ↗
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="kfields">
                    {g.items.map((i) => (
                      <div key={i.key} className="kfield">
                        <label htmlFor={i.key}>
                          {i.label}
                          {i.set && <span className="kset">{i.preview}</span>}
                        </label>
                        <div className="kinput">
                          <input
                            id={i.key}
                            type={i.secret && !show[i.key] ? 'password' : 'text'}
                            placeholder={i.set ? 'เว้นว่างเพื่อคงค่าเดิม' : 'ยังไม่ได้ตั้ง'}
                            value={vals[i.key] ?? ''}
                            onChange={(e) =>
                              setVals((v) => ({ ...v, [i.key]: e.target.value }))}
                          />
                          {i.secret && (
                            <button type="button" className="keye" tabIndex={-1}
                                    onClick={() =>
                                      setShow((s) => ({ ...s, [i.key]: !s[i.key] }))}>
                              {show[i.key] ? '🙈' : '👁'}
                            </button>
                          )}
                        </div>
                        {i.help && <div className="khelp">{i.help}</div>}
                      </div>
                    ))}
                  </div>

                  {g.test && (
                    <div className="ktest">
                      <button className="ktbtn" disabled={busy}
                              onClick={() => runTest(g.test)}>
                        {busy ? <><span className="spin mini" />กำลังทดสอบ…</> : 'ทดสอบคีย์'}
                      </button>
                      {res && !busy && (
                        <div className={`kres ${res.ok ? 'ok' : res.warn ? 'warn' : 'bad'}`}>
                          <b>{res.ok ? '✓' : res.warn ? '⚠' : '✗'}</b> {res.msg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {err && <div className="kerr">{err}</div>}
        {msg && <div className="kok">{msg}</div>}

        <button className="kgo" onClick={save} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>

      <style jsx>{`
        .kbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(880px, 95vw); width: 100%;
          max-height: 90vh; display: flex; flex-direction: column;
        }
        .khint {
          font-size: 12px; color: var(--muted); line-height: 1.7;
          padding-bottom: 12px; border-bottom: 1px solid var(--line);
        }
        .khint :global(code) {
          background: #0b1324; padding: 1px 6px;
          border-radius: 5px; color: #bae6fd;
        }
        .kscroll { overflow-y: auto; flex: 1; margin: 0 -4px; padding: 14px 4px 0; }

        /* การ์ดกริด 2×2 — ยุบเหลือคอลัมน์เดียวบนจอแคบ */
        .kgrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 680px) {
          .kgrid { grid-template-columns: 1fr; }
        }

        .kcard {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-top-width: 5px;
          border-top-style: solid;
          border-radius: 12px;
          padding: 14px;
          display: flex; flex-direction: column;
        }
        .kgtitle {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 700; margin-bottom: 10px;
        }
        .kicon { font-size: 15px; }
        .kgname { color: #0f172a; flex: 1; }
        .kcount {
          font-size: 10.5px; font-weight: 600; color: #64748b;
          background: #f1f5f9; border: 1px solid #e2e8f0;
          border-radius: 999px; padding: 1px 8px;
        }
        .kcount.full {
          color: #15803d; border-color: #86efac; background: #dcfce7;
        }
        .klinks { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 11px; }
        .klink {
          font-size: 10.5px; text-decoration: none;
          color: #0369a1; background: #f1f5f9;
          border: 1px solid #e2e8f0; border-radius: 999px;
          padding: 2px 9px; white-space: nowrap;
        }
        .klink:hover { border-color: #0284c7; background: #e0f2fe; }

        .kfields { flex: 1; }
        .kfield { margin-bottom: 10px; }
        .kfield :global(label) {
          display: flex; align-items: center; gap: 6px;
          font-size: 11.5px; color: #334155; font-weight: 500; margin-bottom: 4px;
        }
        .kset {
          font-size: 10px; color: #15803d; font-family: ui-monospace, monospace;
          background: #dcfce7; border-radius: 999px; padding: 1px 7px;
        }
        .kinput { position: relative; }
        .kinput :global(input) {
          width: 100%; box-sizing: border-box; height: 36px;
          padding: 0 36px 0 11px; font-size: 12.5px; font-family: inherit;
          color: #0f172a; background: #f8fafc;
          border: 1px solid #cbd5e1; border-radius: 8px; outline: none;
        }
        .kinput :global(input::placeholder) { color: #94a3b8; }
        .kinput :global(input:focus) {
          border-color: #f59e0b; background: #fff;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, .2);
        }
        .keye {
          position: absolute; right: 3px; top: 0; height: 36px; width: 30px;
          background: none; border: 0; cursor: pointer; font-size: 13px; opacity: .55;
        }
        .keye:hover { opacity: 1; }
        .khelp { font-size: 10.5px; color: #64748b; margin-top: 3px; line-height: 1.5; }

        .ktest {
          margin-top: 10px; padding-top: 11px;
          border-top: 1px dashed #e2e8f0;
        }
        .ktbtn {
          width: 100%; height: 34px; cursor: pointer;
          font-size: 12px; font-weight: 600; font-family: inherit; color: #334155;
          background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px;
          display: flex; align-items: center; justify-content: center; gap: 7px;
        }
        .ktbtn:hover:not(:disabled) { border-color: #0284c7; background: #e0f2fe; }
        .ktbtn:disabled { opacity: .6; cursor: not-allowed; }
        .ktbtn :global(.spin) { border-color: #64748b; border-top-color: transparent; }

        .kres {
          margin-top: 8px; padding: 8px 10px; font-size: 11.5px;
          border-radius: 8px; line-height: 1.5;
        }
        .kres.ok { color: #15803d; background: #dcfce7; border: 1px solid #86efac; }
        .kres.warn { color: #a16207; background: #fef3c7; border: 1px solid #fcd34d; }
        .kres.bad { color: #b91c1c; background: #fee2e2; border: 1px solid #fca5a5; }

        .kerr, .kok {
          margin-top: 12px; padding: 10px 12px;
          font-size: 12.5px; border-radius: 9px;
        }
        .kerr { color: #fecaca; background: rgba(127,29,29,.3); border: 1px solid #7f1d1d; }
        .kok { color: #bbf7d0; background: rgba(34,197,94,.1);
               border: 1px solid rgba(34,197,94,.35); }
        .kgo {
          margin-top: 14px; width: 100%; height: 46px; border: 0;
          border-radius: 10px; cursor: pointer; font-weight: 700;
          font-size: 15px; font-family: inherit; color: #111;
          background: linear-gradient(90deg, var(--accent), #fbbf24);
        }
        .kgo:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </div>
    </>
  );
}
