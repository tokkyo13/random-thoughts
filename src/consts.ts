export const SITE_TITLE = '散考';
export const SITE_LANG = 'ja';

// latin is used in the copyright notice.
export const AUTHOR = { name: '特許13', latin: 'tokkyo13' };
export const FIRST_PUBLISHED = 2026;
// TODO: placeholder until the repository is published.
export const SOURCE_URL = 'https://github.com/tokkyo13/random_thoughts';

export const SITE_DESCRIPTION = `${AUTHOR.name}の個人サイトです。`;
export const JOURNAL_FEED_TITLE = `Journal | ${SITE_TITLE}`;

export const NAV_ITEMS = [
  { label: 'Journal', href: '/journal/' },
  { label: 'Works', href: '/works/' },
  { label: 'Links', href: '/links/' },
  { label: 'About', href: '/about/' },
] as const;

// Entries per list page, in Journal and Works. It caps the thumbnails one page loads.
export const PER_PAGE = 30;
