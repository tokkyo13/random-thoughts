// Syncs r2-clone/ with R2 and keeps content/image/manifest.json in step. See README.md.
// plan and apply never delete. gc runs only when in sync, and deletes only after a typed
// confirmation in an interactive terminal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { AwsClient } from 'aws4fetch';
import sharp from 'sharp';
import { AREAS, BUCKET, NAME_HASH, SHARE_WIDTH, shareKey, variantKey, type Manifest } from '../src/images/config.ts';
import {
  collectRefs, objectKeys, planCovers, planGc, planStrays, planSync, splitKey, variantWidths, writeNames,
  type CoverCopy, type Items, type LocalFile, type SyncPlan,
} from './img-plan.ts';

const ROOT = 'r2-clone';
const MANIFEST = 'content/image/manifest.json';
const CREDENTIALS = 'creds/r2.env';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

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
  const call = async (method: string, key: string, init: RequestInit = {}) => {
    const res = await client.fetch(`${endpoint}/${BUCKET}/${key}`, { method, ...init });
    if (!res.ok) throw new Error(`${method} ${BUCKET}/${key}: ${res.status} ${await res.text()}`);
    return res;
  };
  return {
    /** Every object key in the bucket, with its size. */
    list: async () => {
      const objects = new Map<string, number>();
      let token = '';
      do {
        const query = new URLSearchParams({ 'list-type': '2', ...(token && { 'continuation-token': token }) });
        const xml = await (await call('GET', `?${query}`)).text();
        for (const [, key, size] of xml.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g)) {
          objects.set(key, Number(size));
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? '') : '';
      } while (token);
      return objects;
    },
    put: (key: string, body: Buffer, type: string) =>
      call('PUT', key, { body, headers: { 'Content-Type': type, 'Cache-Control': CACHE_CONTROL } }),
    get: async (key: string) => Buffer.from(await (await call('GET', key)).arrayBuffer()),
    delete: (key: string) => call('DELETE', key),
  };
}

function saveManifest(m: Manifest) {
  const images = Object.fromEntries(Object.entries(m.images).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(MANIFEST, JSON.stringify({ images }, null, 2) + '\n');
}

const md5 = (buf: Buffer) => crypto.createHash('md5').update(buf).digest('hex');

// sharp drops all metadata (EXIF, GPS) from what it writes.
const avif = (buf: Buffer, width: number) => sharp(buf).rotate().resize({ width }).avif({ quality: 50 }).toBuffer();

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
        md5: md5(buf),
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

async function printSync(plan: SyncPlan, covers: CoverCopy[]) {
  const lines = new Map<string, string[]>();
  const add = (dir: string, line: string) => lines.set(dir, [...(lines.get(dir) ?? []), line]);
  for (const [sign, list] of [['+', plan.uploads], ['*', plan.repairs]] as const) {
    for (const u of list) {
      const { width } = await orientedSize(fs.readFileSync(path.join(ROOT, u.dir, u.from)));
      const n = variantWidths(u.dir, u.stem.split('-')[0], width).length;
      const action = `${sign === '+' ? 'upload' : 'repair'} + ${n} variant${n > 1 ? 's' : ''}`;
      const renamed = u.from === `${u.stem}.avif` ? '' : `  <- ${u.from}`;
      add(u.dir, `  ${sign} ${u.stem.padEnd(NAME_COL)}  ${action.padEnd(20)}${renamed}`);
    }
  }
  for (const d of plan.downloads) {
    const [dir, stem] = splitKey(d.key);
    add(dir, `  < ${stem.padEnd(NAME_COL)}  download`);
  }
  for (const c of covers) {
    const stem = c.to.slice(0, c.to.lastIndexOf('.'));
    add(c.dir, `  + ${stem.padEnd(NAME_COL)}  ${'copy of the first image'.padEnd(20)}  <- ${c.from}`);
  }
  for (const dir of [...lines.keys()].sort()) console.log(`\n${dir}\n${lines.get(dir)!.join('\n')}`);
  for (const w of plan.warnings) console.log(`\n! ${w}`);
  for (const e of plan.errors) console.log(`\nx ${e}`);
  const counts = `${plan.uploads.length} to upload, ${plan.downloads.length} to download, ${plan.repairs.length} to repair, ${covers.length} cover(s) to copy`;
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
  let plan = planSync(local, manifest, remote);
  const covers = planCovers(local, plan, manifest);

  if (command === 'gc') return gc(bucket, manifest, plan, remote);

  await printSync(plan, covers);
  if (plan.errors.length > 0) fail('\nFix the errors above first.');
  if (command === 'plan') return;
  const work = plan.uploads.length + plan.repairs.length + plan.downloads.length + covers.length;
  if (work === 0) return console.log('Nothing to do.');
  if ((await ask('\nApply? [y/N] ')).toLowerCase() !== 'y') fail('Cancelled.');

  // The copies come first, and the plan is made again: from there a cover is an ordinary new
  // file, and gets the widths and the share JPEG its name asks for.
  if (covers.length > 0) {
    for (const c of covers) {
      fs.copyFileSync(path.join(ROOT, c.dir, c.from), path.join(ROOT, c.dir, c.to));
      console.log(`copied ${c.dir}/${c.to}`);
    }
    plan = planSync(scanLocal(), manifest, remote);
  }

  // An upload makes every variant from the dropped-in file and keeps the largest in r2-clone/;
  // the dropped-in file stays until gc. A repair makes them again from that largest one.
  for (const u of [...plan.uploads, ...plan.repairs]) {
    const key = `${u.dir}/${u.stem}`;
    const recorded = manifest.images[key];
    const buf = fs.readFileSync(path.join(ROOT, u.dir, u.from));
    const variants = variantWidths(u.dir, u.stem.split('-')[0], (await orientedSize(buf)).width);
    const top = variants.at(-1)!;
    const largest = recorded ? buf : await avif(buf, top);
    for (const w of variants) {
      await bucket.put(variantKey(key, w), w === top ? largest : await avif(buf, w), 'image/avif');
    }
    const share = shareKey(key);
    if (share) {
      const jpeg = await sharp(buf).rotate().resize({ width: Math.min(SHARE_WIDTH, top) }).jpeg({ quality: 78 }).toBuffer();
      await bucket.put(share, jpeg, 'image/jpeg');
    }
    if (!recorded) {
      const to = path.join(ROOT, u.dir, `${u.stem}.avif`);
      if (fs.existsSync(to)) throw new Error(`${to} already exists`);
      fs.writeFileSync(to, largest);
    }
    const { width, height } = await sharp(largest).metadata();
    const source = recorded?.source ?? u.md5;
    manifest.images[key] = { width: width!, height: height!, size: largest.length, md5: md5(largest), source, variants };
    saveManifest(manifest); // after every image, so an interrupted run loses nothing
    console.log(`uploaded ${key}`);
  }
  for (const d of plan.downloads) {
    const to = path.join(ROOT, `${d.key}.avif`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, await bucket.get(variantKey(d.key, d.entry.variants.at(-1)!)));
    console.log(`downloaded ${d.key}`);
  }
  for (const [dir, names] of plan.order) {
    if (dir.startsWith(`${WRITE_BACK_AREA}/`)) writeBack(splitKey(dir)[1], names);
  }
  console.log('\nDone. Commit the manifest together with the articles that use the images.');
}

// An art entry lists its images in the order it shows them, so the tool fills that list in.
// Other areas name their images by hand, where a page needs one.
const WRITE_BACK_AREA = 'art';

function writeBack(id: string, names: string[]) {
  const file = `content/${WRITE_BACK_AREA}/${id}.mdx`;
  if (!fs.existsSync(file)) return console.log(`! ${file} does not exist; nothing to write the names into`);
  const { text, added, problem } = writeNames(read(file), names);
  if (added.length > 0) {
    fs.writeFileSync(file, text);
    console.log(`wrote ${added.length} name(s) into ${file}`);
  }
  if (problem) console.log(`! ${file} ${problem}; add by hand: ${names.join(', ')}`);
}

// For each perItem area in AREAS: item id -> the text to search for image names.
const mdxItems = (area: string) => () =>
  new Map(
    fs.readdirSync(`content/${area}`)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => [f.slice(0, -'.mdx'.length), read(`content/${area}/${f}`)]),
  );

const ITEM_SOURCES: Record<string, () => Map<string, string>> = {
  journal: mdxItems('journal'),
  art: mdxItems('art'),
  work: () =>
    new Map((JSON.parse(read('content/work/work.json')) as { id: number }[]).map((w) => [String(w.id), JSON.stringify(w)])),
};
async function gc(bucket: ReturnType<typeof r2>, manifest: Manifest, plan: SyncPlan, remote: Map<string, number>) {
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
  const sources = ['src', 'content']
    .flatMap((dir) => (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => path.join(dir, f)))
    .map((f) => f.split(path.sep).join('/'))
    // The manifest lists every key and would keep everything alive.
    .filter((f) => /\.(astro|ts|tsx|js|mjs|md|mdx|json)$/.test(f) && f !== MANIFEST && fs.statSync(f).isFile())
    .map(read);
  const deletions = planGc(manifest, collectRefs(items, sources), items);
  const strays = planStrays(manifest, remote);
  const imported = plan.imported.map((f) => `${f.dir}/${f.name}`);
  if (deletions.length + strays.length + imported.length === 0) return console.log('Nothing to delete.');

  const groups = new Map<string, string[]>();
  let objects = 0;
  for (const { key, reason } of deletions) {
    const entry = manifest.images[key];
    const [dir, stem] = splitKey(key);
    const n = entry.variants.length;
    objects += objectKeys(key, entry).length;
    const group = `${dir}  (${reason})`;
    groups.set(group, [...(groups.get(group) ?? []), `  - ${stem.padEnd(NAME_COL)}  ${n} variant${n > 1 ? 's' : ''}`]);
  }
  for (const [group, lines] of groups) console.log(`\n${group}\n${lines.join('\n')}`);
  if (strays.length > 0) {
    console.log(`\nR2 only  (no image claims them)\n${strays.map((k) => `  - ${k}`).join('\n')}`);
  }
  if (imported.length > 0) {
    console.log(`\n${ROOT}/ only  (already made into AVIF)\n${imported.map((f) => `  - ${f}`).join('\n')}`);
  }
  const counts = [
    `${deletions.length} image(s) (${objects} objects) to delete from R2 and ${ROOT}/`,
    ...(strays.length > 0 ? [`${strays.length} object(s) to delete from R2`] : []),
    ...(imported.length > 0 ? [`${imported.length} file(s) to delete from ${ROOT}/`] : []),
  ];
  console.log(`\nPlan: ${counts.join(', ')}.`);

  const expected = `delete ${deletions.length + strays.length + imported.length}`;
  if ((await ask(`Type "${expected}" to confirm: `)) !== expected) fail('Cancelled; nothing was deleted.');

  for (const { key } of deletions) {
    const entry = manifest.images[key];
    // If interrupted, the next apply makes the objects again from the AVIF in r2-clone/
    // (still present), so nothing is lost; run gc again.
    for (const k of objectKeys(key, entry)) await bucket.delete(k);
    fs.rmSync(path.join(ROOT, `${key}.avif`), { force: true });
    delete manifest.images[key];
    saveManifest(manifest);
    console.log(`deleted ${key}`);
  }
  for (const key of strays) {
    await bucket.delete(key);
    console.log(`deleted ${key}`);
  }
  for (const f of imported) {
    fs.rmSync(path.join(ROOT, f));
    console.log(`deleted ${ROOT}/${f}`);
  }
}

main().catch((e) => fail(String(e?.stack ?? e)));
