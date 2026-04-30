/**
 * SEO comparison tool: WordPress live site vs. Astro rebuild.
 *
 * For each path in the overlap between both URL inventories, fetches
 * the rendered HTML from both, extracts the SEO-load-bearing signals
 * (title, meta description, H1, canonical, OpenGraph, JSON-LD types,
 * body word count, image alt count), and reports any differences.
 *
 * Why these signals: Google's ranking decisions for an existing URL
 * are dominated by on-page content + canonical metadata + structured
 * data. If those match the pre-migration site, ranking equity stays
 * with the URL. Anything that drifts is a launch risk.
 *
 * Run: `npx tsx tools/perf/seo-compare.ts`
 * Requires: `npm run preview` running on port 4322.
 *
 * Output: `docs/perf/seo-compare.json` (raw per-URL data) +
 *         `docs/perf/seo-compare-report.md` (human summary).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());

const LIVE_BASE = 'https://visit-tywyn.co.uk';
const ASTRO_BASE = 'http://localhost:4322';

// Paths shared between WP sitemap and Astro build (the 43-URL overlap).
// Generated from `comm -12` of the two sitemap URL lists.
const overlap = [
	'/',
	'/accessibility-statement-for-visit-tywyn/',
	'/contact/',
	'/cookie-policy/',
	'/dog-friendly-cafes/',
	'/eating/',
	'/eating/coast-deli-dining/',
	'/eating/dine-india/',
	'/eating/dovey-inn/',
	'/eating/kings-cafe-at-talyllyn-railway/',
	'/eating/medina-coffee-house/',
	'/eating/millie-sids/',
	'/eating/mor-tywyn/',
	'/eating/pen-y-bont-hotel/',
	'/eating/pendre-garden-centre-and-cafe/',
	'/eating/peniarth-arms-at-bryncrug/',
	'/eating/proper-gander/',
	'/eating/salt-marsh-kitchen/',
	'/eating/seabreeze/',
	'/eating/the-retreat-bar-cafe/',
	'/eating/toast-coffee-shop/',
	'/eating/ty-te-cadair-tea-room/',
	'/eating/victorian-slipway/',
	'/eating/whitehall/',
	'/events/',
	'/explore-tywyn/',
	'/getting-around/',
	'/privacy-policy/',
	'/things-to-do/',
	'/things-to-do/cadair-idris/',
	'/things-to-do/castell-y-bere/',
	'/things-to-do/dolgoch-falls/',
	'/things-to-do/honey-ice-cream/',
	'/things-to-do/king-arthurs-labyrinth/',
	'/things-to-do/magic-lantern-cinema/',
	'/things-to-do/nant-gwernol/',
	'/things-to-do/the-secret-garden/',
	'/things-to-do/the-talyllyn-railway/',
	'/things-to-do/tywyn-beach/',
	'/things-to-do/tywyn-wharf/',
	'/wales-coastal-path/',
	'/webcam/',
	'/where-to-stay/',
];

interface SeoSignals {
	url: string;
	status: number;
	title: string | null;
	metaDescription: string | null;
	canonical: string | null;
	robots: string | null;
	h1Texts: string[];
	h2Texts: string[];
	ogTitle: string | null;
	ogDescription: string | null;
	ogImage: string | null;
	twitterCard: string | null;
	jsonLdTypes: string[];
	bodyWordCount: number;
	imageCount: number;
	imagesWithAlt: number;
	internalLinkCount: number;
	externalLinkCount: number;
	error?: string;
}

function decodeEntities(s: string): string {
	return (
		s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&#038;/g, '&')
			.replace(/&#38;/g, '&')
			.replace(/&#x26;/g, '&')
			.replace(/&#8217;/g, '’')
			.replace(/&#8216;/g, '‘')
			.replace(/&#8220;/g, '“')
			.replace(/&#8221;/g, '”')
			.replace(/&#8211;/g, '–')
			.replace(/&#8212;/g, '—')
			.replace(/&hellip;/g, '…')
			.replace(/&nbsp;/g, ' ')
			// Generic numeric entity fallback (covers any &#NNN; that
			// the explicit list misses).
			.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
	);
}

/**
 * Normalize text for SEO-equivalence comparison: decode entities,
 * fold smart quotes to ASCII, collapse whitespace, lowercase.
 *
 * Google treats these as identical for indexing — `Millie & Sid's`
 * and `Millie &amp; Sid&#8217;s` are the same query. Comparing the
 * normalized form filters cosmetic content drift from real changes.
 */
function normalize(s: string | null): string | null {
	if (s === null) return null;
	return decodeEntities(s)
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractMeta(html: string, name: string): string | null {
	const reName = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i');
	const reProp = new RegExp(`<meta[^>]+property=["']${name}["'][^>]*>`, 'i');
	const tag = html.match(reName)?.[0] || html.match(reProp)?.[0];
	if (!tag) return null;
	// Match content="..." or content='...' — the inner pattern must
	// only forbid the matching closer, not both. The previous
	// `[^"']*` collapsed an apostrophe inside a double-quoted value
	// (e.g. `content="don't worry"`) which truncated the captured
	// string at the first inner quote of either kind.
	const m = tag.match(/content="([^"]*)"|content='([^']*)'/i);
	if (!m) return null;
	return decodeEntities(m[1] ?? m[2] ?? '');
}

function extractTitle(html: string): string | null {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return m ? decodeEntities(m[1].trim()) : null;
}

function extractCanonical(html: string): string | null {
	const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
	if (!m) return null;
	const href = m[0].match(/href="([^"]*)"|href='([^']*)'/i);
	if (!href) return null;
	return href[1] ?? href[2] ?? null;
}

function extractRobots(html: string): string | null {
	return extractMeta(html, 'robots');
}

function extractTagText(html: string, tag: string): string[] {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
	const out: string[] = [];
	for (const m of html.matchAll(re)) {
		const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
		if (text) out.push(decodeEntities(text));
	}
	return out;
}

function extractJsonLdTypes(html: string): string[] {
	const types: string[] = [];
	const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	for (const m of html.matchAll(re)) {
		try {
			const data = JSON.parse(m[1].trim());
			const collect = (obj: unknown) => {
				if (!obj || typeof obj !== 'object') return;
				const o = obj as Record<string, unknown>;
				if (typeof o['@type'] === 'string') types.push(o['@type']);
				else if (Array.isArray(o['@type'])) types.push(...(o['@type'] as string[]));
				if (Array.isArray(o['@graph'])) o['@graph'].forEach(collect);
			};
			if (Array.isArray(data)) data.forEach(collect);
			else collect(data);
		} catch {
			types.push('PARSE_ERROR');
		}
	}
	return types.sort();
}

function extractBodyText(html: string): string {
	// Strip everything before first <body> + everything after </body>
	const bodyStart = html.search(/<body[^>]*>/i);
	const bodyEnd = html.search(/<\/body>/i);
	let body = bodyStart >= 0 && bodyEnd > bodyStart ? html.slice(bodyStart, bodyEnd) : html;
	// Remove non-content blocks that vary between platforms
	body = body
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<nav[\s\S]*?<\/nav>/gi, '')
		.replace(/<header[\s\S]*?<\/header>/gi, '')
		.replace(/<footer[\s\S]*?<\/footer>/gi, '')
		.replace(/<svg[\s\S]*?<\/svg>/gi, '');
	const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return decodeEntities(text);
}

function countLinks(html: string, baseUrl: string): { internal: number; external: number } {
	const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
	let internal = 0;
	let external = 0;
	const baseHost = new URL(baseUrl).host;
	for (const m of html.matchAll(re)) {
		const href = m[1];
		if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
		try {
			const u = new URL(href, baseUrl);
			if (u.host === baseHost) internal++;
			else external++;
		} catch {
			// relative or malformed — count as internal
			internal++;
		}
	}
	return { internal, external };
}

function countImages(html: string): { total: number; withAlt: number } {
	const re = /<img\b[^>]*>/gi;
	let total = 0;
	let withAlt = 0;
	for (const m of html.matchAll(re)) {
		total++;
		if (/alt=["'][^"']*["']/.test(m[0])) withAlt++;
	}
	return { total, withAlt };
}

async function fetchAndAnalyze(url: string): Promise<SeoSignals> {
	const result: SeoSignals = {
		url,
		status: 0,
		title: null,
		metaDescription: null,
		canonical: null,
		robots: null,
		h1Texts: [],
		h2Texts: [],
		ogTitle: null,
		ogDescription: null,
		ogImage: null,
		twitterCard: null,
		jsonLdTypes: [],
		bodyWordCount: 0,
		imageCount: 0,
		imagesWithAlt: 0,
		internalLinkCount: 0,
		externalLinkCount: 0,
	};
	try {
		const res = await fetch(url, { redirect: 'follow' });
		result.status = res.status;
		if (!res.ok) {
			result.error = `HTTP ${res.status}`;
			return result;
		}
		const html = await res.text();
		result.title = extractTitle(html);
		result.metaDescription = extractMeta(html, 'description');
		result.canonical = extractCanonical(html);
		result.robots = extractRobots(html);
		result.h1Texts = extractTagText(html, 'h1');
		result.h2Texts = extractTagText(html, 'h2');
		result.ogTitle = extractMeta(html, 'og:title');
		result.ogDescription = extractMeta(html, 'og:description');
		result.ogImage = extractMeta(html, 'og:image');
		result.twitterCard = extractMeta(html, 'twitter:card');
		result.jsonLdTypes = extractJsonLdTypes(html);
		const body = extractBodyText(html);
		result.bodyWordCount = body.split(/\s+/).filter(Boolean).length;
		const imgs = countImages(html);
		result.imageCount = imgs.total;
		result.imagesWithAlt = imgs.withAlt;
		const links = countLinks(html, url);
		result.internalLinkCount = links.internal;
		result.externalLinkCount = links.external;
	} catch (err) {
		result.error = (err as Error).message;
	}
	return result;
}

interface PageDiff {
	path: string;
	wp: SeoSignals;
	astro: SeoSignals;
	deltas: string[];
}

function compare(wp: SeoSignals, astro: SeoSignals): string[] {
	const issues: string[] = [];
	if (wp.error || astro.error) {
		if (wp.error) issues.push(`WP fetch failed: ${wp.error}`);
		if (astro.error) issues.push(`Astro fetch failed: ${astro.error}`);
		return issues;
	}
	if (normalize(wp.title) !== normalize(astro.title)) {
		issues.push(`title differs\n    WP:    ${wp.title}\n    Astro: ${astro.title}`);
	}
	if (normalize(wp.metaDescription) !== normalize(astro.metaDescription)) {
		issues.push(
			`meta description differs\n    WP:    ${wp.metaDescription}\n    Astro: ${astro.metaDescription}`,
		);
	}
	// Canonical equivalence: ignore trailing slash and host normalization.
	const normCanonical = (s: string | null) => (s ? s.replace(/\/$/, '').toLowerCase() : null);
	if (normCanonical(wp.canonical) !== normCanonical(astro.canonical)) {
		issues.push(`canonical differs\n    WP:    ${wp.canonical}\n    Astro: ${astro.canonical}`);
	}
	const wpH1 = wp.h1Texts.map(normalize).join('|');
	const astroH1 = astro.h1Texts.map(normalize).join('|');
	if (wpH1 !== astroH1) {
		issues.push(`H1 differs\n    WP:    ${JSON.stringify(wp.h1Texts)}\n    Astro: ${JSON.stringify(astro.h1Texts)}`);
	}
	if (normalize(wp.ogTitle) !== normalize(astro.ogTitle)) {
		issues.push(`og:title differs\n    WP:    ${wp.ogTitle}\n    Astro: ${astro.ogTitle}`);
	}
	if (normalize(wp.ogDescription) !== normalize(astro.ogDescription)) {
		issues.push(
			`og:description differs\n    WP:    ${wp.ogDescription}\n    Astro: ${astro.ogDescription}`,
		);
	}
	const delta = (a: number, b: number) => Math.abs(a - b);
	if (delta(wp.bodyWordCount, astro.bodyWordCount) > Math.max(50, wp.bodyWordCount * 0.2)) {
		issues.push(
			`body word count differs >20%\n    WP:    ${wp.bodyWordCount}\n    Astro: ${astro.bodyWordCount}`,
		);
	}
	const wpTypes = wp.jsonLdTypes.join(',');
	const astroTypes = astro.jsonLdTypes.join(',');
	if (wpTypes !== astroTypes) {
		issues.push(`JSON-LD types differ\n    WP:    [${wpTypes}]\n    Astro: [${astroTypes}]`);
	}
	return issues;
}

function fmt(s: string | null, max = 80): string {
	if (s === null) return '(null)';
	return s.length > max ? s.slice(0, max) + '…' : s;
}

async function main() {
	console.log(`Comparing ${overlap.length} overlapping URLs (WP vs Astro)\n`);
	const diffs: PageDiff[] = [];

	// Throttle to 3 concurrent requests to avoid hammering the live site.
	const inFlight: Promise<void>[] = [];
	const results: PageDiff[] = [];
	let i = 0;

	async function processOne(path: string) {
		const wpUrl = `${LIVE_BASE}${path}`;
		const astroUrl = `${ASTRO_BASE}${path}`;
		const [wp, astro] = await Promise.all([fetchAndAnalyze(wpUrl), fetchAndAnalyze(astroUrl)]);
		const deltas = compare(wp, astro);
		const diff: PageDiff = { path, wp, astro, deltas };
		results.push(diff);
		const tag = deltas.length === 0 ? '✓' : `✗ ${deltas.length}`;
		console.log(`[${++i}/${overlap.length}] ${tag.padEnd(6)} ${path}`);
	}

	// Sequential to keep load on live WP modest.
	for (const p of overlap) {
		await processOne(p);
	}

	diffs.push(...results);

	const cleanCount = diffs.filter((d) => d.deltas.length === 0).length;
	const issueCount = diffs.length - cleanCount;
	console.log(`\nClean: ${cleanCount} | With deltas: ${issueCount}`);

	const json = { generatedAt: new Date().toISOString(), pages: diffs };
	writeFileSync(resolve(repoRoot, 'docs/perf/seo-compare.json'), JSON.stringify(json, null, 2));

	// Markdown report
	const lines: string[] = [];
	lines.push('# SEO comparison: WordPress live vs. Astro rebuild');
	lines.push('');
	lines.push(`Generated ${new Date().toISOString()}`);
	lines.push('');
	lines.push(`- Pages compared: **${diffs.length}**`);
	lines.push(`- Clean (no deltas): **${cleanCount}**`);
	lines.push(`- With deltas: **${issueCount}**`);
	lines.push('');
	lines.push('## Pages with deltas');
	lines.push('');
	for (const d of diffs) {
		if (d.deltas.length === 0) continue;
		lines.push(`### \`${d.path}\``);
		lines.push('');
		for (const issue of d.deltas) {
			lines.push(`- ${issue.replace(/\n/g, '\n  ')}`);
		}
		lines.push('');
	}
	lines.push('## Clean pages (no on-page SEO drift)');
	lines.push('');
	for (const d of diffs) {
		if (d.deltas.length > 0) continue;
		lines.push(`- \`${d.path}\``);
	}
	lines.push('');
	writeFileSync(resolve(repoRoot, 'docs/perf/seo-compare-report.md'), lines.join('\n'));

	console.log('\nWrote docs/perf/seo-compare.json + docs/perf/seo-compare-report.md');
}

main();
