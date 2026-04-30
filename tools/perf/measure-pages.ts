/**
 * Static page-weight analyzer for the perf baseline (Unit 0).
 *
 * For a given list of built page paths, reads the rendered HTML from
 * `dist/`, extracts every `<img src=>`, `<link href=>` (stylesheet),
 * `<script src=>`, plus the `@font-face url(...)` entries inside any
 * referenced stylesheet, and sums the on-disk byte size of each
 * resource. Produces a JSON report we can compare against post-pass.
 *
 * Why static rather than Lighthouse: the new Astro site is not yet
 * deployed, so PageSpeed Insights cannot reach it. Running Lighthouse
 * locally against `astro preview` doesn't represent throttled mobile
 * conditions accurately either — the most reliable signal we can
 * capture today is on-the-wire byte counts, and those translate
 * directly into LCP/INP wins under any network condition. Add
 * Lighthouse-on-deployed-staging once the host decision is made
 * (README open follow-up).
 */
import { readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const distDir = join(repoRoot, 'dist');

const samplePages = [
	'/',
	'/eating/',
	'/eating/dovey-inn/',
	'/things-to-do/cadair-idris/',
	'/things-to-do/magic-lantern-cinema/', // formerly /cinema/ — redirect target
];

type ResourceKind = 'image' | 'font' | 'css' | 'js' | 'html';

interface Resource {
	url: string;
	kind: ResourceKind;
	bytes: number;
	external: boolean;
}

interface PageReport {
	path: string;
	htmlPath: string;
	bytes: {
		document: number;
		image: number;
		font: number;
		css: number;
		js: number;
		external: number;
		total: number;
	};
	counts: {
		imagesWithoutDims: number;
		imagesTotal: number;
		stylesheets: number;
		scripts: number;
		iframes: number;
		iframesWithoutLazy: number;
		externalRequests: number;
	};
	largestImage: { url: string; bytes: number } | null;
	missingDimensionImages: string[];
	resources: Resource[];
}

function pathToHtmlFile(path: string): string {
	const trimmed = path.replace(/^\//, '').replace(/\/$/, '');
	if (!trimmed) return join(distDir, 'index.html');
	return join(distDir, trimmed, 'index.html');
}

function readBytes(filePath: string): number {
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

function resolveRelativeUrl(url: string, fromHtmlFile: string): string | null {
	if (url.startsWith('http://') || url.startsWith('https://')) return null;
	if (url.startsWith('//')) return null;
	if (url.startsWith('data:')) return null;
	const cleaned = url.split('?')[0].split('#')[0];
	if (cleaned.startsWith('/')) return join(distDir, cleaned.replace(/^\//, ''));
	return join(dirname(fromHtmlFile), cleaned);
}

function extractAttr(tag: string, attr: string): string | null {
	const re = new RegExp(`${attr}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
	const m = tag.match(re);
	if (!m) return null;
	return m[1] ?? m[2] ?? m[3] ?? null;
}

function* matchTags(html: string, tagName: string): Iterable<string> {
	const re = new RegExp(`<${tagName}\\b[^>]*?>`, 'gi');
	for (const m of html.matchAll(re)) yield m[0];
}

function extractFontRefsFromCss(cssText: string, cssFile: string): Resource[] {
	// match url(...) inside @font-face declarations
	const urls = new Set<string>();
	for (const m of cssText.matchAll(/url\(([^)]+)\)/gi)) {
		const raw = m[1].trim().replace(/^['"]/, '').replace(/['"]$/, '');
		urls.add(raw);
	}
	const out: Resource[] = [];
	for (const url of urls) {
		if (url.startsWith('data:')) continue;
		if (!/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)) continue;
		const external = url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
		const filePath = external ? null : resolveRelativeUrl(url, cssFile);
		const bytes = filePath && existsSync(filePath) ? readBytes(filePath) : 0;
		out.push({ url, kind: 'font', bytes, external });
	}
	return out;
}

function analyzePage(path: string): PageReport {
	const htmlPath = pathToHtmlFile(path);
	if (!existsSync(htmlPath)) throw new Error(`No built page at ${htmlPath}`);
	const html = readFileSync(htmlPath, 'utf8');
	const docBytes = readBytes(htmlPath);

	const resources: Resource[] = [];
	const missingDims: string[] = [];
	let imagesWithoutDims = 0;
	let imagesTotal = 0;
	let iframes = 0;
	let iframesWithoutLazy = 0;
	let externalRequests = 0;

	// <img>
	for (const tag of matchTags(html, 'img')) {
		imagesTotal++;
		const src = extractAttr(tag, 'src');
		const w = extractAttr(tag, 'width');
		const h = extractAttr(tag, 'height');
		if (!w || !h) {
			imagesWithoutDims++;
			if (src) missingDims.push(src);
		}
		if (!src) continue;
		const external = src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//');
		const filePath = external ? null : resolveRelativeUrl(src, htmlPath);
		const bytes = filePath && existsSync(filePath) ? readBytes(filePath) : 0;
		if (external) externalRequests++;
		resources.push({ url: src, kind: 'image', bytes, external });
	}

	// <iframe>
	for (const tag of matchTags(html, 'iframe')) {
		iframes++;
		const loading = extractAttr(tag, 'loading');
		if (loading !== 'lazy') iframesWithoutLazy++;
	}

	// <link rel=stylesheet>
	const linkTags = Array.from(matchTags(html, 'link'));
	let stylesheets = 0;
	for (const tag of linkTags) {
		const rel = extractAttr(tag, 'rel');
		const href = extractAttr(tag, 'href');
		if (!href) continue;
		if (rel && rel.toLowerCase().includes('stylesheet')) {
			stylesheets++;
			const external = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
			if (external) {
				externalRequests++;
				resources.push({ url: href, kind: 'css', bytes: 0, external: true });
				// resolve linked CSS for @font-face urls (e.g., Google Fonts)
				continue;
			}
			const filePath = resolveRelativeUrl(href, htmlPath);
			const bytes = filePath && existsSync(filePath) ? readBytes(filePath) : 0;
			resources.push({ url: href, kind: 'css', bytes, external: false });
			if (filePath && existsSync(filePath)) {
				const cssText = readFileSync(filePath, 'utf8');
				for (const fontRes of extractFontRefsFromCss(cssText, filePath)) {
					resources.push(fontRes);
					if (fontRes.external) externalRequests++;
				}
			}
		} else if (rel && rel.toLowerCase() === 'preload' && extractAttr(tag, 'as') === 'font') {
			// font preload — count it
			const external = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
			const filePath = external ? null : resolveRelativeUrl(href, htmlPath);
			const bytes = filePath && existsSync(filePath) ? readBytes(filePath) : 0;
			if (external) externalRequests++;
			resources.push({ url: href, kind: 'font', bytes, external });
		}
	}

	// <script src=>
	let scripts = 0;
	for (const tag of matchTags(html, 'script')) {
		const src = extractAttr(tag, 'src');
		if (!src) continue;
		scripts++;
		const external = src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//');
		const filePath = external ? null : resolveRelativeUrl(src, htmlPath);
		const bytes = filePath && existsSync(filePath) ? readBytes(filePath) : 0;
		if (external) externalRequests++;
		resources.push({ url: src, kind: 'js', bytes, external });
	}

	const sumBy = (kind: ResourceKind) =>
		resources.filter((r) => r.kind === kind && !r.external).reduce((s, r) => s + r.bytes, 0);

	const externalBytes = resources.filter((r) => r.external).reduce((s, r) => s + r.bytes, 0);
	const imagesByBytes = resources.filter((r) => r.kind === 'image').sort((a, b) => b.bytes - a.bytes);

	return {
		path,
		htmlPath: htmlPath.replace(repoRoot + '/', ''),
		bytes: {
			document: docBytes,
			image: sumBy('image'),
			font: sumBy('font'),
			css: sumBy('css'),
			js: sumBy('js'),
			external: externalBytes,
			total: docBytes + sumBy('image') + sumBy('font') + sumBy('css') + sumBy('js') + externalBytes,
		},
		counts: {
			imagesTotal,
			imagesWithoutDims,
			stylesheets,
			scripts,
			iframes,
			iframesWithoutLazy,
			externalRequests,
		},
		largestImage: imagesByBytes[0] ? { url: imagesByBytes[0].url, bytes: imagesByBytes[0].bytes } : null,
		missingDimensionImages: missingDims,
		resources,
	};
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
	const reports: PageReport[] = [];
	for (const p of samplePages) {
		try {
			reports.push(analyzePage(p));
		} catch (err) {
			console.error(`Skipping ${p}: ${(err as Error).message}`);
		}
	}

	console.log('\n=== Per-page weight ===\n');
	console.log(
		'Path'.padEnd(42) +
			'Total'.padStart(10) +
			'  Images'.padStart(12) +
			'  Imgs'.padStart(7) +
			'  External'.padStart(11) +
			'  CLS-risk'.padStart(11),
	);
	console.log('-'.repeat(93));
	for (const r of reports) {
		console.log(
			r.path.padEnd(42) +
				fmtBytes(r.bytes.total).padStart(10) +
				`  ${fmtBytes(r.bytes.image)}`.padStart(12) +
				`  ${r.counts.imagesTotal}`.padStart(7) +
				`  ${r.counts.externalRequests}`.padStart(11) +
				`  ${r.counts.imagesWithoutDims}/${r.counts.imagesTotal}`.padStart(11),
		);
	}
	console.log();

	const out = {
		generatedAt: new Date().toISOString(),
		distRoot: distDir.replace(repoRoot + '/', ''),
		pages: reports,
	};
	const outPath = join(repoRoot, 'docs/perf/baseline-pages.json');
	writeFileSync(outPath, JSON.stringify(out, null, 2));
	console.log(`Wrote ${outPath.replace(repoRoot + '/', '')}`);
}

main();
