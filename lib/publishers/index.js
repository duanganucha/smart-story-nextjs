import { youtube } from './youtube';
import { tiktok } from './tiktok';
import { facebook } from './facebook';

/**
 * ชั้นกลางสำหรับอัปโหลดวิดีโอไปแต่ละแพลตฟอร์ม
 *
 * ทุกตัวมีหน้าตาเหมือนกัน: configured() / upload() / status()
 * ทำให้ UI และคิวไม่ต้องรู้รายละเอียดของแต่ละเจ้า
 */
export const PUBLISHERS = { youtube, tiktok, facebook };

export const PLATFORMS = [
  {
    key: 'youtube',
    label: 'YouTube',
    icon: '▶',
    // แนวนอนเป็นหลัก แต่แนวตั้งขึ้นเป็น Shorts ได้
    layouts: ['landscape', 'portrait'],
    color: '#ff0000',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: '♪',
    layouts: ['portrait'],
    color: '#25f4ee',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: 'f',
    layouts: ['portrait', 'landscape'],
    color: '#1877f2',
  },
];

export function getPublisher(platform) {
  const p = PUBLISHERS[platform];
  if (!p) throw new Error(`ไม่รู้จักแพลตฟอร์ม: ${platform}`);
  return p;
}

/** สถานะการตั้งค่าของทุกแพลตฟอร์ม — ใช้บอก UI ว่าปุ่มไหนกดได้ */
export function platformStatus() {
  return PLATFORMS.map((p) => {
    const pub = PUBLISHERS[p.key];
    const c = pub.configured();
    return { ...p, ready: c.ready, missing: c.missing, note: c.note };
  });
}
