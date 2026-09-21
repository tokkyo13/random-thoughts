# random-thoughts

Source of a personal website built with [Astro](https://astro.build) and MDX. The output is a fully static site.

Images are kept out of Git. Their web variants live in Cloudflare R2, a local working copy of the largest ones lives in `r2-clone/`, and the site build reads only a small manifest committed to the repository.

## Requirements

- Node.js 22.18 or later. The scripts are TypeScript run directly by Node.
- For image sync only: R2 credentials in `creds/r2.env` (see [Configuration](#configuration)). Building the site needs none.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Serve the build locally |
| `npm test` | Run the unit tests (`scripts/**/*.test.ts`) |
| `npm run new journal` | Create a draft article |
| `npm run new art` | Create an art entry |
| `npm run new work` | Append a work entry |
| `npm run img plan` | Show what `apply` would do |
| `npm run img apply` | Sync images between `r2-clone/` and R2. Never deletes anything |
| `npm run img gc` | Delete images that nothing refers to, after confirmation |

## Project structure

```text
src/
  components/         Fig, Note and Code (available in articles), PageHeader, ExternalLink, ...
  content/journal/    articles, one <id>.mdx each
  content/art/        illustrations, one <id>.mdx each
  content/work/       work.json, the work entries in display order
  layouts/  pages/  styles/
  consts.ts           site-wide constants
  content.config.ts   content schemas
  images/             areas, widths, bucket and origin (config.ts); the manifest
                      (manifest.json); image(), which resolves a key to <img>
                      attributes (index.ts)
scripts/
  img.ts              image sync tool (file system and R2 access)
  img-plan.ts         its pure planning logic, tested by img-plan.test.ts
  new.ts              creates articles, art entries and work entries
creds/                r2.env (not in Git) and its template
r2-clone/             local copy of the largest variant of each image, not in Git
```

Each kind of definition has one home: image areas in `src/images/config.ts`, content schemas in `src/content.config.ts`, site-wide constants in `src/consts.ts`, and shared page parts in `src/components/`.

## Content

### Journal

Each article is a single file, `src/content/journal/<id>.mdx`. The `<id>` is the Unix time, in seconds, at which the article was created. It is also the URL (`/journal/<id>/`) and the image directory (`r2-clone/journal/<id>/`), so article files are never renamed. Human-readable information belongs in the frontmatter.

| Field | Required | Description |
| --- | --- | --- |
| `title` | yes | Article title |
| `pubDate` | yes | Publication date. Lists are sorted by it |
| `cover` | | Cover image name (such as `cover-a3f91c2b`), shown in the list and at the top of the article. An empty or unknown name shows no image |
| `draft` | | `true` excludes the article from production builds. It stays visible in development |

Articles are MDX. Plain Markdown works unchanged, and these components are available without an import:

```mdx
<Fig src="figure-a3f91c2b" caption="Optional caption" />

<Note type="info">Content in **Markdown**</Note>
<Note type="warning">type is required: info, tip, important, warning or caution; each has its own icon and color</Note>

<Code file="src/consts.ts">

```ts
export const SITE_TITLE = '散考';
```

</Code>
```

`Code` frames a fenced block: `file` writes the file name above it. It is optional, and the fence keeps its own highlighting.

Every code block in an article, framed or not, shows a button in its upper right corner while the pointer is over it, which copies the code. On a device without a pointer the button is always shown.

Links written in an article open in a new tab, so the article is never left behind. Links that point inside the page, such as a jump to a heading, are left alone.

MDX differs from Markdown in a few places: autolinks (`<https://...>`) and indented code blocks are not supported, comments are written as `{/* ... */}`, HTML tags must be closed (`<br />`), and a literal `{` must be escaped as `\{`.

### Work

`src/content/work/work.json` is an array of entries, shown in array order:

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unix time in seconds; also names the image directory `r2-clone/work/<id>/` |
| `title` | yes | Name of the work |
| `description` | yes | One or two sentences |
| `url` | yes | Where the work is published |
| `cover` | | Cover image name, such as `cover-a3f91c2b`. An empty or unknown name shows an empty frame |

### Art

Each entry is a single file, `src/content/art/<id>.mdx`, named and numbered like an article. An entry holds one illustration or a set of them. The list at `/art/` shows a square thumbnail cropped from the center; the page at `/art/<id>/` shows the first image at the width of the text column, and a button opens the rest below it. Every image carries its number in the set, and one switch fits them all to the height of the window.

| Field | Required | Description |
| --- | --- | --- |
| `title` | yes | Title of the entry |
| `description` | | One or two sentences, shown under the title and given to the feed |
| `pubDate` | yes | Publication date. The list is sorted by it, newest first |
| `cover` | yes | The thumbnail of the list, and the picture a link preview shows. An empty or unknown name shows an empty frame |
| `images` | | The images of the entry, shown in this order. The first one is the one the page opens with |

Nothing goes in the body of the file: an entry is the fields above.

`npm run img apply` fills both lines in. It appends every name it assigns that the entry does not list yet, in the order the file names sort, and never reorders and never removes. So a set is arranged by naming the files `01`, `02`, … and rearranged afterwards by moving lines. To drop an image, delete its line and run `npm run img gc`.

An entry with no cover gets one: `apply` copies its first image to a `cover` name before uploading. The copy holds the same bytes, so its name follows from the same hash, and from there it is an ordinary image with the widths and the share JPEG a cover carries. Name a file `cover.png` to choose a different one.

## Images

### Areas and names

Images are grouped into areas, defined in one table (`AREAS` in `src/images/config.ts`):

| Area | Directory | Image types |
| --- | --- | --- |
| home | `home/` | `cover` |
| journal | `journal/<id>/` | `figure`, `cover` |
| art | `art/<id>/` | `art`, `cover` |
| work | `work/<id>/` | `cover` |


Every image is named `<type>-<hash>`, such as `figure-a3f91c2b`, where the hash is the first eight hex digits of the MD5 of the file it was made from. The sync tool derives the name from the file itself, so nothing has to be reserved in advance: uploading the same picture twice, whether as a preview or after a detour, always lands on the same name. References never include the file extension.

### Storage

No original is kept. Everything lives in one public bucket, served from the image origin:

- **Variants** under `<dir>/<name>.<width>w.avif`. They are generated locally with sharp as AVIF and carry no metadata. The widths depend on the area and type. The largest is the image at its own width, capped by the last width listed (1792 at most, which covers an ordinary screen at 2x), and holds all an image has: every smaller variant can be made from it. `r2-clone/` keeps a copy of it as `<name>.avif`.
- **Share images** under `<dir>/<name>.share.jpg`. Only covers get one, and only a link preview ever fetches it: the scrapers behind them do not read AVIF, so this is a small JPEG instead. It is not referenced by any page, so a reader never downloads it.
- Both are uploaded with `Cache-Control: public, max-age=31536000, immutable`. Because the name follows from the content, a name can never point at different bytes, and cached copies never go stale.
- `src/images/manifest.json` records, for every image, the dimensions and MD5 hash of the largest variant, the MD5 hash of the file it was made from, and the variant widths. The site build reads only this file and never contacts R2.

### Workflow

1. Put images in the item's directory under `r2-clone/`, with any file name. A name starting with a type, such as `cover.jpg`, selects that type; other files get the area's first type.
2. Run `npm run img plan` to see the names that will be assigned, then `npm run img apply` to upload the variants, write `<name>.avif` beside each file, and update the manifest. The files you put in stay where they are until `gc` deletes them.
3. Reference images by name: `<Fig src="figure-a3f91c2b" />` in an article, `cover: cover-a3f91c2b` in frontmatter or a work entry, or a full key such as `image('home/cover-a3f91c2b')` in a page.
4. Commit `src/images/manifest.json` together with the content that uses the images.

To replace an image, add the new version (it gets a new name), update the references, and remove the old one with `gc`. Images are never overwritten in place. An AVIF in `r2-clone/` edited in place is an error: save the edit under another name, and it becomes a new image.

### Sync rules

`plan` and `apply` compare `r2-clone/`, the manifest and the bucket:

| State | Action |
| --- | --- |
| Only in `r2-clone/` | Upload the variants and the share image, keep the largest variant beside the file, record it in the manifest |
| Only in R2 | Download the largest variant. On a fresh clone, `apply` restores `r2-clone/` |
| A file the manifest says an image was made from | Nothing; `gc` deletes it |
| In both, same content | Nothing |
| In the manifest, objects missing in R2 | Make them again from the local copy if it matches, otherwise report an error |

`gc` runs only when everything is in sync. It deletes, from the bucket and from `r2-clone/`, every image whose key appears nowhere: not in any article, art or work entry, and not in any source file under `src/`. Images of deleted articles or entries are included. It also deletes, from the bucket alone, every object that no image in the manifest claims any more, such as the variants left behind by a width list that changed, and, from `r2-clone/` alone, every file an image was made from. The search is deliberately conservative, so any occurrence counts, even in a comment. Keys built at runtime cannot be found, so write keys as whole strings. Deletion requires typing `delete <count>` in an interactive terminal; `gc` refuses to delete anything otherwise, and has no option to skip the confirmation.

### Adding an area

Add the area to `AREAS` in `src/images/config.ts`. An area with one directory per item also needs an entry in `ITEM_SOURCES` in `scripts/img.ts`, which tells `gc` where the items and their references live.

## Configuration

- **Credentials**: copy `creds/r2.env.example` to `creds/r2.env` and fill in `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from an R2 API token with Object Read & Write permission on the bucket. Only the sync tool reads them. Credential files are ignored by Git.
- `src/images/config.ts`: the bucket name and the public image origin.
- `astro.config.mjs`: the site URL, used for absolute URLs in the feed.

### Claude Code

When working with [Claude Code](https://docs.claude.com/en/docs/claude-code), the recommended `.claude/settings.json` denies the file tools read access to the credentials, which keeps their values out of the agent's context:

```json
{
  "permissions": {
    "deny": ["Read(./creds/*.env)"]
  }
}
```

The rule does not cover every shell command, so do not ask the agent to read the credentials. The sync tool reads them by itself.

## Deployment

`npm run build` writes a static site to `dist/`, which any static host can serve. Images are not part of the build output; pages link to the image origin.

The site is served by Cloudflare Workers as static assets, with no Worker script. `wrangler.jsonc` holds the whole configuration: the asset directory, `dist/404.html` for unknown paths, and `tokkyo13.net` as the only address. Workers Builds deploys every push to `main` by running `npm run build`, then `npx wrangler deploy`. The build needs no credentials.

### Response headers

`public/_headers` is copied into `dist/` by the build, read by Cloudflare and never served. It carries two rules.

Every response gets `Referrer-Policy: no-referrer`, so a link leaving the site carries nothing about where the reader came from, and `X-Content-Type-Options: nosniff`.

`/_astro/*` is marked `immutable`. Those names contain a content hash, but Cloudflare serves assets as `max-age=0, must-revalidate` by default, so without the rule even a hashed file is revalidated on every page view. Because the rule removes that cost, stylesheets are left external (`build.inlineStylesheets: 'never'`): they are fetched once instead of being carried inside every page.

Nothing about visitors is collected: no cookies, no analytics beacon, and no request log of our own. Nothing is loaded from a third party either, since fonts and icons are inlined at build time and images come from the site's own image origin. There is no Content-Security-Policy; with no third party to shut out, it only stood in the way of ordinary markup.

## Third-party assets

Work by others that is checked into this repository. Each one keeps its license text beside it. Everything is inlined at build time; no font or icon service is loaded at runtime.

| Files | Source | License |
| --- | --- | --- |
| `src/assets/icons/*.svg` | [Material Symbols](https://github.com/google/material-design-icons), outlined, 24px | Apache-2.0, `src/assets/icons/LICENSE` |

Also used, with no files of its own in the repository:

| Where | Source | License |
| --- | --- | --- |
| `src/assets/logo.svg` | The title logo uses [Hina Mincho](https://github.com/Satsuyako/Hina-Mincho) as its base. The SVG is artwork made with the font, not a copy of it | SIL OFL 1.1 |
