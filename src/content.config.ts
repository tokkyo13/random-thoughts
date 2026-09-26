import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// An image name such as "cover-a3f91c2b". Not checked against the manifest, so an entry can be
// written before its image exists; an empty or unknown name shows an empty frame.
const imageName = z.string();

// The file name (unix seconds) is the id, the URL and the image directory.
const journal = defineCollection({
  loader: glob({ base: './content/journal', pattern: '*.mdx' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    cover: imageName.optional(),
    draft: z.boolean().default(false),
    // strict, so a misspelt key fails the build instead of being dropped in silence
  }).strict(),
});

// Array order is display order.
const work = defineCollection({
  loader: file('content/work/work.json'),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    url: z.url(),
    cover: imageName.optional(),
  }),
});

// One illustration per file, laid out like an article: the body is the description, and it is
// the only optional part. The file name (unix seconds) is the id, the URL and the image directory.
const art = defineCollection({
  loader: glob({ base: './content/art', pattern: '*.mdx' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    // The thumbnail of the list and the picture a link preview reads. It is a copy of the
    // first image unless one is named; "npm run img apply" makes it.
    cover: imageName,
    // Every image of the entry, shown in this order. The tool appends the names it assigns,
    // so editing this list is what changes the order.
    // Only art: the cover is a copy of one of them or named beside them, never one of the set.
    images: z.array(imageName.startsWith('art-', 'an art entry lists art images; the cover goes in "cover"')).default([]),
  }).strict(),
});

// Whoever writes the site: the About page. One file, about.mdx; the body is the introduction.
const about = defineCollection({
  loader: glob({ base: './content/about', pattern: 'about.mdx' }),
  schema: ({ image }) => z.object({
    name: z.string(),
    latin: z.string(), // the reading of name, shown beside it
    avatar: image(),
  }).strict(),
});

// The Link page. The key is the label, and key order is display order. A path stays on this
// site; anything else is an external link.
const link = defineCollection({
  loader: file('content/link/link.json'),
  schema: z.object({
    url: z.union([z.url(), z.string().startsWith('/')]),
  }).strict(),
});

export const collections = { journal, work, art, about, link };
