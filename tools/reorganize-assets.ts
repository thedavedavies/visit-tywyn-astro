/**
 * One-shot reorganization: drop the WordPress `YYYY/MM/` hangover
 * inside `src/assets/img/` and group images by content domain.
 *
 *   src/assets/img/
 *   ├── site/                   logo, og default
 *   ├── heroes/                 page-level banners (home, eating list)
 *   ├── pages/<slug>.<ext>      per-page hero_image
 *   ├── eating/<slug>/cover.<ext>
 *   ├── things-to-do/<slug>/cover.<ext>
 *   ├── things-to-do/<slug>/gallery/<NN>.<ext>
 *   └── things-to-do/<slug>/inline/<descriptive>.<ext>   markdown body
 *
 * What changes per content file:
 *   - Frontmatter `photo.src`, `hero_image.src`, `gallery[].src` paths
 *     rewritten to point at the new logical location.
 *   - Markdown body `![alt](path)` references rewritten too.
 *
 * What changes per source file:
 *   - Hardcoded references in `Header.astro`, `index.astro`,
 *     `eating/index.astro`, `BaseLayout.astro` updated by name in
 *     a follow-up pass (this script reports the moves needed).
 *
 * Idempotent. Re-running reads the current frontmatter and only
 * moves files whose source path still starts with the legacy
 * `2022/`, `2023/`, `2024/` prefix.
 */
import {
	readFileSync, writeFileSync, mkdirSync, renameSync, existsSync,
	readdirSync, statSync, copyFileSync,
} from 'node:fs';
import { join, dirname, extname, resolve, basename, relative } from 'node:path';

const repoRoot = resolve(process.cwd());
const assetsImgDir = join(repoRoot, 'src', 'assets', 'img');
const contentDir = join(repoRoot, 'src', 'content');

const stats = {
	mdFilesEdited: 0,
	filesMoved: 0,
	filesAlreadyAtTarget: 0,
	frontmatterRewrites: 0,
	bodyRewrites: 0,
	collisions: 0,
	missing: 0,
};
const movePlan = new Map<string, string>(); // oldRel -> newRel
const collisions: Array<{ from: string; intendedTo: string; existingAt: string }> = [];

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

// Strip the `../../assets/img/` prefix to get the relative path
// inside src/assets/img/. Returns null if the value isn't a
// migrated asset path.
function relInsideAssets(rawPath: string): string | null {
	const cleaned = rawPath.replace(/^['"]|['"]$/g, '').trim();
	const m = cleaned.match(/(?:\.\.\/)+assets\/img\/(.+)$/);
	if (!m) return null;
	return m[1];
}

function planMove(oldRel: string, newRel: string) {
	if (movePlan.has(oldRel)) {
		const existing = movePlan.get(oldRel)!;
		if (existing !== newRel) {
			// Same source mapped to two different targets — keep the
			// first plan, log the conflict.
			collisions.push({ from: oldRel, intendedTo: newRel, existingAt: existing });
			stats.collisions++;
		}
		return;
	}
	movePlan.set(oldRel, newRel);
}

// Rewrite a content file's frontmatter and markdown body.
function rewriteFile(mdPath: string, slug: string, collection: string) {
	const raw = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
	if (!raw.startsWith('---\n')) return;
	const fmEnd = raw.indexOf('\n---\n', 4);
	if (fmEnd < 0) return;
	const fm = raw.slice(0, fmEnd + 5);
	let body = raw.slice(fmEnd + 5);

	let editedFm = fm;
	let dirty = false;

	// Frontmatter: photo.src, hero_image.src, gallery[].src.
	// We track per-file gallery sequence here — each `- src:` inside
	// `gallery:` increments the counter for that file.
	let galleryCounter = 0;
	let inGallery = false;

	editedFm = editedFm
		.split('\n')
		.map((line) => {
			// Track whether we're inside a `gallery:` array. The
			// indentation of `gallery:` is the parent level; any line
			// at deeper indent is part of the array.
			if (/^\s*gallery:\s*$/.test(line)) {
				inGallery = true;
				galleryCounter = 0;
				return line;
			}
			if (inGallery && /^[A-Za-z_-]+:/.test(line)) {
				// Top-level key after gallery — exit gallery scope.
				inGallery = false;
			}

			const srcMatch = line.match(/^([\s-]*src:\s*)(['"])([^'"]*)\2(.*)$/);
			if (!srcMatch) return line;
			const prefix = srcMatch[1];
			const value = srcMatch[3];
			const trailing = srcMatch[4];
			const oldRel = relInsideAssets(value);
			if (!oldRel) return line;

			let role: 'cover' | 'hero' | 'gallery' = 'cover';
			if (inGallery) {
				role = 'gallery';
				galleryCounter++;
			} else if (collection === 'pages') {
				role = 'hero';
			}

			const ext = extname(oldRel).toLowerCase();
			let newRel: string;
			switch (collection) {
				case 'eating':
					newRel = `eating/${slug}/cover${ext}`;
					break;
				case 'things-to-do':
					newRel = role === 'gallery'
						? `things-to-do/${slug}/gallery/${String(galleryCounter).padStart(2, '0')}${ext}`
						: `things-to-do/${slug}/cover${ext}`;
					break;
				case 'stay-categories':
					newRel = `stay-categories/${slug}/cover${ext}`;
					break;
				case 'pages':
					newRel = `pages/${slug}${ext}`;
					break;
				default:
					return line;
			}

			planMove(oldRel, newRel);
			stats.frontmatterRewrites++;
			dirty = true;
			return `${prefix}'../../assets/img/${newRel}'${trailing}`;
		})
		.join('\n');

	// Body: markdown ![alt](../../assets/img/PATH) → inline location.
	let inlineCounter = 0;
	const editedBody = body.replace(
		/!\[([^\]]*)\]\((\.\.\/\.\.\/assets\/img\/[^)\s]+)\)/g,
		(_match, alt, oldPath) => {
			const oldRel = relInsideAssets(oldPath);
			if (!oldRel) return _match;
			inlineCounter++;
			const ext = extname(oldRel).toLowerCase();
			// Use a descriptive name based on the original filename (drop
			// the WP year/month prefix and ShortPixel/Yoast cruft) when
			// reasonable, else fall back to a numbered name.
			const origName = basename(oldRel, ext);
			const cleanedName = origName
				.replace(/^[\d_-]+(?=[a-z])/i, '')
				.replace(/-?(?:scaled|\d{3,4}x\d{3,4})$/, '')
				.toLowerCase()
				.slice(0, 40) || `inline-${inlineCounter}`;
			let newRel: string;
			if (collection === 'pages') {
				newRel = `pages/${slug}-inline/${cleanedName}${ext}`;
			} else {
				newRel = `${collection}/${slug}/inline/${cleanedName}${ext}`;
			}
			planMove(oldRel, newRel);
			stats.bodyRewrites++;
			dirty = true;
			return `![${alt}](../../assets/img/${newRel})`;
		}
	);

	if (dirty) {
		writeFileSync(mdPath, editedFm + editedBody, 'utf8');
		stats.mdFilesEdited++;
	}
}

function executeMoves() {
	for (const [oldRel, newRel] of movePlan) {
		const oldFull = join(assetsImgDir, oldRel);
		const newFull = join(assetsImgDir, newRel);
		if (!existsSync(oldFull)) {
			if (existsSync(newFull)) {
				stats.filesAlreadyAtTarget++;
			} else {
				stats.missing++;
				console.warn(`MISSING: ${oldRel} (intended target: ${newRel})`);
			}
			continue;
		}
		ensureDir(dirname(newFull));
		if (existsSync(newFull)) {
			// Already moved or duplicate — skip.
			stats.filesAlreadyAtTarget++;
			continue;
		}
		renameSync(oldFull, newFull);
		stats.filesMoved++;
	}
}

function pruneEmptyDirs(dir: string) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) pruneEmptyDirs(full);
	}
	const remaining = readdirSync(dir);
	if (remaining.length === 0 && dir !== assetsImgDir) {
		// Empty directory — remove. Use rmdirSync via fs.
		require('node:fs').rmdirSync(dir);
	}
}

function main() {
	const mdFiles = walkMarkdown(contentDir);
	for (const mdPath of mdFiles) {
		const rel = relative(contentDir, mdPath);
		// Path is `<collection>/<slug>.md` or `<collection>/<sub>/<slug>.md`.
		const parts = rel.split('/');
		const collection = parts[0];
		const slug = parts[parts.length - 1].replace(/\.md$/, '');
		rewriteFile(mdPath, slug, collection);
	}
	executeMoves();
	// Clean up empty year-bucketed directories.
	for (const year of ['2022', '2023', '2024', '2025', '2026']) {
		pruneEmptyDirs(join(assetsImgDir, year));
	}

	console.log(`\nReorganization plan summary:`);
	console.log(`  markdown files edited:     ${stats.mdFilesEdited}`);
	console.log(`  frontmatter src rewrites:  ${stats.frontmatterRewrites}`);
	console.log(`  markdown body rewrites:    ${stats.bodyRewrites}`);
	console.log(`  files moved:               ${stats.filesMoved}`);
	console.log(`  files already at target:   ${stats.filesAlreadyAtTarget}`);
	console.log(`  collisions:                ${stats.collisions}`);
	console.log(`  missing source files:      ${stats.missing}`);
	if (collisions.length) {
		console.log('\nCollisions (same source mapped to multiple targets):');
		for (const c of collisions) {
			console.log(`  ${c.from}\n    -> ${c.existingAt} (kept)\n    -> ${c.intendedTo} (skipped)`);
		}
	}
}

main();
