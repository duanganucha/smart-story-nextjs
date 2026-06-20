'use client';

import { useEffect, useState } from 'react';

const LABELS = {
  engine_story: 'เนื้อเรื่อง + วิเคราะห์ภาพ',
  engine_tts: 'เสียงบรรยาย (TTS)',
  engine_image: 'ฉากภาพประกอบ',
};
const OPTS = {
  engine_story: [
    ['sut', 'Local gen — SUT GenAI'],
    ['gemini', 'API key — Gemini'],
  ],
  engine_tts: [
    ['gemini', 'API key — Gemini (เสียง AI)'],
    ['edge', 'Local — Edge TTS (neural ไทย Premwadee)'],
    ['local', 'Local — เสียงในเครื่อง (macOS Kanya)'],
    ['off', 'ปิด (ไม่สร้างเสียง)'],
  ],
  engine_image: [
    ['sut', 'Local gen — SUT (Nano Banana)'],
    ['gemini', 'API key — Gemini image'],
    ['off', 'ปิด (ไม่สร้างฉาก)'],
  ],
};

export default function ConfigDialog({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg({ engine_story: 'sut', engine_tts: 'gemini', engine_image: 'sut' }));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="player" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="player-head">
          <div className="t">⚙️ ตั้งค่า Provider</div>
          <button className="ab" onClick={() => onClose(false)}>✕</button>
        </div>
        {!cfg ? (
          <p className="sub">กำลังโหลด...</p>
        ) : (
          <>
            <p className="sub" style={{ marginTop: 0 }}>
              เลือกว่าแต่ละส่วนจะใช้ <b style={{ color: '#bae6fd' }}>API key (Gemini)</b> หรือ <b style={{ color: '#fcd34d' }}>Local gen (SUT)</b>
            </p>
            {Object.keys(LABELS).map((k) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <label>{LABELS[k]}</label>
                <select value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}>
                  {OPTS[k].map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            ))}
            <button className="go" disabled={saving} onClick={save}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
            </button>
            <p className="hint">
              มีผลกับเรื่องที่สร้าง/สร้างใหม่หลังจากนี้ · TTS รองรับเฉพาะ Gemini API · ฉากภาพแนะนำ SUT (Gemini image ขึ้นกับสิทธิ์ของ key)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
