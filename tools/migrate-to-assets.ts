/**
 * One-shot migration: move `public/img/...` → `src/assets/img/...`
 * and rewrite frontmatter `src:` paths to point at the new location.
 *
 * Stage 2 of the perf pass shifts image rendering from raw `<img src=>`
 * (no processing, served direct from `public/`) to `astro:assets`
 * (Sharp processed, AVIF + WebP + responsive `srcset`, content-hashed
 * URLs). Astro's image pipeline only processes images under `src/`,
 * so the source files have to physically move.
 *
 * What this does
 * ==============
 *
 * For each `.md` file in `src/content/`, this:
 *   1. Finds every `src: /img/<path>` line in the frontmatter.
 *   2. Copies `public/img/<path>` to `src/assets/img/<path>`,
 *      preserving the YYYY/MM/ structure (no domain-grouped reorg
 *      yet — that's a separate concern).
 *   3. Rewrites the `src:` line to a content-file-relative path:
 *      `src: ../../assets/img/<path>` (every content file is at
 *      `src/content/<collection>/<slug>.md`, so the relative depth
 *      is always `../../assets/img/`).
 *
 * Idempotent. Re-running is a no-op once everything is migrated.
 * Files referenced from multiple content entries are copied once.
 *
 * Out of scope
 * ============
 *   - Hardcoded `/img/...` references in `.astro` source files
 *     (Header logo, page banners). Those are migrated by hand
 *     because they need an `import logoSrc from '../../assets/...'`
 *     pattern, not just a string rewrite.
 *   - Markdown body inline `<img src=>` HTML tags. Those need to
 *     become `![alt](path)` to be processed; handled separately.
 *   - Deletion of the original `public/img/` files. Kept for now
 *     so a partial migration doesn't break the running build;
 *     deleted in Phase 6 once everything is verified.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const publicImgDir = join(repoRoot, 'public', 'img');
const assetsImgDir = join(repoRoot, 'src', 'assets', 'img');
const contentDir = join(repoRoot, 'src', 'content');

interface Stats {
	filesScanned: number;
	mdEdited: number;
	imagesCopied: number;
	imagesSkipped: number;
	imagesMissing: number;
	rewrites: number;
}

const stats: Stats = {
	filesScanned: 0,
	mdEdited: 0,
	imagesCopied: 0,
	imagesSkipped: 0,
	imagesMissing: 0,
	rewrites: 0,
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
	// relImgPath is e.g. "2022/05/foo.jpg"
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
		// already migrated; mark and skip
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

function processMarkdownFile(mdPath: string) {
	stats.filesScanned++;
	const raw = readFileSync(mdPath, 'utf8');
	// Normalize CRLF to LF for processing; preserve none on write
	// (the repo otherwise uses LF, so converting drift back to LF is
	// a quiet bonus).
	const text = raw.replace(/\r\n/g, '\n');
	if (!text.startsWith('---\n')) return;

	// Only rewrite within frontmatter — the second `---` ends it.
	const frontmatterEnd = text.indexOf('\n---\n', 4);
	if (frontmatterEnd < 0) return;
	const before = text.slice(0, frontmatterEnd);
	const after = text.slice(frontmatterEnd);

	let edited = before;
	let dirty = false;

	// Match any `src: /img/...` value, optionally quoted (single or
	// double). Character class `[\s-]*` handles both `  src: /img/...`
	// (object property) and `  - src: /img/...` (YAML array element)
	// since the regex anchored at line start otherwise misses
	// gallery entries.
	edited = edited.replace(
		/^([\s-]*src:\s*)(['"]?)\/img\/([^'"\n]+)\2/gm,
		(_match, prefix, quote, relPath) => {
			const trimmedRel = relPath.trim();
			const ok = copyImageOnce(trimmedRel);
			if (!ok) {
				// keep the original line if the source file is missing —
				// don't let migration silently drop references.
				return `${prefix}${quote}/img/${trimmedRel}${quote}`;
			}
			stats.rewrites++;
			dirty = true;
			// Always quote the new path so YAML doesn't try to parse it
			// as anything unusual; relative paths starting with `..` are
			// safe but quoting is a belt-and-braces win.
			return `${prefix}'../../assets/img/${trimmedRel}'`;
		}
	);

	if (dirty) {
		writeFileSync(mdPath, edited + after, 'utf8');
		stats.mdEdited++;
	}
}

function main() {
	if (!existsSync(publicImgDir)) {
		console.error(`No public/img/ at ${publicImgDir}; nothing to migrate.`);
		process.exit(1);
	}
	ensureDir(assetsImgDir);
	const mdFiles = walkMarkdown(contentDir);
	console.log(`Found ${mdFiles.length} markdown files in ${relative(repoRoot, contentDir)}`);
	for (const mdPath of mdFiles) processMarkdownFile(mdPath);

	console.log('\nSummary:');
	console.log(`  files scanned:   ${stats.filesScanned}`);
	console.log(`  markdown edited: ${stats.mdEdited}`);
	console.log(`  images copied:   ${stats.imagesCopied}`);
	console.log(`  images skipped:  ${stats.imagesSkipped} (already in place)`);
	console.log(`  rewrites:        ${stats.rewrites}`);
	if (missing.size > 0) {
		console.log(`  images MISSING:  ${stats.imagesMissing}`);
		for (const p of missing) console.log(`    - ${p}`);
	}
}

main();
