import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// An image name such as "cover-a3f91c2b". Not checked against the manifest, so an entry can be
// written before its image exists; an empty or unknown name shows an empty frame.
const cover = z.string();

// The file name (unix seconds) is the id, the URL and the image directory.
const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '*.mdx' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    cover: cover.optional(),
    draft: z.boolean().default(false),
  }),
});

// Array order is display order.
const works = defineCollection({
  loader: file('src/content/works/works.json'),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    url: z.url(),
    cover: cover.optional(),
  }),
});

export const collections = { journal, works };
