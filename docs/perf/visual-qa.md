---
title: "Visual QA: WP → Astro"
type: visual-qa
status: captured
date: 2026-04-30
---

# Visual QA: WordPress live vs. Astro rebuild

Side-by-side screenshot comparison of the rebuild against the live
WP site at desktop (1280×900) and mobile (390×844). Run on the SEO
fixes branch (`refactor/perf-pass`, post-merge of
`seo/wp-launch-parity`).

## Pages compared

| Page | Desktop | Mobile |
|------|---------|--------|
| `/` (home) | ✓ | ✓ |
| `/eating/` (listing) | ✓ | ✓ |
| `/eating/dovey-inn/` (venue detail) | ✓ | n/a |
| `/things-to-do/cadair-idris/` (activity detail with hero) | ✓ | n/a |
| `/contact/` (form page) | ✓ | n/a |

## Findings

### Match (no visual regression)

- **Header / nav**: identical structure on both. Astro adds a subtle
  highlight on the active page link in the nav (small UX
  improvement, not a regression).
- **Sidebar**: "Plan your visit to Tywyn" + "Tywyn beach weather" +
  "Next tides" widgets render consistently. Same content, same
  ordering.
- **Footer**: identical.
- **Breadcrumbs**: same ordering and labels with one tweak. WP's
  `/eating/` shows `EATING`, Astro shows `EATING IN TYWYN` (a more
  descriptive crumb). Minor copy difference, not a regression.
- **H1**: matches on every page checked. Single H1 confirmed
  (homepage previously rendered two; commit `cdc4e8e` collapsed it).
- **Body content**: substantive editorial text matches verbatim.
- **Cards (eating, things-to-do, related items)**: image left, text
  right at desktop; stacked at mobile. Image dimensions render
  correctly (no CLS surprise; confirms the Q1 work).
- **Lazy loading**: confirmed on `/eating/` mobile, cards below the
  fold load as the viewport approaches them.

### Intentional differences (not regressions)

- **Hero banner images**: Astro renders `hero_image` frontmatter as
  a top-of-page banner on every page that has one (home,
  `/eating/`, `/contact/`, `/things-to-do/cadair-idris/`, etc.). WP
  either didn't render these at all (home: likely Slider Revolution
  wasn't priming) or rendered them inconsistently. The Astro
  treatment is consistent, fast (the Q1 dimensions already shipped),
  and visually stronger. Surfaces design intent the WP install
  buried.
- **Mobile sidebar placement**: Astro stacks the sidebar below the
  content on mobile; WP keeps a 2-column layout at the same
  viewport, which produces a cramped ~130 CSS-px sidebar column.
  The Astro stacking is better mobile UX. Worth flagging because
  CWV (CLS, INP) and accessibility audits both prefer the stacked
  pattern.
- **Active nav highlight**: small visual indicator on the current
  section in the Astro nav. WP doesn't have this.

### Material gap (already known, next task)

- **`/contact/` form is a placeholder.** The Gravity Forms field
  group on WP (Name, Email *required*, Message *required*, Submit)
  is replaced on Astro with a single italic line: "The contact form
  is being rebuilt. For now, please reach us via the social links
  above or by email." This is the open follow-up the README has
  flagged; resolving it is the next task on this branch.

### Things I didn't visually verify

- Tablet breakpoints (between mobile and desktop)
- Pages with markdown body iframes (`/things-to-do/tywyn-beach/`,
  `/things-to-do/castell-y-bere/`, `/wales-coastal-path/`): iframe
  rendering wasn't sampled directly. The Unit 14 work added
  `loading="lazy"` and fixed the malformed YouTube `embed//` URLs;
  worth a quick eyeball before launch.
- Welsh-language diacritics (`ŵ`, `ŷ`) on pages that contain them.
  The Lato `latin-ext` subset should cover these, but no captured
  page in this audit displayed one.
- Print stylesheet (out of scope).

## Verdict

The rebuild is visually faithful where it matters (header, nav,
content, sidebar, cards) and actively better where it diverges
(hero banners, mobile sidebar stacking, nav highlight, single H1).
No visual regressions found in the desktop or mobile passes.

**Ready for launch from a visual-fidelity standpoint**, gated on:
1. The `/contact/` form being wired up (next task).
2. A 5-minute eyeball pass on the iframe-heavy markdown pages and
   any Welsh-diacritics pages, post-deploy.
