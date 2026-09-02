'use client';

import { useEffect, useMemo, useState } from 'react';
import KeysDialog from '../KeysDialog';
import { Toasts, useToasts } from '../Toast';

const STEPS = [
  ['s1_story', 'เนื้อเรื่อง'],
  ['s2_audio', 'เสียง'],
  ['s3_scenes', 'ฉากภาพ'],
  ['s4_video', 'แนวตั้ง'],
  ['s5_land', 'แนวนอน'],
];

const FILTERS = [
  ['all', 'ทั้งหมด'],
  ['ready', 'พร้อมสร้างวิดีโอ'],
  ['made', 'มีวิดีโอแล้ว'],
  ['portrait', 'แนวตั้ง'],
  ['landscape', 'แนวนอน'],
  ['inqueue', 'อยู่ในคิว'],
  ['missing', 'ขาดข้อมูล'],
  ['error', 'ผิดพลาด'],
];

/** สถานะรวมของหนึ่งเรื่อง ใช้กำหนดสีแถบซ้ายและการกรอง */
function overall(c) {
  if (c.status === 'error') return 'error';
  if (c.status === 'processing' || c.status === 'queued') return 'running';
  if (c.s4_video === 'done' || c.s5_land === 'done') return 'done';
  if (c.ready) return 'ready';
  return 'missing';
}

function fmtDate(v) {
  if (!v) return '';
  try {
    return new Date(v).toLocaleString('th-TH', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

export default function PipelinePage() {
  const [showKeys, setShowKeys] = useState(false);
  const [clips, setClips] = useState([]);
  const [dir, setDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [askLayout, setAskLayout] = useState(false);
  // 4 แบบอิสระ — เลือกกี่แบบก็ได้ในครั้งเดียว
  const [variants, setVariants] = useState({
    pv: true,    // แนวตั้ง เบิร์น    → TikTok / Reels
    pn: false,   // แนวตั้ง ไม่เบิร์น → YouTube Shorts
    lv: false,   // แนวนอน เบิร์น
    ln: true,    // แนวนอน ไม่เบิร์น → YouTube
  });
  const [queue, setQueue] = useState({ running: null, jobs: [] });
  const [msg, setMsg] = useState('');
  const [showQueue, setShowQueue] = useState(false);
  const [meta, setMeta] = useState(null);
  const [copied, setCopied] = useState('');
  const [confirmMk, setConfirmMk] = useState(null);
  const [thumbView, setThumbView] = useState(null);
  const [thumbBusy, setThumbBusy] = useState(new Set());
  const [askThumb, setAskThumb] = useState(null);
  const [thSide, setThSide] = useState('left');
  const [thTheme, setThTheme] = useState('auto');
  const [thOpacity, setThOpacity] = useState(0);
  const [thPreview, setThPreview] = useState(null);
  const [thPrevBusy, setThPrevBusy] = useState(false);
  const [pub, setPub] = useState({ platforms: [], done: {} });
  const [pubMsg, setPubMsg] = useState('');
  const [askPub, setAskPub] = useState(null);
  const [toasts, pushToast, dismissToast] = useToasts();
  // เก็บสถานะงานอัปโหลดรอบก่อน — ใช้เทียบว่างานไหนเพิ่งเปลี่ยนเป็น done/error
  const [seenPub, setSeenPub] = useState(null);
  const [schedOn, setSchedOn] = useState(false);
  const [schedAt, setSchedAt] = useState('');

  async function load() {
    setError('');
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setClips(d.clips || []);
      setDir(d.video_dir || '');
      try {
        const q = await fetch('/api/render', { cache: 'no-store' });
        if (q.ok) setQueue(await q.json());
      } catch {}
      try {
        const s = await fetch('/api/publish', { cache: 'no-store' });
        if (s.ok) setPub(await s.json());
      } catch {}
    } catch (e) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll(rows) {
    const ids = rows.filter((c) => c.ready).map((c) => c.id);
    setSel((s) => (ids.length && ids.every((i) => s.has(i)) ? new Set() : new Set(ids)));
  }

  async function startRender() {
    const plan = [
      variants.pv && { layouts: ['portrait'], burn: true },
      variants.pn && { layouts: ['portrait'], burn: false },
      variants.lv && { layouts: ['landscape'], burn: true },
      variants.ln && { layouts: ['landscape'], burn: false },
    ].filter(Boolean);
    if (!plan.length) { setMsg('กรุณาเลือกอย่างน้อยหนึ่งแบบ'); return; }
    try {
      let added = 0, last = null;
      // ยิงแยกทีละแบบ เพราะแต่ละแบบมีค่า burn ต่างกัน
      for (const step of plan) {
        const r = await fetch('/api/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...sel], ...step }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'สั่งงานไม่สำเร็จ');
        added += d.added; last = d;
      }
      if (last) setQueue(last);
      setMsg(`\u2713 เพิ่มเข้าคิว ${added} งาน — ใช้เวลาราว ${Math.round(added * 6)} นาที`);
      setAskLayout(false);
      setSel(new Set());
    } catch (e) {
      setMsg(String(e.message || e));
    }
  }

  async function cancelQueue() {
    const r = await fetch('/api/render', { method: 'DELETE' });
    const d = await r.json();
    setQueue(d);
    setMsg(`ยกเลิกงานที่รออยู่ ${d.removed} งาน`);
  }

  async function openMeta(id) {
    setMeta({ loading: true, id });
    try {
      const r = await fetch(`/api/publish-meta/${id}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'โหลดไม่สำเร็จ');
      setMeta(d);
    } catch (e) {
      setMeta({ error: String(e.message || e) });
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch {}
  }

  // โพสต์ภาพปก + แคปชันที่เขียนไว้ล่วงหน้า (คนละทางกับโพสต์วิดีโอ)
  async function postPhoto(storyId, title) {
    try {
      const r = await fetch('/api/post-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_id: storyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'โพสต์ไม่สำเร็จ');
      pushToast({ kind: 'ok', title: 'โพสต์ภาพขึ้นเพจแล้ว',
                  msg: `${title}${d.links ? ` · แนบลิงก์คลิปเต็ม ${d.links} รายการ` : ''}`,
                  href: d.remote_url, ttl: 9000 });
      load();
    } catch (e) {
      pushToast({ kind: 'bad', title: 'โพสต์ภาพไม่สำเร็จ', msg: String(e.message || e) });
    }
  }

  async function publishTo(storyId, platform, layout, publishAt) {
    setPubMsg('');
    try {
      const r = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: storyId, platform, layout,
          ...(publishAt ? { publish_at: publishAt } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'อัปโหลดไม่สำเร็จ');
      setPubMsg(`✓ เริ่มอัปโหลดไป ${platform} แล้ว` +
        (publishAt ? ` · จะเปิดสาธารณะ ${new Date(publishAt).toLocaleString('th-TH',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''));
      load();
    } catch (e) {
      setPubMsg(String(e.message || e));
    }
  }

  async function previewThumb(id) {
    setThPrevBusy(true);
    try {
      const r = await fetch('/api/thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [id], side: thSide, theme: thTheme,
          opacity: thOpacity, preview: true,
        }),
      });
      const d = await r.json();
      if (r.ok && d.preview) setThPreview(d.preview + '?t=' + Date.now());
    } catch {}
    finally { setThPrevBusy(false); }
  }

  async function makeThumb(ids) {
    setThumbBusy((s) => new Set([...s, ...ids]));
    setMsg('');
    try {
      const r = await fetch('/api/thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, side: thSide, theme: thTheme, opacity: thOpacity }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || 'สร้างปกไม่สำเร็จ');
      setMsg(`✓ สร้างปก ${d.made.length} เรื่อง` +
             (d.skipped.length ? ` · ข้าม ${d.skipped.length}` : ''));
      load();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setThumbBusy((s) => {
        const n = new Set(s);
        ids.forEach((i) => n.delete(i));
        return n;
      });
    }
  }

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.replace('/login');
  }

  // พรีวิวใหม่เมื่อเปลี่ยนตัวเลือก — หน่วงไว้กันยิงถี่ตอนลากสไลเดอร์
  useEffect(() => {
    if (!askThumb?.ids?.length) return;
    const id = askThumb.ids[0];
    const timer = setTimeout(() => previewThumb(id), 260);
    return () => clearTimeout(timer);
  }, [askThumb, thSide, thTheme, thOpacity]);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e) => e.key === 'Escape' && setPlaying(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  useEffect(() => {
    load();
    // รีเฟรชอัตโนมัติเมื่อมีงานกำลังทำอยู่ (เหมือน dashboard ของ video-dub)
    const t = setInterval(() => {
      // เดิมโพลเฉพาะตอนคิวเรนเดอร์ทำงาน ทำให้งานอัปโหลดที่ทำเบื้องหลัง
      // ไม่ถูกรีเฟรช → สถานะค้างและ toast ไม่เด้ง
      if (document.__busy || document.__queue || document.__uploading) load();
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // งานในคิวของแต่ละเรื่อง — ใช้ให้แถวแสดงสถานะสดว่ากำลังทำอะไร
  // ── แจ้งเตือนเมื่ออัปโหลดเสร็จ ────────────────────────────────
  // งานอัปโหลดทำเบื้องหลัง ผู้ใช้ปิดไดอะล็อกไปแล้วจึงไม่รู้ว่าจบเมื่อไหร่
  // จึงเทียบสถานะกับรอบก่อน แล้วเด้ง toast เฉพาะตัวที่ "เพิ่งเปลี่ยน"
  useEffect(() => {
    const jobs = pub?.jobs || [];
    // บอก interval ด้านบนว่ายังมีงานอัปโหลดที่ยังไม่จบ ให้รีเฟรชต่อ
    document.__uploading = jobs.some(
      (j) => j.status === 'uploading' || j.status === 'processing');
    if (!jobs.length) return;
    const now = new Map(jobs.map((j) => [j.id, j.status]));

    // รอบแรกหลังเปิดหน้า: จำไว้เฉย ๆ ไม่เด้ง ไม่งั้นจะเด้งงานเก่าทั้งหมด
    if (seenPub === null) { setSeenPub(now); return; }

    for (const j of jobs) {
      const before = seenPub.get(j.id);
      if (before === undefined || before === j.status) continue;
      const name = clips.find((c) => c.id === j.story_id)?.title || `#${j.story_id}`;
      const plat = (pub.platforms || []).find((x) => x.key === j.platform);
      const label = plat?.label || j.platform;

      if (j.status === 'done') {
        pushToast({ kind: 'ok', title: `ขึ้น ${label} แล้ว`,
                    msg: name, href: j.remote_url || null, ttl: 9000 });
      } else if (j.status === 'error') {
        pushToast({ kind: 'bad', title: `อัป ${label} ไม่สำเร็จ`,
                    msg: `${name} — ${(j.error || 'ไม่ทราบสาเหตุ').slice(0, 120)}` });
      } else if (j.status === 'processing') {
        // ส่งไฟล์ขึ้นครบแล้ว — ที่เหลือแพลตฟอร์มแปลงไฟล์เอง ถือว่าอัปสำเร็จ
        // (Facebook ค้างสถานะนี้จนกว่าจะ poll ซ้ำ จึงต้องเด้งตรงนี้ ไม่ใช่รอ done)
        pushToast({ kind: 'ok', title: `อัปขึ้น ${label} แล้ว`,
                    msg: `${name} — กำลังแปลงไฟล์ อีกสักครู่จะดูได้`,
                    href: j.remote_url || null, ttl: 9000 });
      }
    }
    setSeenPub(now);
  }, [pub]);   // eslint-disable-line react-hooks/exhaustive-deps

  const jobsById = useMemo(() => {
    const m = new Map();
    for (const j of queue.jobs) {
      if (j.status === 'done') continue;      // เสร็จแล้วดูจากจุดสถานะแทน
      if (!m.has(j.id)) m.set(j.id, []);
      m.get(j.id).push(j);
    }
    return m;
  }, [queue]);

  const counts = useMemo(() => {
    const c = { all: clips.length, ready: 0, made: 0, missing: 0, error: 0,
                running: 0, portrait: 0, landscape: 0, inqueue: 0 };
    for (const x of clips) {
      const o = overall(x);
      if (x.s4_video === 'done') c.portrait++;
      if (x.s5_land === 'done') c.landscape++;
      if (jobsById.has(x.id)) c.inqueue++;
      if (o === 'error') c.error++;
      else if (o === 'running') c.running++;
      else if (o === 'done') c.made++;
      else if (o === 'ready') c.ready++;
      else c.missing++;
    }
    return c;
  }, [clips, jobsById]);

  useEffect(() => { document.__busy = counts.running > 0; }, [counts]);
  useEffect(() => {
    document.__queue = Boolean(queue.running) ||
      queue.jobs.some((j) => j.status === 'queued');
  }, [queue]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clips.filter((c) => {
      const o = overall(c);
      const okF =
        filter === 'all' ? true :
        filter === 'ready' ? o === 'ready' :
        filter === 'made' ? o === 'done' :
        filter === 'portrait' ? c.s4_video === 'done' :
        filter === 'landscape' ? c.s5_land === 'done' :
        filter === 'inqueue' ? jobsById.has(c.id) :
        filter === 'missing' ? o === 'missing' :
        filter === 'error' ? o === 'error' : true;
      if (!okF) return false;
      if (!s) return true;
      return c.title.toLowerCase().includes(s) || String(c.id).includes(s);
    });
  }, [clips, filter, q, jobsById]);

  // เรื่องที่ยังขาดวิดีโอแต่ละแนว (พร้อมข้อมูลครบแล้ว)
  const needV = clips.filter((c) => c.ready && c.s4_video !== 'done').map((c) => c.id);
  const needH = clips.filter((c) => c.ready && c.s5_land !== 'done').map((c) => c.id);
  const readyIds = needV;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>สถานะ<span className="em">การผลิต</span></h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            ความพร้อมของแต่ละเรื่องก่อนสร้างวิดีโอ — เนื้อเรื่อง → เสียง → ฉากภาพ → วิดีโอ
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="cfgbtn" href="/">← หน้าหลัก</a>
          <button className="cfgbtn" onClick={() => setShowKeys(true)}
                  title="จัดการ API Key">🔑</button>
          <a className="cfgbtn" href="/videos">🎬 วิดีโอ</a>
          <a className="cfgbtn" href="/insights">📈 แนวโน้ม</a>
          <button className="cfgbtn" onClick={load}>รีเฟรช</button>
          <button className="cfgbtn" onClick={logout}>🚪 ออก</button>
        </div>
      </div>

      {showKeys && <KeysDialog onClose={() => setShowKeys(false)} />}

      {error && <div className="card err" style={{ marginBottom: 16 }}>{error}</div>}

      {/* chip กดได้ = กรองตาราง กดซ้ำเพื่อล้างตัวกรอง */}
      <div className="stats">
        {[
          ['all', 'ทั้งหมด', counts.all, ''],
          ['made', 'มีวิดีโอแล้ว', counts.made, 'ok'],
          ['portrait', 'แนวตั้ง', counts.portrait, 'ok'],
          ['landscape', 'แนวนอน', counts.landscape, 'ok'],
          ['ready', 'พร้อมสร้าง', counts.ready, 'warn'],
          ['inqueue', 'อยู่ในคิว', counts.inqueue, 'info'],
          ['missing', 'ขาดข้อมูล', counts.missing, 'mute'],
          ['error', 'ผิดพลาด', counts.error, 'bad'],
        ].map(([key, label, n, tone]) => {
          // ซ่อน chip ที่ไม่มีของ ยกเว้นตัวที่กำลังเลือกอยู่
          if (!n && key !== 'all' && filter !== key) return null;
          return (
            <button key={key}
                    className={`chip ${tone} ${filter === key ? 'on' : ''}`}
                    onClick={() => setFilter(filter === key ? 'all' : key)}
                    title={filter === key ? 'กดอีกครั้งเพื่อล้างตัวกรอง' : `กรองเฉพาะ${label}`}>
              <span>{label}</span><b>{n}</b>
            </button>
          );
        })}
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`tab ${filter === k ? 'active' : ''}`}
                      onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: '0 1 260px' }}>
            <input type="text" placeholder="ค้นหาชื่อเรื่อง หรือ id…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {(needV.length > 0 || needH.length > 0) && (
          <div className="cmdbox">
            {needV.length > 0 && (
              <>
                <div className="hint" style={{ marginTop: 0 }}>
                  ยังไม่มีวิดีโอ<b> แนวตั้ง</b> {needV.length} เรื่อง:
                </div>
                <code>
                  cd bearrytales-video &amp;&amp; python3 make-video.py{' '}
                  {needV.length > 12 ? '--all' : needV.join(' ')}
                </code>
              </>
            )}
            {needH.length > 0 && (
              <>
                <div className="hint">
                  ยังไม่มีวิดีโอ<b> แนวนอน</b> {needH.length} เรื่อง:
                </div>
                <code>
                  cd bearrytales-video &amp;&amp; python3 make-video.py{' '}
                  {needH.length > 12 ? '--all' : needH.join(' ')} --layout landscape
                </code>
              </>
            )}
          </div>
        )}
      </div>

      {(sel.size > 0 || queue.running || queue.jobs.some((j) => j.status === 'queued')) && (
        <div className="card selbar">
          <div className="selleft">
            {sel.size > 0 && <><b>เลือก {sel.size} เรื่อง</b>
              <button className="linkbtn" onClick={() => setSel(new Set())}>ล้าง</button></>}
            {queue.running && (
              <button className="qrun qbtn" onClick={() => setShowQueue(true)}
                      title="ดูรายละเอียดคิวงาน">
                <span className="spin mini" />
                กำลังสร้าง: #{queue.running.split(':')[0]}{' '}
                ({queue.running.endsWith('landscape') ? 'แนวนอน' : 'แนวตั้ง'})
              </button>
            )}
            {queue.jobs.filter((j) => j.status === 'queued').length > 0 && (
              <button className="qwait qbtn" onClick={() => setShowQueue(true)}
                      title="ดูรายละเอียดคิวงาน">
                รอคิว {queue.jobs.filter((j) => j.status === 'queued').length} งาน
              </button>
            )}
            {queue.jobs.length > 0 && (
              <button className="linkbtn" onClick={() => setShowQueue(true)}>
                ดูคิวงาน ({queue.jobs.length})
              </button>
            )}
            {queue.jobs.filter((j) => j.status === 'error').slice(-1).map((j) => (
              <button key={j.key} className="qerr qbtn" title={j.error || ''}
                      onClick={() => setShowQueue(true)}>
                ✗ #{j.id} ล้มเหลว
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sel.size > 0 && pub.platforms.filter((x) => x.ready).map((pl) => (
              <button key={pl.key} className="cfgbtn" title={`อัปโหลด ${sel.size} เรื่องขึ้น ${pl.label}`}
                      onClick={async () => {
                        setPubMsg('');
                        let n = 0;
                        for (const id of sel) {
                          const c = clips.find((x) => x.id === id);
                          const lay = pl.layouts.find((L) =>
                            L === 'portrait' ? c?.video_file : c?.video_file_h);
                          if (!lay) continue;
                          try {
                            const r = await fetch('/api/publish', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ story_id: id, platform: pl.key, layout: lay }),
                            });
                            if (r.ok) n++;
                          } catch {}
                        }
                        setMsg(`เริ่มอัปโหลด ${n} เรื่องขึ้น ${pl.label}`);
                        load();
                      }}>
                <span style={{ color: pl.color }}>{pl.icon}</span> {pl.label}
              </button>
            ))}
            <button className="cfgbtn" disabled={!sel.size}
                    title={`สร้างปกคลิป ${sel.size} เรื่อง`}
                    onClick={() => setAskThumb({ ids: [...sel] })}>🖼 สร้างปก</button>
            <button className="go mini" disabled={!sel.size}
                    onClick={() => { setMsg(''); setAskLayout(true); }}>
              🎬 สร้างวิดีโอ
            </button>
          </div>
        </div>
      )}

      {msg && <div className="card msgbox">{msg}</div>}

      {loading && clips.length === 0 && (
        <div className="card meta"><span className="spin" />กำลังโหลด…</div>
      )}

      {!loading && shown.length === 0 && (
        <div className="card meta">ไม่พบเรื่องที่ตรงเงื่อนไข</div>
      )}

      {shown.length > 0 && (
        <div className="card tablecard">
          <table className="ptable">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" className="cb"
                         checked={shown.some((c) => c.ready) &&
                                  shown.filter((c) => c.ready).every((c) => sel.has(c.id))}
                         onChange={() => toggleAll(shown)}
                         title="เลือก/ยกเลิกทั้งหมดที่พร้อมสร้าง" />
                </th>
                <th style={{ width: 54 }}>#</th>
                <th>เรื่อง</th>
                {STEPS.map(([k, label]) => <th key={k} className="cstep">{label}</th>)}
                <th className="cnum">ย่อหน้า</th>
                <th className="cnum">ฉาก</th>
                <th className="csrt" title="ไฟล์ซับ .srt สำหรับให้ YouTube แปลอัตโนมัติ">
                  ซับ
                </th>
                <th className="csrt" title="จำนวนตอน (chapters) สำหรับแถบแบ่งตอนบน YouTube">
                  ตอน
                </th>
                <th className="cthumb" title="ปกคลิป 1280×720 สองภาษา">ปก</th>
                {pub.platforms.map((pl) => (
                  <th key={pl.key} className="cpub" title={
                    pl.ready ? `อัปโหลดขึ้น ${pl.label}`
                             : `${pl.label} ยังไม่ตั้งค่า: ขาด ${pl.missing.join(', ')}`
                  }>
                    <span style={{ color: pl.color, opacity: pl.ready ? 1 : 0.45 }}>
                      {pl.icon}
                    </span>{' '}{pl.label}
                    {pub.today?.[pl.key] && (
                      <div className={`quota ${
                        pub.today[pl.key].used >= pub.today[pl.key].limit ? 'full' : ''}`}
                        title="จำนวนที่อัปวันนี้ / เพดานต่อวัน (กันถูกตีเป็นสแปม)">
                        {pub.today[pl.key].used}/{pub.today[pl.key].limit}
                      </div>
                    )}
                  </th>
                ))}
                <th className="cwhen">อัปเดต</th>
                <th className="cact">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const o = overall(c);
                return (
                  <tr key={c.id}
                      className={`r-${o}${(jobsById.get(c.id) || []).some((j) => j.status === 'running') ? ' rendering' : ''}`}
                      onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="cb"
                             checked={sel.has(c.id)}
                             disabled={!c.ready}
                             onChange={() => toggle(c.id)}
                             title={c.ready ? 'เลือกเรื่องนี้' : 'ข้อมูลยังไม่ครบ'} />
                    </td>
                    <td className="cid">{c.id}</td>
                    <td>
                      <div className="tt">{c.title}</div>
                      <div className="sub2">
                        {c.category && <span className="badge topic">{c.category}</span>}
                        {c.status === 'processing' && <span className="badge proc">{c.stage || 'กำลังทำ'}</span>}
                        {c.status === 'error' && <span className="badge error">ผิดพลาด</span>}
                        {c.video_file && <span className="badge done">แนวตั้ง</span>}
                        {c.video_file_h && <span className="badge done">แนวนอน</span>}
                        {(jobsById.get(c.id) || []).map((j) => (
                          <span key={j.key}
                                className={`jtag ${j.status === 'running' ? 'run' :
                                            j.status === 'error' ? 'bad' : 'wait'}`}
                                title={j.error || ''}>
                            {j.status === 'running' && <span className="spin mini" />}
                            {j.status === 'running' ? 'กำลังสร้าง'
                              : j.status === 'error' ? 'สร้างไม่สำเร็จ' : 'รอคิว'}
                            {' '}{j.layout === 'landscape' ? 'แนวนอน' : 'แนวตั้ง'}
                          </span>
                        ))}
                      </div>
                      {openId === c.id && (
                        <div className="detail">
                          {c.error && <div className="lerr2">{c.error}</div>}
                          <div className="meta">
                            <span>engine: {c.engine_story || '-'} / {c.engine_tts || '-'} / {c.engine_image || '-'}</span>
                            {c.views != null && <span>👁 {c.views}</span>}
                            {c.loves != null && <span>♥ {c.loves}</span>}
                          </div>
                          {c.video_file
                            ? <div className="hint">ไฟล์: {c.video_file}</div>
                            : c.ready
                              ? <div className="hint">สร้างด้วย: <code>python3 make-video.py {c.id}</code></div>
                              : <div className="hint">ยังขาด: {[
                                  !c.s1_story || c.s1_story !== 'done' ? 'เนื้อเรื่อง' : null,
                                  c.s2_audio !== 'done' ? 'เสียง' : null,
                                  c.s3_scenes !== 'done' ? 'ฉากภาพ' : null,
                                ].filter(Boolean).join(', ')}</div>}
                        </div>
                      )}
                    </td>
                    {STEPS.map(([k]) => {
                      // ขั้นวิดีโอ: ถ้ามีงานในคิวของแนวนั้น ให้จุดสะท้อนสถานะจริง
                      const lay = k === 's4_video' ? 'portrait'
                                : k === 's5_land' ? 'landscape' : null;
                      const job = lay &&
                        (jobsById.get(c.id) || []).find((j) => j.layout === lay);
                      const st = job && c[k] !== 'done'
                        ? (job.status === 'running' ? 'running'
                           : job.status === 'error' ? 'error' : 'queued')
                        : c[k];
                      const tip = st === 'running' ? 'กำลังสร้าง'
                        : st === 'queued' ? 'รอคิว'
                        : st === 'error' ? (job?.error || 'ผิดพลาด')
                        : st === 'done' ? 'เสร็จแล้ว' : 'ยังไม่มี';
                      return (
                        <td key={k} className="cstep">
                          <span className={`dot ${st}`} title={tip} />
                        </td>
                      );
                    })}
                    <td className="cnum">{c.paragraphs || '-'}</td>
                    <td className="cnum">
                      {c.scene_count ? `${c.scene_ok}/${c.scene_count}` : '-'}
                    </td>
                    <td className="csrt">
                      {c.chapters?.count ? (
                        <span className={`srtag ${c.chapters.accurate ? 'ok' : 'part'}`}
                              title={c.chapters.accurate
                                ? `${c.chapters.count} ตอน — เวลาจากความเงียบจริง (แม่นยำ)`
                                : `${c.chapters.count} ตอน — เวลาประมาณจากสัดส่วนข้อความ`}>
                          {c.chapters.count}
                        </span>
                      ) : <span className="dimd">—</span>}
                    </td>
                    <td className="cthumb" onClick={(e) => e.stopPropagation()}>
                      {thumbBusy.has(c.id) ? (
                        <span className="tbtn"><span className="spin mini" /></span>
                      ) : c.thumb ? (
                        <button className="tprev"
                                title="ดูปกคลิป — กดเพื่อขยาย"
                                onClick={() => setThumbView({ id: c.id, title: c.title, file: c.thumb, v: c.thumb_v })}>
                          <img src={`/api/videos/${encodeURIComponent(c.thumb)}?v=${c.thumb_v || 0}`} alt="" />
                        </button>
                      ) : (
                        <button className="tbtn mk" disabled={!c.ready}
                                title={c.ready ? 'สร้างปกคลิป' : 'ข้อมูลยังไม่ครบ'}
                                onClick={() => setAskThumb({ ids: [c.id], title: c.title })}>+</button>
                      )}
                    </td>
                    <td className="csrt">
                      {(() => {
                        const vids = ['video_file', 'video_file_ns',
                                      'video_file_h', 'video_file_hns']
                          .filter((k) => c[k]).length;
                        if (!vids) return <span className="dimd">—</span>;
                        const n = c.srt_count || 0;
                        // ครบ = มีซับเท่าจำนวนวิดีโอ
                        const full = n >= vids;
                        return (
                          <span className={`srtag ${full ? 'ok' : n ? 'part' : 'none'}`}
                                title={full ? `มีซับครบทุกไฟล์ (${n}/${vids})`
                                       : n ? `มีซับ ${n} จาก ${vids} ไฟล์`
                                       : 'ยังไม่มีไฟล์ซับ'}>
                            {full ? '✓' : n ? `${n}/${vids}` : '—'}
                          </span>
                        );
                      })()}
                    </td>
                    {pub.platforms.map((pl) => {
                      const already = pub.done?.[c.id]?.[pl.key];
                      // งานที่กำลังอัปอยู่ของแถวนี้
                      const job = (pub.jobs || []).find(
                        (j) => j.story_id === c.id && j.platform === pl.key &&
                               ['queued', 'uploading', 'processing'].includes(j.status));
                      const failed = !already && !job && (pub.jobs || []).find(
                        (j) => j.story_id === c.id && j.platform === pl.key &&
                               j.status === 'error');
                      const lay = pl.layouts.find((L) =>
                        L === 'portrait' ? c.video_file : c.video_file_h);
                      const can = pl.ready && lay && !already && !job;
                      return (
                        <td key={pl.key} className="cpub"
                            onClick={(e) => e.stopPropagation()}>
                          {already ? (
                            // อัปสำเร็จ — ไอคอนแพลตฟอร์มหนาและเป็นสีแบรนด์
                            already.url ? (
                              <a className="pcell ok" style={{ color: pl.color }}
                                 href={already.url} target="_blank" rel="noreferrer"
                                 title={`ขึ้น ${pl.label} แล้ว — กดเปิดดู`}>{pl.icon}</a>
                            ) : (
                              <span className="pcell ok" style={{ color: pl.color }}
                                    title={`ขึ้น ${pl.label} แล้ว`}>{pl.icon}</span>
                            )
                          ) : job ? (
                            <span className="pcell run" title={`กำลังอัปโหลด ${job.progress || 0}%`}>
                              <span className="spin mini" />
                            </span>
                          ) : failed ? (
                            <button className="pcell bad"
                                    title={failed.error || 'ล้มเหลว — กดเพื่อลองใหม่'}
                                    onClick={() => publishTo(c.id, pl.key, lay)}
                                    disabled={!pl.ready || !lay}>{pl.icon}</button>
                          ) : (
                            <button className="pcell" disabled={!can}
                                    onClick={() => {
                                      // Facebook แนวตั้ง = Reels ซึ่งจำกัด 90 วิ
                                      // ระบบจะส่งคลิปสั้นให้อัตโนมัติ (ดู app/api/publish)
                                      const useReel = pl.key === 'facebook'
                                        && lay === 'portrait' && !!c.video_file_reel;
                                      setAskPub({
                                        id: c.id, title: c.title,
                                        platform: pl.key, label: pl.label, layout: lay,
                                        fileLabel: useReel
                                          ? 'คลิปสั้น ≤90 วิ (Reels)'
                                          : lay === 'portrait'
                                            ? 'คลิปเต็ม แนวตั้ง' : 'คลิปเต็ม แนวนอน',
                                        pubTitle: c.youtube_title || c.title,
                                      });
                                    }}
                                    title={
                                      !pl.ready ? `${pl.label} ยังไม่ตั้งค่า`
                                      : !lay ? 'ยังไม่มีวิดีโอที่รองรับ'
                                      : `อัปขึ้น ${pl.label}`
                                    }>{pl.icon}</button>
                          )}
                        </td>
                      );
                    })}
                    <td className="cwhen">{fmtDate(c.updated_at)}</td>
                    <td className="cact" onClick={(e) => e.stopPropagation()}>
                      <div className="acts">
                          {/* คลิปสั้น — แยกจากปุ่มอื่นเพราะเป็นไฟล์คนละตัว
                              (ตัดมาจากคลิปเต็มให้ไม่เกิน 90 วิ ตามลิมิต Facebook Reels)
                              สร้างด้วย bearrytales-video/make-reel.py */}
                          {c.video_file_reel ? (
                            <button className="abtn play v-reel"
                                    title="คลิปสั้น ≤90 วิ — Facebook Reels (ตัดจากคลิปเต็ม)"
                                    onClick={() => setPlaying({
                                      ...c, file: c.video_file_reel,
                                      mode: 'portrait', nosub: false, alt: c.video_file || null,
                                    })}>▶ สั้น</button>
                          ) : c.video_file ? (
                            <span className="abtn norl"
                                  title="ยังไม่มีคลิปสั้น — สร้างด้วย: python3 make-reel.py {id}"
                                  >– สั้น</span>
                          ) : null}
                          {[
                            ['video_file',    'Reel',   'portrait',  true,  'pv',
                             'แนวตั้ง เบิร์นซับ — TikTok / Reels'],
                            ['video_file_ns', 'Short',  'portrait',  false, 'pn',
                             'แนวตั้ง ไม่เบิร์นซับ — YouTube Shorts'],
                            ['video_file_h',  'YT+',    'landscape', true,  'lv',
                             'แนวนอน เบิร์นซับ'],
                            ['video_file_hns','YT',     'landscape', false, 'ln',
                             'แนวนอน ไม่เบิร์นซับ — YouTube (แนะนำ)'],
                          ].map(([field, label, mode, burned, vkey, tip]) => {
                            const file = c[field];
                            // งานแบบนี้กำลังอยู่ในคิวหรือไม่
                            const busy = (jobsById.get(c.id) || []).some(
                              (j) => j.layout === mode);
                            if (file) {
                              // มีไฟล์แล้ว — กดดู
                              const other = mode === 'landscape'
                                ? (burned ? c.video_file_hns : c.video_file_h)
                                : (burned ? c.video_file_ns : c.video_file);
                              return (
                                <button key={field} className={`abtn play v-${vkey}`} title={tip}
                                        onClick={() => setPlaying({
                                          ...c, file, mode, nosub: !burned,
                                          alt: other || null,
                                        })}>▶ {label}</button>
                              );
                            }
                            // ยังไม่มี — กดสร้างเฉพาะแบบนี้
                            return (
                              <button key={field} className="abtn mk" disabled={!c.ready || busy}
                                      title={busy ? 'กำลังสร้างอยู่'
                                             : c.ready ? `สร้าง${tip}` : 'ข้อมูลยังไม่ครบ'}
                                      onClick={() => setConfirmMk({
                                        id: c.id, title: c.title, label, mode,
                                        burn: burned, tip,
                                      })}>+ {label}</button>
                            );
                          })}
                          {c.thumb && (
                            <button className="abtn photo"
                                    title="โพสต์ภาพปก + แคปชันขึ้นเพจ Facebook (แนบลิงก์คลิปเต็มให้อัตโนมัติ)"
                                    onClick={() => postPhoto(c.id, c.title)}>🖼 โพสต์</button>
                          )}
                          <button className="abtn info" title="ข้อมูลสำหรับอัปโหลด"
                                  onClick={() => openMeta(c.id)}>ℹ</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />

      {askPub && (
        <div className="modal-overlay" onClick={() => setAskPub(null)}>
          <div className="cfbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">อัปโหลดขึ้น {askPub.label}</div>
              <button className="refresh" onClick={() => setAskPub(null)}>✕</button>
            </div>

            <div className="cfstory">
              <span className="cfid">#{askPub.id}</span> {askPub.title}
            </div>

            <div className="cfrow">
              <span className="cflab">รูปแบบ</span>
              <span className={`badge ${askPub.layout === 'landscape' ? 'proc' : 'topic'}`}>
                {askPub.layout === 'landscape' ? 'แนวนอน 1920×1080' : 'แนวตั้ง 1080×1920'}
              </span>
            </div>
            {/* บอกให้ชัดว่าจะส่งไฟล์ไหนขึ้นไปจริง ๆ
                Facebook แนวตั้งใช้คลิปสั้น (_reel) ส่วนที่อื่นใช้คลิปเต็ม */}
            <div className="cfrow">
              <span className="cflab">ไฟล์</span>
              <span>{askPub.fileLabel}</span>
            </div>
            <div className="cfrow">
              <span className="cflab">ชื่อที่ใช้</span>
              <span style={{ fontSize: 12, lineHeight: 1.5 }}>{askPub.pubTitle}</span>
            </div>
            <div className="cfrow">
              <span className="cflab">เริ่มต้น</span>
              <span>อัปเป็น <b>ส่วนตัว</b> เสมอ — ตรวจก่อนเปิดสาธารณะ</span>
            </div>

            <label className="schedrow">
              <input type="checkbox" className="cb" checked={schedOn}
                     onChange={(e) => {
                       setSchedOn(e.target.checked);
                       if (e.target.checked && !schedAt) {
                         // ค่าเริ่มต้น: พรุ่งนี้ 19:00 — ช่วงนิทานก่อนนอน
                         const d = new Date();
                         d.setDate(d.getDate() + 1);
                         d.setHours(19, 0, 0, 0);
                         const p2 = (n) => String(n).padStart(2, '0');
                         setSchedAt(`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`
                                    + `T${p2(d.getHours())}:${p2(d.getMinutes())}`);
                       }
                     }} />
              <div>
                <b>ตั้งเวลาเปิดสาธารณะอัตโนมัติ</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  ก่อนถึงเวลาจะเป็นส่วนตัว ไม่มีใครเห็น
                </div>
              </div>
            </label>

            {schedOn && (
              <>
                <input className="dtinput" type="datetime-local" value={schedAt}
                       onChange={(e) => setSchedAt(e.target.value)} />
                <div className="hint" style={{ marginTop: 6 }}>
                  ใช้เขตเวลาเครื่องนี้ ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  · แนะนำ <b>18:00–20:00</b> ช่วงนิทานก่อนนอน
                </div>
              </>
            )}

            {pubMsg && <div className="lerr2" style={{ marginTop: 12 }}>{pubMsg}</div>}

            <button className="go" onClick={() => {
              const a = askPub;
              const at = schedOn && schedAt ? new Date(schedAt).toISOString() : null;
              setAskPub(null);
              publishTo(a.id, a.platform, a.layout, at);
            }}>{schedOn ? 'อัปโหลดและตั้งเวลา' : 'อัปโหลดเลย'}</button>
          </div>
        </div>
      )}

      {askThumb && (
        <div className="modal-overlay" onClick={() => setAskThumb(null)}>
          <div className="thbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">
                สร้างปกคลิป
                {askThumb.ids.length > 1 && <span className="modetag">
                  {askThumb.ids.length} เรื่อง</span>}
              </div>
              <button className="refresh"
                      onClick={() => { setAskThumb(null); setThPreview(null); }}>✕</button>
            </div>
            {askThumb.title && <div className="cfstory">{askThumb.title}</div>}

            <div className="thprev">
              {thPreview ? (
                <img src={thPreview} alt="ตัวอย่างปก" />
              ) : (
                <div className="thempty">
                  {thPrevBusy ? <><span className="spin" />กำลังสร้างตัวอย่าง…</>
                              : 'ตัวอย่างจะแสดงที่นี่'}
                </div>
              )}
              {thPrevBusy && thPreview && <div className="thload"><span className="spin" /></div>}
              {askThumb.ids.length > 1 && (
                <div className="thnote">ตัวอย่างจากเรื่องแรก · ใช้ตั้งค่าเดียวกันทุกเรื่อง</div>
              )}
            </div>

            <div className="thlabel">ตำแหน่งชื่อเรื่อง</div>
            <div className="sides">
              {[['left', 'ชื่อซ้าย · ภาพขวา'], ['right', 'ภาพซ้าย · ชื่อขวา']]
                .map(([k, label]) => (
                <button key={k} className={`sidebtn ${thSide === k ? 'on' : ''}`}
                        onClick={() => setThSide(k)}>
                  <span className={`mini-lay ${k}`}>
                    <span className="m-text" /><span className="m-img" />
                  </span>
                  {label}
                </button>
              ))}
            </div>

            <div className="thlabel">สีแถบข้อความ</div>
            <div className="swatches">
              {[['auto', 'linear-gradient(135deg,#0d2818,#101a33,#2b1030)', '#fff', 'อัตโนมัติ'],
                ['forest', '#0d2818', '#FFD24A', 'ป่าเขียว'],
                ['night', '#101a33', '#7DD3FC', 'ราตรี'],
                ['berry', '#2b1030', '#F9A8D4', 'เบอร์รี'],
                ['sunset', '#3a1a08', '#FDBA74', 'พระอาทิตย์ตก'],
                ['ocean', '#06282e', '#5EEAD4', 'ทะเล'],
                ['ink', '#14140f', '#FDE68A', 'หมึกดำ']].map(([k, bg, ac, name]) => (
                <button key={k} className={`sw ${thTheme === k ? 'on' : ''}`}
                        title={name} onClick={() => setThTheme(k)}
                        style={{ background: bg }}>
                  <span className="swdot" style={{ background: ac }} />
                  <span className="swname">{name}</span>
                </button>
              ))}
            </div>

            <div className="thlabel">
              ความทึบของแถบ <b>{thOpacity ? `${Math.round(thOpacity * 100)}%` : 'อัตโนมัติ'}</b>
            </div>
            <input className="slider" type="range" min="0" max="95" step="5"
                   value={Math.round(thOpacity * 100)}
                   onChange={(e) => setThOpacity(Number(e.target.value) / 100)} />
            <div className="hint" style={{ marginTop: 2 }}>
              เลื่อนซ้ายสุด = ให้ระบบเลือกตามความสว่างของภาพ ·
              ทึบมาก = ตัวหนังสืออ่านง่ายขึ้น
            </div>

            <button className="go" onClick={() => {
              const ids = askThumb.ids;
              setAskThumb(null);
              setThPreview(null);
              makeThumb(ids);
            }}>สร้างปก{askThumb.ids.length > 1 ? ` ${askThumb.ids.length} เรื่อง` : ''}</button>
          </div>
        </div>
      )}

      {thumbView && (
        <div className="modal-overlay" onClick={() => setThumbView(null)}>
          <div className="tvbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">ปกคลิป · #{thumbView.id} {thumbView.title}</div>
              <button className="refresh" onClick={() => setThumbView(null)}>✕</button>
            </div>
            <img className="tvimg" src={`/api/videos/${encodeURIComponent(thumbView.file)}?v=${thumbView.v || 0}`}
                 alt={`ปกคลิป ${thumbView.title}`} />
            <div className="meta" style={{ marginTop: 10, justifyContent: 'center', gap: 10 }}>
              <span>1280 × 720</span>
              <a className="abtn" download={thumbView.file}
                 href={`/api/videos/${encodeURIComponent(thumbView.file)}`}>⬇ ดาวน์โหลด</a>
              <button className="abtn" onClick={() => {
                const v = thumbView;
                setThumbView(null);
                setAskThumb({ ids: [v.id], title: v.title });
              }}>↻ สร้างใหม่</button>
            </div>
          </div>
        </div>
      )}

      {confirmMk && (
        <div className="modal-overlay" onClick={() => setConfirmMk(null)}>
          <div className="cfbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">สร้างวิดีโอ</div>
              <button className="refresh" onClick={() => setConfirmMk(null)}>✕</button>
            </div>

            <div className="cfstory">
              <span className="cfid">#{confirmMk.id}</span> {confirmMk.title}
            </div>

            <div className="cfrow">
              <span className="cflab">รูปแบบ</span>
              <span className={`badge ${confirmMk.mode === 'landscape' ? 'proc' : 'topic'}`}>
                {confirmMk.mode === 'landscape' ? 'แนวนอน 1920×1080' : 'แนวตั้ง 1080×1920'}
              </span>
            </div>
            <div className="cfrow">
              <span className="cflab">ซับไตเติล</span>
              <span>{confirmMk.burn ? 'เบิร์นลงภาพ' : 'ไม่เบิร์น (ใช้ไฟล์ .srt)'}</span>
            </div>
            <div className="cfrow">
              <span className="cflab">เหมาะกับ</span>
              <span className="cfnote">{confirmMk.tip.split('—')[1]?.trim() || confirmMk.tip}</span>
            </div>

            <div className="esti">
              ใช้เวลาราว <b>6 นาที</b> · สร้างเบื้องหลัง ปิดหน้านี้ได้
              <div className="hint" style={{ marginTop: 4 }}>
                ได้ไฟล์ <b>.mp4</b> และ <b>.srt</b> — ไม่ทับไฟล์เดิม
              </div>
            </div>

            <button className="go" onClick={async () => {
              const c = confirmMk;
              setConfirmMk(null);
              try {
                const r = await fetch('/api/render', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ids: [c.id], layouts: [c.mode], burn: c.burn }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'สั่งงานไม่สำเร็จ');
                setMsg(`✓ เพิ่มเข้าคิว: #${c.id} ${c.label}`);
                load();
              } catch (e) {
                setMsg(String(e.message || e));
              }
            }}>เริ่มสร้าง</button>
          </div>
        </div>
      )}

      {meta && (
        <div className="modal-overlay" onClick={() => setMeta(null)}>
          <div className="mbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">ข้อมูลสำหรับอัปโหลด</div>
              <button className="refresh" onClick={() => setMeta(null)}>✕</button>
            </div>

            {meta.loading && <div className="meta"><span className="spin" />กำลังโหลด…</div>}
            {meta.error && <div className="lerr2">{meta.error}</div>}

            {meta.snippet && (
              <div className="mscroll">
                <div className="fld">
                  <div className="flabel">
                    ชื่อวิดีโอ
                    <button className="cpy" onClick={() => copy(meta.snippet.title, 'title')}>
                      {copied === 'title' ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                  <div className="fval one">{meta.snippet.title}</div>
                </div>

                <div className="fld">
                  <div className="flabel">
                    คำอธิบาย
                    <button className="cpy"
                            onClick={() => copy(meta.snippet.description, 'desc')}>
                      {copied === 'desc' ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                  <pre className="fval pre">{meta.snippet.description}</pre>
                </div>

                <div className="fld">
                  <div className="flabel">
                    แท็ก ({meta.snippet.tags.length})
                    <button className="cpy"
                            onClick={() => copy(meta.snippet.tags.join(', '), 'tags')}>
                      {copied === 'tags' ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                  <div className="tagwrap">
                    {meta.snippet.tags.map((x) => <span key={x} className="tg">{x}</span>)}
                  </div>
                </div>

                <div className="fld">
                  <div className="flabel">ไฟล์</div>
                  {['portrait', 'landscape'].map((k) => {
                    const f = meta.files?.[k];
                    if (!f?.video) return null;
                    return (
                      <div key={k} className="frow">
                        <span className={`badge ${k === 'landscape' ? 'proc' : 'topic'}`}>
                          {k === 'landscape' ? 'YouTube' : 'Reels/TikTok/Shorts'}
                        </span>
                        <a className="abtn" href={`/api/videos/${encodeURIComponent(f.video)}`}
                           download={f.video}>⬇ วิดีโอ</a>
                        {f.srt && (
                          <a className="abtn" href={`/api/videos/${encodeURIComponent(f.srt)}`}
                             download={f.srt}>⬇ ซับ .srt</a>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="fld">
                  <div className="flabel">อัปโหลดผ่าน API</div>
                  <div className="pubgrid">
                    {pub.platforms.map((pl) => {
                      const already = pub.done?.[meta.id]?.[pl.key];
                      // เลือกแนวที่แพลตฟอร์มรองรับและมีไฟล์จริง
                      const lay = pl.layouts.find((L) => meta.files?.[L]?.video);
                      const canUpload = pl.ready && lay && !already;
                      return (
                        <button key={pl.key}
                                className={`pbtn ${already ? 'ok' : ''} ${!pl.ready ? 'off' : ''}`}
                                disabled={!canUpload}
                                onClick={() => publishTo(meta.id, pl.key, lay)}
                                title={
                                  already ? `อัปโหลดแล้ว — ${already.url || ''}`
                                  : !pl.ready ? `ยังไม่ได้ตั้งค่า: ขาด ${pl.missing.join(', ')}`
                                  : !lay ? 'ยังไม่มีไฟล์วิดีโอที่รองรับ'
                                  : `อัปโหลดขึ้น ${pl.label}`
                                }>
                          <span className="pico" style={{ color: pl.color }}>
                            {already ? '✓' : pl.icon}
                          </span>
                          <span className="plab">
                            {already ? `ขึ้น ${pl.label} แล้ว` : `อัปขึ้น ${pl.label}`}
                          </span>
                          {!pl.ready && <span className="pwarn">ยังไม่ตั้งค่า</span>}
                          {already?.url && (
                            <a className="plink" href={already.url} target="_blank"
                               rel="noreferrer" onClick={(e) => e.stopPropagation()}>เปิด ↗</a>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {pubMsg && <div className="pmsg">{pubMsg}</div>}
                  {pub.platforms.some((x) => !x.ready) && (
                    <div className="hint" style={{ marginTop: 8 }}>
                      แพลตฟอร์มที่ยังไม่ตั้งค่าต้องใส่ค่าใน <code>.env.local</code> —
                      ดูรายละเอียดใน <b>bearrytales-video/PUBLISHING.md</b>
                    </div>
                  )}
                </div>

                <div className="ynote">
                  <b>💡 ไม่ต้องแปลเป็นภาษาอื่น</b>
                  <div className="hint" style={{ marginTop: 4 }}>
                    YouTube แปลชื่อ คำอธิบาย และซับให้ผู้ชมอัตโนมัติตามภาษาของเขา
                    (ซับได้ 100+ ภาษา · พากย์เสียงได้ 27 ภาษา)
                    ขอแค่<b> อัปโหลดไฟล์ .srt ไปด้วย</b> และตั้งภาษาต้นทางเป็นไทย
                  </div>
                </div>

                <div className="ynote ok">
                  <b>⚙️ ตั้งค่าตอนอัปโหลด</b>
                  <div className="hint" style={{ marginTop: 4 }}>
                    ภาษา: <b>ไทย (th)</b> · หมวด: <b>Entertainment</b> ·
                    ทำเพื่อเด็ก: <b>ใช่</b> · เริ่มเป็น <b>ส่วนตัว</b> แล้วค่อยเปิด
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showQueue && (
        <div className="modal-overlay" onClick={() => setShowQueue(false)}>
          <div className="qbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">คิวงานสร้างวิดีโอ</div>
              <button className="refresh" onClick={() => setShowQueue(false)}>✕</button>
            </div>

            {(() => {
              const wait = queue.jobs.filter((j) => j.status === 'queued').length;
              const remain = (queue.running ? 1 : 0) + wait;
              return (
                <div className="qsum">
                  <span>ทั้งหมด <b>{queue.jobs.length}</b> งาน</span>
                  {queue.running && <span>· กำลังทำ <b className="c-run">1</b></span>}
                  {wait > 0 && <span>· รอคิว <b>{wait}</b></span>}
                  <span>· เสร็จ <b className="c-ok">
                    {queue.jobs.filter((j) => j.status === 'done').length}</b></span>
                  {queue.jobs.some((j) => j.status === 'error') &&
                    <span>· ล้มเหลว <b className="c-err">
                      {queue.jobs.filter((j) => j.status === 'error').length}</b></span>}
                  {remain > 0 && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      เหลืออีกราว <b>{remain * 6}</b> นาที
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="qlist">
              {queue.jobs.length === 0 && <div className="meta">ยังไม่มีงานในคิว</div>}
              {queue.jobs.map((j, i) => {
                const story = clips.find((c) => c.id === j.id);
                const secs = j.started
                  ? Math.round(((j.ended || Date.now()) - j.started) / 1000)
                  : 0;
                return (
                  <div key={j.key + i} className={`qitem s-${j.status}`}>
                    <div className="qstat">
                      {j.status === 'running' ? <span className="spin mini" />
                        : j.status === 'done' ? '✓'
                        : j.status === 'error' ? '✗' : '•'}
                    </div>
                    <div className="qmain">
                      <div className="qtitle">
                        #{j.id} {story?.title || ''}
                      </div>
                      <div className="qmeta">
                        <span className={`badge ${j.layout === 'landscape' ? 'proc' : 'topic'}`}>
                          {j.layout === 'landscape' ? 'แนวนอน' : 'แนวตั้ง'}
                        </span>
                        <span className="dim">
                          {j.status === 'queued' ? 'รอคิว'
                            : j.status === 'running' ? `กำลังทำ ${secs}s`
                            : j.status === 'done' ? `เสร็จใน ${secs}s`
                            : 'ล้มเหลว'}
                        </span>
                      </div>
                      {j.error && <div className="qerrmsg">{j.error}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {queue.jobs.some((j) => j.status === 'queued') && (
              <button className="cancelall" onClick={cancelQueue}>
                ยกเลิกงานที่ยังไม่เริ่ม
              </button>
            )}
            <div className="hint" style={{ marginTop: 10 }}>
              งานทำทีละรายการเบื้องหลัง ปิดหน้านี้ได้ งานจะทำต่อจนเสร็จ
            </div>
          </div>
        </div>
      )}

      {askLayout && (
        <div className="modal-overlay" onClick={() => setAskLayout(false)}>
          <div className="askbox" onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">สร้างวิดีโอ {sel.size} เรื่อง</div>
              <button className="refresh" onClick={() => setAskLayout(false)}>✕</button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>เลือกแนววิดีโอที่ต้องการ</p>

            {[
              ['pv', 'แนวตั้ง · เบิร์นซับ', '1080×1920',
               'TikTok / Facebook Reels — ไม่มีระบบซับ ต้องมีตัวหนังสือบนจอ'],
              ['pn', 'แนวตั้ง · ไม่เบิร์นซับ', '1080×1920',
               'YouTube Shorts — ได้ auto-dub + ซับแปล 100+ ภาษา จอสะอาด'],
              ['lv', 'แนวนอน · เบิร์นซับ', '1920×1080',
               'ใช้เมื่อปลายทางไม่รองรับซับแยกไฟล์'],
              ['ln', 'แนวนอน · ไม่เบิร์นซับ', '1920×1080',
               'YouTube ปกติ — ให้ระบบแปลซับอัตโนมัติ (แนะนำ)'],
            ].map(([key, label, size, note]) => (
              <label key={key} className={`opt ${variants[key] ? 'on' : ''}`}>
                <input type="checkbox" className="cb" checked={variants[key]}
                       onChange={(e) =>
                         setVariants((v) => ({ ...v, [key]: e.target.checked }))} />
                <div style={{ flex: 1 }}>
                  <b>{label}</b>
                  <span className="vsize">{size}</span>
                  <div className="hint" style={{ marginTop: 3 }}>{note}</div>
                </div>
              </label>
            ))}

            <div className="hint" style={{ marginTop: -2, marginBottom: 10 }}>
              ทุกแบบได้ไฟล์ <b>.srt</b> ติดมาด้วยเสมอ · ไฟล์แยกกัน ไม่ทับของเดิม
            </div>

            <div className="esti">
              รวม {sel.size * Object.values(variants).filter(Boolean).length} งาน ·
              ใช้เวลาราว <b>
                {Math.round(sel.size * Object.values(variants).filter(Boolean).length * 6)} นาที
              </b>
              <div className="hint" style={{ marginTop: 4 }}>
                ระบบจะสร้างทีละงานเบื้องหลัง ปิดหน้านี้ได้ งานจะทำต่อจนเสร็จ
              </div>
            </div>

            {msg && <div className="lerr2" style={{ marginTop: 10 }}>{msg}</div>}

            <button className="go" onClick={startRender}
                    disabled={!Object.values(variants).some(Boolean)}>เริ่มสร้าง</button>
          </div>
        </div>
      )}

      {playing && (
        <div className="modal-overlay" onClick={() => setPlaying(null)}>
          <div className={`vmodal ${playing.mode}`} onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t">
                #{playing.id} {playing.title}
                <span className="modetag">
                  {playing.mode === 'landscape' ? 'แนวนอน 1920×1080' : 'แนวตั้ง 1080×1920'}
                  {' · '}{playing.nosub ? 'ไม่เบิร์นซับ' : 'เบิร์นซับ'}
                </span>
              </div>
              <button className="refresh" onClick={() => setPlaying(null)}>ปิด ✕</button>
            </div>
            <video key={playing.file} controls autoPlay playsInline
                   src={`/api/videos/${encodeURIComponent(playing.file)}`} />
            <div className="meta" style={{ marginTop: 8, justifyContent: 'center', gap: 10 }}>
              {playing.alt && (
                <button className="abtn"
                        onClick={() => setPlaying({
                          ...playing, file: playing.alt,
                          nosub: !playing.nosub, alt: playing.file })}>
                  ⇄ ดูแบบ{playing.nosub ? 'เบิร์นซับ' : 'ไม่เบิร์นซับ'}
                </button>
              )}
              <a className="abtn" download={playing.file}
                 href={`/api/videos/${encodeURIComponent(playing.file)}`}>⬇ ดาวน์โหลด</a>
            </div>
          </div>
        </div>
      )}

      {dir && <div className="hint">โฟลเดอร์วิดีโอ: {dir}</div>}

      <style jsx>{`
        .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .chip {
          display: flex; align-items: center; gap: 8px;
          background: var(--card); border: 1px solid var(--line);
          border-radius: 999px; padding: 8px 16px; font-size: 13px;
          font-family: inherit; cursor: pointer;
          transition: border-color .15s, background .15s, transform .1s;
        }
        .chip:hover { transform: translateY(-1px); border-color: var(--accent2); }
        .chip:active { transform: none; }
        /* ตัวที่เลือกอยู่ — ขอบสว่างและพื้นเข้มขึ้น เห็นชัดว่ากำลังกรองอะไร */
        .chip.on {
          background: #16213a; border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(245,158,11,.18);
        }
        .chip.on span { color: #e2e8f0; }
        .chip span { color: var(--muted); }
        .chip b { font-size: 15px; }
        .chip.ok { border-color: rgba(34,197,94,.35); }
        .chip.ok b { color: var(--ok); }
        .chip.warn { border-color: rgba(245,158,11,.35); }
        .chip.warn b { color: var(--accent); }
        .chip.info { border-color: rgba(56,189,248,.35); }
        .chip.info b { color: var(--accent2); }
        .chip.bad { border-color: rgba(239,68,68,.35); }
        .chip.bad b { color: var(--err); }
        .chip.mute b { color: var(--muted); }

        .filters { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }

        .cmdbox { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }
        .cmdbox :global(code) {
          display: block; margin-top: 6px; padding: 10px 12px;
          background: #0b1324; border: 1px solid var(--line); border-radius: 8px;
          font-size: 12.5px; color: #bae6fd; overflow-x: auto; white-space: nowrap;
        }

        .ptable { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tablecard {
          padding: 0;
          /* ห้ามใช้ overflow:hidden — จะทำให้ position:sticky ไม่ทำงาน
             ใช้ clip เฉพาะแนวตั้งเพื่อคงมุมโค้ง โดยไม่สร้าง scroll container
             ที่จะทำให้หัวตารางยึดกับกล่องแทนหน้าจอ */
          overflow-x: auto;
          overflow-y: visible;
          border-radius: 14px;
        }
        /* จอแคบกว่าตาราง: เลื่อนแนวนอนในกล่อง หัวตารางยังลอยตามหน้าจอได้ */
        @media (max-width: 1200px) {
          .ptable { min-width: 1120px; }
        }
        .ptable :global(thead) {
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .ptable :global(th) {
          text-align: left; padding: 12px 10px; color: var(--muted);
          font-weight: 600; font-size: 12px;
          /* พื้นหลังต้องทึบ ไม่งั้นแถวจะทะลุขึ้นมาตอนเลื่อน */
          background: #1b2740;
          border-bottom: 1px solid var(--line);
          box-shadow: 0 1px 0 var(--line), 0 6px 14px rgba(0,0,0,.28);
        }
        .ptable :global(td) {
          padding: 11px 10px; border-bottom: 1px solid #26334a; vertical-align: top;
        }
        .ptable :global(tr) { cursor: pointer; }
        .ptable :global(tr:hover td) { background: rgba(56,189,248,.05); }
        .ptable :global(tr:last-child td) { border-bottom: 0; }
        /* แถบสีซ้ายบอกสถานะรวม */
        .ptable :global(tr.r-done td:first-child)   { box-shadow: inset 3px 0 0 var(--ok); }
        .ptable :global(tr.r-ready td:first-child)  { box-shadow: inset 3px 0 0 var(--accent); }
        .ptable :global(tr.r-running td:first-child){ box-shadow: inset 3px 0 0 var(--accent2); }
        .ptable :global(tr.r-error td:first-child)  { box-shadow: inset 3px 0 0 var(--err); }
        .ptable :global(tr.r-missing td:first-child){ box-shadow: inset 3px 0 0 #475569; }

        .cid { color: var(--muted); font-variant-numeric: tabular-nums; }
        .cstep { text-align: center; width: 56px; }
        .cnum { text-align: center; width: 48px; color: #cbd5e1;
                font-variant-numeric: tabular-nums; }
        .cwhen { width: 96px; color: var(--muted); font-size: 12px; white-space: nowrap; }
        .tt { color: #e2e8f0; font-weight: 500; }
        .sub2 { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }

        .dot {
          display: inline-block; width: 11px; height: 11px; border-radius: 50%;
          background: #334155; border: 1px solid #475569;
        }
        .dot.done { background: var(--ok); border-color: var(--ok); }
        .dot.error { background: var(--err); border-color: var(--err); }
        .dot.queued {
          background: #1e3a5f; border-color: var(--accent2);
        }
        .dot.running {
          background: var(--accent2); border-color: var(--accent2);
          animation: pulse 1.1s ease-in-out infinite;
        }
        @keyframes pulse { 50% { opacity: .35; } }

        .jtag {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; padding: 2px 9px; border-radius: 999px;
          white-space: nowrap;
        }
        .jtag.run { background: rgba(56,189,248,.16); color: #bae6fd;
                    border: 1px solid rgba(56,189,248,.45); }
        .jtag.wait { background: #1e293b; color: var(--muted);
                     border: 1px solid var(--line); }
        .jtag.bad { background: rgba(239,68,68,.15); color: #fecaca;
                    border: 1px solid rgba(239,68,68,.45); }
        /* แถวที่กำลังเรนเดอร์ — เรืองแสงอ่อน ๆ ให้เห็นชัดตอนไล่สายตา */
        .ptable :global(tr.rendering td) { background: rgba(56,189,248,.07); }
        .ptable :global(tr.rendering td:first-child) {
          box-shadow: inset 3px 0 0 var(--accent2) !important;
        }

        .cb {
          width: 16px; height: 16px; cursor: pointer;
          accent-color: var(--accent); vertical-align: middle;
        }
        .cb:disabled { cursor: not-allowed; opacity: .3; }

        .selbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
          border-color: rgba(245,158,11,.35);
        }
        .selleft {
          display: flex; align-items: center; gap: 14px;
          flex-wrap: wrap; font-size: 13px;
        }
        .linkbtn {
          background: none; border: 0; color: var(--accent2);
          cursor: pointer; font-size: 12px; font-family: inherit;
          text-decoration: underline; padding: 0 0 0 6px;
        }
        .qrun { color: var(--accent2); display: flex; align-items: center; gap: 6px; }
        .qwait { color: var(--muted); }
        .qerr { color: var(--err); }
        .go.mini {
          margin-top: 0; width: auto; height: 40px; padding: 0 20px;
          font-size: 14px; flex: 0 0 auto;
        }
        .msgbox {
          margin-bottom: 16px; font-size: 13px;
          border-color: rgba(56,189,248,.35); background: rgba(56,189,248,.06);
        }

        .qbtn {
          background: none; border: 0; padding: 0; cursor: pointer;
          font-family: inherit; font-size: 13px;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .qbtn:hover { text-decoration: underline; }

        .abtn.info {
          border-color: rgba(148,163,184,.4); color: #cbd5e1;
          padding: 5px 10px; font-size: 13px;
        }
        .schedrow {
          display: flex; align-items: flex-start; gap: 11px;
          margin-top: 14px; padding: 12px 13px; cursor: pointer;
          background: #0b1324; border: 1px solid var(--line); border-radius: 10px;
        }
        .schedrow :global(input) { margin-top: 2px; flex: 0 0 auto; }
        .schedrow b { font-size: 13px; }
        .dtinput {
          width: 100%; box-sizing: border-box; height: 42px; margin-top: 10px;
          padding: 0 12px; font-size: 13.5px; font-family: inherit;
          color: #e2e8f0; background: #0b1324;
          border: 1px solid #3a4a63; border-radius: 9px;
          color-scheme: dark;
        }
        .dtinput:focus {
          outline: none; border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(245,158,11,.16);
        }

        .cfbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(400px, 94vw); width: 100%;
        }
        .cfstory {
          background: #0b1324; border: 1px solid var(--line);
          border-radius: 10px; padding: 11px 13px;
          font-size: 13.5px; color: #e2e8f0; margin-bottom: 14px;
        }
        .cfid { color: var(--muted); margin-right: 6px; }
        .cfrow {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; padding: 7px 2px;
          border-bottom: 1px solid #26334a;
        }
        .cfrow:last-of-type { border-bottom: 0; }
        .cflab { color: var(--muted); width: 78px; flex: 0 0 auto; font-size: 12px; }
        .cfnote { color: #cbd5e1; font-size: 12.5px; }
        .cfbox :global(.go) {
          margin-top: 16px; width: 100%; height: 46px; padding: 0; border: 0;
          border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;
          font-family: inherit; color: #111;
          background: linear-gradient(90deg, var(--accent), #fbbf24);
        }

        .mbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(620px, 94vw); width: 100%;
          max-height: 86vh; display: flex; flex-direction: column;
        }
        .mscroll { overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
        .fld { margin-bottom: 16px; }
        .flabel {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 600;
        }
        .cpy {
          background: #0b1324; border: 1px solid var(--line); color: var(--accent2);
          border-radius: 7px; padding: 3px 10px; cursor: pointer;
          font-size: 11px; font-family: inherit;
        }
        .cpy:hover { border-color: var(--accent2); }
        .fval {
          background: #0b1324; border: 1px solid var(--line);
          border-radius: 9px; padding: 10px 12px; font-size: 13px;
          color: #e2e8f0; line-height: 1.6;
        }
        .fval.one { font-weight: 600; }
        .fval.pre {
          margin: 0; white-space: pre-wrap; word-break: break-word;
          font-family: inherit; max-height: 220px; overflow-y: auto;
        }
        .tagwrap { display: flex; flex-wrap: wrap; gap: 6px; }
        .tg {
          background: #0b1324; border: 1px solid var(--line);
          border-radius: 999px; padding: 3px 11px; font-size: 12px; color: #cbd5e1;
        }
        .frow {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 7px; flex-wrap: wrap;
        }
        .pubgrid { display: flex; flex-direction: column; gap: 8px; }
        .pbtn {
          display: flex; align-items: center; gap: 10px;
          background: #0b1324; border: 1px solid var(--line); border-radius: 10px;
          padding: 11px 13px; cursor: pointer; font-family: inherit;
          font-size: 13px; color: #e2e8f0; text-align: left;
        }
        .pbtn:hover:not(:disabled) { border-color: var(--accent2); background: #111c33; }
        .pbtn:disabled { cursor: not-allowed; }
        .pbtn.off { opacity: .5; }
        .pbtn.ok {
          border-color: rgba(34,197,94,.45);
          background: rgba(34,197,94,.09); opacity: 1;
        }
        .pico { font-size: 16px; width: 20px; text-align: center; flex: 0 0 auto; }
        .pbtn.ok .pico { color: var(--ok) !important; }
        .plab { flex: 1; }
        .pwarn {
          font-size: 10.5px; color: var(--accent);
          background: rgba(245,158,11,.14); border-radius: 999px; padding: 2px 8px;
        }
        .plink { font-size: 11.5px; color: var(--accent2); text-decoration: none; }
        .plink:hover { text-decoration: underline; }
        .pmsg {
          margin-top: 9px; padding: 9px 11px; font-size: 12.5px;
          background: rgba(56,189,248,.08);
          border: 1px solid rgba(56,189,248,.3); border-radius: 9px;
        }

        .ynote {
          margin-top: 12px; padding: 11px 13px; font-size: 13px;
          background: rgba(245,158,11,.08);
          border: 1px solid rgba(245,158,11,.3); border-radius: 10px;
        }
        .ynote.ok {
          background: rgba(56,189,248,.07); border-color: rgba(56,189,248,.3);
        }

        .qbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(560px, 94vw); width: 100%;
          max-height: 84vh; display: flex; flex-direction: column;
        }
        .qsum {
          font-size: 13px; color: var(--muted); margin-bottom: 12px;
          padding-bottom: 12px; border-bottom: 1px solid var(--line);
          display: flex; gap: 6px; flex-wrap: wrap;
        }
        .qsum b { color: #e2e8f0; }
        .qsum .c-run { color: var(--accent2); }
        .qsum .c-ok { color: var(--ok); }
        .qsum .c-err { color: var(--err); }

        .qlist { overflow-y: auto; flex: 1; margin: 0 -4px; padding: 0 4px; }
        .qitem {
          display: flex; gap: 11px; padding: 10px 12px; margin-bottom: 7px;
          background: #0b1324; border: 1px solid var(--line);
          border-radius: 10px; align-items: flex-start;
        }
        .qitem.s-running { border-color: rgba(56,189,248,.45); background: rgba(56,189,248,.07); }
        .qitem.s-done { opacity: .62; }
        .qitem.s-error { border-color: rgba(239,68,68,.45); background: rgba(239,68,68,.07); }
        .qstat {
          flex: 0 0 18px; text-align: center; font-size: 13px;
          color: var(--muted); padding-top: 1px;
        }
        .qitem.s-done .qstat { color: var(--ok); }
        .qitem.s-error .qstat { color: var(--err); }
        .qmain { flex: 1; min-width: 0; }
        .qtitle {
          font-size: 13px; color: #e2e8f0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .qmeta { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
        .qmeta .dim { font-size: 12px; color: var(--muted); }
        .qerrmsg {
          margin-top: 6px; font-size: 11.5px; color: #fecaca;
          line-height: 1.5; word-break: break-word;
          max-height: 54px; overflow: hidden;
        }
        .cancelall {
          margin-top: 12px; width: 100%; padding: 10px;
          background: #0b1324; border: 1px solid rgba(239,68,68,.4);
          color: #fca5a5; border-radius: 10px; cursor: pointer;
          font-size: 13px; font-family: inherit;
        }
        .cancelall:hover { background: rgba(239,68,68,.12); }

        .askbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(420px, 94vw); width: 100%;
        }
        .opt {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 13px 14px; margin-bottom: 10px; cursor: pointer;
          background: #0b1324; border: 1px solid var(--line); border-radius: 11px;
        }
        .opt:hover { border-color: var(--accent2); }
        .opt :global(input) { margin-top: 2px; flex: 0 0 auto; }
        .opt b { font-size: 14px; }
        .subopt {
          display: flex; align-items: flex-start; gap: 8px;
          margin-top: 9px; padding-top: 9px;
          border-top: 1px dashed var(--line);
          font-size: 12px; color: #cbd5e1; cursor: pointer;
        }
        .subopt :global(input) { margin-top: 1px; }
        .subopt em { color: var(--muted); font-style: normal; font-size: 11.5px; }
        .cb.sm { width: 14px; height: 14px; }

        .opt.on { border-color: var(--accent); background: rgba(245,158,11,.07); }
        .vsize {
          margin-left: 8px; font-size: 11px; color: var(--muted);
          font-weight: 400;
        }

        .esti {
          margin: 14px 0 4px; padding: 11px 13px; font-size: 13px;
          background: rgba(245,158,11,.08);
          border: 1px solid rgba(245,158,11,.3); border-radius: 10px;
        }
        .askbox :global(.go) {
          margin-top: 14px; width: 100%; height: 46px; padding: 0; border: 0;
          border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;
          font-family: inherit; color: #111;
          background: linear-gradient(90deg, var(--accent), #fbbf24);
        }
        .askbox :global(.go:disabled) { opacity: .5; cursor: not-allowed; }

        .cthumb { width: 66px; text-align: center; padding: 4px !important; }
        .tprev {
          display: block; width: 58px; height: 33px; padding: 0;
          border: 1px solid var(--line); border-radius: 5px;
          overflow: hidden; cursor: pointer; background: #0b1324;
        }
        .tprev:hover { border-color: var(--accent2); }
        .tprev img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .tbtn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 26px; border-radius: 6px;
          background: transparent; border: 1px dashed var(--line);
          color: #64748b; cursor: pointer; font-size: 13px; font-family: inherit;
        }
        .tbtn.mk:hover:not(:disabled) {
          border-style: solid; border-color: var(--accent); color: var(--accent);
        }
        .tbtn:disabled { opacity: .3; cursor: not-allowed; }
        .thbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 16px; padding: 20px;
          max-width: min(430px, 94vw); width: 100%;
        }
        .thprev {
          position: relative; margin: 14px 0 4px;
          border-radius: 10px; overflow: hidden;
          border: 1px solid var(--line); background: #0b1324;
          aspect-ratio: 16/9;
        }
        .thprev img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .thempty {
          position: absolute; inset: 0; display: flex; gap: 8px;
          align-items: center; justify-content: center;
          color: var(--muted); font-size: 12.5px;
        }
        .thload {
          position: absolute; inset: 0; display: grid; place-items: center;
          background: rgba(11,19,36,.55);
        }
        .thnote {
          position: absolute; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,.62); color: #cbd5e1;
          font-size: 10.5px; padding: 4px 8px; text-align: center;
        }

        .thlabel {
          font-size: 12px; color: var(--muted); font-weight: 600;
          margin: 16px 0 8px;
        }
        .thlabel b { color: var(--accent); }
        .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .sidebtn {
          display: flex; flex-direction: column; align-items: center; gap: 7px;
          padding: 11px; cursor: pointer; font-size: 11.5px; font-family: inherit;
          color: #cbd5e1; background: #0b1324;
          border: 1px solid var(--line); border-radius: 10px;
        }
        .sidebtn.on { border-color: var(--accent); background: rgba(245,158,11,.09);
                      color: #e2e8f0; }
        .mini-lay {
          display: flex; width: 62px; height: 35px; border-radius: 4px;
          overflow: hidden; border: 1px solid #334155;
        }
        .mini-lay.right { flex-direction: row-reverse; }
        .m-text { flex: 0 0 56%; background: #1e293b; }
        .m-img { flex: 1; background: linear-gradient(135deg,#475569,#64748b); }
        .sidebtn.on .m-text { background: var(--accent); }

        .swatches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .sw {
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          padding: 10px 6px; cursor: pointer; font-family: inherit;
          border: 2px solid transparent; border-radius: 9px;
        }
        .sw.on { border-color: var(--accent); }
        .swdot { width: 18px; height: 18px; border-radius: 50%; }
        .swname { font-size: 10.5px; color: rgba(255,255,255,.82); }

        .slider {
          width: 100%; accent-color: var(--accent); cursor: pointer;
        }
        .thbox :global(.go) {
          margin-top: 18px; width: 100%; height: 46px; padding: 0; border: 0;
          border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;
          font-family: inherit; color: #111;
          background: linear-gradient(90deg, var(--accent), #fbbf24);
        }

        .tvbox {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 16px;
          max-width: min(860px, 94vw); width: 100%;
        }
        .tvimg {
          width: 100%; border-radius: 10px; display: block;
          border: 1px solid var(--line);
        }

        .csrt { width: 52px; text-align: center; }
        .srtag {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 30px; height: 22px; padding: 0 7px;
          border-radius: 999px; font-size: 11px; font-weight: 600;
        }
        .srtag.ok { color: var(--ok); background: rgba(34,197,94,.14);
                    border: 1px solid rgba(34,197,94,.4); }
        .srtag.part { color: var(--accent); background: rgba(245,158,11,.12);
                      border: 1px solid rgba(245,158,11,.4); }
        .srtag.none { color: #475569; border: 1px solid var(--line); }
        .dimd { color: #475569; }

        .cpub { width: 58px; text-align: center; padding: 6px 4px !important; }
        .quota {
          font-size: 9.5px; font-weight: 500; color: var(--muted);
          margin-top: 2px; font-variant-numeric: tabular-nums;
        }
        .quota.full { color: var(--accent); font-weight: 700; }
        .ptable :global(th.cpub) { font-size: 11px; white-space: nowrap; }
        .pcell {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 8px;
          background: #0b1324; border: 1px solid var(--line);
          color: var(--muted); cursor: pointer; font-size: 13px;
          font-family: inherit; text-decoration: none;
        }
        .pcell:hover:not(:disabled) {
          border-color: var(--accent2); background: #111c33; color: #e2e8f0;
        }
        .pcell:disabled { opacity: .22; cursor: not-allowed; }
        /* อัปโหลดแล้ว — ไอคอนหนาขึ้น เป็นสีแบรนด์ (สีมาจาก style ในแถว) */
        .pcell.ok {
          border-color: currentColor;
          background: color-mix(in srgb, currentColor 16%, transparent);
          cursor: pointer;
          font-weight: 800;
          font-size: 15px;
          box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent);
        }
        .pcell.ok:hover {
          background: color-mix(in srgb, currentColor 28%, transparent);
        }
        .pcell.run {
          border-color: rgba(56,189,248,.5); background: rgba(56,189,248,.12);
        }
        .pcell.bad {
          border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.12);
          color: #fca5a5;
        }

        .cact { width: 300px; min-width: 300px; text-align: center; }
        .acts {
          display: flex; gap: 4px; justify-content: center;
          flex-wrap: nowrap;   /* บังคับอยู่แถวเดียว */
          align-items: center;
        }
        .abtn {
          background: #0b1324; border: 1px solid var(--line); color: #cbd5e1;
          border-radius: 8px; padding: 5px 7px; cursor: pointer;
          font-size: 11.5px; font-family: inherit; text-decoration: none;
          display: inline-flex; align-items: center; white-space: nowrap;
          flex: 0 0 auto;
        }
        .abtn:hover { border-color: var(--accent2); background: #111c33; }
        .abtn.play {
          border-color: rgba(34,197,94,.4);
          background: rgba(34,197,94,.12); color: #bbf7d0;
        }
        .abtn.play:hover { background: rgba(34,197,94,.2); }
        .abtn.play.land {
          border-color: rgba(56,189,248,.4);
          background: rgba(56,189,248,.12); color: #bae6fd;
        }
        .abtn.play.land:hover { background: rgba(56,189,248,.22); }
        .abtn.play.v-pv { border-color: rgba(34,197,94,.45);
          background: rgba(34,197,94,.12); color: #bbf7d0; }
        .abtn.play.v-pn { border-color: rgba(168,85,247,.45);
          background: rgba(168,85,247,.12); color: #e9d5ff; }
        .abtn.play.v-lv { border-color: rgba(245,158,11,.45);
          background: rgba(245,158,11,.12); color: #fde68a; }
        .abtn.play.v-ln { border-color: rgba(56,189,248,.45);
          background: rgba(56,189,248,.12); color: #bae6fd; }
        /* คลิปสั้น — สีชมพูให้ต่างจากอีก 4 ปุ่มชัดเจน เพราะเป็นไฟล์คนละชนิด */
        .abtn.play.v-reel { border-color: rgba(236,72,153,.55);
          background: rgba(236,72,153,.16); color: #fbcfe8; font-weight: 600; }
        /* มีคลิปเต็มแล้วแต่ยังไม่ได้ตัดสั้น */
        .abtn.photo { border-color: rgba(59,130,246,.45);
          background: rgba(59,130,246,.12); color: #bfdbfe; }
        .abtn.norl { border-style: dashed; border-color: rgba(236,72,153,.25);
          color: #64748b; cursor: help; }
        .abtn.play:hover { filter: brightness(1.35); }
        /* ยังไม่มีไฟล์ — จางไว้ กดเพื่อสร้างแบบนั้น */
        .abtn.mk {
          border-style: dashed; color: #64748b;
          background: transparent; opacity: .8;
        }
        .abtn.mk:hover:not(:disabled) {
          border-style: solid; color: var(--accent);
          border-color: var(--accent); opacity: 1;
        }
        .abtn.mk:disabled { opacity: .3; cursor: not-allowed; }
        .waitl { font-size: 12px; color: var(--accent); }
        .waitl.dim { color: #475569; }

        .vmodal {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 16px;
          max-width: min(430px, 94vw); width: 100%;
        }
        /* แนวนอนต้องกว้างกว่ามาก ไม่งั้นวิดีโอจะเล็กจนดูไม่รู้เรื่อง */
        .vmodal.landscape { max-width: min(940px, 94vw); }
        .modetag {
          margin-left: 8px; font-size: 11px; font-weight: 500;
          color: var(--muted); white-space: nowrap;
        }
        .vmodal :global(video) {
          width: 100%; max-height: 74vh; border-radius: 10px;
          background: #000; display: block;
        }

        .detail {
          margin-top: 10px; padding: 10px 12px;
          background: #0b1324; border: 1px solid var(--line); border-radius: 8px;
        }
        .lerr2 {
          color: #fecaca; font-size: 12px; margin-bottom: 8px;
          word-break: break-word; line-height: 1.6;
        }
        .detail :global(code) { color: #bae6fd; }
      `}</style>
    </div>
  );
}
