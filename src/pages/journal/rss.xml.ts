import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { journalUrl, listPosts } from '../../posts';
import { JOURNAL_FEED_TITLE, SITE_DESCRIPTION } from '../../consts';

// No article bodies: MDX components would have to be rendered for feed readers.
export async function GET(context: APIContext) {
  const posts = await listPosts();

  return rss({
    title: JOURNAL_FEED_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      link: journalUrl(post.id),
    })),
  });
}
