---
title: "perf: Stage 2 image pipeline migration — post-pass"
type: perf-measurement
status: captured
date: 2026-05-01
plan: docs/plans/2026-04-28-001-refactor-site-performance-pass-plan.md
units: [1, 2, 3, 4a, 4c, 5, 6, 7, 8, 9, 10]
methodology: lighthouse 13.1 mobile preset, Slow 4G simulated, headless localhost
---

# Stage 2: image pipeline migration — post-pass measurement

Stage 2 of the perf pass migrated every site image into Astro's
`astro:assets` pipeline (Sharp processed → AVIF + WebP + JPEG
fallback at responsive widths, content-hashed URLs), reorganized
the asset tree from WordPress's `YYYY/MM/` date-bucketed layout
into a domain-grouped structure under `src/assets/img/`, and
deleted `public/img/` entirely.

## Before / after Lighthouse

Same five sample pages as Stage 1 baseline. Headless Chrome on
localhost, mobile preset, Slow 4G + 4× CPU throttling.

| Page | Stage 1 score | Stage 2 score | LCP (S1 → S2) | Bytes (S1 → S2) |
|------|--------------:|--------------:|--------------:|-----------------:|
| `/` | 98 | **99** | 2.4 s → **1.8 s** | 204 → 146 KiB |
| `/eating/` | 91 | **98** | 3.5 s → **2.4 s** ✓ | 716 → 376 KiB |
| `/eating/dovey-inn/` | 97 | **99** | 2.5 s → **2.1 s** | 896 → 670 KiB |
| `/things-to-do/cadair-idris/` | 82 | **95** | 4.8 s → **2.9 s** | 966 → 403 KiB |
| `/things-to-do/magic-lantern-cinema/` | 76 | **99** | **7.8 s → 1.8 s** | 1519 → 287 KiB |

CLS = 0, TBT = 0 ms, Speed Index = 1.2 s on every page.

The cinema page LCP dropped from 7.8 s to 1.8 s — a 6-second
improvement on the worst page. The 911 KB body PNG is now served
as a 281 KB WebP (or smaller AVIF). All five sample pages are now
in the green CWV band for LCP, four out of five score ≥ 98.

## What landed

### Phase 1 — Foundation

- **Unit 1:** `astro.config.mjs` — `image.layout: 'constrained'`,
  `responsiveStyles: true`, `breakpoints: [640, 960, 1280, 1920]`,
  per-format Sharp config with AVIF quality 60 + effort 4, WebP
  quality 80, JPEG quality 82 + mozjpeg, PNG quality 90.
- **Unit 2:** Images moved from `public/img/YYYY/MM/...` to a
  domain-grouped tree under `src/assets/img/`:

  ```
  src/assets/img/
  ├── site/                    logo, og-default
  ├── heroes/                  page-level banners (home, eating)
  ├── pages/<slug>.<ext>       per-page hero images
  ├── eating/<slug>/cover.<ext>
  ├── things-to-do/<slug>/cover.<ext>
  ├── things-to-do/<slug>/gallery/<NN>.<ext>
  └── things-to-do/<slug>/inline/<name>.<ext>   markdown body images
  ```

  No more `2022/05/` hangover. Filenames in src/ now describe
  what they are (`logo.png`, `home-surfcam.jpg`, `cover.jpg`)
  instead of when WordPress was uploaded.
- **Unit 3:** `src/content.config.ts` switched to `defineCollection({ schema: ({ image }) => z.object({...}) })`,
  with the image fields validated by `image()`. Frontmatter `src`
  fields became `ImageMetadata` objects instead of strings.
- **Unit 4a:** `_redirects` updated. Legacy `/img/*` and
  `/wp-content/uploads/*` paths now return `410 Gone` (search
  engines de-index rather than chasing a 301 chain to a URL that
  no longer exists).

### Phase 2 — Component migration

- **Units 5-8:** All image-rendering components migrated:
  - `BannerImage` → `<Image priority>` with full-width layout +
    fetchpriority="high" for the LCP candidate on every page.
  - `VenueCard`, `ActivityCard`, `EventCard`, `FeaturedStayCard`,
    `StayCategoryCard`, `RelatedItems` → `<Picture>` with
    `formats={['avif', 'webp']}` and per-component responsive
    width sets.
  - `Header` logo → `<Image>` with fixed layout, eager loading.
  - `Gallery` → `<Picture>` for thumbnails + `<Image>` for the
    lightbox dialog.
- **Inline page imgs** (`dog-friendly-cafes.astro`, `eating/[slug].astro`)
  → `<Picture>`.
- `src/lib/image-dimensions.ts` retired. Sharp probes dimensions at
  build time now; the custom JPEG/PNG header parser is no longer
  needed.
- `EventCard` keeps a raw `<img>` for the time being — events come
  from `src/data/events.json` as string paths, not from a content
  collection, so they can't go through `astro:assets` without
  migrating events to a collection. Currently the events array is
  empty so this code path is dead in practice.

### Phase 3 — Markdown body migration

- **Unit 10:** 9 raw HTML `<img>` tags in 7 markdown bodies
  rewritten to `![alt](path)` syntax so Astro processes them.
  This is the change that brought the 911 KB cinema body PNG into
  the pipeline.

### Phase 6 — Cleanup

- **Unit 4c:** `public/img/` deleted (originals are at
  `/tmp/visit-tywyn-public-img-backup/` if recovery is ever needed).
- `tools/migrate-uploads.ts` is now stale (its purpose ended once
  Stage 2 landed). Worth retiring in a follow-up cleanup commit.
- `SITE.defaultOgImage` field dropped from `src/lib/site.ts`;
  BaseLayout now imports the default OG asset directly so it goes
  through Sharp.

## Build cost

- 1090 image variants generated.
- Cold build: ~37 s (Sharp processing dominates).
- Warm build: ~3 s (Astro caches processed variants between runs).
- `dist/` size: 74 MB. ~99% of that is the `dist/_astro/` image
  variants — the price of shipping AVIF + WebP + JPEG fallback at
  4 widths per source image.

## Open follow-ups

- **Retire `tools/migrate-uploads.ts`**: was the public/img/
  populator from the WP backup; obsolete now that everything is
  in `src/assets/img/`.
- **Retire the migration tools**: `migrate-to-assets.ts`,
  `migrate-body-images.ts`, `reorganize-assets.ts`,
  `verify-and-restore-assets.ts` were one-shot tools. They could
  be deleted, or moved to `tools/archived/` with a note about
  their purpose for posterity.
- **Migrate events to a content collection**: would let
  `EventCard` use `<Picture>` and remove the last raw `<img>`
  reference in the codebase. Out of scope for the perf pass —
  blocked on whether events get a richer schema.
- **Critical CSS extraction**: the only Lighthouse audit still
  flagging > 100 ms on every page is `render-blocking-insight`
  (~466 ms across two stylesheets). Inlining critical CSS or
  using `media="print" onload` for non-critical sheets would
  shave a small further LCP win across every page. Worth doing
  if a future audit asks for the green band on Cadair Idris too.
- **Field measurement**: these are localhost-headless lab numbers.
  Once a host is picked and a public URL exists, re-run via PSI
  for real-world Slow-4G + CrUX field data.
