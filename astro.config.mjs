// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://tokkyo13.net', // absolute URLs in the feed
  integrations: [mdx()],
  // Stylesheets stay external: public/_headers marks /_astro/* immutable, so they are
  // fetched once instead of being carried inside every page
  build: { inlineStylesheets: 'never' },
  markdown: {
    shikiConfig: { theme: 'nord' },
  },
});
