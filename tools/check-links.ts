/**
 * Walks the built `dist/` tree, extracts every internal href, and
 * reports which targets do NOT resolve to a built page or to a
 * redirect rule in `public/_redirects`.
 *
 * By default also pings each unique href against a running dev
 * server (defaults to http://localhost:4321) so we surface links that
 * 404 in dev even though `_redirects` would catch them on Cloudflare.
 * Pass `--no-dev` to skip the dev probe.
 *
 * Run with `tsx tools/check-links.ts` after `npm run build`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(PROJECT_ROOT, 'dist');
const REDIRECTS = path.join(PROJECT_ROOT, 'public/_redirects');
const SITE_HOST = 'visit-tywyn.co.uk';
const DEV_BASE = process.env.DEV_BASE ?? 'http://localhost:4321';
const PROBE_DEV = !process.argv.includes('--no-dev');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

function pageRoute(file: string): string {
	const rel = path.relative(DIST, file).replace(/\\/g, '/');
	if (rel === 'index.html') return '/';
	if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
	if (rel.endsWith('.html')) return '/' + rel.slice(0, -'.html'.length);
	return '/' + rel;
}

function loadRedirects(): { exact: Set<string>; prefixes: string[] } {
	const exact = new Set<string>();
	const prefixes: string[] = [];
	if (!fs.existsSync(REDIRECTS)) return { exact, prefixes };
	const lines = fs.readFileSync(REDIRECTS, 'utf8').split('\n');
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const parts = line.split(/\s+/);
		if (parts.length < 2) continue;
		const from = parts[0]!;
		if (from.endsWith('/*')) prefixes.push(from.slice(0, -1));
		else exact.add(from);
	}
	return { exact, prefixes };
}

/* Targets the dev server can't possibly serve (build-time-only assets,
 * generated sitemap, the 404 fallback URL emitted into canonical). They
 * resolve fine on Cloudflare Pages, so we exclude them from probe noise. */
const DEV_IGNORE_RE = /^\/(_astro\/|sitemap-|404\/?$)/;

function normalize(href: string): string | null {
	if (!href) return null;
	if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
	let url: URL;
	try {
		url = new URL(href, `https://${SITE_HOST}/`);
	} catch {
		return null;
	}
	if (url.host !== SITE_HOST) return null;
	let p = url.pathname;
	if (!p.endsWith('/') && !path.extname(p)) p += '/';
	return p;
}

function isReachable(
	target: string,
	pages: Set<string>,
	files: Set<string>,
	redirects: { exact: Set<string>; prefixes: string[] }
): boolean {
	if (pages.has(target)) return true;
	if (files.has(target)) return true;
	if (redirects.exact.has(target)) return true;
	for (const prefix of redirects.prefixes) {
		if (target.startsWith(prefix)) return true;
	}
	// Cloudflare Pages serves 404.html as the fallback for any unmatched
	// URL, so the canonical `/404/` emitted on that page is fine in prod.
	if (target === '/404/') return true;
	return false;
}

const allFiles = walk(DIST);
const pages = new Set<string>();
const filePaths = new Set<string>();
for (const f of allFiles) {
	const route = pageRoute(f);
	if (route.endsWith('/')) pages.add(route);
	else filePaths.add(route);
	if (f.endsWith('/index.html')) pages.add(pageRoute(f));
}

const redirects = loadRedirects();
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));

const broken = new Map<string, Set<string>>();
const HREF_RE = /href=(?:"([^"]*)"|'([^']*)')/g;

for (const file of htmlFiles) {
	const content = fs.readFileSync(file, 'utf8');
	const sourcePage = pageRoute(file);
	for (const match of content.matchAll(HREF_RE)) {
		const href = match[1] ?? match[2] ?? '';
		const target = normalize(href);
		if (!target) continue;
		if (!isReachable(target, pages, filePaths, redirects)) {
			if (!broken.has(target)) broken.set(target, new Set());
			broken.get(target)!.add(sourcePage);
		}
	}
}

// Collect every unique target referenced from any HTML file (not just
// the broken ones), so we can probe the dev server for parity.
const allTargets = new Map<string, Set<string>>();
for (const file of htmlFiles) {
	const content = fs.readFileSync(file, 'utf8');
	const sourcePage = pageRoute(file);
	for (const match of content.matchAll(HREF_RE)) {
		const href = match[1] ?? match[2] ?? '';
		const target = normalize(href);
		if (!target) continue;
		if (!allTargets.has(target)) allTargets.set(target, new Set());
		allTargets.get(target)!.add(sourcePage);
	}
}

async function probeDev(target: string): Promise<number | string> {
	try {
		const res = await fetch(DEV_BASE + target, { redirect: 'manual' });
		return res.status;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

const devBroken = new Map<string, Set<string>>();
if (PROBE_DEV) {
	console.error(`Probing ${allTargets.size} unique internal targets against ${DEV_BASE}…`);
	const targetsArr = [...allTargets.keys()].sort();
	const concurrency = 8;
	let cursor = 0;
	async function worker() {
		while (cursor < targetsArr.length) {
			const i = cursor++;
			const target = targetsArr[i]!;
			if (DEV_IGNORE_RE.test(target)) continue;
			const status = await probeDev(target);
			if (typeof status === 'number' && status >= 400 && status < 500) {
				devBroken.set(target, allTargets.get(target)!);
			} else if (typeof status === 'string') {
				console.error(`! ${target} — fetch error: ${status}`);
			}
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

const buildBrokenCount = broken.size;
const devBrokenCount = devBroken.size;

if (buildBrokenCount === 0 && devBrokenCount === 0) {
	console.log('No broken internal links found.');
	process.exit(0);
}

if (buildBrokenCount > 0) {
	console.log(`\n=== Truly broken (no page, no redirect): ${buildBrokenCount} ===\n`);
	const sorted = [...broken.entries()].sort(([a], [b]) => a.localeCompare(b));
	for (const [target, sources] of sorted) {
		console.log(`✗ ${target}`);
		const srcList = [...sources].sort();
		for (const src of srcList.slice(0, 5)) console.log(`    from ${src}`);
		if (srcList.length > 5) console.log(`    …and ${srcList.length - 5} more`);
	}
}

if (devBrokenCount > 0) {
	console.log(
		`\n=== 404 on dev server (${DEV_BASE}) but reachable in prod via _redirects: ${devBrokenCount} ===\n`
	);
	const sorted = [...devBroken.entries()].sort(([a], [b]) => a.localeCompare(b));
	for (const [target, sources] of sorted) {
		console.log(`✗ ${target}`);
		const srcList = [...sources].sort();
		for (const src of srcList.slice(0, 5)) console.log(`    from ${src}`);
		if (srcList.length > 5) console.log(`    …and ${srcList.length - 5} more`);
	}
}
process.exit(1);
