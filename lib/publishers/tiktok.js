import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

/**
 * อัปโหลดขึ้น TikTok ด้วย Content Posting API (Direct Post)
 *
 * ⚠️ ข้อจำกัดสำคัญที่ต้องรู้ก่อนใช้จริง:
 *  1) ต้องได้ scope `video.publish` — ต้องผ่าน audit ของ TikTok (2-4 สัปดาห์)
 *  2) ก่อนผ่าน audit วิดีโอที่อัปจะเป็น "ส่วนตัว" เท่านั้น เปิดสาธารณะไม่ได้
 *  3) TikTok บังคับว่า UI ต้องแสดงชื่อ+รูปโปรไฟล์ผู้ใช้ก่อนโพสต์ทุกครั้ง
 *     และต้องให้ผู้ใช้เลือกระดับความเป็นส่วนตัวเอง (ตรวจตอน audit)
 *  4) วิดีโอประมวลผลแบบ async — ต้อง poll สถานะ ไม่ได้รู้ผลทันที
 *
 * ต้องมีใน .env.local: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_ACCESS_TOKEN
 */
const API = 'https://open.tiktokapis.com/v2';
const CHUNK = 10 * 1024 * 1024;   // 10 MB ตามที่ TikTok แนะนำ

export const tiktok = {
  configured() {
    const missing = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_ACCESS_TOKEN']
      .filter((k) => !process.env[k]);
    return {
      ready: missing.length === 0,
      missing,
      note: 'ต้องผ่าน audit ของ TikTok (2-4 สัปดาห์) ก่อนโพสต์สาธารณะได้',
    };
  },

  /** ข้อมูลผู้ใช้ — TikTok บังคับให้แสดงก่อนโพสต์ */
  async creatorInfo() {
    const r = await fetch(`${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });
    const d = await r.json();
    if (!r.ok || d.error?.code !== 'ok') {
      throw new Error(`ขอข้อมูลผู้ใช้ไม่สำเร็จ: ${d.error?.message || r.status}`);
    }
    return d.data;   // creator_nickname, creator_avatar_url, privacy_level_options...
  },

  /**
   * @param {{videoPath:string, snippet:object, privacy?:string}} job
   * privacy: PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | SELF_ONLY
   */
  async upload({ videoPath, snippet, privacy = 'SELF_ONLY', onProgress }) {
    const token = process.env.TIKTOK_ACCESS_TOKEN;
    const { size } = await stat(videoPath);
    const chunks = Math.max(1, Math.ceil(size / CHUNK));

    // 1) เริ่มงานโพสต์
    const init = await fetch(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: (snippet.title || '').slice(0, 150),
          privacy_level: privacy,
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          // ประกาศว่าเป็นเนื้อหาที่สร้างด้วย AI (บังคับตามนโยบายปี 2026)
          // TikTok จะติดป้าย "AI-generated" ให้ผู้ชมเห็นอัตโนมัติ
          // ถ้าไม่ประกาศเอง ระบบตรวจจับ C2PA ก็จะติดป้ายให้อยู่ดี และเสียการกระจาย
          is_aigc: true,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: size,
          chunk_size: chunks === 1 ? size : CHUNK,
          total_chunk_count: chunks,
        },
      }),
    });
    const d = await init.json();
    if (!init.ok || d.error?.code !== 'ok') {
      throw new Error(`เริ่มงานไม่สำเร็จ: ${d.error?.message || init.status}`);
    }
    const { publish_id, upload_url } = d.data;
    onProgress?.(10);

    // 2) ส่งไฟล์ทีละก้อน
    for (let i = 0; i < chunks; i++) {
      const start = i * CHUNK;
      const end = Math.min(start + CHUNK, size) - 1;
      const r = await fetch(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
        body: createReadStream(videoPath, { start, end }),
        duplex: 'half',
      });
      if (!r.ok && r.status !== 308) {
        throw new Error(`ส่งไฟล์ก้อนที่ ${i + 1} ล้มเหลว: ${r.status}`);
      }
      onProgress?.(10 + Math.round(((i + 1) / chunks) * 75));
    }

    // TikTok ประมวลผลต่อเอง — ต้อง poll ด้วย status()
    return { remote_id: publish_id, remote_url: null, pending: true };
  },

  /** เช็คว่าประมวลผลเสร็จหรือยัง */
  async status(publishId) {
    const r = await fetch(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const d = await r.json();
    const s = d.data?.status;
    if (s === 'PUBLISH_COMPLETE') {
      return { status: 'done', remote_url: d.data?.public_post_id
        ? `https://www.tiktok.com/video/${d.data.public_post_id}` : null };
    }
    if (s === 'FAILED') {
      return { status: 'error', error: d.data?.fail_reason || 'TikTok ปฏิเสธวิดีโอ' };
    }
    return { status: 'processing' };
  },
};
