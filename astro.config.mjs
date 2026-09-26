// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import site from './content/site/site.json' with { type: 'json' };

export default defineConfig({
  site: site.url, // absolute URLs in the feed
  integrations: [mdx()],
  // Stylesheets stay external: public/_headers marks /_astro/* immutable, so they are
  // fetched once instead of being carried inside every page
  build: { inlineStylesheets: 'never' },
  markdown: {
    shikiConfig: { theme: 'nord' },
  },
});
