/**
 * Build-time intrinsic-dimension probe for `public/img/...` images.
 *
 * Why this exists: until Stage 2 of the perf pass migrates everything
 * into Astro's image pipeline (which probes dimensions via Sharp),
 * the existing `<img>` tags ship with no `width`/`height` attributes
 * because frontmatter authors didn't populate them. Browsers can't
 * reserve space, every image triggers a layout shift, and the
 * `/eating/` page in particular has 19 of 20 images contributing CLS.
 *
 * Stage 1 / Unit Q1 fixes that without changing anything else: read
 * the intrinsic pixel dimensions straight from the file header at
 * SSR / build time, render `width`/`height` attributes, and the
 * browser reserves the correct aspect ratio.
 *
 * Only JPEG and PNG are supported because those are the only
 * formats actually referenced from `<img src>` across the codebase
 * (verified by grepping `src/` and `dist/`: 258 .jpg, 54 .png,
 * 30 .jpeg, zero .webp / .avif / .svg / .gif). When Stage 2 lands
 * and astro:assets takes over, this whole module gets retired.
 *
 * The probe is cached across calls within a build, so referencing
 * the same image from N venue cards costs one filesystem read.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface Dimensions {
	width: number;
	height: number;
}

const cache = new Map<string, Dimensions | null>();
// Resolve to repo `public/` from the build's working directory.
// `import.meta.url` would point to the bundled module location
// during `astro build`, not the source tree, so `process.cwd()`
// (which is the repo root when `npm run build` runs) is the
// reliable reference.
const publicDir = resolve(process.cwd(), 'public');

/**
 * Probe a `/img/...`-shaped URL for its intrinsic dimensions. Returns
 * `null` if the file is missing, an unsupported format, or malformed.
 * Callers should treat `null` as "skip the width/height attributes"
 * rather than failing the build, so a typo in a frontmatter path
 * doesn't break SSR.
 */
export function probeImage(urlOrPath: string): Dimensions | null {
	const cacheKey = urlOrPath;
	if (cache.has(cacheKey)) return cache.get(cacheKey)!;

	const result = probeImageUncached(urlOrPath);
	cache.set(cacheKey, result);
	return result;
}

function probeImageUncached(urlOrPath: string): Dimensions | null {
	const filePath = resolveToPublicFile(urlOrPath);
	if (!filePath) return null;
	if (!existsSync(filePath)) return null;

	let buf: Buffer;
	try {
		// Read up to 64 KB — enough to find a JPEG SOFx marker past
		// any APPx metadata block; PNG only needs the first 24 bytes.
		buf = readFileSync(filePath, { flag: 'r' }).subarray(0, 65536);
	} catch {
		return null;
	}

	const lower = filePath.toLowerCase();
	if (lower.endsWith('.png')) return probePng(buf);
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return probeJpeg(buf);
	return null;
}

function resolveToPublicFile(urlOrPath: string): string | null {
	if (!urlOrPath) return null;
	if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) return null;
	if (urlOrPath.startsWith('//')) return null;
	if (urlOrPath.startsWith('data:')) return null;
	const cleaned = urlOrPath.split('?')[0].split('#')[0];
	const rel = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
	return resolve(publicDir, rel);
}

function probePng(buf: Buffer): Dimensions | null {
	// PNG magic: 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk starts at
	// byte 8: 4 bytes length, 4 bytes "IHDR", 4 bytes width (BE32),
	// 4 bytes height (BE32). Width is at offset 16, height at 20.
	if (buf.length < 24) return null;
	if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
	if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
	const width = buf.readUInt32BE(16);
	const height = buf.readUInt32BE(20);
	if (!width || !height) return null;
	return { width, height };
}

function probeJpeg(buf: Buffer): Dimensions | null {
	// JPEG starts with SOI (0xFFD8). Walk the marker chain skipping
	// APPx (E0..EF) and other non-SOFx segments until we hit a SOFx
	// (0xC0..0xCF except 0xC4 DHT, 0xC8 JPG-reserved, 0xCC DAC).
	if (buf.length < 4) return null;
	if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

	let offset = 2;
	while (offset < buf.length - 9) {
		// Each segment starts with 0xFF + marker byte.
		if (buf[offset] !== 0xff) return null;
		const marker = buf[offset + 1];

		// 0xFF is fill — skip ahead.
		if (marker === 0xff) {
			offset++;
			continue;
		}

		// Markers without a length payload: SOI, EOI, RSTn, TEM.
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			offset += 2;
			continue;
		}

		// Segment length is BE16 starting at offset+2 and INCLUDES
		// the two length bytes themselves.
		const segLen = buf.readUInt16BE(offset + 2);
		if (segLen < 2) return null;

		// SOFx markers: C0..CF except C4 (DHT), C8 (JPG-reserved),
		// CC (DAC). Width/height are at marker_data + 5 and + 3.
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

		if (isSof) {
			if (offset + 9 > buf.length) return null;
			// payload offsets relative to first byte after segLen:
			//   +0: precision (1 byte), +1..+2: height, +3..+4: width
			const height = buf.readUInt16BE(offset + 5);
			const width = buf.readUInt16BE(offset + 7);
			if (!width || !height) return null;
			return { width, height };
		}

		offset += 2 + segLen;
	}
	return null;
}
