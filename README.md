# random-thoughts

Source of a personal website built with [Astro](https://astro.build) and MDX, output as a fully static site. Images live in Cloudflare R2; the build reads only a manifest committed to the repository.

## Requirements

- Node.js 22.18 or later. The scripts are TypeScript run directly by Node.
- Image sync only: R2 credentials in `creds/r2.env` (see [Configuration](#configuration)).
- `npm test` only: [uv](https://docs.astral.sh/uv/), which runs the [REUSE](https://reuse.software) tool.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` / `build` / `preview` | Development server / build into `dist/` / serve the build |
| `npm test` | Unit tests and the license check (`scripts/**/*.test.ts`) |
| `npm run new journal` / `art` / `work` | Create an article (as a draft) / an art entry / a work entry |
| `npm run img plan` | Show what `apply` would do |
| `npm run img apply` | Sync images between `content/image/` and R2. Never deletes |
| `npm run img gc` | Delete unreferenced images, after confirmation |

## Project structure

```text
content/              everything particular to this site; one directory per kind
  site/               site.json and logo.svg
  about/              about.mdx and avatar.avif
  link/               link.json
  journal/  art/      one <id>.mdx per entry
  work/               work.json
  image/              manifest.json, and the images themselves (<area>/<id>/, not in Git)
src/
  components/         shared page parts; mdx/ holds the components articles use
  layouts/  pages/  styles/
  consts.ts           site-wide constants that are not content
  content.config.ts   content schemas
  images/             image areas, widths and bucket (config.ts); image() (index.ts)
scripts/              img.ts and img-plan.ts (image sync), new.ts, tests
creds/                r2.env (not in Git) and its template
LICENSES/  REUSE.toml the license of every file
```

Everything particular to this site lives in `content/`, and nothing in `src/` or `scripts/` names it. Each kind of definition has one home: content schemas in `src/content.config.ts`, image areas in `src/images/config.ts`, constants in `src/consts.ts`.

## Content

An `<id>` is the Unix time in seconds at which the entry was created. It is also the URL and the image directory, so it never changes.

### Site: `content/site/site.json`

| Field | Description |
| --- | --- |
| `title` | Site name |
| `description` | Description for Top and the feed |
| `url` | The site's origin |
| `imageOrigin` | The origin images are served from |

`logo.svg` is the logo in the navigation. The favicons are in `public/`.

### About: `content/about/about.mdx`

The body is the introduction. `avatar` is served as it is: a square AVIF of 320px.

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The author's name |
| `latin` | yes | Its reading in Latin letters |
| `avatar` | yes | Path relative to the file, such as `./avatar.avif` |

### Link: `content/link/link.json`

Each key is a label holding its `url`; key order is display order. A path stays on the site; any other URL opens in a new tab.

### Journal: `content/journal/<id>.mdx`

| Field | Required | Description |
| --- | --- | --- |
| `title` | yes | Title |
| `description` | | Description for the feed |
| `pubDate` | yes | Publication date; lists are sorted by it |
| `cover` | | Cover image name |
| `draft` | | `true` excludes the article from production builds |

These components are available without an import:

```mdx
<Fig src="figure-a3f91c2b" caption="Optional caption" />
<Note type="info">info, tip, important, warning or caution</Note>
<Code file="optional/file/name.ts">(a fenced code block)</Code>
```

### Art: `content/art/<id>.mdx`

The body is empty.

| Field | Required | Description |
| --- | --- | --- |
| `title` | yes | Title |
| `description` | | Description, also given to the feed |
| `pubDate` | yes | Publication date; the list is sorted by it |
| `cover` | yes | Thumbnail and link preview image |
| `images` | | The images, in display order |

`npm run img apply` fills in `cover` and `images`: it appends new names in file name order and never reorders or removes. An entry with no cover gets a copy of its first image; a file named `cover.*` chooses another.

### Work: `content/work/work.json`

An array, shown in array order.

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unix time in seconds; names the image directory |
| `title` | yes | Name of the work |
| `description` | yes | Description |
| `url` | yes | Where the work is published |
| `cover` | | Cover image name |

## Images

### Areas and names

Every image belongs to one entry. Its key is `<area>/<id>/<name>`: the entry's kind, the entry's `<id>`, and the image name. The areas are defined in `AREAS` in `src/images/config.ts`:

| Area | Entry | Image types |
| --- | --- | --- |
| journal | `content/journal/<id>.mdx` | `figure`, `cover` |
| art | `content/art/<id>.mdx` | `art`, `cover` |
| work | `content/work/work.json`, by `id` | `cover` |

An image is named `<type>-<hash>`, such as `figure-a3f91c2b`: the first eight hex digits of the MD5 of the file it was made from. A name never points at other bytes, so images are never overwritten; a new version gets a new name. An entry refers to its images by name alone.

### Storage

One public bucket, served from `imageOrigin`, with `Cache-Control: public, max-age=31536000, immutable`:

- `<key>.<width>w.avif`: variants, at the widths of the area and type. The largest is capped by the last width, and `content/image/<key>.avif` keeps a copy.
- `<key>.share.jpg`: covers only, for link previews.
- `content/image/manifest.json` records each image's dimensions, hashes and widths. The build reads only this file.

### Workflow

1. Put images in `content/image/<area>/<id>/`. A file name starting with a type selects it; other files get the area's first type.
2. `npm run img plan`, then `npm run img apply`: uploads, writes `<name>.avif` beside each file and updates the manifest.
3. Name the images in the entry: `<Fig src="figure-..." />`, `cover: cover-...`.
4. Commit the manifest with the content that uses the images.

### Sync rules

| State | `apply` |
| --- | --- |
| Only in `content/image/` | Upload, keep the largest variant beside the file, record in the manifest |
| Only in R2 | Download the largest variant |
| In the manifest, objects missing in R2 | Recreate from a matching local copy, otherwise an error |
| A file an image was made from | Nothing; `gc` deletes it |

`gc` runs only when everything is in sync. It deletes images their entry does not name (or whose entry is gone), objects no manifest entry claims, and the files images were made from. It asks for `delete <count>` in an interactive terminal and refuses otherwise.

A new area goes in `AREAS`, and in `ITEM_SOURCES` in `scripts/img.ts`, which tells `gc` where its entries are.

## Configuration

- `creds/r2.env`: copy `creds/r2.env.example` and fill in an R2 API token with Object Read & Write on the bucket. Ignored by Git.
- `content/site/site.json`: the site URL and the image origin.
- `src/images/config.ts`: the bucket name.
- `wrangler.jsonc`: the domain.

With [Claude Code](https://docs.claude.com/en/docs/claude-code), deny read access to the credentials in `.claude/settings.json`:

```json
{ "permissions": { "deny": ["Read(./creds/*.env)"] } }
```

## Deployment

Cloudflare Workers serves `dist/` as static assets, with no Worker script, configured in `wrangler.jsonc`. Workers Builds runs `npm run build` and `npx wrangler deploy` on every push to `main`; the build needs no credentials.

`public/_headers` sets `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` on every response, and marks `/_astro/*` immutable.

## License

There is no license for the repository as a whole. Each file has its own, stated in [`REUSE.toml`](REUSE.toml) ([REUSE Specification 3.3](https://reuse.software/spec-3.3/)), with the texts in `LICENSES/`.

| Files | License |
| --- | --- |
| Everything not named below | MIT |
| `src/assets/icons/*.svg` ([Material Symbols](https://github.com/google/material-design-icons)) | Apache-2.0 |
| `content/`, `public/favicon.*`, `wrangler.jsonc` | None: no license is granted |

The unlicensed files hold everything particular to the author and the site, whether or not it is protected by copyright. The images in R2 are not licensed either. `content/site/logo.svg` is artwork made with [Hina Mincho](https://github.com/Satsuyako/Hina-Mincho) (SIL OFL 1.1).

`scripts/license.test.ts` checks that `reuse lint` passes, and that no MIT file contains a value from `content/` (site title, description and domains, the author's name, external links).
