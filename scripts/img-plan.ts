// Planning logic for img.ts, kept free of I/O so img-plan.test.ts can check every rule.
import { AREAS, NAME_HASH, SHARE_TYPE, shareKey, variantKey, type ImageEntry, type Manifest } from '../src/images/config.ts';

const EXT_ALIASES: Record<string, string> = { jpeg: 'jpg', tiff: 'tif' };
const EXTS = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'tif']);

const TYPES = [...new Set(Object.values(AREAS).flatMap((a) => Object.keys(a.types)))].join('|');
const DIRS = Object.entries(AREAS).map(([name, a]) => (a.perItem ? `${name}/\\d{10}` : name)).join('|');
const HASH = `[0-9a-f]{${NAME_HASH}}`;
const IMAGE_NAME = new RegExp(`\\b(?:${TYPES})-${HASH}\\b`, 'g');
const FULL_KEY = new RegExp(`\\b(?:${DIRS})/(?:${TYPES})-${HASH}\\b`, 'g');

export type LocalFile = { dir: string; name: string; md5: string; size: number };
// Made from "from": a dropped-in file for an upload, the AVIF in r2-clone/ for a repair.
export type Upload = { dir: string; from: string; stem: string; md5: string };
export type Download = { key: string; entry: ImageEntry };

export type SyncPlan = {
  uploads: Upload[]; // not in the manifest
  repairs: Upload[]; // in the manifest, objects missing on R2
  downloads: Download[]; // in the manifest, missing in r2-clone/
  imported: LocalFile[]; // files an AVIF in r2-clone/ was made from; gc deletes them
  warnings: string[];
  errors: string[];
  // Image directory -> its image names, in the order the local file names sort. It is the
  // order an art entry lists its images in, and the order the first image is picked in.
  order: Map<string, string[]>;
};

/** A cover an autoCover area owes: a copy of the item's first image, under a cover name. */
export type CoverCopy = { dir: string; from: string; to: string };

export type Deletion = { key: string; reason: string };

/** Per-item area -> item id -> the item's text (an article's source, a work entry as JSON). */
export type Items = Record<string, Map<string, string>>;

/** "journal/1789139909/figure-a3f91c2b" -> ["journal/1789139909", "figure-a3f91c2b"] */
export const splitKey = (key: string) => [key.slice(0, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)] as const;

/** "journal/<10 digits>" -> "journal", "home" -> "home"; undefined if not a valid image directory. */
export function areaOf(dir: string): string | undefined {
  const [area, id, ...rest] = dir.split('/');
  const spec = AREAS[area];
  if (!spec || rest.length > 0) return undefined;
  return (spec.perItem ? /^\d{10}$/.test(id ?? '') : id === undefined) ? area : undefined;
}

const typesOf = (dir: string) => Object.keys(AREAS[areaOf(dir)!].types);

/** The listed widths below the largest, then the largest: the image's own width, capped by the last. */
export function variantWidths(dir: string, type: string, width: number): number[] {
  const list = AREAS[areaOf(dir)!].types[type] ?? [];
  const top = list.length > 0 ? Math.min(width, list.at(-1)!) : width;
  return [...list.filter((w) => w < top), top];
}

/** The variants, largest first, then the share JPEG a cover carries. */
export function objectKeys(key: string, entry: ImageEntry): string[] {
  const share = shareKey(key);
  return [...entry.variants.toReversed().map((w) => variantKey(key, w)), ...(share ? [share] : [])];
}

function normalizeExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return EXT_ALIASES[ext] ?? ext;
}

export function planSync(local: LocalFile[], manifest: Manifest, remote: Map<string, number>): SyncPlan {
  const plan: SyncPlan = { uploads: [], repairs: [], downloads: [], imported: [], warnings: [], errors: [], order: new Map() };
  const localByKey = new Map<string, LocalFile>();

  for (const file of [...local].sort((a, b) => `${a.dir}/${a.name}`.localeCompare(`${b.dir}/${b.name}`))) {
    const ext = normalizeExt(file.name);
    if (!areaOf(file.dir)) {
      plan.errors.push(`${file.dir}/  not a valid image directory  <- ${file.name}`);
      continue;
    }
    if (!EXTS.has(ext)) {
      plan.errors.push(`${file.dir}/  unsupported format, use ${[...EXTS].join(' ')}  <- ${file.name}`);
      continue;
    }
    // The AVIF of an image in the manifest keeps its recorded name, even an old-style one. Any
    // other file is named after its content, under the type its name starts with, else the
    // area's first type.
    const named = file.name.slice(0, file.name.lastIndexOf('.'));
    const recorded = ext === 'avif' ? manifest.images[`${file.dir}/${named}`] : undefined;
    if (recorded && recorded.md5 !== file.md5) {
      // Downloading the recorded image would land on this file
      plan.errors.push(`${file.dir}/${named}  edited in place, save the edit under another name  <- ${file.name}`);
      continue;
    }
    const types = typesOf(file.dir);
    const type = types.find((t) => file.name.toLowerCase().startsWith(t)) ?? types[0];
    const stem = recorded ? named : `${type}-${file.md5.slice(0, NAME_HASH)}`;
    const key = `${file.dir}/${stem}`;
    if (!recorded && manifest.images[key]?.source === file.md5) {
      plan.imported.push(file);
      continue;
    }
    if (localByKey.has(key)) {
      plan.errors.push(`${key}  same content as another file here, remove one  <- ${file.name}`);
      continue;
    }
    localByKey.set(key, file);
    plan.order.set(file.dir, [...(plan.order.get(file.dir) ?? []), stem]);
    const entry = manifest.images[key];
    if (!entry) {
      plan.uploads.push({ dir: file.dir, from: file.name, stem, md5: file.md5 });
    } else if (!recorded) {
      // Two MD5s sharing their first NAME_HASH digits. Practically never.
      plan.errors.push(`${key}  name taken by a different image, re-export this one  <- ${file.name}`);
    }
  }

  const known = new Set<string>();
  for (const [key, entry] of Object.entries(manifest.images)) {
    const keys = objectKeys(key, entry);
    keys.forEach((k) => known.add(k));
    const file = localByKey.get(key);
    const missing = keys.filter((k) => !remote.has(k));
    const largest = keys[0];
    if (remote.has(largest) && remote.get(largest) !== entry.size) {
      plan.errors.push(`${key}  size on R2 does not match content/image/manifest.json`);
    } else if (missing.length > 0) {
      if (file) {
        const [dir, stem] = splitKey(key);
        plan.repairs.push({ dir, from: file.name, stem, md5: file.md5 });
      } else {
        plan.errors.push(`${key}  ${missing.length} object(s) missing on R2 and no matching local copy`);
      }
    } else if (!file) {
      plan.downloads.push({ key, entry });
    }
  }

  // Leftovers of an interrupted apply are overwritten by the pending uploads.
  const pendingPrefixes = plan.uploads.map((u) => `${u.dir}/${u.stem}.`);
  const unknown = [...remote.keys()].filter((k) => !known.has(k) && !pendingPrefixes.some((p) => k.startsWith(p)));
  if (unknown.length > 0) {
    plan.warnings.push(`${unknown.length} object(s) on R2 that no image claims; "npm run img gc" deletes them`);
  }
  // In an autoCover area a cover is a copy of an image or named beside them, never alone
  const stemsByDir = new Map(plan.order);
  for (const key of Object.keys(manifest.images)) {
    const [dir, stem] = splitKey(key);
    stemsByDir.set(dir, [...(stemsByDir.get(dir) ?? []), stem]);
  }
  for (const [dir, stems] of stemsByDir) {
    if (AREAS[areaOf(dir)!].autoCover && stems.every((s) => s.startsWith(`${SHARE_TYPE}-`))) {
      plan.errors.push(`${dir}/  a cover alone; add the images it covers, named without "${SHARE_TYPE}"`);
    }
  }
  if (plan.imported.length > 0) {
    plan.warnings.push(`${plan.imported.length} file(s) in r2-clone/ already made into AVIF; "npm run img gc" deletes them`);
  }

  return plan;
}

/**
 * The copies that give every item in an autoCover area a cover. The copy holds the same bytes,
 * so its name follows from the same hash; from there it is an ordinary new file.
 */
export function planCovers(local: LocalFile[], plan: SyncPlan, manifest: Manifest): CoverCopy[] {
  const copies: CoverCopy[] = [];
  for (const [dir, stems] of plan.order) {
    const area = areaOf(dir);
    if (!area || !AREAS[area].autoCover) continue;
    const covered = (s: string) => s.startsWith(`${SHARE_TYPE}-`);
    if (stems.some(covered)) continue;
    if (Object.keys(manifest.images).some((k) => splitKey(k)[0] === dir && covered(splitKey(k)[1]))) continue;
    // The same order the names are listed in, so the cover is the image the page opens with.
    // Only the files planSync accepted count, so an unsupported one cannot become the cover.
    const first = local
      .filter((f) => f.dir === dir && EXTS.has(normalizeExt(f.name)))
      .sort((x, y) => x.name.localeCompare(y.name))[0];
    copies.push({ dir, from: first.name, to: `${SHARE_TYPE}-${first.md5.slice(0, NAME_HASH)}.${normalizeExt(first.name)}` });
  }
  return copies;
}

/** The result of writing names into an entry: the text to save, and what got in. */
export type WriteResult = { text: string; added: string[]; problem?: string };

/**
 * An entry's frontmatter with its image names written in: an empty "cover:" gets the cover, and
 * "images:" gains every name it does not list yet, in the order given. It never reorders and
 * never removes, so an edited list survives; to drop an image, delete its line and run gc.
 * A shape it cannot extend is left alone and reported.
 */
export function writeNames(text: string, names: string[]): WriteResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const end = lines.indexOf('---', 1); // the frontmatter ends here; the body is never touched
  if (lines[0] !== '---' || end < 0) return { text, added: [], problem: 'has no frontmatter' };
  const added: string[] = [];

  const cover = names.find((n) => n.startsWith(`${SHARE_TYPE}-`));
  const coverAt = lines.findIndex((l, i) => i > 0 && i < end && /^cover:\s*(''|""|)\s*$/.test(l));
  if (cover && coverAt > 0) {
    lines[coverAt] = `cover: '${cover}'`;
    added.push(cover);
  }

  const done = () => ({ text: added.length > 0 ? lines.join(eol) : text, added });
  const pending = names.filter((n) => n !== cover && !text.includes(n));
  if (pending.length === 0) return done();

  // Both an empty list and the head of a block list; a list written any other way is left alone
  const at = lines.findIndex((l, i) => i > 0 && i < end && /^images:\s*(\[\s*\])?\s*$/.test(l));
  if (at < 0) return { ...done(), problem: 'has no "images:" list this tool can extend' };

  let last = at;
  while (last + 1 < end && /^\s+- /.test(lines[last + 1])) last++;
  lines.splice(at, 1, 'images:');
  lines.splice(last + 1, 0, ...pending.map((n) => `  - ${n}`));
  added.push(...pending);
  return { text: lines.join(eol), added };
}

/**
 * A bare name counts for its own item's directory; a full key counts anywhere. Any occurrence
 * counts, even in a comment, so a mistake keeps an image rather than deleting one.
 * A key built at runtime ("home/cover-" + n) is invisible here.
 */
export function collectRefs(items: Items, sources: string[]): Set<string> {
  const refs = new Set<string>();
  for (const [area, byId] of Object.entries(items)) {
    for (const [id, text] of byId) {
      for (const name of text.match(IMAGE_NAME) ?? []) refs.add(`${area}/${id}/${name}`);
    }
  }
  for (const text of [...sources, ...Object.values(items).flatMap((m) => [...m.values()])]) {
    for (const key of text.match(FULL_KEY) ?? []) refs.add(key);
  }
  return refs;
}

/**
 * Objects in the bucket that no image in the manifest claims: what a width list or a format
 * that changed leaves behind. They are unreachable from any page, and gc deletes them.
 */
export function planStrays(manifest: Manifest, remote: Map<string, number>): string[] {
  const claimed = new Set(Object.entries(manifest.images).flatMap(([key, entry]) => objectKeys(key, entry)));
  return [...remote.keys()].filter((key) => !claimed.has(key)).sort();
}

export function planGc(manifest: Manifest, refs: Set<string>, items: Items): Deletion[] {
  const deletions: Deletion[] = [];
  for (const key of Object.keys(manifest.images).sort()) {
    if (refs.has(key)) continue;
    const [area, id] = key.split('/');
    const itemMissing = AREAS[area]?.perItem && !items[area]?.has(id);
    deletions.push({ key, reason: itemMissing ? 'item missing' : 'unreferenced' });
  }
  return deletions;
}
