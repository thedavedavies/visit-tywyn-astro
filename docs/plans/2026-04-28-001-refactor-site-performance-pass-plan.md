---
title: "refactor: Site-wide performance pass"
type: refactor
status: active
date: 2026-04-28
deepened: 2026-04-28
---

# refactor: Site-wide performance pass

## Overview

Comprehensive performance pass for visit-tywyn-astro covering image
optimization, font delivery, third-party scripts, and analytics
migration. Today the site renders every image as a plain `<img>` tag
pointing at unprocessed files in `public/img/` (156 files, ~21 MB),
loads Lato render-blocking from Google Fonts, and ships a defunct
Universal Analytics tag. The headline change is migrating all images
into `src/assets/img/` under a logical (non-WordPress) taxonomy and
adopting `astro:assets` for `<Image>` / `<Picture>` rendering, which
unlocks AVIF + WebP, automatic responsive `srcset`, content-hashed
URLs, and per-image `width`/`height` attributes that prevent CLS.

The pass also self-hosts Lato via the Astro 6 stable Fonts API,
replaces UA with GA4, hardens AdSense for CLS, and adds a hero LCP
preload pattern. UX is preserved throughout: no facade pattern for
maps (the live Google Maps iframe already lazy-loads and remains in
place per stakeholder direction), no aggressive script removal that
breaks ad revenue, no surprise interactions hidden behind clicks.

## Problem Frame

The site was recently ported visually like-for-like from a WordPress
theme (`3d7ba93 Like-for-like visual port from the legacy WP theme`).
That port deliberately deferred performance work — images were copied
into `public/img/YYYY/MM/...` mirroring the WP `wp-content/uploads/`
layout and rendered as plain `<img>` to keep behavioural parity. The
prior plan
([2026-04-27-001](docs/plans/2026-04-27-001-refactor-rename-uploads-to-img-plan.md))
explicitly excluded image format and optimization work as future
follow-up. That follow-up is this plan.

The site is content-heavy (46 markdown entries across `eating`,
`things-to-do`, `pages`, `stay-categories`), image-rich (heroes,
cards, galleries on most entries), low-interactivity (zero `client:*`
directives, three tiny `is:inline` scripts), and statically built —
exactly the shape Astro's image pipeline is designed for. The cost of
not adopting it shows up directly in Core Web Vitals: LCP suffers from
unoptimized hero images and render-blocking Google Fonts; CLS suffers
from `<img>` tags with no width/height; transferred bytes are
3–5× higher than they need to be on every page.

## Requirements Trace

- R1. Migrate all referenced images from `public/img/` to a new
  logical `src/assets/img/` taxonomy (no more `YYYY/MM/`); update
  every consumer to import the new path.
- R2. Render images via `astro:assets` (`<Image>` / `<Picture>`) with
  AVIF + WebP, automatic responsive `srcset`, and explicit dimensions
  on every image element.
- R3. Rewrite the inline `<img>` tags in markdown bodies (9
  occurrences across 7 files, verified via `grep -rn '<img' src/content/`)
  to standard `![alt](path)` syntax so Astro's pipeline processes them.
- R4. Self-host Lato via Astro 6 Fonts API, eliminating the
  render-blocking Google Fonts CSS request and adding a
  metric-matched fallback to neutralize font-swap CLS.
- R5. Replace Universal Analytics with GA4; remove the dead UA
  snippet from `BaseLayout`.
- R6. Reserve fixed dimensions for AdSense slots so ad fill cannot
  introduce CLS.
- R7. Apply LCP best practice to hero/banner images: `priority` (or
  equivalent eager + sync + `fetchpriority="high"`) on the
  above-the-fold image of each page.
- R8. Preserve UX: no map facade, no removal of AdSense, no behaviour
  change to galleries / lightbox / mobile nav.
- R9. Preserve URL stability: legacy `/img/...` paths used by external
  links / search engines must continue resolving via `_redirects`.

## Scope Boundaries

- **Maps embed strategy** — `VenueMap` keeps the live Google Maps
  iframe with `loading="lazy"` (per user direction). Facade pattern
  not adopted.
- **AdSense removal** — out of scope. AdSense stays; only its CLS
  posture and load timing change.
- **CDN / hosting selection** — README still lists "decide on host"
  as open. Cache-Control and CDN tuning are constrained to what
  `_redirects` and host-side headers can express; final cache header
  validation is a deploy-time task on the chosen host.
- **View Transitions / `<ClientRouter />` adoption** — out of scope.
  Astro 6 removed `<ViewTransitions />`; `<ClientRouter />` is
  available but not required for this pass.
- **Tailwind / design system changes** — out of scope.
- **Author tooling** (image upload UX, CMS) — out of scope.

### Deferred to Separate Tasks

- **Sitemap `lastmod` per-entry from frontmatter `updated`** — flagged
  in `astro.config.mjs:18-29` comment; orthogonal to perf.
- **Migrate `public/img/` (or `src/assets/img/`) to S3/R2 CDN** —
  README open follow-up; layered on top of this plan once Astro
  pipeline is in place. The Astro `image.domains` config already
  whitelists `visit-tywyn.s3.amazonaws.com` for that future move.
- **Replace Gravity Forms** — README open follow-up; orthogonal.
- **YouTube facade (`lite-youtube-embed`)** — only 2 inline YouTube
  iframes exist (in `tywyn-beach.md` × 2). The malformed
  `embed//<id>` URLs and missing `loading="lazy"` are fixed inline as
  part of this pass; full facade adoption can come later if traffic
  warrants it.

## Context & Research

### Relevant Code and Patterns

- `astro.config.mjs` — already has `image.domains`, `prefetch.defaultStrategy: 'hover'`, modern Sass compiler. Image config block is the focal point for new `image.layout`, `image.responsiveStyles`, and per-format `image.service.config` defaults.
- `src/layouts/BaseLayout.astro:79-161` — owns `<head>` order. Site-wide changes (Fonts API `<Font>` tag, GA4 swap, hero preload conditional, S3 favicon swap) all land here.
- `src/content.config.ts` — defines `imageSchema` for all four collections as `z.object({ src: z.string(), alt, width?, height? })`. Will switch to using the `image()` helper passed into `defineCollection`'s schema function so frontmatter image paths become validated `ImageMetadata` imports.
- `src/components/BannerImage/BannerImage.astro:14` — LCP candidate component on most pages; first to migrate.
- `src/components/{ActivityCard,EventCard,FeaturedStayCard,VenueCard,StayCategoryCard,RelatedItems,Gallery}/...astro` — six card components + Gallery, all currently rendering `<img loading="lazy">` with no dimensions.
- `src/components/Header/Header.astro:22-28` — logo `<img>` with explicit `width`/`height`; clean migration to `<Image>` with `layout="fixed"`.
- `src/components/Nav/Nav.astro:64-75`, `src/components/Gallery/Gallery.astro:51-68`, `src/components/AdSlot/AdSlot.astro:29-31` — three `is:inline` scripts. Mobile nav and Gallery dialog are good candidates to switch to hoisted (default) `<script>` per Astro 6 client-side scripts guide; AdSense init must stay `is:inline` because it references a third-party global.
- `tools/migrate-uploads.ts` — reference-driven scanner that pulls images from a WP backup into `public/img/`. After this pass, this tool's purpose ends and it can be retired (or repurposed). See implementation note in Unit 4.
- `public/_redirects` — already has `/wp-content/uploads/* → /img/:splat 301` rule; needs an additional layer for legacy `/img/YYYY/MM/...` → new asset routes (or a friendly 404 strategy — see Unit 4).
- `src/lib/site.ts` — central site config (already holds `adsenseClient`); add `gaMeasurementId` here.

### Institutional Learnings

- `docs/solutions/` does not yet exist. No prior learnings on this codebase. Recommend capturing learnings from this pass via `compound-engineering:ce-compound` once shipped — image migration patterns will be the first useful entry.

### External References

- [Astro 6 images guide](https://docs.astro.build/en/guides/images/) — `<Image>`, `<Picture>`, markdown `![]()` processing, public vs src tradeoffs.
- [`astro:assets` API reference](https://docs.astro.build/en/reference/modules/astro-assets/) — `priority`, `layout`, `formats`, `widths`, `densities` props; `<Font>` component (added in Astro 6.0.0).
- [Astro 6 fonts guide](https://docs.astro.build/en/guides/fonts/) — `fonts: [...]` config, providers (`fontsource`, `google`, `local`, etc.), `<Font cssVariable preload />` usage, optimized fallback metrics.
- [Astro 6 configuration reference: image options](https://docs.astro.build/en/reference/configuration-reference/#image-options) — `image.layout`, `image.responsiveStyles`, `image.service.config.{webp,avif,jpeg,png}` (added in 6.1.0), `image.breakpoints`.
- [Astro 6 client-side scripts](https://docs.astro.build/en/guides/client-side-scripts/) — hoisted vs `is:inline` vs `client:*` decision guide.
- [Web.dev: Fetch Priority API](https://web.dev/articles/fetch-priority) — `fetchpriority="high"` on LCP image; documented ~700ms LCP wins.
- [DebugBear: Avoid overusing `fetchpriority="high"`](https://www.debugbear.com/blog/avoid-overusing-fetchpriority-high) — exactly one image per page.
- [GA4 measurement ID setup](https://support.google.com/analytics/answer/9539598) — replacement for the dead UA-28386547-1 tracking ID.

### Current Image Inventory (baseline)

- 156 files in `public/img/`, ~21 MB total.
- Format mix: 68 `.jpg`, 12 `.jpeg`, 3 `.png`, 73 `.webp` (legacy ShortPixel companions, never referenced), **0 `.avif`**.
- Top outliers worth special attention during migration:
  1. `public/img/2022/10/tywyn-cinema.png` — **911 KB** (used inline on Cinema page).
  2. `public/img/2022/06/dolgoch-2-scaled.jpg` — 596 KB.
  3. `public/img/2022/06/dolgoch-1-scaled.jpg` — 570 KB.
  4. `public/img/2022/06/0812889_1_4.jpg` — 324 KB (Talyllyn gallery).
  5. `public/img/2022/07/cadair_idris-scaled.jpg` — 290 KB (Cadair Idris hero).
- 10 raster files have no `.webp` companion today, including
  `surfcam-1.jpg` (home page LCP candidate). All originals will be
  re-encoded to AVIF + WebP after migration regardless of pre-existing
  companions.

### Astro 6 Specifics That Materially Shape The Plan

- `image.layout: 'constrained'` set globally applies to `<Image>`,
  `<Picture>`, AND markdown `![]()` syntax. Single config knob covers
  all three render paths.
- The `priority` prop on `<Image>` / `<Picture>` (added 5.10.0,
  stable in 6.x) sets `loading="eager"`, `decoding="sync"`, and
  `fetchpriority="high"` together. Use it on exactly one image per
  page (the LCP candidate).
- `experimental.fonts` is stable in Astro 6.0 — drop the experimental
  flag, just use top-level `fonts: [...]` and `<Font />` from
  `astro:assets`.
- HTML `<img>` tags inside markdown bodies are NOT processed for
  `src/` images — only `![]()` syntax is. That's why R3 exists.
- `image.service.config.{webp,avif,jpeg,png}` (added 6.1.0) lets us
  set per-format Sharp quality defaults globally rather than per-call.

## Key Technical Decisions

- **Image taxonomy: domain-grouped, not date-grouped.** Drop the
  WordPress `YYYY/MM/` hangover. New layout under `src/assets/img/`
  groups images by domain (heroes, eating, things-to-do, stay,
  events, site, inline). Per-venue and per-activity galleries get
  their own subdirectories keyed by content slug. Rationale: matches
  how the team thinks about content, makes asset discovery trivial
  during editing, and aligns directory structure with content
  collection structure. See Output Structure section for the full
  tree.

- **Use `image()` schema helper, not `z.string()`.** Switch
  `src/content.config.ts` to take `({ image })` in each
  `defineCollection({ schema })` and validate frontmatter image paths
  with `image()`. This makes `data.cover` (or whatever the field is
  named) an `ImageMetadata` import that can pass straight into
  `<Image src={data.cover} />` without manual import boilerplate in
  every page template.

- **Global `image.layout: 'constrained'` + `responsiveStyles: true`.**
  One global setting gives every Astro-rendered image responsive
  `srcset` + `sizes` + the small `:where([data-astro-image])` CSS
  block. Per-image overrides (`layout="full-width"` for heroes,
  `layout="fixed"` for the logo) handle the exceptions. Cleaner than
  per-call configuration on every component.

- **`<Picture formats={['avif', 'webp']}>` for content imagery;
  `<Image>` for utility imagery.** Picture is reserved for hero,
  card thumbnails, and gallery items where the AVIF byte savings
  matter. Image (single format, defaulting to WebP) for the logo and
  any small icons that don't justify per-format negotiation overhead.

- **Per-format quality defaults via `image.service.config`.** Set
  `webp.quality: 80`, `avif.quality: 60`, `avif.effort: 4`,
  `jpeg.quality: 82` globally rather than annotating every call site.
  Photographic content (sky gradients, water, landscape detail at
  Cadair Idris / Dolgoch / beaches) tolerates much less aggressive
  AVIF compression than synthetic UI imagery; `quality: 60` keeps
  most byte savings while avoiding visible banding. AVIF
  `effort: 4` is the sweet spot for build time vs file size — going
  to 5 or 6 roughly doubles encode time for ~3–5% smaller files.
  Estimated transform count is `~140 images × 4 widths × 2 formats =
  ~1,120 transforms` plus single-format gallery thumbs and the logo;
  expect a 60-second to 3-minute cold-cache build depending on
  Sharp parallelism. Per-call `quality` on flagship hero images can
  override upward if needed.

- **Override `image.breakpoints` to a 4-width set.** The Astro
  default `[640, 750, 828, 1080, 1280, 1668, 2048, 2560]` generates
  up to 8 widths per `layout="full-width"` hero. Set
  `image.breakpoints: [640, 960, 1280, 1920]` — covers mobile,
  tablet, desktop, and retina-desktop while dropping the rarely-hit
  ultrawide tier. Halves hero encoding time with no perceptible
  delivery difference for the site's audience.

- **Astro 6 Fonts API + Fontsource provider for Lato.** Self-hosts
  the woff2 from `node_modules` at build, generates a metric-matched
  fallback automatically (CLS killer), serves from origin. `subsets:
  ['latin']` covers Welsh diacritics. Preload only the body 400
  weight; let 700 load on demand to avoid the "preloading too many
  fonts" anti-pattern.

- **GA4 replaces UA. Consent handled by AdSense's CMP (DECIDED).**
  Drop the UA snippet entirely. Add a GA4 snippet with
  `gtag('config', measurementId)` deferred-load. AdSense's
  Funding Choices CMP (Google's built-in IAB-TCF compliant consent
  manager) is already active on the site via the AdSense loader
  and presents the consent prompt to EU/UK visitors covering both
  AdSense and GA4 personalisation. No additional consent scaffold
  is added in this plan. If the CMP coverage is later found
  insufficient for non-AdSense pages or non-personalised analytics,
  add a separate consent task.

- **AdSense stays, but with reserved CLS slots and idle-load.**
  `AdSlot` already has `min-height: 90px` reserved, but the AdSense
  loader script is currently `defer` on every page in `<head>`. Move
  it to load via `requestIdleCallback(loader, { timeout: 3000 })`
  (with `setTimeout` fallback for browsers without
  `requestIdleCallback`) so it doesn't compete with the LCP image
  for bandwidth on first paint. The `timeout: 3000` ceiling
  guarantees AdSense loads within 3 seconds even on a busy main
  thread — without it, image-decode bursts on a venue page can
  starve `requestIdleCallback` indefinitely and the ad slot never
  fills (zero impression, lost revenue). Render order and ad
  placement unchanged.

- **Hero preload via `priority` prop, with a verified fallback.**
  `priority` on `<Image>` / `<Picture>` gives `fetchpriority="high"`
  which is the highest-leverage single attribute (per DebugBear /
  web.dev). For most pages this is sufficient because Astro's
  preload scanner finds the rendered `<img>` quickly. **One known
  gotcha:** when the LCP image is wrapped in `<Picture>` with
  multiple `<source>` elements (AVIF + WebP), the preload scanner
  has to evaluate `type` attributes against browser support before
  picking which source to fetch — that evaluation can delay the LCP
  request by 100–300ms vs. a plain `<img>`. Mitigation, in
  preference order: (1) verify in WebPageTest waterfall after Unit 5
  that the LCP request starts within ~200ms of the HTML response;
  (2) if delayed, downgrade the LCP hero to a single-format
  `<Image>` (WebP only — accept the ~15–20% byte cost on the
  single LCP image in exchange for clean preload-scanner behavior);
  (3) only as last resort, emit a manual `<link rel="preload"
  as="image" imagesrcset imagesizes type="image/avif">` for the
  hero. Add manual preload only if (1) shows a real delay.

- **Bridge schema (DECIDED).** The schema switch from
  `{ src: string }` to `image()`-returned `ImageMetadata` is
  type-incompatible with every consumer that reads `data.X.src`
  today. Resolution: use a **bridge schema** that adds the new
  field (`cover: image().optional()`) alongside the legacy field
  (`hero_image: imageSchema.optional()`) for one PR, populates the
  new field via rewrite, then migrates components in a follow-up
  PR, then removes the legacy field in a small final PR. Keeps
  every intermediate state green for `astro check` and keeps
  rollback cheap.
  **Forcing function for legacy-field removal:** add a CI check
  (a small `tools/check-legacy-fields.ts` runnable as
  `npm run check:legacy-fields` or wired into `astro check` via a
  pre-build step) that fails the build if any frontmatter file in
  a Phase-3-completed collection still uses `hero_image` or
  `photo`. Without this, the bridge state becomes permanent debt.

- **Markdown body LCP rule.** Astro processes markdown `![]()` with
  the global `image.layout: 'constrained'` defaults, which is
  correct for inline body imagery. However, on pages where the
  markdown body image is the LCP candidate (the cinema page is
  exactly this case — its 911 KB cinema PNG appears at the top of
  the body), the `<Image>`-equivalent semantics of markdown
  processing don't apply `priority`. Rule: if a page's LCP element
  is a markdown body image, render that image via the page template
  using `<Picture priority>` instead of `![]()`, and have the
  markdown body skip it. Identify candidates via Unit 0 baseline
  Lighthouse and update Unit 10 accordingly.

- **Existing `is:inline` scripts mostly stay.** Nav toggle and
  Gallery dialog can convert to hoisted `<script>` (deduplicated
  across page) if it simplifies, but neither change is required for
  performance. AdSense init stays inline (it references the
  `adsbygoogle` global).

- **Build time budget: AVIF encoding is slow.** With ~140 unique
  images × multiple widths × 2 formats, expect builds to grow from
  seconds to ~1–2 minutes. Acceptable trade-off; if it becomes
  painful, set `image.service.config.avif.effort: 4` (down from
  default 6) as the first lever.

## Open Questions

### Resolved During Planning

- **What goes in `src/assets/img/`?** All referenced images that need
  optimization. Favicons, robots.txt, `_redirects` stay in `public/`
  because they need stable URLs.
- **How to discover which images are still referenced after content
  edits?** A reorganization script (Unit 4) reads the source tree,
  builds a manifest of `(old_path → new_path)`, copies + renames, and
  emits the mapping JSON for the bulk-rewrite step (Unit 9/10).
- **Markdown image processing path:** `![]()` syntax with relative
  paths from the `.md` file. Astro's image pipeline processes these
  using the global `image.layout: 'constrained'` config.
- **Do the orphan `.webp` companions in `public/img/` need to come
  along?** No. Astro will generate fresh AVIF + WebP from the
  highest-quality original. Drop the legacy ShortPixel companions
  during reorganization.

### Deferred to Implementation

- **Final per-image taxonomy slot for ambiguous images.** A handful
  of images (e.g., generic banners reused across multiple pages)
  may need a judgment call between `heroes/` and `inline/`. Decide
  case-by-case during Unit 2 with the manifest in front of you.
- **Whether to retire `tools/migrate-uploads.ts` or repurpose it.**
  After reorganization the tool's WP-recovery purpose is done, but
  it might be useful as a generic "pull missing originals from S3
  backup" utility. Decide at implementation; default action is
  delete.
- **Exact GA4 measurement ID.** User to provide before implementation
  begins; placeholder `G-XXXXXXX` until then.
- **Whether to keep both Lato 400 and 700 weights.** Audit current
  CSS usage during Unit 11 — if 700 isn't actually used, drop it
  and save another woff2 download.

## Output Structure

The new `src/assets/img/` taxonomy. Galleries live alongside their
content's domain (eating, things-to-do) keyed by slug. Site-wide and
section-banner images live at the top level of each domain or in
`heroes/` and `site/`. Final per-image placement is decided during
Unit 2 with the reorganization manifest as guide.

```
src/assets/img/
├── heroes/                          # Section / page banner images
│   ├── home-surfcam.jpg             # Home page hero (was surfcam-1.jpg)
│   ├── eating.jpg                   # /eating/ landing banner
│   ├── things-to-do.jpg             # /things-to-do/ landing banner
│   ├── where-to-stay.jpg
│   ├── events.jpg
│   ├── webcam.jpg
│   └── dog-friendly.jpg
├── site/                            # Logo, ogimage, brand assets
│   ├── tywyn-logo.png
│   └── og-default.jpg
├── eating/                          # Per-venue cover + galleries
│   ├── coast-deli/
│   │   ├── cover.jpg
│   │   └── gallery/01.jpg ...
│   ├── dine-india/
│   │   └── cover.jpg
│   └── ...                          # one folder per venue (18 total)
├── things-to-do/                    # Per-activity cover + galleries
│   ├── cadair-idris/
│   │   ├── cover.jpg
│   │   └── gallery/01.jpg ...
│   ├── castell-y-bere/
│   │   └── ...
│   └── ...                          # one folder per activity (11 total)
├── stay/                            # Stay-category covers + featured
│   ├── self-catering/cover.jpg
│   ├── b-and-b/cover.jpg
│   └── ...
├── events/                          # Event imagery (currently empty)
│   └── (populated as events are added)
├── inline/                          # Body-of-content images per page
│   ├── tywyn-cinema.png             # was the 911KB outlier
│   ├── magic-lantern-2.jpg
│   └── ...
└── pages/                           # Editorial page-level images
    └── (cover_image references for the `pages` collection)
```

The structure is a scope declaration showing the expected output
shape. The implementing agent may adjust if reorganization reveals a
better fit (e.g., merging `pages/` and `inline/` if the distinction
is too thin to maintain).

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance
> for review, not implementation specification. The implementing
> agent should treat it as context, not code to reproduce.*

### Image rendering decision matrix

| Render context                          | Component         | Layout         | Format strategy        | Loading                          |
|-----------------------------------------|-------------------|----------------|------------------------|----------------------------------|
| Home page hero (LCP)                    | `<Picture>`       | `full-width`   | `['avif', 'webp']`     | `priority` (eager + fp=high)     |
| Section landing banners                 | `<Picture>`       | `full-width`   | `['avif', 'webp']`     | `priority`                       |
| Venue / activity hero photo             | `<Picture>`       | `constrained`  | `['avif', 'webp']`     | `priority` (above the fold)      |
| Card thumbnails (Activity, Venue, etc.) | `<Picture>`       | `constrained`  | `['avif', 'webp']`     | `loading="lazy"` (default)       |
| Gallery thumbs                          | `<Image>`         | `constrained`  | webp only (small)      | `loading="lazy"`                 |
| Gallery lightbox full-size              | `<Image>`         | `constrained`  | webp only              | `loading="lazy"` (dialog opens)  |
| Header logo                             | `<Image>`         | `fixed`        | webp                   | default eager                    |
| Inline markdown body images             | `![]()`           | global default | global default         | default (Astro auto-decides)     |

### Content collection schema flow

```
.md frontmatter:               cover: ./gallery/cover.jpg
       │
       ▼
defineCollection({ schema: ({ image }) => z.object({ cover: image() }) })
       │
       ▼
Astro validates path, imports asset, returns ImageMetadata
       │
       ▼
page template:                 <Picture src={entry.data.cover} ... />
       │
       ▼
Sharp at build time            → /_astro/cover.HASH.{avif,webp}
                                + automatic srcset/sizes
                                + width/height attrs from intrinsic
```

### Head load order (after pass)

```
<head>
  charset, viewport, title, description, canonical, robots
  preconnect: googletagmanager, googlesyndication (only what's left)
  <Font cssVariable="--font-body" preload>            ← self-hosted Lato
  OpenGraph + Twitter
  favicon (local /favicon.svg + .ico, no S3)
  hero <link rel="preload" as="image">                ← only if Lighthouse flags
  GA4 deferred                                         ← was UA
  AdSense via requestIdleCallback                      ← was defer in <head>
  Ahrefs deferred (unchanged)
  JSON-LD blocks
</head>
```

## Implementation Units

Phased delivery: each phase can land as a separate PR for safer
review and rollback. Within a phase, units are dependency-ordered.

### Execution order (DECIDED: quick-wins-first)

The plan ships in two stages with a re-measurement gate between
them. Document review identified that ~80% of CWV gains likely come
from a small subset shippable in days; image-pipeline migration
(Phases 1–3) is the bulk of effort and may be unnecessary if quick
wins land in the green band. Stage 2 commits only after stage 1
data warrants it.

**Stage 1 — Quick wins (this session, ~1 day):**
1. **Unit 0** (baseline measurement) — must land before any
   behavioural change so before/after deltas exist.
2. **NEW Unit Q1: width/height + loading attributes on existing
   `<img>` tags** — sweep all 9 image-rendering components and the
   2 inline page `<img>` references; add explicit `width`/`height`
   from intrinsic image dimensions and `loading="lazy"` (except
   above-fold). Keeps `public/img/` in place. Targets CLS = 0
   without touching the asset pipeline.
3. **Unit 11** (Fonts) — self-host Lato. Eliminates the
   render-blocking Google Fonts CSS request.
4. **Unit 12** (UA → GA4) — drop dead UA, add GA4 deferred-load.
5. **Unit 13** (AdSense CLS reservations) — add the per-placement
   `min-height` reservations only. Keep the `defer` loader in
   `<head>` for now (skip the idle-load change until we measure
   that the CLS-only fix moved the needle).
6. **Unit 14** (iframe `loading="lazy"` + YouTube `embed/` fix +
   VenueMap `allow=""`) — content-side iframe hygiene.
7. **Re-measure** with Stage-1-completed metrics.

**Re-measurement gate:** if mobile LCP and CLS for the 5 sample
pages are already in the "good" CWV band (LCP ≤ 2.5s, CLS ≤ 0.05),
defer or scope down Stage 2. If they're still flagged, proceed.

**Stage 2 — Image pipeline migration (only if Stage 1 leaves room):**
1. **Phase 1** — Units 1, 2, 3 (config, reorganize, schema bridge),
   4a (legacy redirects), 4b (`_headers` cache control).
2. **Phase 2** — Units 5, 6, 7, 8 (component migration to
   `<Image>`/`<Picture>`). Commutative within phase.
3. **Phase 3** — Units 9, 10 (frontmatter + markdown body
   rewrites).
4. **Legacy field cleanup PR** — small follow-up that removes the
   bridge schema's legacy `hero_image`/`photo` fields once Phase 3
   has populated `cover` everywhere. Enforce via the CI check
   added in Unit 3.
5. **Phase 5 remainder** — Unit 13's idle-load change (if Stage 1
   measurement shows it's needed), Unit 15 cleanup (likely cut —
   no R# mapping).
6. **Phase 6** — Unit 4c (delete `public/img/`, retire migrate
   tool) + Unit 16 post-pass measurement.

---

### Phase 1 — Foundation (configuration + image migration mechanics)

- [ ] **Unit 0: Capture pre-pass performance baseline**

**Goal:** Run Lighthouse mobile (5 runs each, report median) on the
representative sample pages and commit the results so post-pass
deltas have ground truth. Without this unit, the rest of the plan
has nothing to measure against.

**Requirements:** Validates R1–R7 (provides comparison floor)

**Dependencies:** None

**Files:**
- Create: `docs/perf/2026-04-baseline.md`

**Approach:**
- Test pages: `/`, `/eating/`, `/eating/dovey-inn/` (representative
  venue with hero + gallery), `/things-to-do/cadair-idris/`
  (representative activity), `/cinema/` (hero is the 911 KB PNG
  inline image — separate test because LCP element may be markdown
  body, not page hero).
- Tooling: PageSpeed Insights API (Lab + CrUX) preferred; local
  Lighthouse mobile (Slow 4G preset, Moto G Power emulation, 5 runs
  median) as fallback.
- Capture per page: LCP, INP, CLS, total transfer bytes, image bytes,
  font bytes, the actual LCP element (selector), time to first byte.
- Capture build wall-clock for `npm run build` (cold and warm).

**Test scenarios:** none — measurement-only unit.

**Verification:**
- `docs/perf/2026-04-baseline.md` committed; numbers reproducible
  by running Lighthouse on the same pages 7 days later within
  ±20% (variance check).
- For each page, the actual LCP element identified (text vs image)
  — informs whether image preload optimization will help that page
  or not (per Markdown body LCP rule in Key Technical Decisions).

---

- [ ] **Unit 1: Configure Astro image pipeline globally**

**Goal:** Set the `image` config block in `astro.config.mjs` so the
entire codebase inherits sensible defaults: constrained responsive
layout, per-format quality, and the small `:where([data-astro-image])`
helper styles.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `astro.config.mjs`

**Approach:**
- Add `image.layout: 'constrained'` to apply globally to `<Image>`,
  `<Picture>`, and markdown `![]()`.
- Add `image.responsiveStyles: true` so the global helper CSS ships
  once.
- Add `image.service.config.webp.quality: 80`,
  `avif.quality: 60`, `avif.effort: 4`, `jpeg.quality: 82` as
  per-format defaults (per Key Technical Decisions rationale).
- Add `image.breakpoints: [640, 960, 1280, 1920]` to override the
  default 8-tier breakpoint array.
- Keep existing `image.domains` (legacy S3 + canonical hostname).
- Verify `prefetch.defaultStrategy` and `output: 'static'` are
  unchanged.

**Patterns to follow:**
- Existing config style in `astro.config.mjs` (single `defineConfig`,
  inline comments where intent isn't obvious).

**Test scenarios:**
- Happy path: `npm run build` succeeds with the new config; output
  log shows Sharp processing images.
- Edge case: Build does not regress on a page with no images
  (e.g., `404.astro`).

**Verification:**
- `astro check` passes.
- `npm run build` completes without errors and emits processed images
  under `dist/_astro/`.

---

- [ ] **Unit 2: Reorganize images into `src/assets/img/` taxonomy**

**Goal:** Physically move every still-referenced image from
`public/img/YYYY/MM/...` to `src/assets/img/<domain>/<slug>/<role>.ext`
per the Output Structure tree. Drop unreferenced files and legacy
ShortPixel `.webp` companions. Emit a name-mapping manifest the
downstream rewrite units consume.

**Requirements:** R1

**Dependencies:** None (can run in parallel with Unit 1)

**Files:**
- Modify: `tools/migrate-uploads.ts` — add a `reorganize` mode (or
  extract shared helpers into `tools/lib/img-refs.ts` and add a
  new thin script). Output writes `tools/img-mapping.json` (`{
  "/img/2022/05/foo.jpg": "src/assets/img/eating/coast-deli/cover.jpg" }`).
- Create: `tools/img-mapping.json` (output of the script; commit
  it as archival evidence per Documentation/Operational Notes).
- Create: `src/assets/img/...` directory tree per the Output Structure
  section.
- Modify: `.gitignore` — remove the existing `public/img/20*/`
  ignore line (since `public/img/` is being removed).
- Pre-step: Run `npm run migrate:uploads` once locally before the
  reorganize step to populate `public/img/` with originals from
  the WP backup. After this pass, `public/img/` and the migrate
  step both retire (Unit 4c).

**Approach:**
- Extend `tools/migrate-uploads.ts` with a `reorganize`
  sub-command (or extract its `discoverReferences()`,
  `walkDir()`, `isTextFile()` helpers into a shared
  `tools/lib/img-refs.ts` module) rather than duplicating in a
  parallel script. The reorganize logic uses the same source
  scanner.
- For each reference, classify:
  - Card / hero / banner image referenced from a `.md` frontmatter
    `hero_image` or `photo` field → `<domain>/<slug>/cover.ext`
  - Image referenced from a `.md` frontmatter `gallery[].src` →
    `<domain>/<slug>/gallery/<NN>.ext`
  - Image referenced inline in `.md` body `<img>` or `![]()` →
    `inline/<filename>.ext` (rename from cryptic WP slugs to readable
    names where reasonable, e.g., `0812889_1_4.jpg` →
    `talyllyn-rolling-stock-04.jpg`)
  - Image referenced from a `.astro` component (logo, section
    banners) → `site/` or `heroes/`
- Always copy the highest-quality version (prefer raster original
  over the `.webp` companion).
- Skip orphan `.webp` companions (Sharp will regenerate fresh).
- Print a summary: `N references discovered, M files copied, K
  orphans skipped`.

**Execution note:** Manual review of the manifest before running the
bulk rewrite (Units 9/10). Spot-check ~10 mappings; adjust the
classification logic if a pattern is consistently wrong.

**Test scenarios:**
- Happy path: Run script on current source; manifest contains an
  entry for every `/img/...` reference found in `src/`; every target
  path is unique; every source file exists.
- Edge case: Cinema page's `tywyn-cinema.png` (911 KB outlier) ends
  up in `inline/` with a sensible name.
- Edge case: Hero `surfcam-1.jpg` ends up in `heroes/home-surfcam.jpg`.
- Edge case: Two markdown files referencing the same `/img/...` path
  produce one copy (deduped) in the new location.
- Error path: A reference in source whose source file does not exist
  in `public/img/` is logged as a warning (not a fatal error).

**Verification:**
- `tools/img-mapping.json` covers every `/img/...` reference in
  `src/` (zero unmapped).
- `find src/assets/img -type f | wc -l` matches `cat
  tools/img-mapping.json | jq 'values | unique | length'`.
- Outliers (cinema PNG, Dolgoch JPGs) are present at their new paths.

---

- [ ] **Unit 3: Update content collection schemas to use `image()` helper**

**Goal:** Switch `src/content.config.ts` so frontmatter image paths
are validated and imported via `image()` rather than typed as bare
strings. This makes `entry.data.cover` an `ImageMetadata` object
ready to pass into `<Image>` / `<Picture>` without per-page import
boilerplate.

**Requirements:** R2

**Dependencies:** Unit 2 (the new asset paths must exist before
schemas can validate them)

**Files:**
- Modify: `src/content.config.ts`

**Approach:**
- Convert each `defineCollection({ schema })` to
  `defineCollection({ schema: ({ image }) => z.object({...}) })`.
- Replace the existing `imageSchema` (`z.object({ src: z.string(),
  alt, ... })`) with `image()` for the path field, plus `alt:
  z.string()`. Drop manual `width`/`height` (Sharp infers from the
  source file).
- Per-collection field naming clean-up: standardize on `cover` (was
  `hero_image` in pages/things-to-do/stay-categories, `photo` in
  eating). Galleries become `gallery: z.array(z.object({ src:
  image(), alt: z.string(), caption: z.string().optional() }))`.
- Update the per-collection `featured[].image` in `stay-categories`
  the same way.

**Execution note:** This is a coordinated breaking change with
Unit 9 (frontmatter rewrites). Land them in the same PR so `astro
check` stays green throughout the diff.

**Test scenarios:**
- Happy path: `astro check` passes after both Unit 3 and Unit 9
  are applied.
- Error path: Pointing a frontmatter `cover` field at a missing file
  fails the build with a clear error (validates the schema is
  actually enforcing).
- Edge case: An entry with no `cover` (if any are optional) still
  validates.

**Verification:**
- TypeScript types in pages that consume `entry.data.cover` show
  `ImageMetadata`, not `string`.
- Build emits processed assets under `dist/_astro/` for every
  referenced cover.

---

- [ ] **Unit 4a: Write `_redirects` rules for legacy `/img/...` paths**

**Goal:** Add `_redirects` rules so externally-linked legacy
`/img/...` URLs (in search engines, social posts, inbound links)
return a useful response rather than 404 once the new asset
pipeline is live.

**Requirements:** R9

**Dependencies:** Unit 2 (mapping)

**Files:**
- Modify: `public/_redirects` — add legacy-image rules layer.

**Approach:**
- External links to `/img/2022/05/surfcam-1.jpg` will go stale
  because those URLs no longer exist (optimized assets live at
  hashed `/_astro/...` paths we don't control). Three options:
  1. **Cheap:** `/img/* /404.html 410` so search engines learn
     these are gone.
  2. **Better (recommended):** Reference `tools/img-mapping.json` to
     emit individual 301s from each old `/img/...` path to the
     canonical *page* that uses the image (e.g.,
     `/img/2022/06/dolgoch-1-scaled.jpg → /things-to-do/dolgoch-falls/`).
     Preserves SEO link equity.
  3. **Best for image SEO:** Keep public copies of optimized
     images at predictable URLs and 301 to those. Out of scope
     here; doable once a CDN move happens.
- Default to **option 1 (catch-all 410 Gone)** because the site
  has no production deployment history and therefore no referrer
  log data to identify which legacy paths actually have inbound
  link equity. Option 1 is the correct conservative default absent
  data. Option 2 (per-image 301s) becomes a post-launch upgrade
  once Search Console / Cloudflare Analytics shows which paths
  attract crawlers and inbound links — at that point, add 301s
  only for the demonstrated top inbound-bearing paths (typically
  ~10–30, not all 156).
- Collapse the existing `/wp-content/uploads/* → /img/:splat 301`
  to a direct `/wp-content/uploads/* → /404.html 410` rule for the
  same reason — chaining a 301 into a 410 confuses search engines.

**Test scenarios:**
- Happy path: a known legacy `/img/2022/06/dolgoch-1-scaled.jpg`
  returns `301` to `/things-to-do/dolgoch-falls/`.
- Edge case: A legacy URL with no mapping returns `410 Gone` from
  the catch-all.
- Happy path: WP-style legacy URL
  (`/wp-content/uploads/2022/06/dolgoch-1-scaled.jpg`) still
  resolves to the new destination via existing rule.

**Verification:**
- `dist/_redirects` contains the new rules in the correct order
  (specific before catch-all).
- Manual smoke against dev server: a legacy URL redirects as
  expected.

---

- [ ] **Unit 4b: Add `_headers` with cache-control for hashed assets**

**Goal:** Long-term immutable caching on content-hashed assets is
load-bearing for the perf pass — without it, return visitors
revalidate hashed `/_astro/...` URLs on every navigation, negating
a large fraction of the AVIF/WebP byte wins. `_headers` is portable
across Netlify and Cloudflare Pages (the two hosts the README is
choosing between).

**Requirements:** R2 (the bytes saved by AVIF/WebP only land for
return visitors with proper cache headers)

**Dependencies:** Unit 1, Unit 11 (so font URLs are also hashed by
the time headers land)

**Files:**
- Create: `public/_headers`

**Approach:**
- `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable`
  (safe because filenames are content-hashed; bumping content
  changes the URL).
- `/fonts/*` (if Astro Fonts API places them under a `fonts/` prefix
  rather than `_astro/`; verify after Unit 11 lands) → same.
- `/img/*` (legacy paths, only hit when 4a's catch-all `410`
  doesn't apply) → short cache, 1 day max.
- HTML pages (`/*` after more specific rules) → `Cache-Control:
  public, max-age=0, must-revalidate` so content updates appear
  immediately while assets stay cached.

**Test scenarios:**
- Happy path: `curl -I` on a deployed `/_astro/cover.HASH.avif`
  returns `Cache-Control: public, max-age=31536000, immutable`.
- Happy path: `curl -I` on a deployed HTML page returns
  `Cache-Control: public, max-age=0, must-revalidate`.
- Edge case: Deploying a content change updates the page HTML
  immediately on next request (revalidation works) without
  requiring a hard refresh.

**Verification:**
- DevTools → Network on second page-view: hashed assets load from
  disk cache (no 304), HTML 304s on revalidation.
- Lighthouse "Serve static assets with an efficient cache policy"
  audit passes.

---

> **Unit 4c (executes in Phase 6):** Retire `migrate:uploads` and
> delete `public/img/`. Listed at the bottom of Phase 6.

---

### Phase 2 — Component image migration

- [ ] **Unit 5: Migrate `BannerImage` to `<Picture>` with `priority`**

**Goal:** The component most likely to render the LCP image. Convert
to `<Picture formats={['avif', 'webp']}>` with the `priority` prop on
above-the-fold instances. Keep the existing `aspect-ratio: 16/5;
max-height: 480px` styling.

**Requirements:** R2, R7

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/components/BannerImage/BannerImage.astro`
- Modify (if needed): `src/components/BannerImage/BannerImage.module.scss`
- Modify: `src/layouts/BaseLayout.astro` — `Props.heroImage`
  interface (the type hand-off point through which every page
  passes its hero); change from `{ src: string; alt?: string }` to
  `{ src: ImageMetadata; alt?: string }`.
- Modify: `src/components/Header/Header.astro` — passes `heroImage`
  through to BannerImage; update prop type accordingly.
- Modify: `src/pages/[...slug].astro` — renders editorial pages
  with hero images from the `pages` collection; reads
  `page.data.hero_image` (renamed to `cover` per Unit 9), passes to
  BannerImage.
- Modify: pages that hardcode inline string heroImage paths today
  (must change to imported `ImageMetadata`):
  - `src/pages/index.astro:39` (currently `/img/2022/05/surfcam-1.jpg`)
  - `src/pages/eating/index.astro:32` (currently `/img/2022/05/eating-banner.jpg`)
  - `src/pages/things-to-do/index.astro` (similar pattern)
  - `src/pages/where-to-stay.astro` (mixed: page-data and hardcoded)
  - `src/pages/dog-friendly-cafes.astro`
  - `src/pages/webcam.astro`
- Modify: every other consumer that passes a string `src` to
  BannerImage — search via `grep -rn 'BannerImage\|heroImage' src/`.

**Approach:**
- Change the `Props` interface so `src` is `ImageMetadata` (the import
  result), not `string`. Callers pass the imported asset.
- Add `priority: boolean = true` prop default (BannerImage is
  always above the fold). Callers with the banner below the fold can
  opt out.
- Use `<Picture>` with `formats={['avif', 'webp']}`,
  `layout="full-width"`, and existing class names.
- Hand off `width`/`height` to Astro (inferred from the import); the
  module SCSS already enforces aspect ratio + max-height for layout.

**Patterns to follow:**
- Image rendering decision matrix (above).

**Test scenarios:**
- Happy path: Build a page with `BannerImage` above the fold; rendered
  HTML includes `<picture>`, `<source type="image/avif">`, `<source
  type="image/webp">`, and an `<img>` with `fetchpriority="high"
  loading="eager" decoding="sync"`.
- Edge case: A page with `priority={false}` produces lazy-loaded
  banner without `fetchpriority`.
- Integration: The 16/5 aspect ratio renders correctly on mobile and
  desktop; no CLS observed in Lighthouse.

**Verification:**
- DevTools → Network → first image request for the LCP candidate has
  `Priority: High` and resolves before any non-critical asset.
- Lighthouse on the home page reports LCP improvement vs. baseline
  (capture baseline before this unit lands).

---

- [ ] **Unit 6: Migrate card components to `<Picture>`**

**Goal:** Six near-identical components rendering thumbnail-sized
imagery. Convert each to `<Picture formats={['avif', 'webp']}
layout="constrained">` with appropriate `widths` for card sizes.

**Requirements:** R2

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Modify: `src/components/ActivityCard/ActivityCard.astro`
- Modify: `src/components/EventCard/EventCard.astro`
- Modify: `src/components/FeaturedStayCard/FeaturedStayCard.astro`
- Modify: `src/components/VenueCard/VenueCard.astro`
- Modify: `src/components/StayCategoryCard/StayCategoryCard.astro`
- Modify: `src/components/RelatedItems/RelatedItems.astro`
- Modify: `src/pages/dog-friendly-cafes.astro:60` — inline `<img>`
  list, convert to use the same `<Picture>` pattern (or extract to a
  small shared component if duplication justifies it).
- Modify: page templates that *construct* card props from collection
  entries — `src/pages/eating/index.astro`,
  `src/pages/eating/[slug].astro` (RelatedItems prop construction
  at line 144), `src/pages/things-to-do/index.astro`,
  `src/pages/things-to-do/[slug].astro` (RelatedItems prop
  construction at line 109), `src/pages/where-to-stay.astro`,
  `src/pages/holiday-accommodation/[category].astro` (passes
  `featured[].image` to FeaturedStayCard).
- Decide: `src/data/events.json` and `src/components/EventCard` —
  see "events.json data-driven image" decision below.

**events.json data-driven image decision:**
EventCard reads `event.image` from `src/data/events.json` (a plain
JSON file, not a content collection), so the `image()` schema
helper does not apply. Pick one:
- **(a)** Convert events to a `type: 'data'` content collection
  with `image()`-validated `image` field. Cleanest, but extends
  scope.
- **(b)** Render events with a plain `<img>` (not `<Picture>`)
  because the path is unknowable at build time. Lose the AVIF win
  on event imagery; acceptable since the events list is currently
  empty.
- **(c)** Move event images to `public/img/events/` and accept
  they're not Astro-pipeline processed.
Default recommendation: **(a)** because Astro 6 supports `data`
collections cleanly and events are a natural fit. Resolve in this
unit before EventCard migration.

**Approach:**
- Each component's `Props` interface gains `image: ImageMetadata` (or
  `cover: ImageMetadata`).
- Render `<Picture src={image} alt={alt} formats={['avif', 'webp']}
  widths={[320, 480, 640]} sizes="(min-width: 768px) 33vw, 100vw" />`
  (tweak widths/sizes per card layout).
- Astro infers `width`/`height` from the imported asset, so cards
  reserve the right space and CLS goes to zero.
- Page templates calling these components pass `entry.data.cover`
  instead of `entry.data.cover.src`.

**Patterns to follow:**
- Image rendering decision matrix.
- Existing `aspect-ratio` rules in module SCSS files (e.g.,
  `EventCard.module.scss:25`, `Gallery.module.scss:41`) — Astro
  inferred dimensions plus these CSS rules give CLS-safe rendering.

**Test scenarios:**
- Happy path: `/eating/` index page renders 18 venue cards; each
  thumbnail is a `<picture>` with AVIF + WebP sources; all `<img>`
  children carry width/height; all are `loading="lazy"` (none are
  the LCP candidate on a listing page).
- Edge case: A venue with no `cover` (if optional) renders without
  crashing.
- Integration: Scroll the listing on mobile and confirm AdSlot
  insertions every 3 cards still render correctly (don't break the
  card grid).

**Verification:**
- `dist/eating/index.html` contains `<picture>` for every card.
- Visual diff of `/eating/` and `/things-to-do/` against the prior
  build: layout unchanged, image quality acceptable.
- Lighthouse on `/eating/` shows reduced transfer size and image
  bytes.

---

- [ ] **Unit 7: Migrate `Gallery` and full-bleed page images to `<Image>` / `<Picture>`**

**Goal:** Galleries (thumbs + lightbox) and the venue/activity hero
photos (`eating/[slug].astro:100`, `things-to-do/[slug].astro` if
present) move to Astro pipeline. Hero photos use `<Picture>` with
`priority`; gallery thumbs use `<Image>` (no AVIF — the byte savings
on small thumbs don't justify per-format overhead).

**Requirements:** R2, R7

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Modify: `src/components/Gallery/Gallery.astro`
- Modify: `src/pages/eating/[slug].astro`
- Modify: `src/pages/things-to-do/[slug].astro`
- Modify: `src/pages/holiday-accommodation/[category].astro` —
  renders stay-category covers + `featured[].image` cards; in scope.

**Approach:**
- Hero photo on `[slug].astro` pages: `<Picture src={entry.data.cover}
  formats={['avif', 'webp']} priority />` — this is the LCP candidate
  on detail pages.
- Gallery thumbs: `<Image src={item.src} alt={item.alt}
  layout="constrained" widths={[200, 400]} />`.
- Lightbox `<img>` in the `<dialog>`: keep `<Image>` (no `<Picture>`
  needed because the dialog only opens on click; we don't pay LCP
  cost). Bump `widths` to `[800, 1200, 1600]`.
- Preserve existing dialog open/close behaviour from
  `Gallery.astro:51-68`.

**Test scenarios:**
- Happy path: A venue page with a 6-image gallery renders 6
  `<Image>` thumbs lazy-loaded.
- Happy path: Clicking a thumb opens the dialog and loads the
  full-size `<Image>`.
- Edge case: A venue with no gallery (only `cover`) renders without
  the gallery section.
- Integration: Lightbox keyboard close (Escape) and click-outside
  still work — verify the existing inline script wasn't broken by
  rewiring the image markup.

**Verification:**
- DevTools → Network: opening a venue page loads N+1 images (1 hero,
  N thumbs); the full-size lightbox versions are NOT loaded until the
  dialog opens.
- LCP on a representative venue page improves vs. baseline.

---

- [ ] **Unit 8: Migrate `Header` logo, OG image, favicon, remaining `<img>` references**

**Goal:** Sweep the remaining components, inline page `<img>` tags,
the site-wide OG image source, and the S3-hosted favicon. Header
logo uses `<Image layout="fixed">` (intentionally not responsive);
any other strays get the right rendering call.

**Requirements:** R2

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/components/Header/Header.astro`
- Modify: `src/lib/site.ts` — `defaultOgImage` (currently
  `'/img/2022/05/explore.jpg'`) flows into
  `BaseLayout.astro:61`'s `<meta property="og:image">`. After Unit
  4c deletes `public/img/`, this URL 404s on every social share.
- Modify: `src/layouts/BaseLayout.astro` — favicon currently
  references `https://visit-tywyn.s3.amazonaws.com/favicon.ico`
  (line 132); swap to local `/favicon.svg` + `/favicon.ico` (both
  already exist in `public/`).
- Modify: `src/lib/jsonld.ts` — `heroImage?: string` field at
  line 183 emits `image: absoluteUrl(input.heroImage)` for
  Schema.org structured data, fed from page templates' `entry.data.cover.src`.
  After the schema flip, `cover.src` is a hashed `_astro/` URL,
  which works for the live page but produces unstable URLs that
  Google Image Search may re-crawl on every rebuild. Decide:
  (a) keep the hashed URL (acceptable; structured-data crawlers
  re-resolve), or (b) emit a stable canonical URL pointing at
  the page that displays the image.
- Modify: any other component or page surfaced by `grep -rn '<img'
  src/ --include='*.astro'` after prior units have run.

**Approach:**
- `<Image src={logo} alt="Visit Tywyn" width={261} height={39}
  layout="fixed" loading="eager" />`. The logo is in the header on
  every page, generally above the fold but small enough to not be the
  LCP candidate; eager + fixed is correct.
- Drop the legacy unreferenced `tywyn-logo.webp` from
  `src/assets/img/site/` (Astro generates fresh).
- **OG image is special:** social platforms (Facebook, Twitter,
  LinkedIn) cache OG image URLs aggressively and their crawlers
  don't follow `<picture>` source negotiation — they want a stable
  public URL pointing at a JPEG/PNG. Solution: keep an unhashed,
  non-pipeline OG image in `public/og/og-default.jpg` (move from
  the legacy `/img/2022/05/explore.jpg`) and have `site.ts` point
  there. Don't try to send OG through `astro:assets`.
- Favicon: same rationale (social platforms / browsers want stable
  URLs). Use the existing local files; remove the S3 dependency
  and the `dns-prefetch` to S3 if it's no longer needed.

**Test scenarios:**
- Happy path: Logo renders at 261×39 on every page; no CLS.
- Edge case: Logo retains pixel-perfect rendering on retina
  (Astro emits a `srcset` with 1x/2x densities for `layout="fixed"`).
- Happy path: Sharing any page on Facebook/Twitter renders the OG
  image card with the new `/og/og-default.jpg`.
- Happy path: Browser tab favicon loads from local `/favicon.svg`
  (no S3 round-trip).

**Verification:**
- `dist/eating/index.html` (or any page) contains the logo
  `<img>` with explicit width/height and a hashed `_astro/` URL.
- `dist/eating/index.html` `<meta property="og:image">` resolves
  to `https://visit-tywyn.co.uk/og/og-default.jpg`.
- Facebook Sharing Debugger reports the OG image with no errors.

---

### Phase 3 — Content migration (frontmatter + markdown bodies)

- [ ] **Unit 9: Bulk-rewrite frontmatter image references using mapping**

**Goal:** Every `.md` file in `src/content/` updates its frontmatter
image fields from `/img/YYYY/MM/foo.jpg` strings to relative paths
into `src/assets/img/...` per `tools/img-mapping.json`. Field names
also normalize: `hero_image` / `photo` → `cover`; gallery items'
`src` paths get rewritten; `stay-categories.featured[].image` gets
rewritten.

**Requirements:** R1, R2

**Dependencies:** Unit 2 (mapping), Unit 3 (schema)

**Files:**
- Modify: every file under `src/content/eating/*.md` (18 files).
- Modify: every file under `src/content/things-to-do/*.md` (11 files).
- Modify: every file under `src/content/pages/*.md` (13 files).
- Modify: every file under `src/content/stay-categories/*.md` (4 files).
- Create: `tools/rewrite-frontmatter-imgs.ts` (one-shot script that
  parses YAML frontmatter, applies the mapping, and writes back
  preserving formatting; deletes itself after the diff is committed,
  or stays as a documented one-shot tool).

**Approach:**
- Script reads `tools/img-mapping.json`, walks `src/content/`,
  parses each file's frontmatter, replaces `/img/...` strings (in
  any field) with relative paths from the `.md` file to its mapped
  asset (e.g., `../../assets/img/eating/coast-deli/cover.jpg` or
  `./gallery/01.jpg` if we colocate galleries with content).
- Field rename: `hero_image` → `cover` everywhere; `photo` → `cover`
  in eating; structure preserved otherwise.

**Execution note:** Coordinate with Unit 3 in the same PR. Run the
rewrite, run `astro check`, fix any per-file mismatches surfaced by
the schema.

**Test scenarios:**
- Happy path: After running, `astro check` passes; every `.md`
  frontmatter validates against the new schema.
- Edge case: A markdown file with no images (e.g., a privacy policy
  page that has no `cover`) is left untouched if `cover` is optional
  in the schema; or has a placeholder added if it's required.
- Error path: A frontmatter image not present in the mapping fails
  loudly (don't silently leave a broken `/img/...` string).

**Verification:**
- `grep -rn '/img/' src/content/` returns zero hits in frontmatter.
- `astro check` is green.

---

- [ ] **Unit 10: Rewrite inline `<img>` tags in markdown bodies to `![]()` syntax**

**Goal:** Astro doesn't process raw `<img>` for `src/` images in
markdown bodies; standard `![alt](path)` does. Convert each occurrence
manually (only 9 instances across 7 files — re-verified via grep).

**Requirements:** R3

**Dependencies:** Unit 2, Unit 9

**Files:**
- Modify: 7 markdown files (9 `<img>` occurrences total, verified via
  `grep -rn '<img' src/content/`):
  - `src/content/pages/cinema.md`
  - `src/content/things-to-do/magic-lantern-cinema.md` (note:
    `_redirects` already redirects `/cinema/` to this URL; verify
    whether `pages/cinema.md` is still a live route or should be
    deleted)
  - `src/content/things-to-do/cadair-idris.md`
  - `src/content/things-to-do/castell-y-bere.md`
  - `src/content/things-to-do/the-secret-garden.md`
  - `src/content/things-to-do/nant-gwernol.md` (×2)
  - `src/content/things-to-do/the-talyllyn-railway.md` (×2)
- Hand-edit recommended (only 9 instances). If `tools/rewrite-frontmatter-imgs.ts`
  from Unit 9 is being written anyway, the inline-img substitution
  can be a second pass in the same script. Do not create a third
  standalone tool.

**Approach:**
- For each `<img src="/img/..." alt="..." width="..." height="..."
  />` tag, look up the new path in `tools/img-mapping.json` and
  replace with `![alt-from-the-tag](relative/path)`.
- Drop `width`/`height` attributes — Astro infers from intrinsic
  dimensions; the global `image.layout: 'constrained'` covers
  responsive sizing.
- Drop any inline `class=""` attributes — markdown processing won't
  preserve them (and they came from WP export, likely not load-bearing).

**Test scenarios:**
- Happy path: `dist/cinema/index.html` (or wherever the cinema
  content renders) contains a `<picture>` (or `<img>` with srcset)
  with hashed `_astro/` URLs; the 911 KB cinema PNG is now AVIF/WebP
  at <100 KB.
- Edge case: A markdown body with multiple inline images in a row
  renders all of them, each processed independently.
- Edge case: An inline image with surrounding text renders inline
  with text flow preserved (not wrapped in unwanted block elements).

**Verification:**
- `grep -rn '<img' src/content/` returns zero hits (after unit
  completes; remaining `<img>` should only be in component code,
  not content).
- The cinema page's transferred image bytes drop from ~911 KB to
  ~50–100 KB across formats.

---

### Phase 4 — Fonts

- [ ] **Unit 11: Self-host Lato via Astro 6 Fonts API**

**Goal:** Drop the render-blocking `<link
href="fonts.googleapis.com/...">` request; serve subsetted, preloaded
Lato woff2 from origin with an automatic metric-matched fallback.

**Requirements:** R4

**Dependencies:** None (independent of image work)

**Files:**
- Modify: `astro.config.mjs` — add `fonts: [...]` block.
- Modify: `src/layouts/BaseLayout.astro:106-109` — remove the Google
  Fonts CSS `<link>`; remove the `fonts.googleapis.com` and
  `fonts.gstatic.com` `<link rel="preconnect">` (no longer needed
  with self-hosting). Add `<Font cssVariable="--font-body" preload />`.
- Modify: `src/styles/abstracts/_variables.scss:37-44` — change
  `$font-body` to use `var(--font-body)` with the existing system
  fallback stack as backup.

**Approach:**
- `fonts: [{ name: 'Lato', cssVariable: '--font-body', provider:
  fontProviders.fontsource(), weights: [400, 700], styles:
  ['normal'], subsets: ['latin', 'latin-ext'], fallbacks: ['system-ui',
  '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue',
  'sans-serif'] }]`. The optimized fallback metrics are auto-derived
  from the last fallback (`sans-serif`) to neutralize CLS.
- **Subset note:** `subsets: ['latin', 'latin-ext']` is the safe
  default. Welsh diacritics `ŵ` (U+0175) and `ŷ` (U+0177) are in
  Latin Extended-A, which lives in the `latin-ext` subset, NOT the
  base `latin` subset. Costs one additional small woff2 file per
  weight; correctness on Welsh content is worth it.
- **API form caveat:** The `<Font />` component shape (`preload`
  boolean vs `preload={[{...}]}` array) and the top-level `fonts:
  [...]` config (vs `experimental: { fonts: [...] }` wrapper) differ
  between Astro 6.0 and the version installed (6.1.9). Verify
  against `node_modules/astro/dist/...` schema before committing
  the config; if `fonts` is still flagged experimental, wrap it
  accordingly.
- `<Font cssVariable="--font-body" preload />` — preload the body
  weight. The granular per-weight `preload={[{...}]}` array form may
  not be valid in 6.1.9 (verify against installed types); if the
  boolean preloads too many faces, use two `fonts: [...]` config
  entries — one with `preload: true` for the body weight, one
  without for 700.
- Update `_variables.scss` so `$font-body: var(--font-body),
  system-ui, ...`. Heading variable mirrors body (already does:
  `$font-heading: $font-body`).
- Audit during execution whether weight `700` is actually used; if
  not, drop it from the `fonts` config to save the woff2 download
  entirely.

**Patterns to follow:**
- Astro 6 fonts guide (linked in External References).

**Test scenarios:**
- Happy path: `astro build` emits Lato woff2 files under
  `dist/_astro/fonts/`; rendered HTML includes `<link rel="preload"
  as="font" type="font/woff2" crossorigin>` for the 400 weight only.
- Happy path: DevTools → Network → first paint loads Lato 400 from
  origin; no `fonts.googleapis.com` or `fonts.gstatic.com` requests.
- Integration: Welsh diacritics in content (e.g., "Cadair Idris",
  "Tywyn", any "ŵ"/"ŷ") render correctly using Lato (latin subset
  covers them).
- Edge case: A connection that drops mid-font-load shows the metric-
  matched fallback with no visible layout shift on font swap.

**Verification:**
- Lighthouse "Eliminate render-blocking resources" no longer flags
  `fonts.googleapis.com`.
- CrUX CLS for the origin trends down (post-deploy, requires
  field data).
- Manual: throttle network to 3G, refresh — text is readable
  immediately in the fallback, then swaps to Lato without obvious
  reflow.

---

### Phase 5 — Third-party scripts (analytics, ads, embeds)

- [ ] **Unit 12: Replace UA tracking with GA4**

**Goal:** Remove the dead UA-28386547-1 snippet (sunset July 2023);
add a GA4 snippet using a new measurement ID. Net effect: roughly
the same script weight (slightly larger) but actually collecting
data.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/lib/site.ts` — add `gaMeasurementId: 'G-XXXXXXX'`
  (placeholder; user provides real ID before implementation).
- Modify: `src/layouts/BaseLayout.astro:136-146` — replace the UA
  snippet with the GA4 equivalent.

**Approach:**
- New head snippet: `<script async src="https://www.googletagmanager.com/gtag/js?id={GA4_ID}"></script>`
  + `<script is:inline>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '{GA4_ID}');</script>`.
- Read the measurement ID from `SITE.gaMeasurementId` (matches the
  `SITE.adsenseClient` pattern in `src/lib/site.ts`).
- Drop the `dns-prefetch` to `google-analytics.com` and
  `stats.g.doubleclick.net` (GA4 uses `region1.google-analytics.com`
  and similar; preconnect tuning is GA4-specific and not
  high-priority — leave the existing `googletagmanager.com`
  preconnect since GA4 still needs it).

**Test scenarios:**
- Happy path: Built HTML for any page contains the GA4 snippet
  with the configured measurement ID; no UA-prefixed strings remain
  anywhere in `src/`.
- Edge case: With `gaMeasurementId` set to an empty string in
  `site.ts`, the snippet is omitted entirely (build doesn't ship
  unconfigured tracking).
- Integration: After deploy, GA4 Realtime report shows the test
  pageview within 30 seconds.

**Verification:**
- `grep -rn 'UA-' src/` returns zero hits.
- `grep -rn 'gtag/js?id=' src/` returns the new measurement ID.
- DevTools → Network on a deployed page shows
  `googletagmanager.com/gtag/js` and
  `region1.google-analytics.com/g/collect` requests fire.

---

- [ ] **Unit 13: Idle-load AdSense + verify CLS reservations**

**Goal:** Move the AdSense loader script from `defer` in `<head>`
to `requestIdleCallback`-loaded after first paint. Confirm every
ad-bearing region has reserved space so CLS stays at 0 even when
ads fill (or fail to fill).

**Requirements:** R6

**Dependencies:** None (independent of image / font work)

**Files:**
- Modify: `src/layouts/BaseLayout.astro:152-155` — remove the
  current AdSense `<script defer src="...adsbygoogle.js">` from
  `<head>`.
- Modify: `src/layouts/BaseLayout.astro` — add a small `is:inline`
  script (5–8 lines) at the end of `<body>` that schedules the
  AdSense loader via `requestIdleCallback(loader, { timeout: 3000 })`
  with `setTimeout` fallback. No new component needed for a one-call-site
  pattern; matches existing inline-script convention used by
  `AdSlot.astro:29-31`.
- Modify: `src/components/AdSlot/AdSlot.astro` — verify
  `min-height` reservations for **all three** rendering contexts:
  (1) sidebar narrow column (rendered in `Sidebar.astro:147` on
  every venue/activity detail page; current 90 px is fine for a
  banner unit);
  (2) in-feed on `/eating/` (`src/pages/eating/index.astro:60`,
  inserted every 3 cards; needs reservation matching the card grid
  cell height — likely 250 px for a medium rectangle);
  (3) in-feed on `/things-to-do/` (`src/pages/things-to-do/index.astro:58`,
  same shape).
  One AdSlot component, one slot ID (`7221027714`), three layout
  contexts → may need either three CSS rules keyed by parent
  context, or one component prop `placement="sidebar" |
  "in-feed"` that sets the right `min-height`.
- Modify: `src/components/AdSlot/AdSlot.module.scss` — add the
  per-placement reservation rules.

**Approach:**
- New loader pattern (inline at end of `<body>`):
  - On `requestIdleCallback(loader, { timeout: 3000 })` (or
    `setTimeout(..., 1)` fallback for browsers without
    `requestIdleCallback`), append the AdSense `<script async
    src="...adsbygoogle.js">` to the body.
- **Loader-vs-push ordering contract (load-bearing for ad
  revenue):** the per-AdSlot `(adsbygoogle = window.adsbygoogle ||
  []).push({})` inline scripts run *during* HTML parse, before the
  loader executes. Today they survive because `defer` on the
  loader still arrives before DOMContentLoaded; after the change,
  they execute against `window.adsbygoogle` being just an empty
  array. The pushed entries DO queue in the array — when the
  loader eventually executes, AdSense's `adsbygoogle.push`
  prototype-swap converts queued entries into real impressions.
  This works correctly **as long as the loader actually runs**;
  the `timeout: 3000` ceiling above guarantees it. Confirm via
  staging that ad fill rate matches pre-change baseline.
- Confirm reserved dimensions are correct for slot ID
  `7221027714` in all three rendering contexts (per
  AdSlot file modifications above).

**Test scenarios:**
- Happy path: First contentful paint occurs without waiting for
  AdSense; AdSense loads after idle and ads fill.
- Edge case: AdSense fails to load (network blocked / ad blocker)
  — the reserved 90 px area stays empty, no CLS.
- Edge case: A page with no `AdSlot` (if any exist) doesn't ship
  the loader unnecessarily.

**Verification:**
- DevTools → Performance: AdSense network request starts after the
  LCP event, not before.
- Lighthouse → CLS = 0 on `/eating/` (which has multiple
  in-feed AdSlots).
- Visual: ad placeholder rendered immediately at correct size; ad
  fills in without layout shift.

---

- [ ] **Unit 14: Fix malformed YouTube iframes + add `loading="lazy"` to all markdown iframes**

**Goal:** Two markdown files have YouTube embeds with a malformed
`embed//<id>` URL (double slash). Two more have iframes with no
`loading=` attribute. Fix in place; no facade adoption.

**Requirements:** R3 (sort of — content cleanup), R8

**Dependencies:** None

**Files:**
- Modify: `src/content/pages/tywyn-beach.md` — fix `embed//` to
  `embed/`; add `loading="lazy"`.
- Modify: `src/content/things-to-do/tywyn-beach.md` — same.
- Modify: `src/content/pages/wales-coastal-path.md` — add
  `loading="lazy"` to Google My Maps iframe.
- Modify: `src/content/things-to-do/castell-y-bere.md:49` — add
  `loading="lazy"` to virtual tour iframe.
- Modify: `src/components/VenueMap/VenueMap.astro` — Google Maps
  iframe currently has no `allow=""` attribute, so it inherits the
  embedding page's Permissions Policy and can prompt visitors for
  geolocation. Add `allow=""` (no permissions) since the embedded
  map doesn't need device features for its display use case.

**Approach:**
- Hand edits; only 4 files. Confirm via `grep -rn '<iframe' src/content/`.
- Add `loading="lazy"`, `referrerpolicy="no-referrer-when-downgrade"`,
  and `allow="accelerometer; autoplay; clipboard-write;
  encrypted-media; gyroscope; picture-in-picture; web-share"` to
  YouTube embeds (current YouTube embed defaults).

**Test scenarios:**
- Happy path: Tywyn Beach page renders a working YouTube embed
  (previously broken due to `embed//`).
- Edge case: All four iframes have `loading="lazy"` after edit.

**Verification:**
- `grep -rn '<iframe' src/content/` shows every match has
  `loading="lazy"`.
- Manual: visit `/things-to-do/tywyn-beach/` — the YouTube embed
  thumbnail shows and plays on click.

---

- [ ] **Unit 15: Audit `is:inline` scripts (optional micro-cleanup)**

**Goal:** Move Nav and Gallery `is:inline` scripts to hoisted
`<script>` (no attributes), leveraging Astro's bundling and
deduplication. AdSense init stays inline (third-party global
reference). Improves perf marginally; primarily a code-cleanliness
pass.

**Requirements:** None directly (related to general cleanup)

**Dependencies:** None

**Files:**
- Modify: `src/components/Nav/Nav.astro:64-75`
- Modify: `src/components/Gallery/Gallery.astro:51-68`

**Approach:**
- Drop `is:inline` from the Nav toggle and Gallery dialog scripts.
- Switch any single-element `getElementById` lookups to
  `querySelectorAll(...).forEach(...)` so the bundled script handles
  multiple instances correctly (per the Astro client-side scripts
  guide pattern).
- Verify Galleries on pages with multiple instances (none today, but
  defensive) still work.
- **Future-router note:** if `<ClientRouter />` (Astro 6 successor
  to `<ViewTransitions />`) is adopted in a later plan, hoisted
  scripts won't re-execute on client-side navigations and will
  silently break Nav/Gallery rebinds. Adopt `astro:page-load`
  listeners or `data-astro-rerun` at that point. Out of scope here;
  flagged for the future router PR.

**Test scenarios:**
- Happy path: Mobile nav toggles open/close; Gallery dialog opens
  and closes via thumb click and Escape key.
- Edge case: A page with 0 Galleries doesn't ship the Gallery script
  (Astro's bundling handles this; verify in built output).

**Verification:**
- `dist/eating/index.html` has at most one `<script type="module"
  src="/_astro/...">` for the bundled tiny scripts (rather than N
  inline copies).
- Manual smoke: Nav and Gallery interactions still work.

---

### Phase 6 — Verification + tuning

- [ ] **Unit 16: Lighthouse baseline + post-pass measurement**

**Goal:** Capture before/after Lighthouse + CrUX measurements to
prove the pass moved metrics. Tune any image whose AVIF/WebP output
looks visibly degraded.

**Requirements:** Validates R1–R7

**Dependencies:** All prior units

**Files:**
- Create: `docs/perf/2026-04-post-pass.md` — short doc capturing
  post-pass Lighthouse mobile scores for: home, `/eating/`,
  `/eating/dovey-inn/` (representative venue with hero + gallery),
  `/things-to-do/cadair-idris/` (representative activity), `/cinema/`
  (markdown-body-LCP test page). Compares against the
  `docs/perf/2026-04-baseline.md` from Unit 0.
- Modify (potentially): `astro.config.mjs` if any per-format quality
  needs tightening or a specific image needs a per-call quality
  override.

**Approach:**
- Pre-pass baseline already captured by Unit 0.
- Re-measure at the end of each phase and at end of pass; capture
  field data from CrUX 28 days post-deploy.
- Same methodology as Unit 0 (5 runs, median, Slow 4G + Moto G
  Power emulation, PageSpeed Insights API preferred).

**Hard go/no-go thresholds (per phase):**

| Page | Metric | Hard threshold (ship gate) | Block-merge if regression vs Unit 0 baseline |
|------|--------|----------------------------|-----------------------------------------------|
| `/` | LCP (mobile) | ≤ 2.5s | > baseline + 200ms |
| `/` | CLS | ≤ 0.05 | > 0.10 |
| `/` | Total transfer | ≤ 60% of baseline | > 80% of baseline |
| `/eating/` | LCP | ≤ 2.5s | > baseline + 200ms |
| `/eating/` | Image bytes | ≤ 40% of baseline | > 60% of baseline |
| `/eating/dovey-inn/` | LCP | ≤ 2.5s | > 3.0s |
| `/eating/dovey-inn/` | CLS | ≤ 0.05 | > 0.10 |
| `/cinema/` | LCP | ≤ 2.5s | > baseline + 200ms |
| Build wall-clock | n/a | ≤ 3 min cold cache, ≤ 60s warm | > 5 min cold |

Per-phase gates: Phase 2 (image migration) must hit ≥40% image
byte reduction or it's not worth merging. Phase 4 (fonts) must
eliminate the `fonts.googleapis.com` request entirely. Phase 5
must show no LCP regression vs end-of-Phase-2 measurement.

**Test scenarios:** measurement only; gate is the threshold table
above.

**Verification:**
- `docs/perf/2026-04-baseline.md` updated with post-pass numbers
  for every metric in the threshold table.
- WebPageTest waterfall on `/` shows Lato woff2 preloaded before
  hero `<img>` request; hero `<img>` has `Priority: High`; AdSense
  starts after LCP event.
- CrUX 75th-percentile LCP for the origin trends down 28 days
  post-deploy (field-data confirmation, separate follow-up).

---

- [ ] **Unit 4c: Retire `migrate:uploads` and delete `public/img/`**

**Goal:** Final cleanup; remove the migration tool and the
now-unused source images directory after Lighthouse confirms zero
regressions.

**Requirements:** R1 (concludes the migration)

**Dependencies:** Unit 9, Unit 10, Unit 16 (post-pass measurement
must confirm no regressions before deletion)

**Files:**
- Delete: `public/img/` directory (verify zero references first).
- Modify or delete: `tools/migrate-uploads.ts` (default delete; see
  Open Questions).
- Modify: `package.json` — remove `migrate:uploads` script if the
  tool is deleted.
- Modify: `.gitignore` — remove the `public/img/20*/` ignore line.

**Approach:**
- `grep -rn '/img/' src/ public/ tools/` before deletion — must
  return only `_redirects` and `_headers` rule strings.
- Commit deletion as a separate, easily-revertable PR.

**Test scenarios:**
- Happy path: After deletion, `npm run build` produces an
  identical `dist/` (modulo the deleted directory).
- Edge case: `_redirects` legacy 301s still resolve correctly
  because they don't depend on `public/img/` existing.

**Verification:**
- Site renders correctly post-deploy.
- No 404s in server logs for `/img/...` paths originating from the
  site itself (only from external referrers, handled by 4a).

---

## System-Wide Impact

- **Interaction graph:** The image schema change (Unit 3) ripples
  through every page template that reads `entry.data.cover`. Every
  caller of `BannerImage` (Unit 5) ripples to its consumers. The
  Fonts API change (Unit 11) interacts with global SCSS variables.
  These are coordinated cross-file changes; land each phase as a
  single PR to keep `astro check` green throughout.
- **Error propagation:** A missing image in frontmatter now fails
  the build (schema enforcement) rather than silently rendering a
  broken `<img>`. This is a desirable behaviour change but means
  Unit 9 must be exhaustive — verify `astro check` is clean before
  merging Phase 3.
- **State lifecycle risks:** None introduced. Static build, no
  runtime state.
- **API surface parity:** The site's _public_ surface (URLs)
  changes only at the asset layer: `/img/...` paths disappear
  (replaced by hashed `/_astro/...`). Page URLs, RSS feeds, sitemap
  entries unchanged. `_redirects` (Unit 4) preserves SEO equity for
  legacy `/img/...` inbound links by 301-ing them to the canonical
  consuming page.
- **Integration coverage:** Card listings + AdSlot insertion is the
  one cross-cutting interaction worth eyeballing — the perf pass
  should not break the every-3-cards ad placement on `/eating/` and
  `/things-to-do/`. Manual smoke after Phase 2.
- **Unchanged invariants:** Page routes, content collection slugs,
  navigation, breadcrumbs, RSS/sitemap output, redirect rules for
  WP-style URLs (only the destination format changes), the venue
  map iframe behaviour, the gallery dialog UX, the Welsh diacritic
  rendering in Lato.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| AVIF encoding inflates build time from seconds to >1 minute. | Default `avif.effort: 4` (per Key Technical Decisions) keeps cold-cache builds in the 60-90s range. If still painful, defer AVIF to a later iteration and ship WebP-only first. |
| CI build cache not persisted between runs → every deploy re-encodes 1,400 transforms from cold cache. | Astro caches generated images in `node_modules/.astro/`. On Netlify, set `[build] cache_directories = ["node_modules/.astro"]` in `netlify.toml`. On Cloudflare Pages, the build cache is automatic for `node_modules/` but verify `.astro/` is included. Without this, every deploy hits the 5-minute cold-cache build path; with it, incremental builds drop to seconds. |
| `<Picture>` AVIF source delays preload-scanner discovery of LCP image by 100–300ms (the scanner can't evaluate `type` support upfront). | Verify in WebPageTest waterfall after Unit 5; if real, downgrade hero to single-format `<Image>` (WebP only) for a ~15–20% byte cost on the single LCP image, OR emit a manual `<link rel="preload" as="image" imagesrcset type="image/avif">`. |
| Schema cutover is more atomic than a single PR can comfortably contain — Units 3, 5, 6, 7, 8, 9, 10 all touch incompatible types. | Bridge schema pattern (per Key Technical Decisions): land `cover: image().optional()` alongside legacy `hero_image: imageSchema.optional()` in Phase 1; populate via Phase 3 rewrite; migrate components in Phase 2; remove legacy field in a small follow-up. Allows phased PRs without a giant atomic super-PR. |
| AdSense loader runs after per-AdSlot push scripts → if `requestIdleCallback` starves indefinitely, ads never fill (zero impressions, lost revenue). | `{ timeout: 3000 }` on `requestIdleCallback` ceiling guarantees loader runs within 3 seconds of first paint regardless of main thread state. Confirm fill rate matches pre-change baseline on staging. |
| AdSense fill rate may drop because late loading is penalized by ad networks. | Measure ad revenue 1–2 weeks post-deploy; if material drop, revert to `defer` in `<head>` (no other code change required). |
| Schema change (Unit 3) + frontmatter rewrite (Unit 9) must land together. Half-applied state breaks `astro check`. | Land in a single PR; CI runs `astro check`. If a hot-fix is needed mid-PR, revert the schema change first. |
| Hero image `surfcam-1.jpg` has no original WebP; the only existing copy is the JPG in `public/img/`. After migration, Sharp regenerates AVIF/WebP from the JPG. | Verify the JPG is the highest-quality source available before deletion. If a higher-quality master exists in S3 backup, prefer that. |
| `_redirects` rule explosion: emitting one rule per legacy `/img/...` URL (Unit 4 option 2) could add hundreds of rules. | Acceptable for Netlify/Cloudflare Pages (limits are in the thousands). If host changes to one with a tighter limit, fall back to option 1 (catch-all 410). |
| Welsh-language content uses diacritics not in the basic Latin subset (e.g., `ŵ`, `ŷ`). | Astro Fonts API `subsets: ['latin']` includes Latin Supplement which covers these. Verify visually after Unit 11 on a page with diacritics. If broken, add `subsets: ['latin', 'latin-ext']`. |
| GA4 measurement ID mistakenly committed as placeholder. | Build skips the snippet entirely if `gaMeasurementId === ''` (Unit 12 test scenario). PR template should mention swapping the ID before merge. |
| AdSense idle-load reduces fill rate (real-world ad networks penalize late-loading inventory). | Measure ad revenue 1–2 weeks post-deploy; if material drop, revert to `defer` in `<head>` (no other code change required). |
| Image quality regression on flagship outliers (cinema PNG, Cadair Idris hero). | Visually inspect during Unit 16; per-call `quality` override on `<Picture>` if the global default is too aggressive. |
| Markdown `<img>` with inline `class` attributes loses styling when rewritten to `![]()`. | Audit CSS for selectors targeting `.entry-content img.something` — none expected (WP-export classes were not load-bearing in the SCSS port), but verify via `grep` before Unit 10. |
| Three third-party origins (GA4, AdSense, Ahrefs) compete with image and font requests during first paint. | After Unit 13 lands, confirm `<head>` preconnect order: Lato font preload → preconnect to ad/analytics origins (not the reverse). Drop dead preconnects (`google-analytics.com`, `stats.g.doubleclick.net` were UA-era). Verify in WebPageTest that no third-party request gets `Priority: High`. |
| Dev hot-reload character changes when images move from `public/` to `src/assets/` — first request to a new image after edit goes through Vite transform pipeline (200ms-2s per image). | Document in `README.md` for content editors. Mitigation: `astro dev --remote` for warm-up; or accept the cost since it only hits new images. |
| TypeScript compile time grows because `image()` validation forces import of every referenced image at content-build time. | Acceptable; adds a few seconds to fresh builds. If `tsserver` becomes sluggish in editor, suggest editors restart TS server periodically (already a normal workflow). |
| LCP element on some pages may be *text*, not an image (e.g., the home page heading rendered before surfcam photo loads). Image preload optimization is wasted work on text-LCP pages. | Unit 0 (baseline) explicitly identifies the LCP element per page. If a page's LCP is text, drop `priority` on its hero image (still load eager, but don't fight for fetchpriority). Adjust Unit 5/7 per-page accordingly. |

## Documentation / Operational Notes

- After Unit 4 lands, the `migrate:uploads` script in `package.json`
  can be removed. README's "Decide on host" follow-up is unchanged
  by this work; cache-control headers for `/_astro/*` should be set
  to `public, max-age=31536000, immutable` once host is chosen
  (the content-hashed filenames make this safe).
- A first entry in `docs/solutions/` (currently nonexistent)
  capturing the WordPress→Astro image migration would be valuable
  institutional knowledge — recommend running
  `compound-engineering:ce-compound` after Phase 3 to capture the
  pattern for future migrations.
- GA4 setup requires a measurement ID from Google Analytics admin
  (Property → Data Streams). User to create the property and
  provide the ID before Unit 12.
- The reorganization manifest (`tools/img-mapping.json`) is useful
  archival evidence of the rename and should be committed alongside
  the rewrite PR even if the script itself is deleted afterwards.

## Sources & References

- [Astro 6 images guide](https://docs.astro.build/en/guides/images/)
- [`astro:assets` API reference](https://docs.astro.build/en/reference/modules/astro-assets/)
- [Astro 6 fonts guide](https://docs.astro.build/en/guides/fonts/)
- [Astro 6 configuration reference: image options](https://docs.astro.build/en/reference/configuration-reference/#image-options)
- [Astro 6 client-side scripts guide](https://docs.astro.build/en/guides/client-side-scripts/)
- [Astro 6 prefetch guide](https://docs.astro.build/en/guides/prefetch/)
- [Astro 6 upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v6/)
- [web.dev: Fetch Priority API](https://web.dev/articles/fetch-priority)
- [DebugBear: Avoid overusing fetchpriority="high"](https://www.debugbear.com/blog/avoid-overusing-fetchpriority-high)
- [DebugBear: Web font layout shift](https://www.debugbear.com/blog/web-font-layout-shift)
- [Core Web Vitals 2026 thresholds (DigitalApplied)](https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide)
- Prior plan: [docs/plans/2026-04-27-001-refactor-rename-uploads-to-img-plan.md](docs/plans/2026-04-27-001-refactor-rename-uploads-to-img-plan.md)
- Existing config: [astro.config.mjs](astro.config.mjs)
- Existing content schema: [src/content.config.ts](src/content.config.ts)
- Existing migration tool (to be retired): [tools/migrate-uploads.ts](tools/migrate-uploads.ts)
