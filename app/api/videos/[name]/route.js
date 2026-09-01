import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { VIDEO_DIR } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * สตรีมไฟล์วิดีโอ พร้อมรองรับ HTTP Range
 * (จำเป็นสำหรับการเลื่อนดูกลางเรื่อง — ถ้าไม่มี เบราว์เซอร์จะเล่นได้แต่เลื่อนไม่ได้)
 */
export async function GET(req, { params }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  // กันการอ่านไฟล์นอกโฟลเดอร์ที่อนุญาต (path traversal)
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) {
    return new Response('ชื่อไฟล์ไม่ถูกต้อง', { status: 400 });
  }
  const low = decoded.toLowerCase();
  const isSrt = low.endsWith('.srt');
  const isImg = low.endsWith('.jpg') || low.endsWith('.jpeg') || low.endsWith('.png');
  if (!low.endsWith('.mp4') && !isSrt && !isImg) {
    return new Response('รองรับเฉพาะไฟล์ .mp4 .srt และรูปภาพ', { status: 400 });
  }

  const full = path.join(VIDEO_DIR, decoded);
  let st;
  try {
    st = await stat(full);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    return new Response('ไม่พบวิดีโอ', { status: 404 });
  }

  const size = st.size;
  const range = req.headers.get('range');
  const baseHeaders = {
    'Content-Type': isSrt ? 'text/plain; charset=utf-8'
      : isImg ? (low.endsWith('.png') ? 'image/png' : 'image/jpeg')
      : 'video/mp4',
    'Accept-Ranges': 'bytes',
    // ปกสร้างทับได้บ่อย จึงต้องตรวจกับเซิร์ฟเวอร์ทุกครั้ง
    'Cache-Control': isImg ? 'no-cache, must-revalidate' : 'public, max-age=3600',
  };

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response('ช่วงข้อมูลไม่ถูกต้อง', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }
      end = Math.min(end, size - 1);
      return new Response(createReadStream(full, { start, end }), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }

  return new Response(createReadStream(full), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  });
}
