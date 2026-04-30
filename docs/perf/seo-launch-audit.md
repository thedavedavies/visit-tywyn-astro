---
title: "SEO launch-readiness audit: WP → Astro"
type: seo-audit
status: draft
date: 2026-04-30
---

# SEO launch-readiness audit

Comparison of the live WordPress site (`https://visit-tywyn.co.uk`)
against the Astro rebuild on `refactor/perf-pass`. Goal: identify
everything that could move rankings on launch day, classified by
severity. Raw data: [`seo-compare.json`](seo-compare.json),
report: [`seo-compare-report.md`](seo-compare-report.md).

The premise — *URL + content + metadata stay the same → rankings
stay the same* — is correct in principle. The audit below quantifies
exactly which assumptions that holds for and which it breaks.

## TL;DR

| Risk | Severity | Mitigation status |
|------|----------|-------------------|
| 60 individual accommodation pages removed | **High** (deliberate trade-off) | Covered by 301 redirects to 4 category landings — equity transfers but at reduced strength |
| Homepage title + description completely changed | **High** | Not addressed — needs frontmatter update |
| 16 of 18 eating venues have no `seo:` block, 7 share an identical generic meta description | **High** | Not addressed — fix in frontmatter |
| Global `WebSite` JSON-LD missing on every page (Yoast emitted on WP) | **Medium** | Not addressed — easy add to BaseLayout |
| Homepage emits 2 `<h1>` (visible + hidden) | **Medium** | Not addressed — collapse to 1 |
| `/event/race-the-train/` has no working redirect | **Medium** | Listed in `_redirects` but rule loops to itself |
| `/category/uncategorized/` has no redirect | **Low** (low-equity URL anyway) | Not addressed |
| Title format drift on a handful of pages | **Low–Medium** | Per-page review, see table below |
| JSON-LD schema types changed shape (Restaurant vs WebPage etc.) | **Low** (Astro shapes are arguably better) | Keep Astro shapes, add WebSite globally |

## URL inventory diff

| Bucket | WordPress | Astro | Notes |
|--------|----------:|------:|-------|
| URLs in sitemap | 106 | 47 | |
| Common (overlap) | 43 | 43 | The audit comparison set |
| WP-only | 63 | 0 | |
| Astro-only | 0 | 4 | New `/holiday-accommodation/{cat}/` landings |

WP-only breakdown:

- **60 `/accommodation/<slug>/` pages** — every one of them is in
  `public/_redirects` going to the relevant `/holiday-accommodation/`
  category landing. Equity transfers via 301. Page-level relevance
  for narrow searches (e.g. *"tyn-y-cornel hotel tywyn"*) loses the
  exact-match URL anchor and competes from the broader B&B landing
  instead. Expect a 10–30% relevance drop on those queries; mitigated
  by Google passing PageRank through 301s.
- **`/cinema/`** — redirected to `/things-to-do/magic-lantern-cinema/`. ✓
- **`/tywyn-beach/`** — redirected to `/things-to-do/tywyn-beach/`. ✓
- **`/event/race-the-train/`** — single event page, no working redirect.
  `_redirects` line 87 is `/event/race-the-train/index.html →
  /event/race-the-train` which loops to a non-existent URL. Either
  add `/event/race-the-train/ → /events/ 301` or `→ /404 410`.
- **`/category/uncategorized/`** — WordPress default category page.
  Low SEO equity (Yoast probably noindexed it anyway, see
  `<x-robots-tag>` header). Add `/category/* → /404.html 410` for
  cleanliness.

## Per-page SEO drift (the 43 overlapping URLs)

All 43 pages have at least one delta. Most fall into 3 categories
that need the same fix repeated, plus a long tail of single-page
issues. Numbers below are aggregate counts of pages affected.

### Category 1 — `WebSite` JSON-LD missing globally (43/43 pages)

WP (Yoast) emits a `WebSite` schema on every page:

```json
{ "@type": "WebSite", "@id": "https://visit-tywyn.co.uk/#website",
  "url": "https://visit-tywyn.co.uk/", "name": "Visit Tywyn",
  "potentialAction": { "@type": "SearchAction", "target": "..." } }
```

Astro doesn't emit this anywhere. The schema feeds Google's site-name
display and (with `potentialAction`) the sitelinks search box. Easy
fix: add a `WebSite` block to the auto-emitted JSON-LD in
`src/layouts/BaseLayout.astro` (alongside `BreadcrumbList`).

**Action:** add `website()` helper to `src/lib/jsonld.ts` and emit it
unconditionally from BaseLayout.

### Category 2 — Meta descriptions falling back to site default (7/18 eating venues)

WP often had `null` Yoast description (Google synthesizes from page
content). Astro has descriptions, but for pages without a `summary`
field in frontmatter, the meta description falls back to the generic
`SITE.description`. The result: 7 eating venues currently ship the
same meta description (`"Tywyn is a coastal town in Gwynedd…"`),
which Google flags as duplicate content in Search Console.

Affected venues (all need `summary` added to frontmatter):

- `dine-india.md`
- `dovey-inn.md`
- `medina-coffee-house.md`
- `mor-tywyn.md`
- `pendre-garden-centre-and-cafe.md`
- `victorian-slipway.md`
- `whitehall.md`

**Action:** add a 1–2 sentence `summary:` field to each. Pull from
the venue's website / TripAdvisor blurb if no in-house copy exists.

### Category 3 — Title text divergence (6 pages)

Pages where the Astro title is meaningfully different from WP and the
WP version is more SEO-targeted:

| Path | WP title (preserve) | Astro title (current) | Action |
|------|---------------------|----------------------|--------|
| `/` | *Tywyn Holiday Accommodation, Things to Do and Visit in Tywyn* | *Visit Tywyn — Your guide to Tywyn, Mid Wales* | Update home title |
| `/eating/` | *Top restaurants and places to eat in Tywyn* | *Where to eat in Tywyn?* | Update title |
| `/dog-friendly-cafes/` | *Dog Friendly Bars, Pubs, Restaurants, and Cafes in Tywyn* | (same + suffix) | Drop *Visit Tywyn* suffix to match |
| `/things-to-do/king-arthurs-labyrinth/` | (per-page) | (per-page) | Spot-check + align |
| `/things-to-do/magic-lantern-cinema/` | (per-page) | (per-page) | Spot-check + align |

Two ways to handle:

1. **Update Astro frontmatter** to match the WP-targeted titles
   (preserves the indexed title text Google has already learned).
2. **Decide deliberately** that some new titles are better and
   accept short-term ranking flux for long-term improvement.

The conservative SEO answer is option 1 for launch, then iterate
post-launch with proper A/B (or simply observed CTR data).

### Category 4 — Multiple H1 on homepage

Astro home renders both:

```html
<p class="title-hidden" aria-hidden="true"><a href="/" tabindex="-1">Visit Tywyn</a></p>
<h1>Welcome to Visit Tywyn</h1>
```

…and the wrapping logic in `Header.astro` upgrades the visually-hidden
`<p>` to `<h1>` on `isFrontPage`. WP rendered exactly one H1.

Multiple H1s aren't broken HTML but they confuse some crawlers and
produce conflicting topic signals. Collapse to one — either keep the
visible *Welcome to Visit Tywyn* H1 and downgrade the branding link
to `<p>` on the home page, or vice versa.

**Action:** in `src/components/Header/Header.astro`, when
`isFrontPage` is true, render the branding as `<p>` rather than as
the front-page `<h1>` upgrade. The visible page H1 (rendered by the
home page template) is the real one.

### Category 5 — Body word-count drift (most venue + activity pages)

Astro venue pages render ~50–150 more words than WP. Investigated
`/eating/dovey-inn/` directly — the editorial markdown body is
identical. The drift is chrome:

- `RelatedItems` block ("More places to eat in Tywyn" with 4 cards) —
  +20–30 words.
- "Where is X" map section + "Get directions" link.
- Dog-friendly note (when applicable).
- Sidebar tides widget content (live tide times — counted as body words by my tool).

This is **content addition, not change**. Net impact on rankings is
neutral-to-positive (more internal linking, more semantic context).
No action.

### Category 6 — JSON-LD type shape changes

| Page type | WP types | Astro types | Verdict |
|-----------|----------|-------------|---------|
| `/` (home) | BreadcrumbList, WebPage, WebSite | Organization, TouristDestination, WebSite | Astro wins (richer) |
| Eating venue | BreadcrumbList, WebPage, WebSite | BreadcrumbList, Restaurant *or* FoodEstablishment | Astro wins |
| Listing pages | BreadcrumbList, CollectionPage, WebSite | BreadcrumbList, ItemList | Either is valid |
| Standard page | BreadcrumbList, WebPage, WebSite | BreadcrumbList, WebPage | Astro missing WebSite |

Astro's per-type schemas are more specific and arguably closer to
current Schema.org best practice (especially `Restaurant` /
`FoodEstablishment` for venue pages — WP just used `WebPage`).

**Action:** keep the Astro shapes; add `WebSite` to the global
auto-emit so we don't lose Yoast's contribution.

## Recommended pre-launch action list

Ordered by ranking impact, cheapest first:

### Must-do before launch

1. **Add `WebSite` JSON-LD globally** (1 file, ~10 lines in
   `src/lib/jsonld.ts` + import in `BaseLayout.astro`). Restores
   Yoast's contribution.
2. **Add `summary:` to the 7 eating venues** (Category 2). Eliminates
   duplicate meta descriptions.
3. **Fix the homepage title and description** in
   `src/pages/index.astro` (or the `home` page frontmatter wherever
   that lives). Use the WP-indexed title verbatim.
4. **Update `/eating/` title** in `src/pages/eating/index.astro` to
   match WP's *Top restaurants and places to eat in Tywyn*.
5. **Collapse homepage to one H1** in `Header.astro`.
6. **Fix the `/event/race-the-train/` redirect** — the current rule
   loops. Send to `/events/` instead.
7. **Add `/category/* → /404.html 410`** as a catch-all so stale
   category URLs return Gone, not 200.

### Should-do soon (post-launch ok)

8. **Spot-check titles on the 12 things-to-do pages** — these all
   have `seo:` blocks already, so divergence is intentional but
   worth eyeballing.
9. **Fix the 11 pages without an `seo:` block** that aren't covered
   by a `summary` fallback. Add real Yoast-derived titles +
   descriptions.
10. **Consider preserving the 60 individual accommodation pages**
    if any of them have measurable inbound traffic. Submit the URL
    list to Google Search Console → Performance → Pages and check
    impressions over the past 90 days. Any page with > 10 impressions
    /day deserves a per-URL 301 to the most relevant landing rather
    than a category-page 301.

### Nice-to-have

11. **Set the GA4 measurement ID** so launch traffic is captured.
12. **Verify Search Console ownership** transfers cleanly when
    DNS/HTML markers change (ensure the meta tag verification
    string in `<head>` is preserved or re-verify post-launch).
13. **Submit the new sitemap** in GSC immediately after launch.
14. **Watch GSC's "Coverage" report** for the first 30 days for
    any unexpected 404s — those are old WP URLs we missed in
    `_redirects`.

## Confidence on the "no rankings drop" thesis

For the **43 overlapping URLs**: confidence is high (>90%) that
rankings hold or improve, **provided** the must-do list above is
addressed. The Astro implementation is mostly the same content
shipped at the same URLs with stronger schema and faster delivery.

For the **60 redirected accommodation URLs**: confidence is
moderate (60–80%) that aggregate ranking equity transfers, but
expect URL-level rankings on long-tail queries to weaken.

For the **2 unhandled outliers** (`/event/race-the-train/`,
`/category/uncategorized/`): these need redirects fixed before
launch.

The `/wp-content/uploads/* → /img/:splat` redirect handles legacy
image URLs cleanly, so image-search rankings should transfer.

## Reproducing this audit

```bash
npm run build
npm run preview -- --port 4322
npx tsx tools/perf/seo-compare.ts
```

Re-run after applying the recommendations above to verify the diffs
shrink.
