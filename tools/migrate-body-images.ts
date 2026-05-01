/**
 * Phase 3 migration: rewrite raw HTML `<img src="/img/...">` tags
 * inside markdown bodies as markdown `![alt](path)` syntax so
 * Astro's image pipeline picks them up.
 *
 * Astro only processes images referenced via `![]()` markdown or
 * `<Image>` / `<Picture>` components. Raw HTML `<img>` tags inside
 * markdown bodies are passed through verbatim, so the 911 KB
 * `tywyn-cinema.png` (and 8 others) currently bypass the AVIF/WebP
 * pipeline entirely.
 *
 * What this does
 * ==============
 *
 * For each `.md` in `src/content/`:
 *   1. Find every `<img src="/img/PATH" alt="..." ...>` in the body
 *      (skips frontmatter; that's handled by `migrate-to-assets.ts`).
 *   2. Copy `public/img/PATH` to `src/assets/img/PATH` (idempotent).
 *   3. Replace the `<img>` tag with `![alt](../../assets/img/PATH)`.
 *   4. Special case: `<a href="..."><img ...></a>` becomes
 *      `[![alt](path)](url)`.
 *
 * One-shot. Re-runs are no-ops once everything's been migrated.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const publicImgDir = join(repoRoot, 'public', 'img');
const assetsImgDir = join(repoRoot, 'src', 'assets', 'img');
const contentDir = join(repoRoot, 'src', 'content');

const stats = {
	filesScanned: 0,
	mdEdited: 0,
	imagesCopied: 0,
	imagesSkipped: 0,
	imagesMissing: 0,
	tagsRewritten: 0,
	linkedTagsRewritten: 0,
};
const missing = new Set<string>();
const copied = new Set<string>();

function walkMarkdown(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) walkMarkdown(full, out);
		else if (entry.endsWith('.md')) out.push(full);
	}
	return out;
}

function ensureDir(dir: string) {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function copyImageOnce(relImgPath: string): boolean {
	if (copied.has(relImgPath)) {
		stats.imagesSkipped++;
		return true;
	}
	const src = join(publicImgDir, relImgPath);
	const dst = join(assetsImgDir, relImgPath);
	if (!existsSync(src)) {
		if (!missing.has(relImgPath)) {
			missing.add(relImgPath);
			stats.imagesMissing++;
		}
		return false;
	}
	if (existsSync(dst)) {
		copied.add(relImgPath);
		stats.imagesSkipped++;
		return true;
	}
	ensureDir(dirname(dst));
	copyFileSync(src, dst);
	copied.add(relImgPath);
	stats.imagesCopied++;
	return true;
}

// Pull `alt` out of an `<img>` tag's attribute string.
function extractAlt(tagAttrs: string): string {
	const m = tagAttrs.match(/\balt=(?:"([^"]*)"|'([^']*)')/);
	return (m?.[1] ?? m?.[2] ?? '').trim();
}

function processMarkdownFile(mdPath: string) {
	stats.filesScanned++;
	const raw = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
	if (!raw.startsWith('---\n')) return;
	const frontmatterEnd = raw.indexOf('\n---\n', 4);
	if (frontmatterEnd < 0) return;
	const frontmatter = raw.slice(0, frontmatterEnd + 5); // include trailing `\n---\n`
	let body = raw.slice(frontmatterEnd + 5);
	let dirty = false;

	// Pass 1: <a href="URL"...>...<img src="/img/PATH" alt="ALT" .../>...</a>
	// Match the whole anchor-wrapped image block. Tolerant of class
	// soup, additional attrs, and inner whitespace.
	body = body.replace(
		/<a\s+([^>]*?)href="([^"]+)"([^>]*)>\s*<img\s+([^>]*?)src="\/img\/([^"]+)"([^>]*?)\/?>\s*<\/a>/g,
		(_match, _aBefore, href, _aAfter, imgBefore, relPath, imgAfter) => {
			const ok = copyImageOnce(relPath);
			if (!ok) return _match;
			const alt = extractAlt(imgBefore + ' ' + imgAfter);
			stats.linkedTagsRewritten++;
			dirty = true;
			return `[![${alt}](../../assets/img/${relPath})](${href})`;
		}
	);

	// Pass 2: bare <img src="/img/..." alt="..." .../>
	body = body.replace(
		/<img\s+([^>]*?)src="\/img\/([^"]+)"([^>]*?)\/?>/g,
		(_match, before, relPath, after) => {
			const ok = copyImageOnce(relPath);
			if (!ok) return _match;
			const alt = extractAlt(before + ' ' + after);
			stats.tagsRewritten++;
			dirty = true;
			return `![${alt}](../../assets/img/${relPath})`;
		}
	);

	if (dirty) {
		writeFileSync(mdPath, frontmatter + body, 'utf8');
		stats.mdEdited++;
	}
}

function main() {
	if (!existsSync(publicImgDir)) {
		console.error(`No public/img/ at ${publicImgDir}.`);
		process.exit(1);
	}
	ensureDir(assetsImgDir);
	const mdFiles = walkMarkdown(contentDir);
	for (const mdPath of mdFiles) processMarkdownFile(mdPath);

	console.log(`\nSummary:`);
	console.log(`  files scanned:   ${stats.filesScanned}`);
	console.log(`  markdown edited: ${stats.mdEdited}`);
	console.log(`  bare <img> rewrites:    ${stats.tagsRewritten}`);
	console.log(`  <a><img></a> rewrites:  ${stats.linkedTagsRewritten}`);
	console.log(`  images copied:   ${stats.imagesCopied}`);
	console.log(`  images skipped:  ${stats.imagesSkipped}`);
	if (missing.size > 0) {
		console.log(`  images MISSING:  ${stats.imagesMissing}`);
		for (const p of missing) console.log(`    - ${p}`);
	}
}

main();
