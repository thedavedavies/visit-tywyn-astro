---
title: Rename public/wp-content/uploads/ → public/img/ and prune unused assets
type: refactor
status: active
date: 2026-04-27
deepened: 2026-04-27
---

# Rename public/wp-content/uploads/ → public/img/ and prune unused assets

## Overview

Reorganise the legacy assets tree to drop WordPress-era directory naming and
shrink the deploy footprint. The current `public/wp-content/uploads/` is 315MB
across 6,198 files — most of it dead weight from the 59 retired accommodation
listings, plus non-image junk (security plugin backups, performance-plugin
caches, `.php` / `.htaccess` / `.log` files) that came in with the legacy
backup rsync.

After this work, `public/img/` contains only image files actually referenced
by current content (~50MB estimated) and the `wp-content` terminology is gone
from the source tree.

## Problem Frame

`public/wp-content/uploads/` exists because the legacy WP migration rsynced
the entire uploads directory and content references inside markdown frontmatter
were preserved as `/wp-content/uploads/YYYY/MM/file.jpg` paths. Two problems
have grown out of that decision:

1. **WP terminology leaks into the URL space.** Visitors and crawlers see
   `/wp-content/uploads/...` URLs on a static Astro site. It's confusing,
   advertises an attack surface that doesn't exist, and is jarring against
   the otherwise clean URL scheme.
2. **The directory is bloated with files we don't need.** The 59 retired
   accommodation listings have ~10 images each (×4-5 thumbnail variants =
   thousands of files). Plus plugin junk: `aios/`, `ShortpixelBackups/`,
   `cleantalk_fw_files_for_blog_1/`, `hummingbird-assets/`, plus 3 stray
   `.php` files (security risk if ever served), 1 `.log`, 1 `.htaccess`,
   1 `.css`. Of the 6,198 files, fewer than 500 are likely referenced.

The user explicitly asked to "scrap the wp-content terminology" and noted
"we certainly don't need the non image files".

## Requirements Trace

- **R1.** All `/wp-content/uploads/` paths in the source tree (markdown
  content, page templates, components, lib config) are rewritten to a new
  scheme that doesn't reference WordPress.
- **R2.** A migration tool replaces the existing `tools/copy-uploads.sh`.
  It (a) scans the source tree for the new image paths, (b) copies only
  those files from the legacy backup into the new public directory, and
  (c) skips non-image extensions and known plugin-junk directories.
- **R3.** `public/img/` (the new location) contains only files actually
  referenced by content. Unreferenced thumbnails, retired-accommodation
  images, and plugin artifacts are not copied.
- **R4.** The Astro build still produces all 48 pages with images
  resolving correctly when previewed.
- **R5.** A backward-compat 301 redirect catches any external link still
  pointing at `/wp-content/uploads/*` and routes it to the new path so
  any indexed asset URLs continue to resolve.
- **R6.** `public/wp-content/` is deleted from the working tree at the
  end of the migration. The new directory is gitignored (same as the
  old) and populated by running the migration tool.

## Scope Boundaries

- **Image format changes are NOT in scope.** The plan keeps `.jpg`/`.png`
  in their existing places and keeps the WebP companion files generated
  by ShortPixel as-is. Wiring up `<picture>` tags or AVIF generation is
  separate work.
- **Hosting the assets on S3/R2/etc is NOT in scope.** The
  README's existing follow-up to migrate uploads to remote storage stays
  open; this plan is a precursor that makes that migration easier (a
  smaller, cleaner tree is faster to lift and shift).
- **No new image optimisation pipeline.** We're preserving exactly the
  bytes WordPress already generated — not regenerating thumbnails, not
  re-encoding to AVIF.

### Deferred to Separate Tasks

- Generate a 1200×630 OG social card image (already in
  `src/lib/site.ts` comments as a follow-up after the SEO pass).
- Wire per-entry sitemap `lastmod` from frontmatter `updated` dates
  (also in `astro.config.mjs` comments from the SEO pass).
- Move `public/img/` contents to S3/R2 once their volume stabilises
  (mentioned in `README.md` Open follow-ups).

## Context & Research

### Relevant Code and Patterns

Path-emitting code (must be updated):

- `tools/export-from-sql.ts` — line 428 builds attachment paths as
  `/wp-content/uploads/${file}`. This is the canonical source for
  every frontmatter image path and most body-content image refs.
- `tools/export-from-sql.ts` — `rewriteContent()` does no path
  rewriting today; needs to translate any
  `/wp-content/uploads/` references already inside post body HTML
  into the new prefix during export.

Hardcoded template references (must be updated):

- `src/components/Header/Header.astro:24` — logo `<img src>`.
- `src/lib/site.ts:20` — `defaultOgImage` default-OG image path.
- `src/pages/eating/index.astro:32` — eating archive banner image.

Generated content (rewritten by re-running export):

- `src/content/pages/*.md` (12 files), `src/content/eating/*.md`
  (18), `src/content/things-to-do/*.md` (11), totalling ~100
  `/wp-content/uploads/` references in frontmatter and body.

Existing migration tooling:

- `tools/copy-uploads.sh` — naive `rsync -a --delete` from the legacy
  uploads tree into `public/wp-content/uploads/`. Replaced wholesale
  by the new tool.

Backup source of truth:

- `/Users/dave/Downloads/visit-tywyn.co.uk_2026-Mar-13_backup_69b436db1a3c81.57399253/wp-content/uploads/`
  — 315MB. Top-level entries include real content directories
  (`2022/`, `2023/`, `2024/`) plus plugin junk (`aios/`,
  `ShortpixelBackups/`, `cleantalk_fw_files_for_blog_1/`,
  `hummingbird-assets/`, `smush-webp-test.png`).

Existing `_redirects`:

- `public/_redirects:119` — single hand-curated rule
  `/wp-content/uploads/2015/04/Overhead.jpg → /` for an old hotlink
  hijack. The new wildcard 301 rule supersedes the need for this
  individual entry but it's harmless to keep.

### Institutional Learnings

`docs/solutions/` does not exist — confirmed in the prior `ce:review`
learnings researcher pass. This is the first plan in the project.

### External References

None needed. The work is pure file-system reorganization with internal
codebase patterns to follow.

## Key Technical Decisions

**Decision 1: New directory is `/img/` (not `/uploads/`, not
content-type-restructured).**

Rationale: `/img/` is shorter, advertises "this is images" rather than
the more generic "uploads", and lets us keep the existing
`YYYY/MM/filename.ext` substructure unchanged. Restructuring by content
type (e.g. `/img/eating/proper-gander.jpg`) was considered and rejected
— it would force the export script to know each file's owning content
type, makes filename deduplication harder when the same file is shared
across multiple entries, and changes the filename relationship to
WordPress's original structure (which complicates any future re-export
from the legacy DB).

**Decision 2: Filter to image extensions only.**

Allowlist: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.svg`, `.ico`.
Everything else (`.php`, `.log`, `.htaccess`, `.css`, `.bak`, no
extension) is dropped. Plugin-junk directories (`aios/`,
`ShortpixelBackups/`, `cleantalk_*`, `hummingbird-assets/`, `cache/`,
`shortpixel-meta/`, `smush*/`) are also skipped wholesale.

**Decision 3: Reference-driven copy, not blanket rsync.**

The migration tool scans `src/content/**/*.md` and the three hardcoded
template references for `/img/...` URLs (post-rename), builds a Set of
needed files, and copies only those. WebP companion files
(`name.webp` next to `name.jpg`) are auto-included for any retained
source image so a future `<picture>` rollout works without re-running
the migration.

**Decision 4: Single one-shot migration, not incremental.**

The legacy backup is frozen as of 2026-03-13. There won't be a
"refresh" cycle — the migration runs once when an image set changes
(e.g., a new venue is added). The tool is idempotent and
delete-safe: existing files in `public/img/` not in the needed set
are left in place (operator decides whether to clean them up).

**Decision 5: Backward-compat redirect rule.**

`/wp-content/uploads/* → /img/:splat 301` in `public/_redirects`
catches any external links still pointing at the old paths.
Cheap insurance; one line of config.

## Open Questions

### Resolved During Planning

- **What replaces `/wp-content/uploads/` in URLs?** `/img/` — see
  Decision 1.
- **Does anything currently live at `public/img/`?** A stray empty
  `public/img/svg/` directory created during initial scaffolding
  but never used. Verified via `git ls-files public/img/` (zero
  tracked files) and `ls public/img/svg/` (empty). The Icon
  component pulls SVGs from `src/icons/` at build time via Vite's
  `import.meta.glob`, not from `public/`. Unit 5 deletes the empty
  directory along with `public/wp-content/`. No collision risk.
- **Do we keep the date-based subdirectory (`YYYY/MM/`)?** Yes —
  preserves filename uniqueness and minimises export-script
  changes (just a prefix swap).
- **Do we keep WebP companions?** Yes when their source `.jpg`/`.png`
  is referenced. Verified the backup uses single-extension swap
  pattern: `summer-night-at-the-dovey.jpg` →
  `summer-night-at-the-dovey.webp` (NOT
  `summer-night-at-the-dovey.jpg.webp`). Migration tool maps
  `.jpg`/`.jpeg`/`.png` → same-stem `.webp`. WebP-only files
  (no source image) are dropped because nothing references them.
- **Do we keep WP-generated thumbnail variants
  (`-150x150`, `-300x204`, etc.) when the canonical full-size image
  is referenced?** No — we copy only files exactly referenced. If
  the body content references `Castell-y-Bere-70-1024x768.jpeg`,
  that exact file is copied; sibling variants are not.
- **Does `_redirects` get hand-edited or generated?** Generated by
  `tools/export-from-sql.ts`. Header comment in the file says so.
  Therefore Unit 4 edits the **export script**, not the generated
  output. Hand-editing `public/_redirects` would silently lose the
  rule on the next `npm run export`.
- **Does the wildcard rule sort correctly relative to the explicit
  `Overhead.jpg → /` rule?** Only if it's emitted as a trailing
  rule, AFTER the existing sorted block — not as a new entry in the
  sorted Set. Lexically, `*` (ASCII 42) sorts before digits, so a
  sorted member would override the explicit rule on first-match
  hosts (Netlify). Unit 4 specifies trailing emission.
- **Where else might `/img/` references live beyond `src/content/`?**
  Three known hardcoded refs in templates (covered in Unit 2),
  plus `src/data/events.json` (the `_example` block has
  `/img/uploads/example-event.jpg`). The scanner walks the entire
  `src/` tree to catch all of them automatically — see Unit 3.
- **Does the migration tool consume the existing
  `tools/.upload-references.txt` dotfile produced by the export?**
  No. The dotfile records pre-rewrite paths and would lag the
  source of truth. Migration scans the source tree directly so
  there's only one path-source.

### Deferred to Implementation

- Exact API shape of `tools/migrate-uploads.ts` (CLI flags,
  output format) — pick during build, prefer terse stdout: counts +
  total bytes copied + skipped reasons.
- Whether to also include `*.svg` from `src/icons/` in the new
  `public/img/` tree, or leave them as inline-imported SVGs in the
  source tree. Prefer leaving the inline-import workflow as-is.
- Whether to commit `public/img/` to git or keep it gitignored
  (current `public/wp-content/` is gitignored). Keep gitignored —
  the operator runs migrate-uploads after a fresh checkout.

## Implementation Units

- [ ] **Unit 1: Update path emission in the export pipeline + non-content refs**

**Goal:** Change every path constructor in `tools/export-from-sql.ts`
so the next export run produces `/img/...` paths instead of
`/wp-content/uploads/...`. Update `src/data/events.json`'s example
template to match the new scheme. Re-run the export to regenerate
all markdown files. (Hardcoded template refs are deliberately
kept in Unit 2 to keep this unit focused on the export pipeline.)

**Requirements:** R1.

**Dependencies:** None.

**Files:**
- Modify: `tools/export-from-sql.ts`
- Modify: `src/data/events.json` (replace
  `"image": "/img/uploads/example-event.jpg"` in the `_example`
  block with `"image": "/img/2026/04/example-event.jpg"`)
- Regenerated (do not hand-edit): `src/content/pages/*.md`,
  `src/content/eating/*.md`, `src/content/things-to-do/*.md`,
  `src/content/stay-categories/*.md` (these are export output)

**Approach:**
- Update `attachmentPathById` construction at line 428 from
  `` `/wp-content/uploads/${file}` `` to `` `/img/${file}` ``.
- Inside `rewriteContent()`, add a substitution that translates any
  remaining `/wp-content/uploads/` literal in raw post body HTML to
  `/img/`. **Order:** the substitution must run BEFORE the existing
  `out.matchAll(/\/wp-content\/uploads\/.../g)` tracker that fills
  `uploadReferences`. Otherwise the dotfile records pre-rewrite
  paths. Either flip the order, or also rewrite the tracker keys
  to the new prefix. (The migration tool in Unit 3 doesn't consume
  the dotfile, but other tooling might.)
- Re-run `npm run export`.
- Confirm via `grep -r "/wp-content/" src/content/` that the
  result is empty.

**Patterns to follow:**
- The export script already does string-rewriting in `rewriteContent`
  for things like the legacy domain (`https?://www.visit-tywyn.co.uk/` →
  `/`). Add the new replacement next to that one.

**Test scenarios:**
- Happy path: re-run export → grep `src/content/**/*.md` for
  `/wp-content/` → 0 hits.
- Happy path: spot-check a frontmatter
  `hero_image.src` is now `/img/2022/05/...`.
- Edge case: spot-check a body-content `<img>` tag inside a
  page like `cinema.md` or `nant-gwernol.md` (which reference
  `/wp-content/uploads/...` inline) is now `/img/...`.
- Edge case: non-`/wp-content/uploads/` paths (the few absolute
  external URLs in body content) are untouched.
- Edge case: `tools/.upload-references.txt` dotfile (if still
  emitted by the export script) contains `/img/...` paths, not
  the legacy prefix.

**Verification:**
- `grep -rE "/wp-content/" src/content/` returns nothing.
- `grep '"image"' src/data/events.json` shows `/img/...`, not
  `/img/uploads/...`.
- `npm run build` still succeeds with 48 pages. Built JSON-LD
  blocks (`primaryImageOfPage.url`, `og:image`) all use `/img/`
  in `dist/`.

- [ ] **Unit 2: Update hardcoded template path references**

**Goal:** Translate the three hardcoded `/wp-content/uploads/`
references in the templates and lib config to the new `/img/` scheme
so the build emits a consistent URL space.

**Requirements:** R1.

**Dependencies:** Unit 1 (so `dist/` reflects fully-renamed paths
when verified).

**Files:**
- Modify: `src/components/Header/Header.astro` (logo `<img src>`)
- Modify: `src/lib/site.ts` (`defaultOgImage` constant)
- Modify: `src/pages/eating/index.astro` (eating-banner heroImage prop)

**Approach:**
- Three single-line string changes; no logic changes.
- After editing, run `npm run build` and verify with
  `grep -rE "/wp-content/" dist/` that no rendered HTML still
  emits old paths.

**Patterns to follow:**
- These are the only three out-of-content references; once they
  change, the codebase is clean. No new pattern needed.

**Test scenarios:**
- Test expectation: none — pure string substitution covered by
  the build verification step.

**Verification:**
- `grep -rE "/wp-content/" src/ | grep -v "src/content/"` returns
  nothing (with content/ already cleaned by Unit 1, total source
  tree is clean).
- `grep -rE "/wp-content/" dist/` returns nothing after build.
- Built `<head>` shows `og:image` content starting with `/img/`.

- [ ] **Unit 3: Build the reference-driven migration tool**

**Goal:** Create `tools/migrate-uploads.ts` that scans the source
tree for `/img/...` URLs, intersects them with the legacy backup's
image-only files, and copies the intersection (plus WebP companions)
into `public/img/`.

**Requirements:** R2, R3.

**Dependencies:** Unit 1 (path scheme settled), Unit 2 (template
refs updated so the scanner picks them up).

**Files:**
- Create: `tools/migrate-uploads.ts`
- Modify: `package.json` (add `migrate:uploads` script)
- Modify: `README.md` (replace `tools/copy-uploads.sh` mention with
  `npm run migrate:uploads`)
- Delete: `tools/copy-uploads.sh`

**Approach:**

The tool runs in three phases:

1. **Discover.** Walk the entire `src/` tree (every file under
   `src/`, not just `src/content/`) and read each text file
   looking for `/img/<rest>` patterns. The reason for the full
   walk: hardcoded refs already live in templates (Header,
   site.ts, eating/index), `src/data/events.json` carries example
   refs, and future contributors will scatter image paths across
   components without remembering to update a hardcoded scanner
   list. Full-tree scan stays correct as the codebase evolves.
   Path-extraction logic:
   - Match `/img/[^\s"'<>?#)]+\.(jpg|jpeg|png|webp|gif|svg|ico)`
     case-insensitively. The terminator class excludes whitespace,
     quotes, angle brackets, query strings, fragments, and
     parentheses (e.g., the trailing `)` of a CSS `url(...)`).
   - Reject any match where the immediate prefix is `://` or `//` —
     those are absolute external URLs that happen to contain
     `/img/` (e.g. `https://example.com/img/x.jpg`). Use a
     negative-lookbehind in the regex or post-filter on the
     match's left context.
   - Normalise to a repo-relative path under `<BACKUP>/wp-content/
     uploads/` by stripping the leading `/img/`.
   - Deduplicate into a Set.
2. **Filter.** For each filename in the needed Set, compute the
   absolute legacy-backup source path
   (`<BACKUP>/wp-content/uploads/<filename>`). Verify the file
   exists in the backup AND has an image extension AND is not
   inside a plugin-junk directory. If all three hold, mark for
   copy. Plus: if a `.jpg`, `.jpeg`, or `.png` is being copied,
   also copy the sibling `.webp` if it exists. WebP companion
   pattern is single-extension swap: `foo.jpg` →
   `foo.webp` (verified in the backup; not `foo.jpg.webp`).
3. **Copy.** For each marked file, ensure the destination
   directory exists under `public/img/` and copy the file.
   Track stats: files copied, total bytes, files referenced but
   missing from backup (warn), files in needed Set that hit
   junk-dir filter (warn — should not happen post-cleanup).

The tool is idempotent: copying over an existing identical file
is a no-op. The tool is delete-safe: it does not remove files in
`public/img/` that aren't in the needed Set; that's a separate
manual cleanup decision.

CLI:
- `npm run migrate:uploads` — uses the default backup path baked
  into the script (`tools/copy-uploads.sh` did this too).
- `npm run migrate:uploads -- /path/to/different/backup` —
  override.

Stdout summary at the end:
```
Migration summary:
  Referenced: N files
  Copied:     M files (X.X MB)
  Skipped:    K files (already up to date)
  Missing:    P files (referenced but not in backup) — see warnings above
```

**Patterns to follow:**
- `tools/export-from-sql.ts` is the existing exemplar of a
  build-time TypeScript helper. Use the same structure: top-level
  constants for paths, pure helper functions, an entry block at
  the bottom that ties it together. Keep it dependency-free
  beyond `node:fs`/`node:path`.
- Run via `tsx` like the other tools (`npm run` script wraps
  `tsx tools/migrate-uploads.ts`).

**Test scenarios:**

Reference scanner:
- Happy path: finds `/img/2022/05/foo.jpg` inside a markdown
  frontmatter `hero_image.src` field.
- Happy path: finds `/img/2022/06/bar.png` inside a body
  `<img src="/img/2022/06/bar.png">` tag.
- Edge case: ignores absolute external URLs (`https://example.com/img/x.jpg`)
  even though they contain `/img/` substring.
- Edge case: handles paths with query strings or hashes
  (truncates to the path).
- Edge case: handles uppercase extensions (`.JPG`).

Image filter:
- Happy path: includes `.jpg`, `.jpeg`, `.png`, `.webp`,
  `.gif`, `.svg`, `.ico`.
- Error path: skips `.php`, `.log`, `.htaccess`, `.css`, no-extension.
- Error path: skips files inside `aios/`, `ShortpixelBackups/`,
  `cleantalk_*/`, `hummingbird-assets/`, `cache/`,
  `shortpixel-meta/`, `smush*/`.

Migration runner:
- Happy path: end-to-end run on the real backup → output dir
  contains exactly the referenced images plus WebP companions.
- Edge case: a referenced file genuinely missing from the backup
  → warning printed, run does not crash, continues with the rest.
- Integration: `du -sh public/img/` is measured at <80MB after
  a real run (vs 315MB previously).

**Verification:**
- After running `npm run migrate:uploads`, all images in the
  built `dist/` resolve (visual smoke check or `find dist -name
  '*.html' -exec grep -l '/img/' {} \\;` followed by a script
  that checks each `<img src>` resolves to a real file in
  `public/img/`).
- `du -sh public/img/` is materially smaller than the previous
  315MB.
- The discovery phase reports `Referenced: N files` where N is
  consistent with the number of unique image references the
  source tree actually contains (~150-300).

- [ ] **Unit 4: Add backward-compat redirect via the export script**

**Goal:** Catch any external links to old asset URLs and 301 them
to the new location, by teaching the export script to emit a
trailing wildcard rule. Editing the generated `public/_redirects`
file directly would lose the rule on the next `npm run export`.

**Requirements:** R5.

**Dependencies:** None — independent of Units 1-3.

**Files:**
- Modify: `tools/export-from-sql.ts` (the redirect-emission code
  near the bottom of the script — adds a trailing `/wp-content/
  uploads/* /img/:splat 301` line AFTER the sorted block of
  per-URL rules)
- Regenerated: `public/_redirects`

**Approach:**

The export script today builds an array of `RedirectRow`s, sorts
them by `from`, and writes them as the body of `public/_redirects`.
Add the wildcard as a trailing line emitted after the sorted block
(NOT as a new entry in the sorted array — `*` sorts lexically
before digits and letters, so a sorted entry would land at the top
and override the explicit `Overhead.jpg → /` rule on first-match
hosts like Netlify).

The line to emit:

```
/wp-content/uploads/*  /img/:splat  301
```

`:splat` is the Netlify / Cloudflare Pages wildcard capture syntax;
it works the same in both.

**Patterns to follow:**
- The script already emits the 43 plugin redirects + 59
  accommodation slug redirects + 16 pagination redirects from a
  sorted Set, then writes the file. Add a single `\n` + the
  wildcard line after the sorted block but before the trailing
  newline.
- `public/_redirects` 3-column `from to code` syntax is preserved.

**Test scenarios:**
- Happy path: re-run `npm run export` → grep
  `public/_redirects` for `/wp-content/uploads/\*` → exactly one
  hit, and it's the LAST data line in the file.
- Happy path: the explicit
  `/wp-content/uploads/2015/04/Overhead.jpg / 301` line still
  appears earlier in the file (sorted block).
- Happy path (deploy): `curl -I https://visit-tywyn.co.uk/wp-content/uploads/2022/05/explore.jpg`
  returns `301` → `/img/2022/05/explore.jpg` (post-deploy +
  post-Unit 5 migration so the destination exists).
- Edge case: a path that doesn't exist under `/img/` after rewrite
  returns 404 from the host (not an infinite redirect loop —
  `/img/<missing>.jpg` is not in the redirect table).

**Verification:**
- `cat dist/_redirects | tail -3` shows the wildcard rule as the
  last line.
- `cat dist/_redirects | grep -c "/wp-content/uploads/"` returns
  exactly 2 (the explicit Overhead rule + the wildcard).
- After deploy (or `npm run preview` + manual curl test), an old
  asset URL 301s to the new location.

- [ ] **Unit 5: Wipe the old directory and verify end-to-end**

**Goal:** Remove `public/wp-content/`, run the new migration, build,
and verify the site is fully on the new asset scheme with no stragglers.

**Requirements:** R3, R4, R6.

**Dependencies:** Units 1-4.

**Files:**
- Modify: `.gitignore` (replace `public/wp-content/` line with
  `public/img/`).
- Delete (working tree only — gitignored anyway):
  `public/wp-content/`.
- Repopulate: `public/img/` (via `npm run migrate:uploads`).

**Approach:**

This is a verification + cleanup unit, not new code. **Critical
ordering:** populate `public/img/` BEFORE deleting
`public/wp-content/`. If Unit 3's migration tool has a runtime
bug, the operator can re-run it; if `public/wp-content/` is
already gone, the local dev server has no images until either
re-running `tools/copy-uploads.sh` (which has been deleted) or
re-running migrate-uploads against a working tool.

1. **Pre-flight grep.** `grep -rE "/wp-content/" src/` returns
   nothing. If non-zero, return to Unit 1 — Unit 5 cannot proceed
   while content still references the legacy prefix.
2. **Update `.gitignore`.** Replace `public/wp-content/` with
   `public/img/20*/`. The `20*` glob covers `public/img/2022/`,
   `public/img/2023/`, `public/img/2024/`, etc. — keeps any
   manually-curated future content under `public/img/` (e.g., a
   commitable 1200x630 OG card) trackable while keeping the
   year-bucketed migrated content gitignored.
3. **Delete the empty `public/img/svg/`** (verified empty during
   planning; created by initial scaffolding but unused).
4. **Run `npm run migrate:uploads`** to populate
   `public/img/`. Verify the stdout summary: copied count,
   total bytes, no missing files (or only documented missing
   files).
5. **Build:** `npm run build`. Verify 48 pages built.
6. **Smoke check** in dev (`npm run dev`):
   - Home page logo loads.
   - Eating index banner loads.
   - A venue detail page photo loads.
   - A things-to-do gallery loads.
   - The OG image referenced in `<head>` resolves.
7. `grep -rE "/wp-content/" dist/` should return only the redirect
   rule line in `dist/_redirects` (expected — the wildcard 301
   we emit in Unit 4 references `/wp-content/uploads/*` by
   design). All other matches must be zero.
8. **Now safe to delete:** `rm -rf public/wp-content/`.
9. `du -sh public/img/` to confirm the new size is well under
   100MB (target: ~50-80MB based on referenced-only filtering).

**Patterns to follow:**
- `.gitignore` already uses simple line entries; a single-line
  swap is sufficient.

**Test scenarios:**
- Test expectation: none — this is verification of the units
  above, not new behavior.

**Verification:**
- `public/wp-content/` does not exist.
- `public/img/` exists, contains only image files, and is
  under 100MB.
- Dev server renders all images without 404s in the network panel.
- `dist/` build succeeds with the same 48-page count.

## System-Wide Impact

- **Interaction graph.** Three callsites consume image paths
  emitted by the export script: rendered markdown content
  (via `<Content />`), `<BannerImage>` props from page
  templates, and `<img>` tags in components. All three resolve
  to paths under `/wp-content/uploads/` today and will resolve
  to paths under `/img/` after the migration. No call-site
  changes required beyond Unit 2's three hardcoded references.
- **Error propagation.** If a referenced image is missing from
  the backup (and therefore missing from `public/img/`), the
  built page renders a broken `<img>`. The migration tool's
  warning surface catches this at migrate-time so we don't ship
  broken assets unknowingly.
- **State lifecycle risks.** The migration tool is idempotent
  and delete-safe — re-running it doesn't break anything. If
  someone hand-adds a file to `public/img/` (e.g., a new social
  card), re-running migrate-uploads won't delete it. That's a
  feature.
- **API surface parity.** The legacy `_redirects` continue to
  work because the new wildcard catches anything that slipped
  through. External SEO surfaces (Google Search index, social
  cards on archived shares) hit a 301 and update naturally.
- **Integration coverage.** The end-to-end check in Unit 5 is
  the integration test: build, render, network-panel-no-404s.
  No mocked unit test substitutes for that.
- **Unchanged invariants.** The `/eating/`, `/things-to-do/`,
  `/holiday-accommodation/...` page URLs do NOT change. The
  legacy URL space (canonical pages, redirects to/from old WP
  paths) remains intact. Only asset URLs move from
  `/wp-content/uploads/...` to `/img/...`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Migration tool misses a reference (a stylesheet `url()`, a hand-edited markdown file, a JSON data file, a future component, etc.). The image is in the backup but not copied; the deployed site has a broken image. | Discovery-phase scanner walks the entire `src/` tree (every file under `src/`, not just `src/content/`) with a regex tuned to capture `/img/...` substrings while rejecting absolute external URLs. New paths added in any future file are picked up automatically. The wildcard 301 rule catches old-path inbound links. The Unit 5 dev-server smoke test surfaces missing images before deploy. |
| The 1908×397 hero banner images are referenced by full path (no thumbnail variants), but inline body `<img>` tags reference specific thumbnail sizes (e.g., `Castell-y-Bere-70-1024x768.jpeg`). The migration must copy exact filenames as referenced — not infer "all sizes of this image". | Reference scanner builds the needed Set from exact path strings. No filename normalisation or "include all variants" logic. Keeps the copy footprint minimal AND avoids false negatives. |
| Plugin junk has `.jpg` files that ARE images but live under junk dirs (e.g., `aios/wp-fail2ban-attack-1.jpg`). Naive image-extension filter would copy these. | Combine extension filter AND junk-dir denylist. A file passes only if both conditions hold. Verified during build of the migration tool's filter logic. |
| Re-running `npm run export` clobbers any hand-edited markdown content (frontmatter AND inline body HTML). If someone hand-edits a `<img src>` after a previous export and then we never re-run export, the rewrite never happens; their hand-edited path stays as `/wp-content/uploads/...`. | Unit 5 step 1 ("pre-flight grep") makes Unit 1's `grep -rE "/wp-content/" src/` a hard precondition for cleanup. If anything is hand-edited and not yet re-exported, the grep fails and the cleanup blocks. README already notes export is destructive; the precondition adds a checked gate. |
| Editing `public/_redirects` directly to add the wildcard rule would be silently lost on the next `npm run export`, since the file is regenerated. | Unit 4 edits `tools/export-from-sql.ts` to emit the rule, not the generated file directly. The rule is also placed as a TRAILING line (post-sort) so it doesn't override the explicit `Overhead.jpg → /` rule on first-match hosts. |
| `public/img/` already exists as `public/img/svg/` (created by initial scaffolding). A blanket `public/img/` gitignore rule would untrack any tracked content under that path. | Verified during planning that `public/img/svg/` is empty AND untracked (`git ls-files public/img/` returned nothing). Unit 5 deletes the empty `svg/` and uses a more specific gitignore pattern (`public/img/20*/`) that keeps room for committable content under `public/img/` (e.g., a future hand-curated 1200×630 OG card) while gitignoring the year-bucketed migrated content. |

## Documentation / Operational Notes

- Update `README.md` to replace mentions of `tools/copy-uploads.sh` with
  `npm run migrate:uploads`. Update the "Open follow-ups" list to drop
  the now-resolved `wp-content` cleanup item and replace with the
  remote-storage migration item (already there) reframed against the
  new `public/img/` location.
- **Naming convention to mirror existing tools.** The new tool ships as
  `tools/migrate-uploads.ts` (file) wired to the npm script
  `migrate:uploads` (so users invoke `npm run migrate:uploads`, not
  `node tools/migrate-uploads.ts` directly). This matches the existing
  `export` and `refresh:conditions` script style.
- Operator note: re-clone or re-checkout requires running
  `npm run migrate:uploads` once before `npm run dev` will show
  images. (Same operational shape as before, different command name.)
- The legacy backup directory at
  `/Users/dave/Downloads/visit-tywyn.co.uk_2026-Mar-13_backup_69b436db1a3c81.57399253/`
  remains the source of truth for image content until uploads are
  moved to remote storage. Anyone migrating to a new dev machine
  needs that backup tree on disk to populate `public/img/`. This
  is documented in `README.md`.
- **Backup-path portability.** The default backup path is hardcoded
  in `tools/migrate-uploads.ts` at the top of the file (matching
  `tools/export-from-sql.ts`'s pattern). Anyone with the backup at
  a different `Downloads/` location must either symlink it to the
  hardcoded path or pass `--backup /path/to/backup` as an override.
  Documented in the tool's CLI help.

## Sources & References

- Related code:
  - `tools/export-from-sql.ts` (path emission, content rewriter)
  - `tools/copy-uploads.sh` (replaced by Unit 3 + Unit 4 cleanup)
  - `src/components/Header/Header.astro`, `src/lib/site.ts`,
    `src/pages/eating/index.astro` (hardcoded references)
  - `public/_redirects` (backward-compat 301 rule)
  - `.gitignore` (path swap)
- Discovery output captured during planning:
  - 103 `/wp-content/` references across the source tree
    (~100 in `src/content/`, 3 hardcoded in templates/lib).
  - 6,198 files in `public/wp-content/uploads/` totalling 315MB.
  - File-extension breakdown: 3070 `.jpg`, 3027 `.webp`,
    69 `.jpeg`, 23 `.png`, 3 `.php`, 3 `.gif`, 1 `.log`,
    1 `.htaccess`, 1 `.css`.
- Prior commits relevant to this plan:
  - `2c7293e` Port SCSS into per-component CSS modules (introduced
    the per-component folder structure that informs path patterns).
  - `9c7bc09` Scaffold Astro 6 rebuild (introduced
    `tools/copy-uploads.sh`).
  - `180f391` Fix all P1/P2/P3 findings from ce:review of the SEO
    pass (most recent commit; baseline for this plan).
