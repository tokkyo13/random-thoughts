// What this site is, and who writes it, is content: content/site/ and content/about/.
export const SITE_LANG = 'ja';

export const NAV_ITEMS = [
  { label: 'Top', href: '/' },
  { label: 'Journal', href: '/journal/' },
  { label: 'Art', href: '/art/' },
  { label: 'Work', href: '/work/' },
  { label: 'Link', href: '/link/' },
  { label: 'About', href: '/about/' },
] as const;

// Entries per list page, in Journal, Work and Art. It caps the thumbnails one page loads.
export const PER_PAGE = 30;
