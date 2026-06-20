'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Slideshow synced to the narration audio: scenes split into equal time segments
// across the audio duration — looks like a video, but it's just images + audio.
export default function StoryPlayer({ story, onClose }) {
  const scenes = useMemo(() => {
    let s = story.scenes;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = []; } }
    return (s || []).filter((x) => x && x.path);
  }, [story]);

  const audioRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [anim, setAnim] = useState('fade');

  // pick a random transition each time the scene changes
  useEffect(() => {
    const TRANSITIONS = ['fade', 'zoomIn', 'zoomOut', 'blur', 'kenburns'];
    setAnim(TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)]);
  }, [idx]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const a = audioRef.current;
    if (a) a.play().then(() => setPlaying(true)).catch(() => {});
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seg = dur && scenes.length ? dur / scenes.length : 0;

  function onTime() {
    const a = audioRef.current;
    if (!a || !scenes.length) return;
    const d = a.duration || dur;
    if (!d) return;
    const s = d / scenes.length;
    let i = Math.floor(a.currentTime / s);
    if (i >= scenes.length) i = scenes.length - 1;
    if (i < 0) i = 0;
    setIdx(i);
    setCur(a.currentTime);
  }

  function seekToScene(i) {
    const a = audioRef.current;
    if (!a || !seg) return;
    a.currentTime = i * seg + 0.01;
    setIdx(i);
    a.play().then(() => setPlaying(true)).catch(() => {});
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {});
    else { a.pause(); setPlaying(false); }
  }

  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  const fmt = (t) => {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="player" onClick={(e) => e.stopPropagation()}>
        <div className="player-head">
          <div className="t">{story.title || story.topic || ('เรื่อง #' + story.id)}</div>
          <button className="ab" onClick={onClose}>✕</button>
        </div>

        <div className="player-stage" onClick={togglePlay} style={{ aspectRatio: (story.aspect_ratio || '16:9').replace(':', '/') }}>
          {scenes.length > 0 ? (
            <img key={idx} className={'tr-' + anim} src={scenes[idx]?.path} alt={'ฉาก ' + (idx + 1)} />
          ) : (
            <div className="miss" style={{ aspectRatio: 'auto', height: '100%' }}>ไม่มีฉากภาพ</div>
          )}
          {!playing && <div className="play-overlay">▶</div>}
          <div className="player-cap">ฉาก {idx + 1}/{scenes.length}</div>
        </div>

        {/* progress with scene segment markers */}
        <div className="player-bar">
          <div className="pb-fill" style={{ width: pct + '%' }} />
          {scenes.map((_, i) => (
            <div key={i} className="pb-mark" style={{ left: (scenes.length ? (i / scenes.length) * 100 : 0) + '%' }} />
          ))}
        </div>
        <div className="player-ctrl">
          <button className="ab" onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
          <span className="time">{fmt(cur)} / {fmt(dur)}</span>
        </div>

        <audio
          ref={audioRef}
          src={story.audio_path}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
          onTimeUpdate={onTime}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          style={{ width: '100%', marginTop: 8 }}
          controls
        />

        <div className="filmstrip">
          {scenes.map((s, i) => (
            <img
              key={i}
              src={s.path}
              alt={'ฉาก ' + (i + 1)}
              className={i === idx ? 'active' : ''}
              onClick={() => seekToScene(i)}
              loading="lazy"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
