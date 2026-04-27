# Visit Tywyn — Astro

Static rebuild of [visit-tywyn.co.uk](https://visit-tywyn.co.uk), migrated
from a 4-year-old WordPress installation to Astro 6.

## What's in here

| Source                         | Becomes                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| WP `page` posts                | `src/content/pages/*.md` → `/[slug]/`                         |
| WP `eating` CPT                | `src/content/eating/*.md` → `/eating/[slug]/`                 |
| WP `things_to_do` CPT          | `src/content/things-to-do/*.md` → `/things-to-do/[slug]/`     |
| 4 WP categories                | `src/content/stay-categories/*.md` (replaces 59 listings)     |
| `events.json` (already in WP)  | `src/data/events.json` (rendered on `/` and `/events/`)       |
| Open-Meteo + EasyTide          | `src/data/{weather,tides}.json` (refreshed by script)         |
| Yoast SEO meta                 | Frontmatter `seo:` block, used by `BaseLayout.astro`          |
| Redirection plugin + accommodation slugs | `public/_redirects` (Netlify-style)                 |

The 59 individual `accommodation` listings have been retired — they're
no longer worth maintaining. See `src/content/stay-categories/` for the
4 category landings that replace them. Old URLs 301 to the relevant
category, or to `/where-to-stay/` if no category was attached.

## Getting started

Requires Node 22.12+.

```bash
npm install
tools/copy-uploads.sh           # pulls legacy uploads (~315MB, gitignored)
npm run refresh:conditions      # weather + tides snapshots
npm run dev
```

## Re-running the content export

The export reads from a WP SQL dump and overwrites
`src/content/**` and `public/_redirects`. Manual edits to those files
will be lost on the next run, so commit them, then either:

- delete `src/content/**` first and re-run, or
- adjust the script and re-run (it idempotently overwrites).

```bash
npm run export
```

The dump path is hardcoded in `tools/export-from-sql.ts` —
edit `SQL_PATH` if the backup moves.

## Conditions snapshots

Weather and tide JSON snapshots live in `src/data/`. They're committed
so a deploy carries a known-good fallback even if the next refresh
fails.

```bash
npm run refresh:conditions
```

The refresher never overwrites with garbage: if the upstream API errors
or returns an unrecognised shape, the existing snapshot is left in
place.

For production freshness:

- run `npm run refresh:conditions && npm run build` in CI on a cron
  (e.g. every 6h on Cloudflare Pages, GitHub Actions, etc.), **or**
- stand up a small scheduled function that hits both APIs and commits
  the JSON back to this repo, triggering a redeploy.

## Project layout

```
src/
├── components/
│   ├── conditions/   # WeatherWidget, TidesWidget
│   ├── events/       # EventCard, EventsSection
│   ├── layout/       # Header, Footer, Sidebar, Nav, Breadcrumbs
│   └── ui/           # Icon (inlines SVGs from src/icons)
├── content/          # markdown collections (managed by export script)
├── data/             # JSON snapshots (events, weather, tides)
├── icons/            # SVG icons inlined by <Icon name="…" />
├── layouts/          # BaseLayout + PageLayout
├── lib/              # site config, nav, events, conditions
├── pages/            # routes — file-system + dynamic
└── styles/           # SCSS, 7-1 architecture
tools/
├── copy-uploads.sh        # rsync legacy uploads into public/
├── export-from-sql.ts     # SQL dump → markdown + redirects
└── refresh-conditions.ts  # Open-Meteo + EasyTide → JSON snapshots
```

## Deployment notes

- Output is fully static (`output: 'static'` in `astro.config.mjs`).
- `_redirects` lands in `dist/_redirects` after build — Netlify, Cloudflare
  Pages and Vercel all understand the format.
- Legacy `/wp-content/uploads/...` URLs are preserved so existing
  external links and image embeds keep working. The host needs to
  serve `public/wp-content/uploads/*` alongside the rest of `dist/`.

## Open follow-ups

- [ ] Port legacy SCSS into `src/styles/` (currently shells; build is
      green but visually un-styled compared to the live site)
- [ ] Migrate `wp-content/uploads/` to S3/R2 and rewrite paths during
      export so the repo stops needing a 315 MB sibling directory
- [ ] Replace Gravity Forms contact form with Astro Actions or a host
      form handler
- [ ] Decide on host (Netlify / Cloudflare Pages / Vercel) and codify
      headers + redirects in the host's preferred config format
