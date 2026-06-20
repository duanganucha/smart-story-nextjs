'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import StoryPlayer from './StoryPlayer';
import ConfigDialog from './ConfigDialog';

const STATUS_LABEL = { queued: 'รอคิว', processing: 'กำลังทำ', done: 'เสร็จ', error: 'ผิดพลาด' };

export default function Home() {
  const [mode, setMode] = useState('topic');
  const [studentName, setStudentName] = useState('');
  const [storyType, setStoryType] = useState('นิทาน');
  const [language, setLanguage] = useState('thai');
  const [topic, setTopic] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [paragraphs, setParagraphs] = useState(6);
  const [voiceSpeed, setVoiceSpeed] = useState('normal');
  const [voiceGender, setVoiceGender] = useState('female');
  const [aspect, setAspect] = useState('16:9');
  const [ageRange, setAgeRange] = useState('6-8');
  const [category, setCategory] = useState('ผจญภัย');

  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [player, setPlayer] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [alertErr, setAlertErr] = useState(null);
  const [dismissedId, setDismissedId] = useState(0);
  const [editing, setEditing] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStory, setEditStory] = useState('');
  const [editMoral, setEditMoral] = useState('');
  const fileRef = useRef(null);
  const dragIdx = useRef(null);

  async function load() {
    try {
      const r = await fetch('/api/stories', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        setRows(data);
        // detect Local/SUT provider failures and surface a notice
        const e = data.find(
          (x) => x.status === 'error' && x.error &&
            /cost limit|sut-gen|genai\.sut|edge[-_ ]?tts|NoAudioReceived|afconvert/i.test(x.error)
        );
        setAlertErr(e ? { id: e.id, msg: e.error } : null);
      }
    } catch {}
  }

  // adaptive polling: fast while jobs are active
  useEffect(() => {
    load();
    let timer;
    const tick = async () => {
      await load();
      const active = (document.__rows || []).some((x) => x.status === 'queued' || x.status === 'processing');
      timer = setTimeout(tick, active ? 1800 : 5000);
    };
    timer = setTimeout(tick, 1800);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => { document.__rows = rows; }, [rows]);

  function onFile(e) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setNotice('');
    if (mode === 'image' && !file) { setError('กรุณาเลือกรูปภาพ'); return; }
    if (mode === 'topic' && !topic.trim()) { setError('กรุณาใส่หัวข้อเรื่อง'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('student_name', studentName || 'นักเรียน');
      fd.append('story_type', storyType);
      fd.append('language', language);
      fd.append('paragraphs', String(paragraphs));
      fd.append('voice_speed', voiceSpeed);
      fd.append('voice_gender', voiceGender);
      fd.append('aspect_ratio', aspect);
      fd.append('age_range', ageRange);
      fd.append('category', category);
      if (mode === 'topic') fd.append('topic', topic);
      if (mode === 'image' && file) fd.append('image', file);

      const r = await fetch('/api/stories', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      setNotice(`✓ ส่งเข้าคิวแล้ว #${data.id} — กำลังประมวลผลเบื้องหลัง (ส่งเรื่องต่อไปได้เลย)`);
      setTopic('');
      setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  async function doDelete(id) {
    if (!confirm(`ลบเรื่อง #${id} (รวมไฟล์เสียง/ภาพ) ?`)) return;
    await fetch('/api/stories/' + id, { method: 'DELETE' });
    if (expanded === id) setExpanded(null);
    load();
  }
  async function doAction(id, action) {
    const label = action === 'scenes' ? 'สร้างฉากภาพใหม่' : action === 'audio' ? 'สร้างเสียงใหม่' : 'สร้างใหม่ทั้งหมด';
    if (!confirm(`${label} สำหรับเรื่อง #${id} ?`)) return;
    setNotice(`✓ #${id}: เริ่ม${label}แล้ว`);
    await fetch('/api/stories/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    load();
  }

  function startEdit(h) {
    setEditing(h.id);
    setEditTitle(h.title || '');
    setEditStory(h.story || '');
    setEditMoral(moralOf(h.moral).join('\n'));
  }
  async function saveEdit(id) {
    await fetch('/api/stories/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editTitle, story: editStory, moral: editMoral.split('\n').map((s) => s.trim()).filter(Boolean) }),
    });
    setEditing(null);
    load();
  }
  async function reorderScenes(id, scenesArr, from, to) {
    if (from == null || from === to || to == null) { dragIdx.current = null; return; }
    const arr = [...scenesArr];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const renum = arr.map((s, i) => ({ ...s, n: i + 1 }));
    dragIdx.current = null;
    // optimistic UI
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, scenes: JSON.stringify(renum) } : r)));
    await fetch('/api/stories/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes: renum }),
    });
    load();
  }
  async function doScene(id, index, currentPrompt) {
    const p = window.prompt('แก้ prompt ของฉากนี้ (อังกฤษ) แล้วกด OK เพื่อสร้างภาพใหม่ — หรือกด OK เลยเพื่อใช้ prompt เดิม:', currentPrompt || '');
    if (p === null) return;
    await fetch('/api/stories/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scene', index, prompt: p }),
    });
    load();
  }

  const moralOf = (m) => {
    if (!m) return [];
    if (Array.isArray(m)) return m;
    try { return JSON.parse(m); } catch { return []; }
  };
  const scenesOf = (s) => {
    if (!s) return [];
    if (Array.isArray(s)) return s;
    try { return JSON.parse(s); } catch { return []; }
  };

  const activeCount = rows.filter((r) => r.status === 'queued' || r.status === 'processing').length;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>📖 Smart Story <span className="em">AI</span></h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            สร้างนิทานจากรูปภาพหรือหัวข้อ — เนื้อเรื่อง/เสียง/ฉากภาพ เลือก provider ได้ · เก็บลง MySQL + ไฟล์ในเครื่อง · ทำหลายเรื่องพร้อมกันได้
          </p>
        </div>
        <button className="cfgbtn" onClick={() => setShowConfig(true)}>⚙️ ตั้งค่า</button>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="tabs">
          <span className={'tab' + (mode === 'topic' ? ' active' : '')} onClick={() => setMode('topic')}>✍️ จากหัวข้อ</span>
          <span className={'tab' + (mode === 'image' ? ' active' : '')} onClick={() => setMode('image')}>🖼️ จากรูปภาพ</span>
        </div>

        {mode === 'topic' ? (
          <>
            <label>หัวข้อ / ธีมของเรื่อง</label>
            <textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="เช่น กระต่ายน้อยผู้กล้าหาญผจญภัยในป่าใหญ่" />
          </>
        ) : (
          <>
            <label>อัปโหลดรูปภาพ</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} />
            {preview && <img className="thumb" src={preview} alt="preview" />}
          </>
        )}

        <div className="row">
          <div>
            <label>ชื่อนักเรียน</label>
            <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="นักเรียน" />
          </div>
          <div>
            <label>ประเภท</label>
            <select value={storyType} onChange={(e) => setStoryType(e.target.value)}>
              <option>นิทาน</option>
              <option>เรื่องสั้น</option>
              <option>นิทานก่อนนอน</option>
            </select>
          </div>
          <div>
            <label>ภาษา</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="thai">ไทย</option>
              <option value="english">English</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label>จำนวนย่อหน้า</label>
            <input type="number" min={1} max={10} value={paragraphs} onChange={(e) => setParagraphs(e.target.value)} />
          </div>
          <div>
            <label>ความเร็วเสียง</label>
            <select value={voiceSpeed} onChange={(e) => setVoiceSpeed(e.target.value)}>
              <option value="slow">ช้า</option>
              <option value="normal">ปกติ</option>
              <option value="fast">เร็ว</option>
            </select>
          </div>
          <div>
            <label>น้ำเสียงผู้บรรยาย</label>
            <select value={voiceGender} onChange={(e) => setVoiceGender(e.target.value)}>
              <option value="female">หญิง</option>
              <option value="male">ชาย</option>
            </select>
          </div>
          <div>
            <label>อัตราส่วนรูป</label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="16:9">16:9 (แนวนอน)</option>
              <option value="1:1">1:1 (จัตุรัส)</option>
              <option value="9:16">9:16 (แนวตั้ง)</option>
            </select>
          </div>
          <div>
            <label>ช่วงอายุเด็ก</label>
            <select value={ageRange} onChange={(e) => setAgeRange(e.target.value)}>
              <option value="3-5">3–5 ปี (อนุบาล)</option>
              <option value="6-8">6–8 ปี (ประถมต้น)</option>
              <option value="9-12">9–12 ปี (ประถมปลาย)</option>
            </select>
          </div>
          <div>
            <label>หมวด (แนวเรื่อง)</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="ผจญภัย">ผจญภัย</option>
              <option value="แฟนตาซี">แฟนตาซี</option>
              <option value="มิตรภาพ">มิตรภาพ</option>
              <option value="สัตว์และธรรมชาติ">สัตว์และธรรมชาติ</option>
              <option value="ความรู้และวิทยาศาสตร์">ความรู้และวิทยาศาสตร์</option>
              <option value="คุณธรรมและข้อคิด">คุณธรรมและข้อคิด</option>
            </select>
          </div>
        </div>

        <button className="go" type="submit" disabled={submitting}>
          {submitting ? <><span className="spin" />กำลังส่ง...</> : '✨ ส่งสร้างเรื่อง (ไม่ต้องรอ)'}
        </button>
        {notice && <div style={{ color: 'var(--ok)', fontSize: 13, marginTop: 10 }}>{notice}</div>}
        {error && <div className="err">⚠️ {error}</div>}
      </form>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>
            เรื่องทั้งหมด ({rows.length}){activeCount > 0 && <span style={{ color: 'var(--accent2)', fontSize: 13 }}> · กำลังทำ {activeCount} เรื่องพร้อมกัน</span>}
          </h3>
          <button className="refresh" onClick={load}>↻ รีเฟรช</button>
        </div>

        {rows.length === 0 && <p className="sub">ยังไม่มีเรื่อง</p>}

        {rows.length > 0 && (
          <div className="tablewrap">
            <table className="stbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>นักเรียน</th>
                  <th>ชื่อเรื่อง / หัวข้อ</th>
                  <th>ที่มา</th>
                  <th>สถานะ</th>
                  <th>ขั้นตอน</th>
                  <th title="เนื้อเรื่อง">📝</th>
                  <th title="เสียง">🔊</th>
                  <th title="ฉากภาพ">🖼️</th>
                  <th>เวลา</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const scenes = scenesOf(h.scenes);
                  const sc = scenes.filter((s) => s.path).length;
                  const m = (h.stage || '').match(/(\d+)\s*\/\s*(\d+)/);
                  const proc = h.status === 'queued' || h.status === 'processing';
                  const total = scenes.length;
                  let sceneCell;
                  if (total > 0 && sc >= total) sceneCell = '✅ ' + total;
                  else if (sc > 0) sceneCell = sc + '/' + total;
                  else if (h.status === 'processing' && (h.stage || '').includes('ฉาก') && m) sceneCell = m[1] + '/' + m[2];
                  else if (h.status === 'error') sceneCell = '❌';
                  else if (h.status === 'done') sceneCell = '—';
                  else sceneCell = '⏳';
                  const chk = (ok) => (ok ? '✅' : h.status === 'error' ? '❌' : h.status === 'done' ? '—' : '⏳');
                  const open = expanded === h.id;
                  return (
                    <Fragment key={h.id}>
                      <tr className={'rowline' + (open ? ' open' : '')} onClick={() => setExpanded(open ? null : h.id)}>
                        <td>{h.id}</td>
                        <td>{h.student_name}</td>
                        <td className="ttl">{h.title || h.topic || '—'}</td>
                        <td><span className={'badge ' + (h.source_type === 'image' ? 'image' : 'topic')}>{h.source_type === 'image' ? 'รูป' : 'หัวข้อ'}</span></td>
                        <td><span className={'badge ' + (h.status === 'error' ? 'error' : h.status === 'done' ? 'done' : 'proc')}>{STATUS_LABEL[h.status]}</span></td>
                        <td className="stage">{proc ? <><span className="spin mini" />{h.stage}</> : h.status === 'error' ? '—' : 'เสร็จ'}</td>
                        <td className="chk">{chk(!!h.story)}</td>
                        <td className="chk">{chk(!!h.audio_path)}</td>
                        <td className="chk">{sceneCell}</td>
                        <td className="dt">{h.created_at ? new Date(h.created_at).toLocaleDateString('th-TH') : ''}</td>
                        <td className="act" onClick={(e) => e.stopPropagation()}>
                          <button className="ab play" title="เล่นภาพ + เสียง" disabled={!(h.status === 'done' && h.audio_path && sc > 0)} onClick={() => setPlayer(h)}>▶️</button>
                          <button className="ab" title="ดูรายละเอียด" onClick={() => setExpanded(open ? null : h.id)}>👁</button>
                          <button className="ab" title="สร้าง/สร้างเสียงใหม่" disabled={proc || !h.story} onClick={() => doAction(h.id, 'audio')}>🔊</button>
                          <button className="ab" title="สร้าง/ทำฉากใหม่" disabled={proc || !h.story} onClick={() => doAction(h.id, 'scenes')}>🎬</button>
                          <button className="ab" title="สร้างใหม่ทั้งหมด" disabled={proc} onClick={() => doAction(h.id, 'retry')}>🔁</button>
                          <button className="ab del" title="ลบ" disabled={proc} onClick={() => doDelete(h.id)}>🗑</button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detailrow">
                          <td colSpan={11}>
                            {h.status === 'error' && <div className="err">⚠️ {h.error}</div>}

                            {editing === h.id ? (
                              <div onClick={(e) => e.stopPropagation()}>
                                <label>ชื่อเรื่อง</label>
                                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                                <label>เนื้อเรื่อง</label>
                                <textarea rows={10} value={editStory} onChange={(e) => setEditStory(e.target.value)} />
                                <label>ข้อคิด (บรรทัดละข้อ)</label>
                                <textarea rows={3} value={editMoral} onChange={(e) => setEditMoral(e.target.value)} />
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                  <button className="go" style={{ marginTop: 0, maxWidth: 160 }} onClick={() => saveEdit(h.id)}>💾 บันทึก</button>
                                  <button className="cfgbtn" onClick={() => setEditing(null)}>ยกเลิก</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  {h.title && <div className="t" style={{ fontSize: 16 }}>{h.title}</div>}
                                  {h.story && <button className="cfgbtn" onClick={(e) => { e.stopPropagation(); startEdit(h); }}>✏️ แก้ไขเนื้อหา</button>}
                                </div>
                                {h.topic && <div style={{ fontSize: 12, color: 'var(--muted)' }}>หัวข้อ: {h.topic}</div>}
                                {h.category && <div style={{ fontSize: 12, color: 'var(--muted)' }}>หมวด: <b>{h.category}</b> · {h.story_type}</div>}
                                <div style={{ fontSize: 12, color: 'var(--muted)' }}>👤 สร้างโดย: <b>{h.owner_name || 'ไม่ระบุ (เว็บ/ระบบ)'}</b></div>
                                {(h.engine_story || h.engine_tts || h.engine_image) && (
                                  <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0' }}>
                                    🛠️ สร้างด้วย — เนื้อเรื่อง: <b>{h.engine_story || '—'}</b> · เสียง: <b>{h.engine_tts || '—'}</b> · ฉาก: <b>{h.engine_image || '—'}</b> · {h.paragraphs}ย่อหน้า · {h.aspect_ratio}
                                  </div>
                                )}
                                {h.story && <p style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1', fontSize: 14, margin: '8px 0', lineHeight: 1.7 }}>{h.story}</p>}
                                {moralOf(h.moral).length > 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>💡 {moralOf(h.moral).join(' · ')}</div>}
                                {h.audio_path && <audio controls preload="none" src={h.audio_path} />}
                              </>
                            )}

                            {scenes.length > 0 && (
                              <>
                                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 4px' }}>🖼️ ฉากภาพ ({scenes.length}) · ลากเพื่อสลับลำดับ</div>
                                <div className="scenes">
                                  {scenes.map((s, i) => (
                                    <div
                                      className="scene-item"
                                      key={i}
                                      draggable
                                      onDragStart={() => { dragIdx.current = i; }}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={(e) => { e.preventDefault(); reorderScenes(h.id, scenes, dragIdx.current, i); }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {s.path ? (
                                        <a href={s.path} target="_blank" rel="noreferrer" title={s.prompt} draggable={false}>
                                          <img src={s.path} alt={'ฉาก ' + s.n} loading="lazy" draggable={false} />
                                          <span className="num">{s.n}</span>
                                        </a>
                                      ) : (
                                        <div className="miss">ฉาก {s.n} ✗</div>
                                      )}
                                      <button className="ab scene-regen" title="สร้างภาพฉากนี้ใหม่" disabled={proc} onClick={() => doScene(h.id, i, s.prompt)}>🔄</button>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {player && <StoryPlayer story={player} onClose={() => setPlayer(null)} />}
      {showConfig && <ConfigDialog onClose={() => setShowConfig(false)} />}

      {alertErr && alertErr.id !== dismissedId && (
        <div className="modal-overlay" onClick={() => setDismissedId(alertErr.id)}>
          <div className="player" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="player-head">
              <div className="t" style={{ color: '#fca5a5' }}>⚠️ ตัวสร้างแบบ Local / SUT ใช้งานไม่ได้</div>
              <button className="ab" onClick={() => setDismissedId(alertErr.id)}>✕</button>
            </div>
            <p className="sub" style={{ marginTop: 0 }}>
              มีเรื่องที่สร้างไม่สำเร็จ เพราะ provider แบบ Local/SUT มีปัญหา (เช่น SUT เต็มโควต้ารายวัน หรือ Edge TTS ใช้ไม่ได้)
            </p>
            <div style={{ background: '#0b1324', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12, color: '#fca5a5', whiteSpace: 'pre-wrap', maxHeight: 130, overflow: 'auto' }}>
              {String(alertErr.msg).slice(0, 400)}
            </div>
            <p className="hint">เปลี่ยน provider เป็น Gemini (API key) ได้ที่ ⚙️ ตั้งค่า แล้วกด ↻ หรือ 🔊/🎬 เพื่อสร้างใหม่</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="go" style={{ marginTop: 0 }} onClick={() => { setShowConfig(true); setDismissedId(alertErr.id); }}>⚙️ ไปที่ตั้งค่า</button>
              <button className="cfgbtn" onClick={() => setDismissedId(alertErr.id)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
