---
title: "perf: Stage 1 post-pass measurement"
type: perf-measurement
status: captured
date: 2026-04-30
plan: docs/plans/2026-04-28-001-refactor-site-performance-pass-plan.md
units: [Q1, 11, 12, 13, 14]
baseline: docs/perf/2026-04-baseline.md
---

# Stage 1 post-pass measurement

Re-runs of [`tools/perf/measure-pages.ts`](../../tools/perf/measure-pages.ts) after Stage 1 (Units 0,
Q1, 11, 12, 13, 14) lands. Same methodology as the baseline doc — same
sample pages, same deterministic byte counter — so the deltas below
are directly comparable.

The win Stage 1 was designed for is **CLS = 0 on every sample page
without touching the image pipeline**, plus removing two render-blocking
external requests from the critical path. Image bytes are unchanged
because format migration is Stage 2's job.

## Per-page deltas

| Path | Total bytes (Δ) | Images bytes (Δ) | External reqs (Δ) | CLS risk (Δ) |
|------|-----------------:|------------------:|-------------------:|--------------:|
| `/` | 162.7 KB (+25.1 KB) | 108.3 KB (=) | **2** (-2) | **0/2** (-1) |
| `/eating/` | 1.64 MB (+27 KB) | 1.56 MB (=) | **2** (-2) | **0/20** (-19) |
| `/eating/dovey-inn/` | 468.7 KB (+25.2 KB) | 404.4 KB (=) | **2** (-2) | **0/6** (-5) |
| `/things-to-do/cadair-idris/` | 925.4 KB (+25.2 KB) | 868.0 KB (=) | **2** (-2) | **0/7** (-5) |
| `/things-to-do/magic-lantern-cinema/` | 1.45 MB (+25.2 KB) | 1.39 MB (=) | **2** (-2) | **0/7** (-5) |

The +25 KB per page total is the Lato 400-latin woff2 that now ships
from origin. Pre-pass it travelled from `fonts.gstatic.com` and was
counted as "external" in the baseline; bytes-on-the-wire are roughly
the same, but the second-hop DNS + TLS round trip is gone, which is
the actual LCP win.

## Per-unit summary

- **Unit 0** — captured pre-pass baseline ([2026-04-baseline.md](2026-04-baseline.md)) with
  deterministic byte-counter and JSON dump for diff comparison.
- **Unit Q1** — wired intrinsic `width`/`height` into 7 image-rendering
  components (BannerImage, VenueCard, ActivityCard, EventCard,
  FeaturedStayCard, StayCategoryCard, RelatedItems, Gallery thumb +
  lightbox) and 2 inline page `<img>` tags. CLS-risk surface
  collapses to 0 across all sample pages. New helper
  [`src/lib/image-dimensions.ts`](../../src/lib/image-dimensions.ts) probes JPEG/PNG headers at
  build time; will retire when astro:assets takes over in Stage 2.
- **Unit 11** — Lato self-hosted via `fontProviders.fontsource()` at
  weights 400 + 700, subsets `latin` + `latin-ext`. The 400-latin
  woff2 is `<link rel="preload">`-ed; everything else lazy-loads
  on demand. `optimizedFallbacks: true` synthesizes Arial-derived
  metric overrides so font swap doesn't shift layout. Both
  `fonts.googleapis.com` and `fonts.gstatic.com` requests are gone
  from every page.
- **Unit 12** — `gaMeasurementId` field added to `SITE`; defaults to
  empty so the gtag snippet is omitted entirely until a real
  `G-XXXXXXX` ID is provisioned. Dead UA-28386547-1 tag and the
  `dns-prefetch` to `google-analytics.com` /
  `stats.g.doubleclick.net` removed. **Open follow-up:** provide
  the GA4 measurement ID and set it in [`src/lib/site.ts`](../../src/lib/site.ts).
- **Unit 13** — `placement` prop on AdSlot drives per-context
  `min-height` (sidebar 90 px / in-feed 250 px). Discovered and
  fixed a pre-existing rendering bug in `/eating/index.astro` and
  `/things-to-do/index.astro`: the `<>` Fragment + conditional
  inside `.map()` was silently dropping every in-feed AdSlot.
  Switched to `flatMap` returning an array, which Astro renders
  correctly. /eating/ now ships 5 in-feed slots (was 0); /things-to-do/
  ships 3 (was 0).
- **Unit 14** — Fixed two malformed `youtube.com/embed//<id>` URLs
  in tywyn-beach markdown bodies (the leading double-slash 404'd
  the embeds). Added `loading="lazy"`,
  `referrerpolicy="no-referrer-when-downgrade"`, and the standard
  YouTube `allow=` permission list to all four content iframes.
  Tightened VenueMap to `allow=""` so it can't prompt for
  geolocation.

## What didn't move

- **Image bytes per page** — unchanged. Stage 1 was deliberately
  scoped to skip the image pipeline; the 18 MB of unprocessed
  `public/img/` raster files stay untouched until Stage 2's
  AVIF + WebP migration.
- **Build wall-clock** — still ~3 s warm, ~5 s cold. The Fonts
  API adds a small per-build font fetch from Fontsource the first
  time it sees a font config (cached on subsequent builds).

## Open follow-ups before re-measurement on staging

- Set the real GA4 measurement ID in `src/lib/site.ts:gaMeasurementId`.
- Pick a host (Netlify / Cloudflare Pages / Vercel) so PageSpeed
  Insights can reach a deployed staging URL — that's when LCP /
  INP / CLS field data first becomes capturable.
- The `_redirects` rule for `/wp-content/uploads/* → /img/:splat` is
  unchanged; verify that's still serving correctly on the chosen
  host once deployed.

## Re-measurement gate decision

Per the plan's Stage 1 → Stage 2 gate: if mobile LCP and CLS for
the 5 sample pages are already in the "good" CWV band (LCP ≤ 2.5s,
CLS ≤ 0.05) post-deploy, defer or scope down Stage 2.

Lab CLS is now 0 across all five sample pages. LCP cannot be
measured here without deploy. **Decision deferred until staging
exists.**
