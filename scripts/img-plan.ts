// Planning logic for img.ts, kept free of I/O so img-plan.test.ts can check every rule.
import { AREAS, NAME_HASH, variantKey, type ImageEntry, type Manifest } from '../src/images/config.ts';

const EXT_ALIASES: Record<string, string> = { jpeg: 'jpg', tiff: 'tif' };
const EXTS = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'tif']);

const TYPES = [...new Set(Object.values(AREAS).flatMap((a) => Object.keys(a.types)))].join('|');
const DIRS = Object.entries(AREAS).map(([name, a]) => (a.perItem ? `${name}/\\d{10}` : name)).join('|');
const HASH = `[0-9a-f]{${NAME_HASH}}`;
const IMAGE_NAME = new RegExp(`\\b(?:${TYPES})-${HASH}\\b`, 'g');
const FULL_KEY = new RegExp(`\\b(?:${DIRS})/(?:${TYPES})-${HASH}\\b`, 'g');

export type LocalFile = { dir: string; name: string; md5: string; size: number };
export type Upload = { dir: string; from: string; stem: string; ext: string; md5: string; size: number };
export type Download = { key: string; entry: ImageEntry };

export type SyncPlan = {
  uploads: Upload[]; // not in the manifest
  repairs: Upload[]; // in the manifest, objects missing on R2
  downloads: Download[]; // in the manifest, missing in r2-clone/
  warnings: string[];
  errors: string[];
};

export type Deletion = { key: string; reason: string };

/** Per-item area -> item id -> the item's text (an article's source, a works entry as JSON). */
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

export function variantWidths(dir: string, type: string, width: number): number[] {
  const fits = (AREAS[areaOf(dir)!].types[type] ?? []).filter((w) => w <= width);
  return fits.length > 0 ? fits : [width];
}

/** The original first, then the variants. */
export function objectKeys(key: string, entry: ImageEntry): string[] {
  return [`${key}.${entry.ext}`, ...entry.variants.map((w) => variantKey(key, w))];
}

function normalizeExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return EXT_ALIASES[ext] ?? ext;
}

export function planSync(local: LocalFile[], manifest: Manifest, remote: Map<string, number>): SyncPlan {
  const plan: SyncPlan = { uploads: [], repairs: [], downloads: [], warnings: [], errors: [] };
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
    // A file in the manifest keeps its recorded name, even an old-style one. Any other file is
    // named after its content, under the type its name starts with, else the area's first type.
    const named = file.name.slice(0, file.name.lastIndexOf('.'));
    const types = typesOf(file.dir);
    const type = types.find((t) => file.name.toLowerCase().startsWith(t)) ?? types[0];
    const stem = manifest.images[`${file.dir}/${named}`]?.md5 === file.md5 ? named : `${type}-${file.md5.slice(0, NAME_HASH)}`;
    const key = `${file.dir}/${stem}`;
    if (localByKey.has(key)) {
      plan.errors.push(`${key}  same content as another file here, remove one  <- ${file.name}`);
      continue;
    }
    localByKey.set(key, file);
    const entry = manifest.images[key];
    if (!entry) {
      plan.uploads.push({ dir: file.dir, from: file.name, stem, ext, md5: file.md5, size: file.size });
    } else if (entry.md5 !== file.md5) {
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
    const original = keys[0];
    if (remote.has(original) && remote.get(original) !== entry.size) {
      plan.errors.push(`${key}  size on R2 does not match src/images/manifest.json`);
    } else if (missing.length > 0) {
      if (file && file.md5 === entry.md5) {
        const [dir, stem] = splitKey(key);
        plan.repairs.push({ dir, from: file.name, stem, ext: entry.ext, md5: file.md5, size: file.size });
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
  if (unknown.length > 0) plan.warnings.push(`${unknown.length} object(s) on R2 not in src/images/manifest.json, left as is`);

  return plan;
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
