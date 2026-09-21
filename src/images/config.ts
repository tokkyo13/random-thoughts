// Shared by the site (src/images/index.ts) and the sync tool (scripts/img.ts).

export const IMAGE_ORIGIN = 'https://img.tokkyo13.net';
export const BUCKET = 'random-thoughts-images';

// Names are "<type>-<first NAME_HASH hex digits of the MD5 of the file it was made from>". A
// name never points at other bytes, which is what makes the immutable cache header safe.
export const NAME_HASH = 8;

// Changing the format renames every variant; "npm run img apply" then regenerates them.
export const variantKey = (key: string, width: number) => `${key}.${width}w.avif`;

// A link preview needs a format every scraper reads, and AVIF is not one. Covers carry one extra
// JPEG for that. Only scrapers ever fetch it, so it is small and costs a reader nothing.
export const SHARE_TYPE = 'cover';
export const SHARE_WIDTH = 640;

/** The share key for a cover, or undefined for any other type. */
export const shareKey = (key: string) =>
  key.slice(key.lastIndexOf('/') + 1).startsWith(`${SHARE_TYPE}-`) ? `${key}.share.jpg` : undefined;

type AreaSpec = {
  perItem: boolean; // one directory per item ("journal/<id>/") or one flat directory ("home/")
  // An item with no cover gets one: "npm run img apply" copies its first image. The list needs
  // a thumbnail and the page a link preview, and both follow from the name being a cover.
  autoCover?: boolean;
  // Variant widths per type. A new file whose name starts with no type gets the first one.
  // The last width caps the image: the largest variant is the image at its own width, up to it,
  // and is also the copy kept in r2-clone/. Editing a list affects only images uploaded afterwards.
  types: Record<string, number[]>;
};

// A perItem area also needs an entry in ITEM_SOURCES in scripts/img.ts.
// 1792 is the most any layout asks for on an ordinary screen: the prose column (56rem) at 2x,
// and the art page's middle on a 1920px screen (about 1330px) at 1x.
export const AREAS: Record<string, AreaSpec> = {
  journal: {
    perItem: true,
    types: {
      figure: [448, 896, 1792], // prose column stops at 56rem = 896px
      cover: [320, 640, 896, 1792], // list thumbnail (16rem, full width on phones) and the article's top
    },
  },
  work: { perItem: true, types: { cover: [480, 960] } },
  // The illustrations, shown at the width of the prose column. art is first, so a file dropped
  // in under any name is one; only the cover has to be named.
  art: { perItem: true, autoCover: true, types: { art: [640, 896, 1792], cover: [640, 896, 1792] } },
  home: { perItem: false, types: { cover: [640, 1024, 1600] } },
};

export type ImageEntry = {
  width: number; // of the largest variant
  height: number;
  size: number; // of the largest variant, the file in r2-clone/
  md5: string; // of the same
  source: string; // MD5 of the file it was made from, which the name is taken from
  variants: number[];
};

export type Manifest = {
  images: Record<string, ImageEntry>; // keyed by "<dir>/<name>", without extension
};
