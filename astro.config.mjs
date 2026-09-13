// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://tokkyo13.net', // absolute URLs in the feed
  integrations: [mdx()],
  // No stylesheet requests: hashed files would still be revalidated on every page view
  build: { inlineStylesheets: 'always' },
  prefetch: { prefetchAll: true }, // on hover or focus
  markdown: {
    shikiConfig: { theme: 'nord' },
  },
});
