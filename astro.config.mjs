// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * Walk a content directory and pull `updated` (preferred) or
 * `published` dates out of the YAML frontmatter. Returns a map of
 * slug -> ISO date string for use in the sitemap `lastmod`.
 *
 * Uses a regex against the raw markdown instead of `gray-matter` to
 * avoid a build-time dependency. Frontmatter dates in this repo are
 * either bare `2026-04-29` or quoted ISO strings; both match.
 *
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function readContentDates(dir) {
	const map = new Map();
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return map;
	}
	for (const ent of entries) {
		if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
		const slug = ent.name.slice(0, -3);
		let raw;
		try {
			raw = readFileSync(`${dir}/${ent.name}`, 'utf8');
		} catch {
			continue;
		}
		const fmEnd = raw.indexOf('\n---', 4);
		const front = fmEnd > 0 ? raw.slice(0, fmEnd) : raw;
		const updated = front.match(/^updated:\s*(['"]?)(\d{4}-\d{2}-\d{2}[^'"\r\n]*)\1\s*$/m);
		const published = front.match(/^published:\s*(['"]?)(\d{4}-\d{2}-\d{2}[^'"\r\n]*)\1\s*$/m);
		const value = updated?.[2] ?? published?.[2];
		if (!value) continue;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) continue;
		map.set(slug, date.toISOString());
	}
	return map;
}

const pagesDates = readContentDates('./src/content/pages');
const eatingDates = readContentDates('./src/content/eating');
const thingsToDoDates = readContentDates('./src/content/things-to-do');
const stayCategoryDates = readContentDates('./src/content/stay-categories');

/**
 * Map a sitemap URL back to the most recent edit date in our
 * content collections. Returns undefined for any URL that doesn't
 * resolve to a known content file (e.g. the home page, which is
 * code-driven, or bespoke pages without an `updated` field).
 *
 * @param {string} url
 * @returns {string | undefined}
 */
function lastmodForUrl(url) {
	let path;
	try {
		path = new URL(url).pathname;
	} catch {
		return undefined;
	}
	let m;
	m = path.match(/^\/eating\/([^/]+)\/$/);
	if (m) return eatingDates.get(m[1]);
	m = path.match(/^\/things-to-do\/([^/]+)\/$/);
	if (m) return thingsToDoDates.get(m[1]);
	m = path.match(/^\/holiday-accommodation\/([^/]+)\/$/);
	if (m) return stayCategoryDates.get(m[1]);
	m = path.match(/^\/([^/]+)\/$/);
	if (m) return pagesDates.get(m[1]);
	return undefined;
}

/**
 * Rename the sitemap index from `sitemap-index.xml` to
 * `sitemap_index.xml` so the URL matches what the live WordPress
 * site (Yoast SEO) served. Google Search Console already has the
 * underscore variant registered, so emitting at the same URL avoids
 * a 301 hop and keeps GSC's submitted-sitemap reference valid
 * through cutover.
 */
/** @type {import('astro').AstroIntegration} */
const sitemapUnderscoreAlias = {
	name: 'sitemap-underscore-alias',
	hooks: {
		'astro:build:done': async ({ dir }) => {
			const src = new URL('sitemap-index.xml', dir);
			const dest = new URL('sitemap_index.xml', dir);
			await rename(src, dest);
		},
	},
};

// https://astro.build/config
export default defineConfig({
	site: 'https://visit-tywyn.co.uk',
	output: 'static',
	trailingSlash: 'always',
	build: {
		format: 'directory',
		// Inline every Astro-generated stylesheet into the page <head>.
		// Combined size on this site is ~12 KB (BaseLayout.css +
		// EntryHeader.css) which fits in a single TCP RTT, so inlining
		// eliminates the render-blocking external request entirely and
		// shaves ~400 ms LCP on cold mobile loads. The CSS-modules
		// build artefacts still ship to /_astro/ for downstream pages
		// that might come back later via the cache; Astro just no
		// longer references them from <link rel="stylesheet">.
		inlineStylesheets: 'always',
	},
	prefetch: {
		prefetchAll: false,
		defaultStrategy: 'hover',
	},
	integrations: [
		sitemap({
			// Exact match — `.includes('/404')` would catch any URL
			// containing that substring (e.g. a future `/404-redirect/`).
			filter: (page) => page !== 'https://visit-tywyn.co.uk/404/',
			// Set per-route priority + changefreq based on URL pattern,
			// so the home page and high-traffic listings outrank deep
			// editorial content in crawl prioritisation. `lastmod` is
			// derived per-entry from content frontmatter `updated` or
			// `published` dates via `lastmodForUrl`; URLs without a
			// matching content file (e.g. the bespoke home page) ship
			// without a lastmod rather than with a fake build-time
			// stamp that destroyed per-page freshness signal.
			serialize: (item) => {
				const url = item.url;
				// `changefreq` accepts the `EnumChangefreq` enum from the
				// `sitemap` package. The string literals match the enum
				// values at runtime, so cast through the imported enum
				// to keep TypeScript happy without renaming everything.
				/** @typedef {import('sitemap').EnumChangefreq} ChangeFreq */
				const daily = /** @type {ChangeFreq} */ (/** @type {unknown} */ ('daily'));
				const weekly = /** @type {ChangeFreq} */ (/** @type {unknown} */ ('weekly'));
				const monthly = /** @type {ChangeFreq} */ (/** @type {unknown} */ ('monthly'));
				const lastmod = lastmodForUrl(url);
				const withLastmod = lastmod ? { lastmod } : {};
				if (url === 'https://visit-tywyn.co.uk/') {
					return { ...item, priority: 1.0, changefreq: daily, ...withLastmod };
				}
				if (
					/\/(eating|things-to-do|where-to-stay|events|holiday-accommodation)\/?$/.test(url) ||
					/\/holiday-accommodation\/[^/]+\/$/.test(url)
				) {
					return { ...item, priority: 0.9, changefreq: weekly, ...withLastmod };
				}
				if (/\/(eating|things-to-do)\/[^/]+\/$/.test(url)) {
					return { ...item, priority: 0.8, changefreq: monthly, ...withLastmod };
				}
				return { ...item, priority: 0.6, changefreq: monthly, ...withLastmod };
			},
		}),
		sitemapUnderscoreAlias,
	],
	image: {
		// Global image rendering defaults. `constrained` layout gives
		// every `<Image>` / `<Picture>` (and markdown `![]()`) a
		// responsive `srcset` + `sizes` plus the auto-injected
		// `:where([data-astro-image])` helper styles. Per-call props
		// (e.g. `layout="full-width"` on hero banners) override.
		layout: 'constrained',
		responsiveStyles: true,
		// Override the default 8-tier breakpoint array with four
		// widths that match common viewport classes. Fewer variants
		// = less Sharp work at build time and a smaller `dist/_astro/`.
		breakpoints: [640, 960, 1280, 1920],
		service: {
			entrypoint: 'astro/assets/services/sharp',
			config: {
				// AVIF: aggressive compression at acceptable quality.
				// `effort: 4` is the speed/size sweet-spot recommended
				// by libavif maintainers; effort 9 is ~2x slower for
				// ~2-3% extra compression.
				avif: { quality: 60, effort: 4 },
				webp: { quality: 80 },
				jpeg: { quality: 82, mozjpeg: true },
				png: { quality: 90, compressionLevel: 9 },
			},
		},
		// Allow remote images from the legacy S3 bucket and uploads dir during migration.
		domains: ['visit-tywyn.s3.amazonaws.com', 'visit-tywyn.co.uk'],
	},
	// Self-host Lato via Fontsource. Eliminates the render-blocking
	// Google Fonts CSS request and the second-hop fonts.gstatic.com
	// font fetch — both are now inlined `@font-face` against locally
	// hashed woff2 files that ship from the same origin as HTML.
	//
	// `subsets` includes `latin-ext` so Welsh diacritics (ŵ, ŷ —
	// Latin Extended-A) render correctly. Costs one extra small woff2
	// per weight; correctness on Welsh content is worth it.
	//
	// `optimizedFallbacks: true` derives ascent/descent metrics for
	// `sans-serif` so the fallback face renders at the same height
	// as Lato — neutralizes font-swap CLS.
	//
	// Only weight 400 is preloaded (body text). Weight 700 lazy-loads
	// when first heading/badge using it paints — an extra ~25 KB on
	// initial load is not worth the LCP cost.
	fonts: [
		{
			name: 'Lato',
			cssVariable: '--font-body',
			provider: fontProviders.fontsource(),
			weights: [400, 700],
			styles: ['normal'],
			subsets: ['latin', 'latin-ext'],
			fallbacks: [
				'system-ui',
				'-apple-system',
				'Segoe UI',
				'Roboto',
				'Helvetica Neue',
				'sans-serif',
			],
			optimizedFallbacks: true,
		},
	],
});
