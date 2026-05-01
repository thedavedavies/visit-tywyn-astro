/**
 * Recovery pass: walk every frontmatter image reference, check the
 * file actually exists at the new logical location, and restore
 * from `/tmp/visit-tywyn-public-img-backup/` (which mirrors the
 * pre-reorg `public/img/` layout) when it's missing.
 *
 * The reorganize tool moved files from `src/assets/img/YYYY/MM/...`
 * to `src/assets/img/<collection>/<slug>/<role>.<ext>`. When the
 * source file had already been consumed by a previous move (e.g.
 * the same image referenced from a venue cover and a gallery item),
 * later moves saw a missing source. This script reads each
 * frontmatter reference back out of the markdown, looks up the
 * pre-reorg name from the backup, and copies the right file into
 * place.
 */
import { readFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';

const repoRoot = resolve(process.cwd());
const assetsImgDir = join(repoRoot, 'src', 'assets', 'img');
const contentDir = join(repoRoot, 'src', 'content');
const backupDir = '/tmp/visit-tywyn-public-img-backup';

function walkMarkdown(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) walkMarkdown(full, out);
		else if (entry.endsWith('.md')) out.push(full);
	}
	return out;
}

function findInBackup(filename: string): string | null {
	const stack = [backupDir];
	while (stack.length) {
		const dir = stack.pop()!;
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const st = statSync(full);
			if (st.isDirectory()) stack.push(full);
			else if (entry === filename) return full;
		}
	}
	return null;
}

function ensureDir(dir: string) {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function originalNameFromNewPath(newRel: string, mdPath: string, role: string): string | null {
	// Read the markdown's git-tracked or current frontmatter to figure
	// out which legacy filename used to live at newRel. We don't have
	// that history here, so instead: the original name lives in the
	// backup. We need a way to map cover/gallery-NN back to a name.
	//
	// The trick: parse the OLD frontmatter (before reorg) from
	// /tmp/visit-tywyn-public-img-backup-md/ if available. We don't
	// have that. Instead, we can ONLY recover when the file in the
	// backup has a 1:1 mapping by virtue of being unique under
	// public/img/ ... which it usually is.
	return null;
}

interface MissingRef {
	mdPath: string;
	collection: string;
	slug: string;
	role: 'cover' | 'gallery' | 'hero' | 'inline';
	galleryIndex?: number;
	inlineName?: string;
	newRelPath: string;
}

function processMarkdown(mdPath: string): MissingRef[] {
	const text = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
	const fmEnd = text.indexOf('\n---\n', 4);
	if (fmEnd < 0) return [];
	const fm = text.slice(0, fmEnd + 5);
	const body = text.slice(fmEnd + 5);

	const rel = relative(contentDir, mdPath);
	const parts = rel.split('/');
	const collection = parts[0];
	const slug = parts[parts.length - 1].replace(/\.md$/, '');

	const missing: MissingRef[] = [];

	// Frontmatter src lines
	let inGallery = false;
	let galleryIndex = 0;
	for (const line of fm.split('\n')) {
		if (/^\s*gallery:\s*$/.test(line)) {
			inGallery = true;
			galleryIndex = 0;
			continue;
		}
		if (inGallery && /^[A-Za-z_-]+:/.test(line)) inGallery = false;

		const m = line.match(/^[\s-]*src:\s*['"]([^'"]+)['"]/);
		if (!m) continue;
		const value = m[1];
		const inAssets = value.match(/(?:\.\.\/)+assets\/img\/(.+)$/);
		if (!inAssets) continue;
		const newRel = inAssets[1];
		if (existsSync(join(assetsImgDir, newRel))) continue;

		let role: MissingRef['role'] = 'cover';
		if (inGallery) {
			role = 'gallery';
			galleryIndex++;
		} else if (collection === 'pages') {
			role = 'hero';
		}
		missing.push({ mdPath, collection, slug, role, galleryIndex: inGallery ? galleryIndex : undefined, newRelPath: newRel });
	}

	// Body markdown ![alt](path)
	const bodyMatches = body.matchAll(/!\[([^\]]*)\]\((\.\.\/\.\.\/assets\/img\/[^)\s]+)\)/g);
	for (const m of bodyMatches) {
		const inAssets = m[2].match(/(?:\.\.\/)+assets\/img\/(.+)$/);
		if (!inAssets) continue;
		const newRel = inAssets[1];
		if (existsSync(join(assetsImgDir, newRel))) continue;
		missing.push({
			mdPath,
			collection,
			slug,
			role: 'inline',
			inlineName: basename(newRel),
			newRelPath: newRel,
		});
	}

	return missing;
}

interface ResolvedFrontmatterImage {
	role: 'cover' | 'gallery' | 'hero';
	galleryIndex?: number;
	originalRelInBackup: string;
}

// Reading the *git-history-erased* original frontmatter is the only
// way to map a logical role (e.g. gallery[3]) back to an original
// filename. We instead read each markdown file's CURRENT frontmatter,
// which has already been rewritten to point at the new logical name —
// useless for recovery. So we do the inverse: read git's HEAD copy
// of each file's frontmatter (if available) to recover the mapping.
function getOriginalFrontmatter(mdPath: string): string | null {
	try {
		const { execSync } = require('node:child_process') as typeof import('node:child_process');
		const rel = relative(repoRoot, mdPath);
		const out = execSync(`git show HEAD:${rel}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
		return out;
	} catch {
		return null;
	}
}

function recover() {
	const mdFiles = walkMarkdown(contentDir);
	const missingFiles: MissingRef[] = [];
	for (const md of mdFiles) missingFiles.push(...processMarkdown(md));

	console.log(`Found ${missingFiles.length} missing references across ${new Set(missingFiles.map((m) => m.mdPath)).size} files.`);

	let recovered = 0;
	let stillMissing = 0;
	const stillMissingDetail: string[] = [];

	// Group by mdPath to walk each file's pre-reorg frontmatter
	const byMd = new Map<string, MissingRef[]>();
	for (const m of missingFiles) {
		if (!byMd.has(m.mdPath)) byMd.set(m.mdPath, []);
		byMd.get(m.mdPath)!.push(m);
	}

	for (const [mdPath, refs] of byMd) {
		// Get HEAD's frontmatter to recover original src paths
		const origText = getOriginalFrontmatter(mdPath);
		if (!origText) {
			for (const r of refs) {
				stillMissing++;
				stillMissingDetail.push(`${r.newRelPath} (no git HEAD copy of ${r.mdPath})`);
			}
			continue;
		}
		// Extract original src lines from frontmatter (in order)
		const fmEnd = origText.indexOf('\n---\n', 4);
		if (fmEnd < 0) continue;
		const fm = origText.slice(0, fmEnd + 5);
		const origSrcs: { value: string; inGallery: boolean; galleryIndex: number }[] = [];
		let inGallery = false;
		let galleryIndex = 0;
		for (const line of fm.split('\n')) {
			if (/^\s*gallery:\s*$/.test(line)) {
				inGallery = true;
				galleryIndex = 0;
				continue;
			}
			if (inGallery && /^[A-Za-z_-]+:/.test(line)) inGallery = false;
			const m = line.match(/^[\s-]*src:\s*['"]?([^'"\n]+?)['"]?\s*$/);
			if (!m) continue;
			if (inGallery) galleryIndex++;
			origSrcs.push({ value: m[1], inGallery, galleryIndex: inGallery ? galleryIndex : 0 });
		}

		// Sort current refs by role + galleryIndex to mirror order
		const refsByRole = {
			cover: refs.filter((r) => r.role === 'cover' || r.role === 'hero'),
			gallery: refs.filter((r) => r.role === 'gallery').sort((a, b) => (a.galleryIndex! - b.galleryIndex!)),
			inline: refs.filter((r) => r.role === 'inline'),
		};

		// Cover/hero (one entry — first non-gallery src)
		if (refsByRole.cover.length) {
			const orig = origSrcs.find((s) => !s.inGallery);
			if (orig) {
				const filename = basename(orig.value);
				const backup = findInBackup(filename);
				if (backup) {
					const dest = join(assetsImgDir, refsByRole.cover[0].newRelPath);
					ensureDir(dirname(dest));
					copyFileSync(backup, dest);
					recovered++;
				} else {
					stillMissing++;
					stillMissingDetail.push(`${refsByRole.cover[0].newRelPath} (no backup of ${filename})`);
				}
			}
		}

		// Gallery entries: pair by index
		const origGallery = origSrcs.filter((s) => s.inGallery);
		for (const ref of refsByRole.gallery) {
			const orig = origGallery[ref.galleryIndex! - 1];
			if (!orig) {
				stillMissing++;
				stillMissingDetail.push(`${ref.newRelPath} (no original at gallery index ${ref.galleryIndex})`);
				continue;
			}
			const filename = basename(orig.value);
			const backup = findInBackup(filename);
			if (backup) {
				const dest = join(assetsImgDir, ref.newRelPath);
				ensureDir(dirname(dest));
				copyFileSync(backup, dest);
				recovered++;
			} else {
				stillMissing++;
				stillMissingDetail.push(`${ref.newRelPath} (no backup of ${filename})`);
			}
		}

		// Inline body images: search backup by basename only
		for (const ref of refsByRole.inline) {
			const filename = ref.inlineName!;
			const backup = findInBackup(filename);
			if (backup) {
				const dest = join(assetsImgDir, ref.newRelPath);
				ensureDir(dirname(dest));
				copyFileSync(backup, dest);
				recovered++;
			} else {
				// inline names were sometimes "cleaned" (slug-style),
				// so the backup might have a different basename. Skip.
				stillMissing++;
				stillMissingDetail.push(`${ref.newRelPath} (inline; cleaned name "${filename}" not in backup)`);
			}
		}
	}

	console.log(`\nRecovery summary:`);
	console.log(`  recovered:     ${recovered}`);
	console.log(`  still missing: ${stillMissing}`);
	if (stillMissingDetail.length) {
		for (const d of stillMissingDetail) console.log(`    - ${d}`);
	}
}

recover();
