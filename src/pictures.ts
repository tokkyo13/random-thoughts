import { getCollection } from 'astro:content';

/** Newest first, as Journal is. Pictures have no draft state. */
export const listPictures = async () =>
  (await getCollection('picture')).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

export const pictureUrl = (id: string) => `/picture/${id}/`;
