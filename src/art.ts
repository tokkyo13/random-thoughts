import { getCollection } from 'astro:content';

/** Newest first, as Journal is. A piece has no draft state. */
export const listArt = async () =>
  (await getCollection('art')).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

export const artUrl = (id: string) => `/art/${id}/`;
