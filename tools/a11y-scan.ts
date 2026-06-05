/**
 * Accessibility regression gate.
 *
 * Serves the built site with `astro preview`, then runs axe-core (via
 * puppeteer) against a representative set of URLs at a desktop viewport,
 * failing on any WCAG A/AA *violation*. Run by `npm run test:a11y`,
 * which builds first.
 *
 * Why a small custom runner rather than pa11y-ci: pa11y's axe runner
 * reports axe "incomplete" results (cannot-determine, e.g. a nav link
 * whose background axe could not measure because another element
 * overlaps it, or a single-glyph caret) as hard errors with the same
 * `color-contrast` code as real failures. On this site that meant a red
 * gate full of non-issues with no clean way to separate them. Running
 * axe directly lets us gate on `violations` only and scope to the WCAG
 * A/AA tag set. Pure axe also avoids HTML_CodeSniffer's false positive
 * on the footer's `content-visibility`.
 *
 * GA, Ahrefs, and AdSense are gated to the canonical production host in
 * BaseLayout, so none load on localhost; the scan sees only first-party
 * markup (no third-party injected iframes to ignore).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core');

const PORT = 4322;
const BASE = `http://localhost:${PORT}`;

// One representative URL per template type, plus the pages the launch
// audit specifically changed (gallery + alt, FAQ + disclosure nav,
// the data table, an archive, a stay category, a plain content page).
const PATHS = [
	'/',
	'/eating/',
	'/things-to-do/cadair-idris/',
	'/explore-tywyn/',
	'/getting-around/',
	'/holiday-accommodation/bed-and-breakfast/',
	'/contact/',
];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { method: 'HEAD' });
			if (res.status < 500) return;
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Preview server never responded at ${url} within ${timeoutMs}ms`);
}

interface Violation {
	id: string;
	impact: string | null;
	help: string;
	nodes: { target: string[]; summary: string }[];
}

// `detached: true` makes the child a process-group leader so the whole
// tree (npm + astro) can be killed on teardown via `process.kill(-pid)`.
const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT)], {
	stdio: 'inherit',
	detached: true,
});

let totalViolations = 0;

try {
	await waitForServer(`${BASE}/`);
	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});
	try {
		for (const path of PATHS) {
			const page = await browser.newPage();
			await page.setViewport({ width: 1280, height: 900 });
			await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
			await page.addScriptTag({ path: axePath });
			// Evaluate body passed as a string so the bundler cannot inject
			// helpers (e.g. __name) into the browser-side function.
			const violations = (await page.evaluate(
				`(async () => {
					const r = await axe.run(document, { runOnly: ${JSON.stringify(TAGS)} });
					return r.violations.map((v) => ({
						id: v.id,
						impact: v.impact,
						help: v.help,
						nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
					}));
				})()`,
			)) as Violation[];
			await page.close();

			if (violations.length === 0) {
				console.log(`✓ ${path}`);
				continue;
			}
			for (const v of violations) {
				totalViolations += v.nodes.length;
				console.log(`✘ ${path}`);
				console.log(`   [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}`);
				for (const node of v.nodes) {
					console.log(`      ${node.target.join(' ')}`);
				}
			}
		}
	} finally {
		await browser.close();
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	totalViolations = totalViolations || 1;
} finally {
	if (server.pid) {
		try {
			process.kill(-server.pid, 'SIGTERM');
		} catch {
			// already exited
		}
	}
}

console.log(
	`\n${totalViolations ? '✘' : '✓'} ${totalViolations} WCAG A/AA violation(s) across ${PATHS.length} pages`,
);
process.exit(totalViolations ? 1 : 0);
