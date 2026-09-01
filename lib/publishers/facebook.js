import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

/**
 * อัปโหลดขึ้นเพจ Facebook ด้วย Graph API v25.0
 *
 * รองรับ 2 แบบ:
 *   - แนวตั้ง → Reels (/video_reels) แบบ 3 ขั้น: start → upload → finish
 *   - แนวนอน → วิดีโอปกติ (/videos)
 *
 * การประกาศว่าเป็นเนื้อหา AI:
 * Meta ไม่มีฟิลด์ API ให้ติ๊กเหมือน YouTube/TikTok — ตรวจจับเองจาก
 * metadata ฝังในไฟล์ (C2PA / IPTC) และ classifier ของตัวเอง
 * เราจึงประกาศด้วยข้อความในคำอธิบายแทน (ทำมาจาก publish-meta แล้ว)
 *
 * ⚠️ ต้องผ่าน App Review ของ Meta ก่อนใช้จริง และต้องได้สิทธิ์:
 *    pages_show_list, pages_read_engagement, pages_manage_posts
 *    ผู้ขอ token ต้องมีสิทธิ์ระดับ ADMIN บนเพจนั้น
 *
 * ต้องมีใน .env.local: FB_PAGE_ID, FB_PAGE_TOKEN
 */
const V = 'v25.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const RUPLOAD = `https://rupload.facebook.com/video-upload/${V}`;

const AI_NOTE = '🤖 ภาพประกอบและเสียงบรรยายสร้างด้วย AI';

/**
 * ประกอบคำอธิบายพร้อมประโยคประกาศ AI
 * Meta ไม่มีฟิลด์ API ให้ประกาศ จึงต้องบอกในข้อความให้ผู้ชมเห็นเอง
 */
function withAiNote(snippet, withTitle = true) {
  const body = snippet.description || '';
  const head = withTitle ? `${snippet.title}\n\n` : '';
  return body.includes(AI_NOTE) ? head + body : `${head}${body}\n\n${AI_NOTE}`;
}

export const facebook = {
  configured() {
    const missing = ['FB_PAGE_ID', 'FB_PAGE_TOKEN'].filter((k) => !process.env[k]);
    return {
      ready: missing.length === 0,
      missing,
      note: 'ต้องผ่าน App Review ของ Meta และมีสิทธิ์ ADMIN บนเพจ',
    };
  },

  async upload({ videoPath, snippet, layout = 'portrait', onProgress }) {
    return layout === 'portrait'
      ? this.uploadReel({ videoPath, snippet, onProgress })
      : this.uploadVideo({ videoPath, snippet, onProgress });
  },

  /** Reels — ต้องทำ 3 ขั้นตามลำดับ */
  async uploadReel({ videoPath, snippet, onProgress }) {
    const page = process.env.FB_PAGE_ID;
    const token = process.env.FB_PAGE_TOKEN;
    const { size } = await stat(videoPath);

    // 1) ขอ video id
    const start = await fetch(`${GRAPH}/${page}/video_reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_phase: 'start', access_token: token }),
    });
    const s = await start.json();
    if (!start.ok || !s.video_id) {
      throw new Error(`เริ่มอัปโหลดไม่สำเร็จ: ${JSON.stringify(s).slice(0, 300)}`);
    }
    onProgress?.(10);

    // 2) ส่งไฟล์ไปที่โดเมนแยก (rupload)
    const up = await fetch(`${RUPLOAD}/${s.video_id}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${token}`,
        offset: '0',
        file_size: String(size),
        'Content-Type': 'application/octet-stream',
      },
      body: createReadStream(videoPath),
      duplex: 'half',
    });
    const u = await up.json();
    if (!up.ok || !u.success) {
      throw new Error(`ส่งไฟล์ไม่สำเร็จ: ${JSON.stringify(u).slice(0, 300)}`);
    }
    onProgress?.(80);

    // 3) สั่งเผยแพร่
    const fin = await fetch(
      `${GRAPH}/${page}/video_reels?` + new URLSearchParams({
        access_token: token,
        video_id: s.video_id,
        upload_phase: 'finish',
        video_state: 'PUBLISHED',
        description: withAiNote(snippet).slice(0, 2200),
      }), { method: 'POST' }
    );
    const f = await fin.json();
    if (!fin.ok || !f.success) {
      throw new Error(`เผยแพร่ไม่สำเร็จ: ${JSON.stringify(f).slice(0, 300)}`);
    }
    onProgress?.(100);

    return {
      remote_id: s.video_id,
      remote_url: `https://www.facebook.com/reel/${s.video_id}`,
      pending: true,   // Facebook ยังประมวลผลต่อสักครู่
    };
  },

  /** วิดีโอปกติบนเพจ */
  async uploadVideo({ videoPath, snippet, onProgress }) {
    const page = process.env.FB_PAGE_ID;
    const token = process.env.FB_PAGE_TOKEN;
    onProgress?.(10);

    const form = new FormData();
    const buf = await (await import('fs/promises')).readFile(videoPath);
    form.append('source', new Blob([buf], { type: 'video/mp4' }), 'video.mp4');
    form.append('title', snippet.title || '');
    form.append('description', withAiNote(snippet, false));
    form.append('access_token', token);

    const r = await fetch(`${GRAPH}/${page}/videos`, { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok || !d.id) {
      throw new Error(`อัปโหลดไม่สำเร็จ: ${JSON.stringify(d).slice(0, 300)}`);
    }
    onProgress?.(100);
    return {
      remote_id: d.id,
      remote_url: `https://www.facebook.com/${d.id}`,
      pending: true,
    };
  },

  /** เช็คสถานะการประมวลผล */
  async status(videoId) {
    const r = await fetch(
      `${GRAPH}/${videoId}?fields=status&access_token=${process.env.FB_PAGE_TOKEN}`
    );
    const d = await r.json();
    const phase = d.status?.video_status;
    if (phase === 'ready') return { status: 'done' };
    if (phase === 'error') return { status: 'error', error: 'Facebook ประมวลผลล้มเหลว' };
    return { status: 'processing' };
  },
};
