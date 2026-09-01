// Backfill the WebP variants (_thumb / _med) for scene PNGs that predate them.
//
//   node scripts-gen-thumbs.mjs           # every story missing variants
//   node scripts-gen-thumbs.mjs 41 79     # only these story ids
//   node scripts-gen-thumbs.mjs --force   # rebuild even if variants exist
//
// New stories get their variants automatically in lib/scenes.js — this is only
// for images generated before that hook existed. Safe to re-run: it skips work
// that is already done unless --force.
//
// Standalone scripts can't import from lib/ (extensionless imports only Next
// resolves), so the variant table is inlined here. Keep it in sync with
// IMAGE_VARIANTS in lib/scenes.js.
import { readdir, stat } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const VARIANTS = [
  { suffix: '_thumb', width: 400, quality: 70 },
  { suffix: '_med', width: 1024, quality: 80 },
];

const SCENES_DIR = path.join(process.cwd(), 'public', 'scenes');
const CONCURRENCY = Number(process.env.THUMB_CONCURRENCY || 4);

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIds = args.filter((a) => /^\d+$/.test(a));

const exists = (f) => stat(f).then(() => true).catch(() => false);

async function collectJobs() {
  let storyDirs;
  try {
    storyDirs = await readdir(SCENES_DIR);
  } catch {
    console.error(`No scenes directory at ${SCENES_DIR}`);
    return [];
  }
  if (onlyIds.length) storyDirs = storyDirs.filter((d) => onlyIds.includes(d));

  const jobs = [];
  for (const dir of storyDirs) {
    const full = path.join(SCENES_DIR, dir);
    if (!(await stat(full).then((s) => s.isDirectory()).catch(() => false))) continue;

    for (const file of await readdir(full).catch(() => [])) {
      if (!file.toLowerCase().endsWith('.png')) continue;
      const png = path.join(full, file);
      for (const v of VARIANTS) {
        const out = png.replace(/\.png$/i, `${v.suffix}.webp`);
        if (force || !(await exists(out))) jobs.push({ png, out, ...v });
      }
    }
  }
  return jobs;
}

async function main() {
  const jobs = await collectJobs();
  if (!jobs.length) {
    console.log('Nothing to do — every scene already has its variants.');
    return;
  }
  console.log(`Building ${jobs.length} variant(s) with concurrency ${CONCURRENCY}...`);

  let done = 0;
  let failed = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        // withoutEnlargement: never upscale a source smaller than the target.
        await sharp(job.png)
          .resize({ width: job.width, withoutEnlargement: true })
          .webp({ quality: job.quality })
          .toFile(job.out);
        bytesIn += (await stat(job.png)).size;
        bytesOut += (await stat(job.out)).size;
      } catch (e) {
        failed++;
        console.error(`  FAILED ${path.relative(process.cwd(), job.png)}${job.suffix}: ${e?.message || e}`);
      }
      if (++done % 50 === 0 || done === jobs.length) {
        console.log(`  ${done}/${jobs.length}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker)
  );

  const mb = (b) => (b / 1024 / 1024).toFixed(1);
  console.log(`\nDone: ${done - failed} built, ${failed} failed.`);
  if (bytesOut) {
    console.log(`Source PNGs read: ${mb(bytesIn)} MB → variants written: ${mb(bytesOut)} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
