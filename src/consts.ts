export const SITE_TITLE = '散考';
export const SITE_LANG = 'ja';

// latin is the reading of name, shown side by side in About.
export const AUTHOR = { name: '特許13', latin: 'tokkyo13' };
export const SOURCE_URL = 'https://github.com/tokkyo13/random-thoughts';

export const SITE_DESCRIPTION = `${AUTHOR.name}の個人サイトです。`;
export const JOURNAL_FEED_TITLE = `Journal | ${SITE_TITLE}`;

export const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Journal', href: '/journal/' },
  { label: 'Works', href: '/works/' },
  { label: 'Links', href: '/links/' },
  { label: 'About', href: '/about/' },
] as const;

// Entries per list page, in Journal and Works. It caps the thumbnails one page loads.
export const PER_PAGE = 30;
