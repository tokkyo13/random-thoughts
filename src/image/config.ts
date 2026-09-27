// Shared by the site (src/image/index.ts) and the sync tool (scripts/img.ts).

import site from '../../content/site/site.json' with { type: 'json' };

export const IMAGE_ORIGIN = site.imageOrigin;
export const BUCKET = 'random-thoughts-images';

// Names are "<type>-<first NAME_HASH hex digits of the MD5 of the file it was made from>". A
// name never points at other bytes, which is what makes the immutable cache header safe.
export const NAME_HASH = 8;

// Changing the format renames every variant; "npm run img apply" then regenerates them.
export const variantKey = (key: string, width: number) => `${key}.${width}w.avif`;

// A cover is only ever shown small: in a list, and as a link preview. A list shows it through
// thumbnails, cut from the middle to the ratio of the list's frame. The key carries both sides,
// so a frame of another ratio makes new keys instead of new bytes under old ones.
export const COVER_TYPE = 'cover';
export type Thumb = [width: number, height: number];
export const thumbKey = (key: string, [width, height]: Thumb) => `${key}.${width}x${height}.avif`;

// The frame at 1x, 2x and 3x of its CSS size, one for each common pixel density.
export const THUMB_SCALES = [1, 2, 3];

// A link preview needs a format every scraper reads, and AVIF is not one. Covers carry one extra
// JPEG for that. Only scrapers ever fetch it, so it is small and costs a reader nothing.
export const SHARE_WIDTH = 640;

export const isCover = (key: string) => key.slice(key.lastIndexOf('/') + 1).startsWith(`${COVER_TYPE}-`);

/** The share key for a cover, or undefined for any other type. */
export const shareKey = (key: string) => (isCover(key) ? `${key}.share.jpg` : undefined);

// An area holds one directory per item, "<area>/<id>/", named by the id of its entry.
type AreaSpec = {
  // An item with no cover gets one: "npm run img apply" copies its first image. The list needs
  // a thumbnail and the page a link preview, and both follow from the name being a cover.
  autoCover?: boolean;
  // Variant widths per type. A new file whose name starts with no type gets the first one.
  // The last width caps the image: the largest variant is the image at its own width, up to it,
  // and is also the copy kept in content/image/. "npm run img apply" remakes the smaller
  // variants when a list changes; a new cap applies only to images uploaded afterwards.
  types: Record<string, number[]>;
  // The largest frame, in CSS px, the list shows a cover in; .thumb and SIZES in
  // src/image/index.ts lay it out. A cover made at this ratio is shown whole.
  thumb: Thumb;
};

// A new area also needs an entry in ITEM_SOURCES in scripts/img.ts.
// 1792 is the most any layout asks for on an ordinary screen: the prose column (56rem) at 2x,
// and the middle of an art page (a plate main) on a 1920px screen (about 1370px) at 1x. A cover
// lists only that cap, as the copy its thumbnails and share JPEG are made from.
export const AREAS: Record<string, AreaSpec> = {
  journal: {
    types: {
      figure: [448, 896, 1792], // prose column stops at 56rem = 896px
      cover: [1792],
    },
    thumb: [256, 144], // .entry-list: 16rem at 16:9
  },
  work: { types: { cover: [1792] }, thumb: [256, 144] },
  // The illustrations, shown at the width of the prose column. art is first, so a file dropped
  // in under any name is one; only the cover has to be named.
  art: {
    autoCover: true,
    types: { art: [640, 896, 1792], cover: [1792] },
    thumb: [168, 168], // .art-grid: 10.5rem square
  },
};

export type ImageEntry = {
  width: number; // of the largest variant
  height: number;
  size: number; // of the largest variant, the file in content/image/
  md5: string; // of the same
  source: string; // MD5 of the file it was made from, which the name is taken from
  variants: number[];
  thumbs?: Thumb[]; // covers only
};

export type Manifest = {
  images: Record<string, ImageEntry>; // keyed by "<area>/<id>/<name>", without extension
};
