---
title: "Lighthouse baseline (Stage 1, post-merge)"
type: perf-measurement
status: captured
date: 2026-05-01
methodology: lighthouse 13.1 mobile preset, Slow 4G simulated, headless localhost
---

# Lighthouse baseline: Stage 1 perf pass, after merge to main

First actual runtime measurements taken since the perf pass started.
Until now, every claim about "perf" had been static byte counts plus
assertions from the rebuild plan. These are the numbers.

## Scores at a glance

| Page | Score | LCP | CLS | TBT | SI | Bytes |
|------|------:|----:|----:|----:|---:|------:|
| `/` | **98** | 2.4s | 0 | 0ms | 1.7s | 204 KB |
| `/eating/` | **91** | 3.5s | 0 | 0ms | 1.4s | 716 KB |
| `/eating/dovey-inn/` | **97** | 2.5s | 0 | 0ms | 1.2s | 896 KB |
| `/things-to-do/cadair-idris/` | **82** | 4.8s | 0 | 0ms | 1.2s | 966 KB |
| `/things-to-do/magic-lantern-cinema/` | **76** | 7.8s | 0 | 0ms | 1.2s | 1519 KB |

Scoring bands: Lighthouse green ≥ 90, orange 50-89, red < 50.
LCP green ≤ 2.5s, orange 2.5-4.0s, red > 4.0s.

## Honest read

**The Stage 1 work paid off where the plan promised it would.**

- **CLS = 0 on every page.** The Q1 image-dimension work and AdSense
  reservations did exactly what they were supposed to do.
- **TBT = 0ms on every page.** The site ships effectively no
  client-side JavaScript. Astro's static-first model is doing the
  work.
- **Speed Index 1.2-1.7s on every page.** Above-fold paint is fast.
  The font self-hosting, render-blocking removal of dead UA gtag,
  and idle-loaded ads are visible here.
- **Home and Dovey Inn are in the green band.** The lightest pages
  do well.

**Three of five pages are LCP-bound and out of the green band.**

- `/things-to-do/magic-lantern-cinema/` at 7.8s LCP is the worst.
  Lighthouse's `image-delivery-insight` calls out a single offender:
  `tywyn-cinema.png`, **895 KB of waste** on a 932 KB file that's
  served at 2098×1050 to display at 665×333. That one image is
  responsible for the 7.8s.
- `/things-to-do/cadair-idris/` at 4.8s LCP is in the red band. Part
  is hero image, part is the ~466ms of render-blocking CSS that
  shows up on every page.
- `/eating/` at 3.5s LCP is in the orange band. The first venue
  card's image is the LCP candidate; the lazy-loading on cards
  below the fold is working (Lighthouse only loaded ~700 KB of the
  ~1.6 MB of card images counted statically — a real Q1 win for
  visitors who don't scroll).

**The render-blocking CSS audit is consistent across all pages.**

Every page wastes ~464-468ms on two render-blocking stylesheets
(`BaseLayout.css` + a per-page `EntryHeader.css` etc). That's a
flat penalty paid on every navigation. Inlining critical CSS
above-the-fold or `media="print" onload` for non-critical sheets
would lift LCP across the board.

## Where Stage 1 didn't move the needle

The image bytes that dominate the LCP-bound pages were untouched
by Stage 1, exactly as the plan called out and exactly as the
post-pass critical assessment predicted. Stage 2 (image pipeline
migration to AVIF/WebP via `astro:assets` with responsive `srcset`)
is the work that would close this gap.

Lighthouse explicitly tells us this on the cinema page:

> Using a modern image format (WebP, AVIF) or increasing the image
> compression could improve this image's download time. This image
> file is larger than it needs to be (2098×1050) for its displayed
> dimensions (665×333). Use responsive image techniques.

That sentence is a direct prescription for `astro:assets` + `<Picture>`.

## Caveats on these numbers

- **Headless Chrome on localhost.** Network is essentially zero
  RTT; CPU is the host machine. Lighthouse simulates Slow-4G + 4×
  CPU slowdown on top, but the simulation is a proxy for real-world
  mobile, not a substitute. Expect deployed Slow-4G PSI scores to
  be **at least as bad** on the LCP-bound pages, possibly worse on
  pages that stress connection setup.
- **Single run per page.** No median across runs; variance could
  be ±300-500ms on LCP. The shape of the rankings won't change but
  individual numbers will wobble.
- **CrUX field data is unavailable** (no production traffic).
  These are lab measurements only.

## Decision points

The numbers force a choice the project has been deferring:

1. **Ship Stage 1 as-is.** Three pages stay LCP-bound. Real users
   on real mobile see 5-10s LCP on cinema; 4-6s on cadair; 3-4s on
   the eating listing. CWV-driven SEO penalty on those URLs;
   nothing happens to the well-performing pages.

2. **Cheap targeted fixes (~half-day, no architecture change).**
   Hand-export AVIF + WebP for the worst 5 images
   (`tywyn-cinema.png`, `dolgoch-1` and `dolgoch-2-scaled.jpg`,
   `0812889_1_4.jpg`, `cadair_idris-scaled.jpg`), drop them in at
   the same paths with format negotiation via `<picture>`.
   Could move cinema page LCP from 7.8s to ~3-4s.
   Add `fetchpriority="high"` to BannerImage. Inline critical CSS.
   Probably 70% of the Stage 2 win for 10% of the effort.

3. **Stage 2 properly.** AVIF/WebP pipeline via `astro:assets`,
   responsive `srcset` for all 156 images, content-hashed URLs.
   1-2 days. Right answer if the site is staying on this codebase
   long-term.

## Reproduction

```bash
npm run build
npx serve dist  # or `npm run preview` on port 4322
for path in "" "eating/" "eating/dovey-inn/" "things-to-do/cadair-idris/" "things-to-do/magic-lantern-cinema/"; do
  slug=$(echo "$path" | tr '/' '-' | sed 's/-$//' | sed 's/^$/home/')
  npx lighthouse "http://localhost:4322/$path" \
    --only-categories=performance \
    --output=json \
    --output-path="./docs/perf/lighthouse/$slug.json" \
    --chrome-flags="--headless --no-sandbox" --quiet
done
```

Raw JSON for each run is in `docs/perf/lighthouse/`.
