import manifest from '../../content/image/manifest.json';
import { IMAGE_ORIGIN, shareKey, thumbKey, variantKey, type Manifest } from './config';

const { images } = manifest as Manifest;

/**
 * <img> attributes for a key like "journal/1789084800/figure-a3f91c2b": an entry's area and id,
 * and an image name the entry holds. "npm run img gc" keeps an image while its entry names it.
 * Set loading here, not on the <img>: Astro would emit the attribute twice.
 */
export function image(key: string, loading: 'lazy' | 'eager' = 'lazy') {
  const entry = images[key];
  if (!entry) {
    throw new Error(`Image "${key}" is not in content/image/manifest.json. Run "npm run img apply".`);
  }
  const url = (w: number) => `${IMAGE_ORIGIN}/${variantKey(key, w)}`;
  return {
    src: url(entry.variants.at(-1)!),
    srcset: entry.variants.map((w) => `${url(w)} ${w}w`).join(', '),
    width: entry.width,
    height: entry.height,
    loading,
    decoding: 'async' as const,
  };
}

/** The attributes image() hands a page, for a component that passes them on. */
export type Image = ReturnType<typeof image>;

/**
 * Absolute URL of the JPEG a link preview should show. Undefined unless the key names a cover,
 * since those are the only images that carry one.
 */
export function shareImage(key: string | undefined): string | undefined {
  if (!key || !images[key]) return undefined;
  const share = shareKey(key);
  return share && `${IMAGE_ORIGIN}/${share}`;
}

/** Like image(), but undefined for an empty or unknown key. */
export const optionalImage = (key: string | undefined, loading?: 'lazy' | 'eager') =>
  key && images[key] ? image(key, loading) : undefined;

/**
 * <img> attributes for a cover in a list, from its thumbnails. Undefined for an empty or unknown
 * key, or a cover not yet given thumbnails, so the list shows its empty frame.
 */
export function thumbnail(key: string | undefined) {
  const thumbs = key ? images[key]?.thumbs : undefined;
  if (!thumbs) return undefined;
  const url = (i: number) => `${IMAGE_ORIGIN}/${thumbKey(key!, thumbs[i])}`;
  return {
    src: url(thumbs.length - 1),
    srcset: thumbs.map(([w], i) => `${url(i)} ${w}w`).join(', '),
    width: thumbs[0][0],
    height: thumbs[0][1],
    loading: 'lazy' as const,
    decoding: 'async' as const,
  };
}

// Each mirrors a layout in CSS; the thumb frames in AREAS in ./config mirror the largest of theirs. The page column is 56rem plus two gutters of at most 2.5rem: 61rem.
export const SIZES = {
  prose: '(min-width: 61rem) 56rem, 100vw',
  // A plate main gives the pictures the whole middle: the page less both rails and its gutters
  plate: '(min-width: 85rem) calc(100vw - 34.5rem), (min-width: 61rem) 56rem, 100vw',
  entryThumb: 'min(16rem, 50vw)', // .entry-list: Journal and Work, up to half the row
  artThumb: '(min-width: 61rem) 10.5rem, (min-width: 36rem) 33vw, 50vw', // .art-grid: 5 columns down to 2
};
