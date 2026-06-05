---
title: 'fix: Accessibility remediation pass'
type: fix
status: implemented
date: 2026-06-04
---

# fix: Accessibility remediation pass

## Status

Implemented and verified via `npm run build` (48 pages, clean). All WCAG AA
issues are fixed. One AAA item (new-tab cues on author-written markdown links)
is deferred with a documented reason. A browser-based rendered audit is still
outstanding for the items static analysis cannot confirm (see Outstanding).

This document is the reconciled record of a two-source audit: a source-level
review (caught the Level-A alt failures, content-page heading skips, and
semantic issues) plus an automated-tool review (caught computed contrast
failures the token analysis missed). Each finding below was verified against
the actual source and the built output, not inferred.

## Overview

The site is built with Astro 6 (pure static HTML, no client framework, no
forms). It was already strongly accessibility-aware: skip link, correct
landmarks, single-`<h1>` discipline, a native-`<dialog>` lightbox with focus
return, an APG disclosure nav, and consistent "opens in new tab" cues in
components. The remediation closed a small, concrete set of gaps, most of them
in author-entered markdown content or in component CSS that hardcoded colours
instead of using the design tokens.

## Findings and resolution

| # | Severity | Issue | WCAG | Status |
|---|----------|-------|------|--------|
| F1 | AA | Weather + Tides widget text `rgba(255,255,255,.85/.7)` on `#13729b` (4.37 / 3.49:1) | 1.4.3 | Fixed |
| F2 | AA | `ListingCard` address `color: grey` (#808080) on white = 3.95:1 | 1.4.3 | Fixed |
| F3 | A | 5 content images with empty `alt` | 1.1.1 | Fixed |
| F4 | A | Linked map image (F3) had no accessible name | 2.4.4 / 4.1.2 | Fixed |
| F5 | A | Data table (1bws prices) with no `<th>` / caption | 1.3.1 | Fixed |
| F6 | A/AA | Heading skips: 3 archive pages (h1 to h3) + 2 content pages + 1 disordered | 1.3.1 / 2.4.10 | Fixed |
| F7 | AAA | No global `prefers-reduced-motion` guard | 2.3.3 | Fixed |
| F8 | AAA | 19 author `target="_blank"` links omit new-tab cue | 3.2.5 | Deferred |
| F9 | AA | `ListingCard` redundant duplicate link | 2.4.4 | Fixed |
| F10 | minor | Accessibility statement date mismatch | n/a | Fixed (dates aligned) |

Two findings from the automated-tool plan were **rejected after verification**
and deliberately NOT applied:

- **Footer copyright contrast "2.37:1".** False. The text is `#a8a8a8` on the
  `#333` footer = **5.31:1, passes.** The 2.37 figure assumed a white
  background; `content-visibility: auto` does not feed a white background to
  the accessibility tree. The proposed "fix" (darken to `#767676`) would have
  *reduced* real contrast on `#333` to ~2.78:1, manufacturing a failure. Left
  unchanged.
- **AdSense untitled iframe.** A hidden 1x1 tracking pixel flagged by pa11y is
  not a user-facing barrier; the proposed runtime patch targeted `body > iframe`
  but AdSense injects inside the `<ins>`, so it would not have matched. Left to
  the existing "third-party content" caveat in the accessibility statement.

## What changed (by area)

### Contrast (F1, F2)
- `WeatherWidget.module.scss`: `dt`, `.stamp`, `.stale`, `.empty` translucent
  white to solid `#fff` (now 5.37:1 on the teal sidebar).
- `TidesWidget.module.scss`: `.stale`, `.empty` same fix.
- `ListingCard.module.scss`: `.address` `grey` to `$color-text-dim` (5.4:1).

### Images (F3, F4)
Real alt text written from inspecting each image (not the filename, e.g. the
`magiclantern2.jpg` on the Secret Garden page is the dusk garden patio, not a
cinema building):
- `cadair-idris.md`, `castell-y-bere.md`, `the-secret-garden.md`,
  `nant-gwernol.md` (woodland photo plus the linked OS Maps route map, whose
  alt is now the link's accessible name).

### Data table (F5)
`getting-around.md` 1bws price table now has `<caption>`, `<thead>` with
`<th scope="col">`, and `<th scope="row">` on each ticket type. (Newly found
during implementation: neither prior plan caught it because it is raw HTML, not
a markdown pipe table, so grep-for-pipes and Lighthouse both missed it.)

### Heading order (F6)
- Archives (`eating/index.astro`, `things-to-do/index.astro`,
  `dog-friendly-cafes.astro`): `ListingCard` cards now `headingLevel={2}` so the
  page is h1 then h2 (no skip), instead of h1 then h3.
- `getting-around.md`: section headings h3 to h2.
- `the-talyllyn-railway.md`: History / Museum h3 to h2 (monotonic order).
- `explore-tywyn.md`: FAQ title h3 to h2, questions h4 to h3.
- **Coupled change:** `lib/markdown.ts` `extractFaq` regex updated h4 to h3
  (and boundary `<h[1-4]>` to `<h[1-3]>`) so the FAQPage rich result survives.
  Verified: built `/explore-tywyn/` still emits FAQPage JSON-LD with all 6
  questions.

### Motion (F7)
`styles/base/_reset.scss`: global `@media (prefers-reduced-motion: reduce)`
block neutralising animations/transitions. Gallery keeps its own
`no-preference` opt-in.

### Duplicate link (F9)
`ListingCard.astro`: the image-wrapper link is now `aria-hidden="true"
tabindex="-1"` (mirrors `EventCard`), so each card exposes one link instead of
two to the same URL. Also removes the latent empty-link risk.

### Statement (F10)
`accessibility-statement-for-visit-tywyn.md`: frontmatter `updated` and the
visible `<time>` both set to 2026-06-04 (were 2025-02-14 and 2025-01-01).
WCAG version left at 2.1 deliberately, see Outstanding.

## Deferred: F8 new-tab cues

**Attempted and reverted.** A custom rehype plugin was written to append the
visually hidden cue and harden `rel` on every `target="_blank"` link in
rendered markdown. It did not work and was removed (clean `git restore`, no
dead code shipped). Reason, verified in the build:

- The author links are raw HTML inside markdown. Astro does not reparse raw
  HTML into hast `element` nodes, so an element-based visitor never sees them.
- Handling them as `raw` string nodes also fails for the common case: inline
  raw anchors are split across separate nodes (the opening `<a>` and the
  closing tag land in different `raw` nodes), so no single-node regex can match
  the pair.

Two viable paths, neither done here:
1. **Add `rehype-raw`** to reparse raw HTML into elements before a clean
   element-based cue plugin runs. Cost: one build dependency (the repo
   currently avoids adding deps; see the `gray-matter`-avoidance note in
   `astro.config.mjs`), so this needs a deliberate decision.
2. **Edit the ~15 live links by hand** (excluding the redirected `cinema.md`
   and `tywyn-beach.md`). Reliable but tedious and does not cover future
   content.

Priority is low: this is WCAG 3.2.5 (AAA), the components already cue their own
new-tab links, and the destinations are obviously external.

## Outstanding (rendered audit, not source)

Static analysis and the build cannot confirm these; they need a browser:
- Focus-ring visibility (2.4.7): expected to pass (no `outline:none`; components
  define `:focus-visible`).
- Target sizes of the lightbox prev/next/close buttons (2.5.8).
- 320px reflow and 200% zoom (1.4.10, 1.4.4).
- Mobile submenu reachability on touch (the "Explore Tywyn" children are also in
  the footer, so Multiple Ways is satisfied; consider tap-to-expand).
- Third-party embeds (Google Maps, webcam, virtual tour) and AdSense internals.

After the rendered audit passes, bump the accessibility statement from WCAG 2.1
to 2.2 AA (held back now because two new 2.2 criteria, 2.4.11 focus appearance
and 2.5.8 target size, are exactly the rendered-only items above).

## Verification log

- `npm run build`: 48 pages, clean (run after every batch; final run clean).
- Contrast: `grep` confirms no `rgba(255,255,255,.85/.7)` text remains in
  `dist/`.
- `prefers-reduced-motion:reduce` present in inlined CSS.
- All 5 content-image alts present in built HTML; the only remaining `alt=""`
  is the Gallery lightbox placeholder (populated by JS on open, by design).
- FAQPage JSON-LD on `/explore-tywyn/` intact: 6 questions.
- Archive cards render as `<h2>` (h1 then h2, no skip); `getting-around` table
  has caption + 2 col headers + 5 row headers.
- `ListingCard` media link renders `aria-hidden="true" tabindex="-1"`.

## Appendix: contrast (verified)

Principal token pairings pass AA. The three failures were component instances
that deviated from the tokens (now fixed):

| Element | Was | Ratio | Now |
|---------|-----|-------|-----|
| Weather/Tides `dt`/`.stamp`/`.stale`/`.empty` | `#fff @ .85` / `.7` on `#13729b` | 4.37 / 3.49:1 | `#fff` (5.37:1) |
| ListingCard `.address` | `grey` #808080 on white | 3.95:1 | `$color-text-dim` (5.4:1) |
| Footer copyright (rejected finding) | `#a8a8a8` on `#333` | 5.31:1 | unchanged (passes) |
