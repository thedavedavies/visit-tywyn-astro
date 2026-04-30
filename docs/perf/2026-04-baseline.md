---
title: "perf: Pre-pass baseline"
type: perf-baseline
status: captured
date: 2026-04-30
plan: docs/plans/2026-04-28-001-refactor-site-performance-pass-plan.md
unit: 0
---

# Pre-pass performance baseline

Captured before any Stage 1 changes land, so post-pass deltas have
ground truth. Methodology, raw numbers, and reproduction steps below.

## Methodology

The new Astro site has no production deployment yet (host decision is
an open follow-up in the README), so PageSpeed Insights / CrUX cannot
reach it and field LCP/INP/CLS are unmeasurable today. The baseline
therefore prioritizes deterministic, on-disk byte counts of every
resource each rendered page references — those translate directly
into LCP wins under any network condition and reproduce exactly on
re-run.

- **Build:** `npm run build` against commit `df1df7e` (refactor/perf-pass).
- **Tool:** [`tools/perf/measure-pages.ts`](../../tools/perf/measure-pages.ts) — parses each
  rendered HTML file in `dist/`, extracts every `<img src>`,
  `<link rel="stylesheet">`, `<script src>`, and `<link rel="preload"
  as="font">`, plus `url(...)` references inside any same-origin
  stylesheet, and sums on-disk file sizes.
- **Sample pages** (per Unit 0 of the plan):
  1. `/` (home — banner image LCP)
  2. `/eating/` (listing page — 20 venue cards)
  3. `/eating/dovey-inn/` (representative venue with hero + gallery)
  4. `/things-to-do/cadair-idris/` (representative activity)
  5. `/things-to-do/magic-lantern-cinema/` (formerly `/cinema/` — markdown body
     contains the 911 KB inline PNG, so LCP is the body image, not
     the page banner)
- **Counts not captured:** Lighthouse mobile-emulated LCP / INP / CLS
  scores. Out of reach until a staging URL exists. Re-capture via PSI
  on staging once the host is chosen and the same five paths are
  reachable.

## Build wall-clock

| Build | Wall-clock | Pages built |
|-------|------------|-------------|
| Cold (`dist/` removed)  | 4.57 s | 48 |
| Warm (incremental)      | 3.05 s | 48 |

Total `dist/` size: **23 MB**, of which **18 MB is unprocessed
`public/img/`** (155 raster files: 73 webp, 68 jpg, 12 jpeg, 3 png).
`dist/_astro/` is 20 KB (just the bundled CSS + tiny scripts).

## Per-page weight (encoded bytes from disk)

| Path | Total | Image | CSS | JS | Doc | External reqs |
|------|------:|------:|----:|---:|----:|--------------:|
| `/` | **137.6 KB** | 108.3 KB | 11.1 KB | 2.2 KB | 16.1 KB | 4 |
| `/eating/` | **1.61 MB** | 1.56 MB | 11.1 KB | 2.2 KB | 35.5 KB | 4 |
| `/eating/dovey-inn/` | **443.5 KB** | 404.4 KB | 11.1 KB | 2.2 KB | 25.8 KB | 4 |
| `/things-to-do/cadair-idris/` | **900.2 KB** | 868.0 KB | 11.1 KB | 2.2 KB | 18.9 KB | 4 |
| `/things-to-do/magic-lantern-cinema/` | **1.42 MB** | 1.39 MB | 11.1 KB | 2.2 KB | 22.7 KB | 4 |

Image bytes dominate every page (78–97% of total). The four
external requests on every page are the same (Lato CSS, GA loader,
AdSense loader, Ahrefs analytics) and will be cut by Stage 1 (font
self-host removes one; AdSense move to idle defers timing but not
bytes).

## LCP candidate per page

The largest static `<img>` per page, identified statically. Real
LCP element confirmation needs a runtime PerformanceObserver run on
deployed staging — these are best-guess based on byte size and DOM
position.

| Path | Likely LCP element | Bytes |
|------|--------------------|------:|
| `/` | `/img/2022/05/surfcam-1.jpg` (BannerImage) | 109.7 KB |
| `/eating/` | `/img/2022/05/photo0565.jpg` (first VenueCard) | 244.0 KB |
| `/eating/dovey-inn/` | `/img/2022/05/enjoy-afternoon-tea-at.jpg` (venue hero) | 117.5 KB |
| `/things-to-do/cadair-idris/` | `/img/2022/07/cadair_idris-scaled.jpg` (hero) | 289.7 KB |
| `/things-to-do/magic-lantern-cinema/` | `/img/2022/10/tywyn-cinema.png` (markdown body) | 911.1 KB |

The `magic-lantern-cinema` page is the markdown-body-LCP test case
called out in the plan: a 911 KB inline PNG in the article body
beats the (much smaller) page banner for LCP. Image-preload on the
page hero won't help that page; the inline image needs to migrate
into the Astro pipeline (Stage 2).

## CLS risk surface

Every `<img>` in the rendered HTML lacks `width`/`height` attributes
on all but the header logo. Browsers cannot reserve space, so each
image triggers a layout shift when it loads.

| Path | `<img>` missing width/height |
|------|-----------------------------:|
| `/` | 1 of 2 |
| `/eating/` | **19 of 20** |
| `/eating/dovey-inn/` | 5 of 6 |
| `/things-to-do/cadair-idris/` | 5 of 7 |
| `/things-to-do/magic-lantern-cinema/` | 5 of 7 |

Plus 4 `<iframe>` references in markdown bodies without
`loading="lazy"` (Unit 14 fixes), and the AdSense slot has no
reserved height (Unit 13 fixes).

The `<img>` problem is a Stage 1 quick win (Unit Q1): adding the
already-known intrinsic dimensions as attributes is a one-day sweep
that drives CLS to ~0 without touching the asset pipeline.

## External resource chain (every page)

From the rendered HTML on every sample page:

- `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Lato:wght@400;700&display=swap">` — render-blocking. Unit 11 removes.
- `<script src="https://www.googletagmanager.com/gtag/js?id=UA-28386547-1">` — UA tag, sunset July 2023, not collecting. Unit 12 replaces.
- `<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" defer>` — AdSense loader. Unit 13 moves to idle.
- `<script async src="https://analytics.ahrefs.com/analytics.js">` — kept; already async, low priority.

`<link rel="preconnect">` to `fonts.googleapis.com`,
`fonts.gstatic.com`, `googletagmanager.com`,
`pagead2.googlesyndication.com` and `dns-prefetch` to
`analytics.ahrefs.com`, `google-analytics.com` are all in
`<head>`. The `google-analytics.com` dns-prefetch is dead with the
UA tag and will be dropped in Unit 12.

## Site-wide image inventory (baseline)

- 155 raster files in `public/img/`, **18 MB on disk**.
- 73 `.webp` companions (legacy ShortPixel, never referenced from
  the source — they shipped to `dist/` but no `<img>` points at
  them). Stage 2 deletes them along with the move to
  `src/assets/img/`.
- 0 `.avif`. Whole format dimension is unused.
- Top outliers (already flagged in the plan):

| File | Bytes | Used on |
|------|------:|---------|
| `/img/2022/10/tywyn-cinema.png` | 911 KB | `/things-to-do/magic-lantern-cinema/` (markdown body), `/things-to-do/magic-lantern-cinema/` |
| `/img/2022/06/dolgoch-2-scaled.jpg` | 596 KB | `/things-to-do/dolgoch-falls/` |
| `/img/2022/06/dolgoch-1-scaled.jpg` | 570 KB | `/things-to-do/dolgoch-falls/` |
| `/img/2022/06/0812889_1_4.jpg` | 324 KB | Talyllyn gallery |
| `/img/2022/07/cadair_idris-scaled.jpg` | 290 KB | Cadair Idris hero |

## Reproduction

```bash
npm run build
npx tsx tools/perf/measure-pages.ts
```

Produces `docs/perf/baseline-pages.json` (committed alongside this
doc) with per-page resource lists. Re-run after each Stage 1 unit
to get exact byte deltas. The script is deterministic — same dist
content always produces the same numbers.

## Open: field metrics

Not captured here, must be captured once the site is deployed:

- Lighthouse mobile (Slow 4G, Moto G Power emulation, 5 runs median)
  for: LCP, INP, CLS, Speed Index, TBT, Total Blocking Time.
- CrUX field data (28-day rolling) once the origin has traffic.
- WebPageTest waterfall on `/` to confirm `<head>` request order.

These three numbers per page (LCP, INP, CLS) are the Core Web
Vitals gates in Unit 16's threshold table. Stage 1 will reduce
bytes and CLS; whether it hits the green CWV band requires
deployed-staging measurement before the gate decision can be made.
