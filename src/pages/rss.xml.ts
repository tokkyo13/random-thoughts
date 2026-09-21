import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { journalUrl, listPosts } from '../posts';
import { listArt, artUrl } from '../art';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

// One feed for the whole site, newest first. No article bodies: MDX components would have to
// be rendered for feed readers.
export async function GET(context: APIContext) {
  const [posts, pieces] = await Promise.all([listPosts(), listArt()]);

  const items = [
    ...posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: journalUrl(post.id),
      categories: ['Journal'], // a reader can tell the two apart, and filter on them
    })),
    ...pieces.map((piece) => ({
      title: piece.data.title,
      description: piece.data.description,
      pubDate: piece.data.pubDate,
      link: artUrl(piece.id),
      categories: ['Art'],
    })),
  ].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items,
  });
}
