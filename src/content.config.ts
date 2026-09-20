import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// An image name such as "cover-a3f91c2b". Not checked against the manifest, so an entry can be
// written before its image exists; an empty or unknown name shows an empty frame.
const imageName = z.string();

// The file name (unix seconds) is the id, the URL and the image directory.
const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '*.mdx' }),
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
  loader: file('src/content/work/work.json'),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    url: z.url(),
    cover: imageName.optional(),
  }),
});

// One illustration per file, laid out like an article: the body is the description, and it is
// the only optional part. The file name (unix seconds) is the id, the URL and the image directory.
const picture = defineCollection({
  loader: glob({ base: './src/content/picture', pattern: '*.mdx' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    // The illustration itself. It is a cover, so it carries the JPEG a link preview reads.
    cover: imageName,
  }).strict(),
});

export const collections = { journal, work, picture };
