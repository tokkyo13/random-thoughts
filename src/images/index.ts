import manifest from './manifest.json';
import { IMAGE_ORIGIN, shareKey, variantKey, type Manifest } from './config';

const { images } = manifest as Manifest;

/**
 * <img> attributes for a key like "journal/1789084800/figure-a3f91c2b". Write the key as a
 * whole string literal where possible: "npm run img gc" finds references by searching for it.
 * Set loading here, not on the <img>: Astro would emit the attribute twice.
 */
export function image(key: string, loading: 'lazy' | 'eager' = 'lazy') {
  const entry = images[key];
  if (!entry) {
    throw new Error(`Image "${key}" is not in src/images/manifest.json. Run "npm run img apply".`);
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

/**
 * Absolute URL of the JPEG a link preview should show. Undefined unless the key names a cover,
 * since those are the only images that carry one.
 */
export function shareImage(key: string | undefined): string | undefined {
  if (!key || !images[key]) return undefined;
  const share = shareKey(key);
  return share && `${IMAGE_ORIGIN}/${share}`;
}

/** Like image(), but undefined for an empty or unknown key, so a list shows its empty frame. */
export const optionalImage = (key: string | undefined, loading?: 'lazy' | 'eager') =>
  key && images[key] ? image(key, loading) : undefined;

// Each mirrors a layout in CSS. The page column is 56rem plus two gutters of at most 2.5rem: 61rem.
export const SIZES = {
  prose: '(min-width: 61rem) 56rem, 100vw',
  journalThumb: '(max-width: 32rem) 100vw, 16rem', // stacks below 32rem
  worksThumb: '(min-width: 61rem) 17.5rem, (min-width: 48rem) 33vw, (min-width: 32rem) 50vw, 100vw', // 3, 3, 2, 1 columns
};
