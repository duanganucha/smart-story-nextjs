import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Admin-only (Basic Auth via middleware) endpoint to push a full-resolution
// scene image to the server, replacing any downsized version under
// public/scenes/<id>/<filename>. Used to re-sync the high-quality originals.
//
// multipart/form-data: id=<numeric story id>, filename=scene_NN.png, image=<file>
export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }
  const id = String(form.get('id') || '');
  const filename = String(form.get('filename') || '');
  const file = form.get('image');

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'id must be numeric' }, { status: 400 });
  }
  // Prevent path traversal — only allow scene_<n>[_variant].<ext> file names,
  // where the optional suffix is one of the generated WebP derivatives
  // (scene_01_thumb.webp / scene_01_med.webp).
  if (!/^scene_\d+(_thumb|_med)?\.(png|jpg|jpeg|webp)$/i.test(filename)) {
    return NextResponse.json({ error: 'invalid filename' }, { status: 400 });
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'image file required' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), 'public', 'scenes', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buf);

  return NextResponse.json({ ok: true, id, filename, bytes: buf.length });
}
