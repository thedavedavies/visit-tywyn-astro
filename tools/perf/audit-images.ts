import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const distDir = join(repoRoot, 'dist');
const PORT = 4331;
const BASE = `http://localhost:${PORT}`;

const UNDER_FETCH_RATIO = 0.85;
const OVER_FETCH_RATIO = 1.7;
const MIN_RENDERED_WIDTH = 40;
const DENSITY_CAP = 2;

interface Viewport {
	label: string;
	width: number;
	height: number;
	dpr: number;
}

const VIEWPORTS: Viewport[] = [
	{ label: 'phone-390@3x', width: 390, height: 844, dpr: 3 },
	{ label: 'tablet-768@2x', width: 768, height: 1024, dpr: 2 },
	{ label: 'tablet-1023@2x', width: 1023, height: 768, dpr: 2 },
	{ label: 'laptop-1024@2x', width: 1024, height: 768, dpr: 2 },
	{ label: 'laptop-1440@2x', width: 1440, height: 900, dpr: 2 },
	{ label: 'desktop-1920@1x', width: 1920, height: 1080, dpr: 1 },
];

interface ImgSample {
	page: string;
	viewport: string;
	currentSrc: string;
	naturalWidth: number;
	renderedWidth: number;
	neededWidth: number;
	ratio: number;
	bytes: number | null;
	candidates: { url: string; width: number }[];
}

function discoverPages(): string[] {
	const pages: string[] = [];
	const walk = (dir: string, route: string) => {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (ent.isDirectory()) walk(join(dir, ent.name), `${route}${ent.name}/`);
			else if (ent.name === 'index.html') pages.push(route);
		}
	};
	walk(distDir, '/');
	return pages.sort();
}

function fileBytes(url: string): number | null {
	if (!url.startsWith('/')) return null;
	try {
		return statSync(join(distDir, decodeURIComponent(url))).size;
	} catch {
		return null;
	}
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// server not up yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function auditPages(): Promise<ImgSample[]> {
	const pages = discoverPages();
	const browser = await puppeteer.launch({ headless: true });
	const samples: ImgSample[] = [];
	try {
		const page = await browser.newPage();
		await page.setCacheEnabled(false);
		for (const vp of VIEWPORTS) {
			await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr });
			for (const route of pages) {
				await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0', timeout: 30_000 });
				await page.evaluate(async () => {
					const step = window.innerHeight;
					for (let y = 0; y < document.body.scrollHeight; y += step) {
						window.scrollTo(0, y);
						await new Promise((r) => setTimeout(r, 60));
					}
					window.scrollTo(0, 0);
					await Promise.all(
						Array.from(document.images)
							.filter((img) => !img.complete)
							.map((img) => new Promise((r) => img.addEventListener('load', r, { once: true }))),
					).catch(() => undefined);
				});
				const rows = await page.evaluate(() =>
					Array.from(document.images)
						.filter((img) => img.getBoundingClientRect().width > 0 && img.currentSrc)
						.map((img) => ({
							currentSrc: img.currentSrc.replace(location.origin, ''),
							naturalWidth: img.naturalWidth,
							renderedWidth: Math.round(img.getBoundingClientRect().width),
							candidates: [
								img.srcset || '',
								...(img.parentElement instanceof HTMLPictureElement
									? Array.from(img.parentElement.querySelectorAll('source')).map(
											(s) => s.srcset || '',
										)
									: []),
							]
								.flatMap((set) => set.split(','))
								.map((c) => c.trim())
								.filter(Boolean)
								.map((c) => {
									const [url, w] = c.split(/\s+/);
									return { url, width: parseInt(w ?? '0', 10) };
								}),
						})),
				);
				for (const row of rows) {
					if (row.renderedWidth < MIN_RENDERED_WIDTH) continue;
					const needed = Math.round(row.renderedWidth * Math.min(vp.dpr, DENSITY_CAP));
					const chosen = row.candidates.find((c) => row.currentSrc.endsWith(c.url))?.width;
					const chosenWidth = chosen ?? row.naturalWidth;
					samples.push({
						page: route,
						viewport: vp.label,
						currentSrc: row.currentSrc,
						naturalWidth: chosenWidth,
						renderedWidth: row.renderedWidth,
						neededWidth: needed,
						ratio: chosenWidth / needed,
						bytes: fileBytes(row.currentSrc),
						candidates: row.candidates,
					});
				}
			}
		}
	} finally {
		await browser.close();
	}
	return samples;
}

interface CompressionRow {
	file: string;
	bytes: number;
	width: number;
	height: number;
	format: string;
	bytesPerMegapixel: number;
}

async function compressionScan(): Promise<CompressionRow[]> {
	const sharp = (await import('sharp')).default;
	const rows: CompressionRow[] = [];
	const astroDir = join(distDir, '_astro');
	for (const ent of readdirSync(astroDir, { withFileTypes: true })) {
		if (!ent.isFile() || !/\.(avif|webp|jpe?g|png)$/.test(ent.name)) continue;
		const p = join(astroDir, ent.name);
		const meta = await sharp(p).metadata();
		if (!meta.width || !meta.height) continue;
		const bytes = statSync(p).size;
		rows.push({
			file: ent.name,
			bytes,
			width: meta.width,
			height: meta.height,
			format: meta.format ?? 'unknown',
			bytesPerMegapixel: Math.round(bytes / ((meta.width * meta.height) / 1e6)),
		});
	}
	return rows.sort((a, b) => b.bytesPerMegapixel - a.bytesPerMegapixel);
}

async function main() {
	spawnSync('npx', ['astro', 'preview', 'stop'], { cwd: repoRoot, stdio: 'ignore' });
	const server = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
		cwd: repoRoot,
		stdio: 'ignore',
		detached: false,
	});
	try {
		await waitForServer(BASE + '/');
		const samples = await auditPages();

		const under = samples.filter((s) => s.ratio < UNDER_FETCH_RATIO);
		const over = samples.filter((s) => s.ratio >= OVER_FETCH_RATIO && (s.bytes ?? 0) > 10_000);
		const dedupe = (rows: ImgSample[]) => {
			const seen = new Map<string, ImgSample>();
			for (const r of rows) {
				const key = `${r.currentSrc}|${r.viewport}`;
				const prev = seen.get(key);
				if (!prev || Math.abs(1 - r.ratio) > Math.abs(1 - prev.ratio)) seen.set(key, r);
			}
			return [...seen.values()];
		};

		const compression = await compressionScan();
		const report = {
			generated: new Date().toISOString(),
			sampleCount: samples.length,
			underFetch: dedupe(under).sort((a, b) => a.ratio - b.ratio),
			overFetch: dedupe(over).sort((a, b) => b.ratio - a.ratio),
			compressionWorst: compression.slice(0, 25),
			compressionByFormat: Object.entries(
				compression.reduce<Record<string, { n: number; totalBpmp: number }>>((acc, r) => {
					(acc[r.format] ??= { n: 0, totalBpmp: 0 }).n += 1;
					acc[r.format].totalBpmp += r.bytesPerMegapixel;
					return acc;
				}, {}),
			).map(([format, { n, totalBpmp }]) => ({
				format,
				files: n,
				avgBytesPerMegapixel: Math.round(totalBpmp / n),
			})),
		};
		const outPath = process.argv[2] ?? join(repoRoot, 'dist', 'image-audit.json');
		writeFileSync(outPath, JSON.stringify(report, null, '\t'));
		console.log(`samples: ${samples.length}`);
		console.log(`under-fetched (<${UNDER_FETCH_RATIO}, blur risk): ${report.underFetch.length}`);
		for (const s of report.underFetch.slice(0, 20)) {
			console.log(
				`  UNDER ${s.ratio.toFixed(2)} ${s.currentSrc} natural=${s.naturalWidth} needed=${s.neededWidth} @${s.viewport} on ${s.page}`,
			);
		}
		console.log(`over-fetched (>=${OVER_FETCH_RATIO}x, wasted bytes): ${report.overFetch.length}`);
		for (const s of report.overFetch.slice(0, 20)) {
			console.log(
				`  OVER ${s.ratio.toFixed(2)} ${s.currentSrc} natural=${s.naturalWidth} needed=${s.neededWidth} @${s.viewport} on ${s.page}`,
			);
		}
		console.log('compression avg bytes/megapixel by format:');
		for (const f of report.compressionByFormat) {
			console.log(`  ${f.format}: ${f.avgBytesPerMegapixel} B/MP across ${f.files} files`);
		}
		console.log(`report written to ${outPath}`);
	} finally {
		server.kill('SIGTERM');
		spawnSync('npx', ['astro', 'preview', 'stop'], { cwd: repoRoot, stdio: 'ignore' });
	}
}

await main();
