// Shared by the site (src/images/index.ts) and the sync tool (scripts/img.ts).

// Originals keep their EXIF, GPS included, so only the variants bucket is ever public.
export const IMAGE_ORIGIN = 'https://img.tokkyo13.net';
export const VARIANTS_BUCKET = 'random-thoughts-images';
export const ORIGINALS_BUCKET = 'random-thoughts-images-origin';

// Names are "<type>-<first NAME_HASH hex digits of the MD5>". A name never points at other
// bytes, which is what makes the immutable cache header safe.
export const NAME_HASH = 8;

// Changing the format renames every variant; "npm run img apply" then regenerates them.
export const variantKey = (key: string, width: number) => `${key}.${width}w.avif`;

type AreaSpec = {
  perItem: boolean; // one directory per item ("journal/<id>/") or one flat directory ("home/")
  // Variant widths per type. A new file whose name starts with no type gets the first one.
  // Editing a list affects only images uploaded afterwards.
  types: Record<string, number[]>;
};

// A perItem area also needs an entry in ITEM_SOURCES in scripts/img.ts.
export const AREAS: Record<string, AreaSpec> = {
  journal: {
    perItem: true,
    types: {
      figure: [448, 896, 1792], // prose column stops at 56rem = 896px
      cover: [320, 640], // list thumbnail is 16rem wide, full width on phones
    },
  },
  works: { perItem: true, types: { cover: [480, 960] } },
  home: { perItem: false, types: { cover: [640, 1024, 1600] } },
};

export type ImageEntry = {
  ext: string;
  width: number;
  height: number;
  size: number;
  md5: string;
  variants: number[];
};

export type Manifest = {
  images: Record<string, ImageEntry>; // keyed by "<dir>/<name>", without extension
};
