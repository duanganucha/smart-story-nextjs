import { NextResponse } from 'next/server';
import { enqueue, queueState, cancelPending, resume } from '@/lib/videoqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LAYOUTS = ['portrait', 'landscape'];

/** ดูสถานะคิว */
export async function GET() {
  // เผื่อเซิร์ฟเวอร์เพิ่งรีสตาร์ท — ทำงานที่ค้างในคิวต่อ
  await resume();
  return NextResponse.json(await queueState());
}

/** สั่งสร้างวิดีโอ — body: { ids: [92, 51], layouts: ['portrait','landscape'] } */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  const layouts = Array.isArray(body.layouts)
    ? body.layouts.filter((l) => LAYOUTS.includes(l))
    : [];

  if (!ids.length) {
    return NextResponse.json({ error: 'ยังไม่ได้เลือกเรื่อง' }, { status: 400 });
  }
  if (!layouts.length) {
    return NextResponse.json({ error: 'ยังไม่ได้เลือกแนววิดีโอ' }, { status: 400 });
  }

  const burn = body.burn !== false;
  const added = await enqueue(ids, layouts, burn);
  return NextResponse.json({ ok: true, added, ...(await queueState()) });
}

/** ยกเลิกงานที่ยังไม่เริ่ม (งานที่กำลังรันอยู่จะทำต่อจนจบ) */
export async function DELETE() {
  const removed = await cancelPending();
  return NextResponse.json({ ok: true, removed, ...(await queueState()) });
}
