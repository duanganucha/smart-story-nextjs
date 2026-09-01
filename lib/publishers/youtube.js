import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

/**
 * อัปโหลดขึ้น YouTube ด้วย Data API v3 (resumable upload)
 *
 * โควตา (ตั้งแต่ มิ.ย. 2026): videos.insert = 1 unit ในกระเป๋าแยก 100 ครั้ง/วัน
 * จึงอัปได้ ~100 คลิป/วัน โดยไม่กินโควตาส่วนอื่น
 *
 * ต้องมีใน .env.local:
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable' +
  '&part=snippet,status';
const CAPTION_URL =
  'https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet';
const THUMB_URL =
  'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=';

export const youtube = {
  configured() {
    const missing = ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN']
      .filter((k) => !process.env[k]);
    return {
      ready: missing.length === 0,
      missing,
      note: 'ต้องสร้าง OAuth client ใน Google Cloud + เปิด YouTube Data API v3',
    };
  },

  /** แลก refresh token เป็น access token (อายุ 1 ชั่วโมง) */
  async token() {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.YT_CLIENT_ID,
        client_secret: process.env.YT_CLIENT_SECRET,
        refresh_token: process.env.YT_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`ขอ token ไม่สำเร็จ: ${d.error_description || d.error}`);
    return d.access_token;
  },

  /**
   * อัปโหลดวิดีโอ + ซับ
   * @param {{videoPath:string, srtPath?:string, snippet:object, status:object}} job
   */
  async upload({ videoPath, srtPath, thumbPath, snippet, status, onProgress }) {
    const access = await this.token();
    const { size } = await stat(videoPath);

    // 1) เปิด session แบบ resumable — ทนต่อเน็ตหลุดกลางคัน
    const init = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({ snippet, status }),
    });
    if (!init.ok) {
      throw new Error(`เปิด session ไม่สำเร็จ: ${(await init.text()).slice(0, 300)}`);
    }
    const sessionUrl = init.headers.get('location');
    if (!sessionUrl) throw new Error('ไม่ได้ URL สำหรับอัปโหลด');

    // 2) ส่งไฟล์
    onProgress?.(10);
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
      body: createReadStream(videoPath),
      duplex: 'half',
    });
    const out = await res.json();
    if (!res.ok) {
      throw new Error(`อัปโหลดไม่สำเร็จ: ${JSON.stringify(out).slice(0, 300)}`);
    }
    onProgress?.(85);

    // 3) ส่งปกคลิป — ถ้าไม่ส่ง YouTube จะสุ่มเฟรมจากวิดีโอให้เอง
    if (thumbPath) {
      try {
        await this.setThumbnail(access, out.id, thumbPath);
      } catch {
        // ปกพลาดไม่ควรทำให้ทั้งงานล้ม — วิดีโอขึ้นแล้ว
      }
    }
    onProgress?.(92);

    // 4) แนบซับ — ทำให้ YouTube แปลอัตโนมัติได้ 100+ ภาษา
    if (srtPath) {
      try {
        await this.uploadCaption(access, out.id, srtPath);
      } catch {
        // ซับพลาดไม่ควรทำให้ทั้งงานล้ม — วิดีโอขึ้นแล้ว
      }
    }
    onProgress?.(100);

    return {
      remote_id: out.id,
      remote_url: `https://youtu.be/${out.id}`,
    };
  },

  /** ส่งปกคลิป (ต้องมี scope youtube.force-ssl) */
  async setThumbnail(access, videoId, thumbPath) {
    const { readFile } = await import('fs/promises');
    const img = await readFile(thumbPath);
    const r = await fetch(THUMB_URL + videoId, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': thumbPath.toLowerCase().endsWith('.png')
          ? 'image/png' : 'image/jpeg',
      },
      body: img,
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  },

  async uploadCaption(access, videoId, srtPath) {
    const srt = await (await import('fs/promises')).readFile(srtPath);
    const meta = JSON.stringify({
      snippet: { videoId, language: 'th', name: 'ไทย', isDraft: false },
    });
    const B = '----bearry' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${B}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      srt,
      Buffer.from(`\r\n--${B}--\r\n`),
    ]);
    const r = await fetch(CAPTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': `multipart/related; boundary=${B}`,
      },
      body,
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  },

  /** YouTube ประมวลผลเสร็จเองหลังอัป — ไม่ต้อง poll */
  async status() {
    return { status: 'done' };
  },
};
