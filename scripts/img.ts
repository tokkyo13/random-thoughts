// Syncs r2-clone/ with R2 and keeps src/images/manifest.json in step. See README.md.
// plan and apply never delete. gc runs only when in sync, and deletes only after a typed
// confirmation in an interactive terminal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { AwsClient } from 'aws4fetch';
import sharp from 'sharp';
import { AREAS, NAME_HASH, ORIGINALS_BUCKET, VARIANTS_BUCKET, variantKey, type Manifest } from '../src/images/config.ts';
import {
  collectRefs, objectKeys, planGc, planSync, splitKey, variantWidths, type Items, type LocalFile, type SyncPlan,
} from './img-plan.ts';

const ROOT = 'r2-clone';
const MANIFEST = 'src/images/manifest.json';
const CREDENTIALS = 'creds/r2.env';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', tif: 'image/tiff',
};

// Column width of an image name: the longest type, plus "-" and the hash.
const NAME_COL = Math.max(...Object.values(AREAS).flatMap((a) => Object.keys(a.types).map((t) => t.length))) + 1 + NAME_HASH;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const read = (f: string) => fs.readFileSync(f, 'utf8');

function r2() {
  try {
    process.loadEnvFile(CREDENTIALS);
  } catch {
    // Missing file is fine if the variables are already in the environment.
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    fail(`Missing R2 credentials. Copy ${CREDENTIALS}.example to ${CREDENTIALS} and fill it in.`);
  }
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const call = async (method: string, bucket: string, key: string, init: RequestInit = {}) => {
    const res = await client.fetch(`${endpoint}/${bucket}/${key}`, { method, ...init });
    if (!res.ok) throw new Error(`${method} ${bucket}/${key}: ${res.status} ${await res.text()}`);
    return res;
  };
  // Keys never collide across buckets: variants end in ".<width>w.avif", originals do not
  // (an original name has no dot before its extension).
  const bucketFor = (key: string) => (/\.\d+w\.avif$/.test(key) ? VARIANTS_BUCKET : ORIGINALS_BUCKET);
  const listBucket = async (bucket: string) => {
    const objects = new Map<string, number>();
    let token = '';
    do {
      const query = new URLSearchParams({ 'list-type': '2', ...(token && { 'continuation-token': token }) });
      const xml = await (await call('GET', bucket, `?${query}`)).text();
      for (const [, key, size] of xml.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g)) {
        objects.set(key, Number(size));
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? '') : '';
    } while (token);
    return objects;
  };
  return {
    /** Every object key in both buckets, with its size. */
    list: async () => new Map([...(await listBucket(ORIGINALS_BUCKET)), ...(await listBucket(VARIANTS_BUCKET))]),
    put: (key: string, body: Buffer, type: string) =>
      call('PUT', bucketFor(key), key, { body, headers: { 'Content-Type': type, 'Cache-Control': CACHE_CONTROL } }),
    get: async (key: string) => Buffer.from(await (await call('GET', bucketFor(key), key)).arrayBuffer()),
    delete: (key: string) => call('DELETE', bucketFor(key), key),
  };
}

function saveManifest(m: Manifest) {
  const images = Object.fromEntries(Object.entries(m.images).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(MANIFEST, JSON.stringify({ images }, null, 2) + '\n');
}

// Hashes every file on every run (about 600 MB/s); cache MD5s by size and mtime if plan gets slow.
function scanLocal(): LocalFile[] {
  return (fs.readdirSync(ROOT, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join('/'))
    // Skips .gitkeep and anything inside a dot directory.
    .filter((rel) => !rel.split('/').some((s) => s.startsWith('.')) && fs.statSync(path.join(ROOT, rel)).isFile())
    .map((rel) => {
      const buf = fs.readFileSync(path.join(ROOT, rel));
      const dir = path.posix.dirname(rel);
      return {
        dir: dir === '.' ? '' : dir,
        name: path.posix.basename(rel),
        md5: crypto.createHash('md5').update(buf).digest('hex'),
        size: buf.length,
      };
    });
}

/** Width and height as displayed, after applying the EXIF orientation. */
async function orientedSize(buf: Buffer) {
  const m = await sharp(buf).metadata();
  const swap = (m.orientation ?? 1) >= 5;
  return { width: swap ? m.height! : m.width!, height: swap ? m.width! : m.height! };
}

async function printSync(plan: SyncPlan) {
  const lines = new Map<string, string[]>();
  const add = (dir: string, line: string) => lines.set(dir, [...(lines.get(dir) ?? []), line]);
  for (const [sign, list] of [['+', plan.uploads], ['*', plan.repairs]] as const) {
    for (const u of list) {
      const { width } = await orientedSize(fs.readFileSync(path.join(ROOT, u.dir, u.from)));
      const n = variantWidths(u.dir, u.stem.split('-')[0], width).length;
      const action = `${sign === '+' ? 'upload' : 'repair'} + ${n} variant${n > 1 ? 's' : ''}`;
      const renamed = u.from === `${u.stem}.${u.ext}` ? '' : `  <- ${u.from}`;
      add(u.dir, `  ${sign} ${u.stem.padEnd(NAME_COL)}  ${action.padEnd(20)}${renamed}`);
    }
  }
  for (const d of plan.downloads) {
    const [dir, stem] = splitKey(d.key);
    add(dir, `  < ${stem.padEnd(NAME_COL)}  download`);
  }
  for (const dir of [...lines.keys()].sort()) console.log(`\n${dir}\n${lines.get(dir)!.join('\n')}`);
  for (const w of plan.warnings) console.log(`\n! ${w}`);
  for (const e of plan.errors) console.log(`\nx ${e}`);
  const counts = `${plan.uploads.length} to upload, ${plan.downloads.length} to download, ${plan.repairs.length} to repair`;
  console.log(`\nPlan: ${counts}. ${plan.warnings.length} warning(s), ${plan.errors.length} error(s).`);
}

async function ask(question: string) {
  if (!process.stdin.isTTY) fail('Not an interactive terminal; nothing was changed.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  const command = process.argv[2];
  if (!['plan', 'apply', 'gc'].includes(command)) fail('usage: npm run img plan | apply | gc');

  const bucket = r2();
  const manifest: Manifest = fs.existsSync(MANIFEST) ? JSON.parse(read(MANIFEST)) : { images: {} };
  const local = scanLocal();
  const remote = await bucket.list();
  const plan = planSync(local, manifest, remote);

  if (command === 'gc') return gc(bucket, manifest, plan);

  await printSync(plan);
  if (plan.errors.length > 0) fail('\nFix the errors above first.');
  if (command === 'plan') return;
  if (plan.uploads.length + plan.repairs.length + plan.downloads.length === 0) return console.log('Nothing to do.');
  if ((await ask('\nApply? [y/N] ')).toLowerCase() !== 'y') fail('Cancelled.');

  for (const u of [...plan.uploads, ...plan.repairs]) {
    const from = path.join(ROOT, u.dir, u.from);
    const buf = fs.readFileSync(from);
    const { width, height } = await orientedSize(buf);
    const variants = variantWidths(u.dir, u.stem.split('-')[0], width);
    const key = `${u.dir}/${u.stem}`;
    // Variants first, original last: an original on R2 marks a finished upload.
    // sharp drops all metadata (EXIF, GPS) from the variants.
    for (const w of variants) {
      const avif = await sharp(buf).rotate().resize({ width: w }).avif({ quality: 50 }).toBuffer();
      await bucket.put(variantKey(key, w), avif, 'image/avif');
    }
    await bucket.put(`${key}.${u.ext}`, buf, MIME[u.ext]);
    const to = path.join(ROOT, u.dir, `${u.stem}.${u.ext}`);
    if (from !== to) {
      if (fs.existsSync(to)) throw new Error(`${to} already exists`);
      fs.renameSync(from, to);
    }
    manifest.images[key] = { ext: u.ext, width, height, size: u.size, md5: u.md5, variants };
    saveManifest(manifest); // after every image, so an interrupted run loses nothing
    console.log(`uploaded ${key}`);
  }
  for (const d of plan.downloads) {
    const to = path.join(ROOT, `${d.key}.${d.entry.ext}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, await bucket.get(`${d.key}.${d.entry.ext}`));
    console.log(`downloaded ${d.key}`);
  }
  console.log('\nDone. Commit the manifest together with the articles that use the images.');
}

// For each perItem area in AREAS: item id -> the text to search for image names.
const ITEM_SOURCES: Record<string, () => Map<string, string>> = {
  journal: () =>
    new Map(
      fs.readdirSync('src/content/journal')
        .filter((f) => f.endsWith('.mdx'))
        .map((f) => [f.slice(0, -'.mdx'.length), read(`src/content/journal/${f}`)]),
    ),
  works: () =>
    new Map((JSON.parse(read('src/content/works/works.json')) as { id: number }[]).map((w) => [String(w.id), JSON.stringify(w)])),
};

async function gc(bucket: ReturnType<typeof r2>, manifest: Manifest, plan: SyncPlan) {
  if (plan.errors.length + plan.uploads.length + plan.repairs.length + plan.downloads.length > 0) {
    fail('Local and R2 are not in sync. Run "npm run img apply" first.');
  }

  const items: Items = {};
  for (const [area, spec] of Object.entries(AREAS)) {
    if (!spec.perItem) continue;
    const source = ITEM_SOURCES[area];
    if (!source) fail(`No item source for area "${area}" in scripts/img.ts; cannot tell what is referenced.`);
    items[area] = source();
  }
  const sources = (fs.readdirSync('src', { recursive: true }) as string[])
    .map((f) => path.join('src', f).split(path.sep).join('/'))
    // The manifest lists every key and would keep everything alive.
    .filter((f) => /\.(astro|ts|tsx|js|mjs|md|mdx|json)$/.test(f) && f !== MANIFEST && fs.statSync(f).isFile())
    .map(read);
  const deletions = planGc(manifest, collectRefs(items, sources), items);
  if (deletions.length === 0) return console.log('Nothing to delete.');

  const groups = new Map<string, string[]>();
  let objects = 0;
  for (const { key, reason } of deletions) {
    const entry = manifest.images[key];
    const [dir, stem] = splitKey(key);
    const n = entry.variants.length;
    objects += objectKeys(key, entry).length;
    const group = `${dir}  (${reason})`;
    groups.set(group, [...(groups.get(group) ?? []), `  - ${stem.padEnd(NAME_COL)}  original + ${n} variant${n > 1 ? 's' : ''}`]);
  }
  for (const [group, lines] of groups) console.log(`\n${group}\n${lines.join('\n')}`);
  console.log(`\nPlan: ${deletions.length} image(s) (${objects} objects) to delete from R2 and ${ROOT}/.`);

  const expected = `delete ${deletions.length}`;
  if ((await ask(`Type "${expected}" to confirm: `)) !== expected) fail('Cancelled; nothing was deleted.');

  for (const { key } of deletions) {
    const entry = manifest.images[key];
    // Variants first, original last. If interrupted, the next apply re-uploads the
    // image from r2-clone/ (still present), so nothing is lost; run gc again.
    for (const k of objectKeys(key, entry).reverse()) await bucket.delete(k);
    fs.rmSync(path.join(ROOT, `${key}.${entry.ext}`), { force: true });
    delete manifest.images[key];
    saveManifest(manifest);
    console.log(`deleted ${key}`);
  }
}

main().catch((e) => fail(String(e?.stack ?? e)));
