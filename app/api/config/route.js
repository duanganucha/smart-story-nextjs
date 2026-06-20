import { NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getConfig());
}

export async function PUT(req) {
  const body = await req.json().catch(() => ({}));
  const cfg = await setConfig(body || {});
  return NextResponse.json(cfg);
}
