import { getCollection } from 'astro:content';

/** Newest first. Drafts are left out of production builds only. */
export const listJournal = async () =>
  (await getCollection('journal', ({ data }) => !(import.meta.env.PROD && data.draft))).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

export const journalUrl = (id: string) => `/journal/${id}/`;
