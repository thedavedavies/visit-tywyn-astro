#!/usr/bin/env tsx
/**
 * Reference-driven image migration.
 *
 * Scans the source tree for /img/... references, copies only the
 * referenced image files (plus WebP companions) from the legacy WP
 * backup into public/img/, and skips plugin junk / non-image files.
 *
 * Usage:
 *   npm run migrate:uploads
 *   npm run migrate:uploads -- /path/to/different/backup
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_BACKUP =
	'/Users/dave/Downloads/visit-tywyn.co.uk_2026-Mar-13_backup_69b436db1a3c81.57399253';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const DEST_DIR = path.join(PROJECT_ROOT, 'public', 'img');

const IMAGE_EXTENSIONS = new Set([
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
	'.gif',
	'.svg',
	'.ico',
]);

const JUNK_DIRS = new Set([
	'aios',
	'ShortpixelBackups',
	'cleantalk_fw_files_for_blog_1',
	'hummingbird-assets',
	'cache',
	'shortpixel-meta',
	'smush',
	'smush-webp',
]);

// Match /img/<path>.ext  (terminators exclude quotes, angle brackets, query strings, fragments, parens)
const IMG_REF_REGEX = /\/img\/[^\s"'<>?#)]+\.(jpg|jpeg|png|webp|gif|svg|ico)/gi;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

function isTextFile(filePath: string): boolean {
	// Read first 8KB and check for null bytes (binary heuristic)
	const fd = fs.openSync(filePath, 'r');
	const buf = Buffer.alloc(8192);
	const n = fs.readSync(fd, buf, 0, 8192, 0);
	fs.closeSync(fd);
	return !buf.subarray(0, n).includes(0);
}

function discoverReferences(): Set<string> {
	const refs = new Set<string>();
	const files = walkDir(SRC_DIR);

	for (const file of files) {
		if (!isTextFile(file)) continue;
		const content = fs.readFileSync(file, 'utf8');
		for (const m of content.matchAll(IMG_REF_REGEX)) {
			const match = m[0];
			const start = m.index ?? 0;
			// Reject absolute external URLs (prefix is :// or //)
			const prefix = content.slice(Math.max(0, start - 3), start);
			if (prefix.endsWith('://') || prefix.endsWith('//')) continue;
			// Strip leading /img/ to get repo-relative path
			const rel = match.slice(5); // '/img/' is 5 chars
			refs.add(rel.toLowerCase());
		}
	}

	return refs;
}

function isJunkDir(relPath: string): boolean {
	const firstDir = relPath.split(path.sep)[0];
	if (!firstDir) return false;
	// Also catch cleantalk_* wildcard via prefix match
	if (firstDir.startsWith('cleantalk_')) return true;
	return JUNK_DIRS.has(firstDir);
}

function hasImageExtension(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return IMAGE_EXTENSIONS.has(ext);
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

const backupRoot = process.argv[2] || DEFAULT_BACKUP;
const uploadSrc = path.join(backupRoot, 'wp-content', 'uploads');

if (!fs.existsSync(uploadSrc)) {
	console.error(`✗ Source not found: ${uploadSrc}`);
	process.exit(1);
}

console.log('Discovering references…');
const needed = discoverReferences();
console.log(`  Referenced: ${needed.size} files`);

const toCopy = new Map<string, string>(); // destRel -> srcAbs
const missing: string[] = [];
const skippedJunk: string[] = [];
const skippedExt: string[] = [];

for (const rel of needed) {
	const srcAbs = path.join(uploadSrc, rel);

	if (!fs.existsSync(srcAbs)) {
		missing.push(rel);
		continue;
	}

	if (isJunkDir(rel)) {
		skippedJunk.push(rel);
		continue;
	}

	if (!hasImageExtension(rel)) {
		skippedExt.push(rel);
		continue;
	}

	toCopy.set(rel, srcAbs);

	// Auto-include WebP companion for jpg/jpeg/png
	const ext = path.extname(rel).toLowerCase();
	if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
		const webpRel = rel.slice(0, -ext.length) + '.webp';
		const webpSrc = path.join(uploadSrc, webpRel);
		if (fs.existsSync(webpSrc) && !isJunkDir(webpRel)) {
			toCopy.set(webpRel, webpSrc);
		}
	}
}

let copiedCount = 0;
let skippedCount = 0;
let copiedBytes = 0;

for (const [destRel, srcAbs] of toCopy) {
	const destAbs = path.join(DEST_DIR, destRel);
	ensureDir(path.dirname(destAbs));

	const srcStat = fs.statSync(srcAbs);
	let destStat: fs.Stats | undefined;
	try {
		destStat = fs.statSync(destAbs);
	} catch {
		// dest doesn't exist yet
	}

	if (destStat && destStat.size === srcStat.size && destStat.mtime >= srcStat.mtime) {
		skippedCount++;
		continue;
	}

	fs.copyFileSync(srcAbs, destAbs);
	copiedCount++;
	copiedBytes += srcStat.size;
}

if (missing.length > 0) {
	console.warn(`\nWarning: ${missing.length} referenced file(s) missing from backup:`);
	for (const f of missing) console.warn(`  - ${f}`);
}
if (skippedJunk.length > 0) {
	console.warn(`\nWarning: ${skippedJunk.length} referenced file(s) in junk directories (not copied):`);
	for (const f of skippedJunk) console.warn(`  - ${f}`);
}
if (skippedExt.length > 0) {
	console.warn(`\nWarning: ${skippedExt.length} referenced file(s) with non-image extension (not copied):`);
	for (const f of skippedExt) console.warn(`  - ${f}`);
}

console.log(`\nMigration summary:`);
console.log(`  Referenced: ${needed.size} files`);
console.log(`  Copied:     ${copiedCount} files (${formatBytes(copiedBytes)})`);
console.log(`  Skipped:    ${skippedCount} files (already up to date)`);
console.log(`  Missing:    ${missing.length} files (referenced but not in backup)`);
