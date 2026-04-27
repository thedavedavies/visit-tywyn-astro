/**
 * SQL → markdown export.
 *
 * Reads the WordPress SQL dump from the legacy site and produces
 * Astro-friendly content:
 *
 *   src/content/pages/*.md
 *   src/content/eating/*.md
 *   src/content/things-to-do/*.md
 *   src/content/stay-categories/*.md   (4 generated landings)
 *   public/_redirects                   (Netlify-style; portable)
 *   tools/.export-report.json           (summary stats)
 *
 * Run with `npm run export`.
 *
 * Design notes:
 * - We intentionally skip the 59 individual `accommodation` posts.
 *   The user has retired that content; we only consume their term
 *   relationships to map old URLs → new category landings.
 * - The script never touches the live database. It only reads the
 *   .sql dump file, so it is safe to re-run as many times as you
 *   like.
 * - Existing markdown files are overwritten; manual edits live in
 *   git, not here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────

const SQL_PATH =
	'/Users/dave/Downloads/visit-tywyn.co.uk_2026-Mar-13_backup_69b436db1a3c81.57399253/mwp_db/localhost-dbgiytib8j8qvd.sql';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const PREFIX = 'fhsst_';

// Skip these page IDs (they're handled bespoke). Home is fully
// replaced by `pages/index.astro`. The events page IS exported so
// `/events/` can render its body intro before the events list.
const HOME_PAGE_ID = '8';

// Map WP category term_id → stay category slug.
// Confirmed from the SQL: terms 3 (Self catering), 4 (Camping),
// 5 (Caravan), 6 (Bed & Breakfast).
const STAY_CATEGORY_SLUGS: Record<string, string> = {
	'3': 'self-catering',
	'4': 'camping',
	'5': 'caravan',
	'6': 'bed-and-breakfast',
};

// Title pattern + subtitle mirror `archive-accommodation.php`,
// where $cat_name (the WP category name) is concatenated with
// "in Tywyn" and a hand-written subtitle per category.
const STAY_CATEGORY_TITLES: Record<string, string> = {
	'self-catering': 'Self catering in Tywyn',
	camping: 'Camping in Tywyn',
	caravan: 'Caravan in Tywyn',
	'bed-and-breakfast': 'Bed & Breakfast in Tywyn',
};

const STAY_CATEGORY_SUBTITLES: Record<string, string> = {
	'self-catering': 'Find your perfect self catering holiday in Tywyn today',
	camping: 'Top campsites in Tywyn',
	caravan: 'Find your perfect caravan holiday in Tywyn today',
	'bed-and-breakfast': 'Find your perfect B&B holiday in Tywyn today',
};

const STAY_CATEGORY_INTROS: Record<string, string> = {
	'self-catering':
		'Self-catering cottages and apartments give you the run of the place — a kitchen for fish and chips on the porch, sandy boots by the door, and the freedom to come and go on your own schedule. Browse the booking sites below for places in and around Tywyn.',
	camping:
		'Tywyn sits between the sea and the southern edge of Eryri (Snowdonia), and the campsites here run the full range from quiet farm fields to fully serviced parks with shops and pubs on site.',
	caravan:
		'Static caravan parks line the Cardigan Bay coast either side of Tywyn. Most welcome touring caravans and motorhomes too, and several are within walking distance of the beach and the railway station.',
	'bed-and-breakfast':
		'A friendly Welsh welcome and a proper cooked breakfast — the B&Bs in Tywyn are mostly small, family-run, and well placed for the seafront, the railway, and the town centre.',
};

const STAY_CATEGORY_LINKS: Record<
	string,
	{ label: string; url: string; note?: string }[]
> = {
	'self-catering': [
		{ label: 'Sykes Cottages — Tywyn', url: 'https://www.sykescottages.co.uk/search/Wales/Tywyn-244.html' },
		{ label: 'Booking.com — Tywyn', url: 'https://www.booking.com/searchresults.html?ss=Tywyn%2C+Wales%2C+United+Kingdom' },
		{ label: 'Airbnb — Tywyn', url: 'https://www.airbnb.co.uk/s/Tywyn--Wales/homes' },
	],
	camping: [
		{ label: 'Pitchup — Tywyn', url: 'https://www.pitchup.com/campsites/Wales/Gwynedd/Tywyn/' },
		{ label: 'Cool Camping — Mid Wales', url: 'https://coolcamping.com/campsites/europe/uk/wales/mid-wales' },
		{ label: 'UK Campsite — Gwynedd', url: 'https://www.ukcampsite.co.uk/sites/county.asp?county=Gwynedd' },
	],
	caravan: [
		{ label: 'Hoseasons — Tywyn', url: 'https://www.hoseasons.co.uk/search?searchTerm=Tywyn' },
		{ label: 'Parkdean Resorts — Wales', url: 'https://www.parkdeanresorts.co.uk/holiday-parks/wales' },
		{ label: 'UK Caravans — Gwynedd', url: 'https://www.ukcaravans4hire.com/results.aspx?searchterm=Tywyn' },
	],
	'bed-and-breakfast': [
		{ label: 'Booking.com — B&Bs in Tywyn', url: 'https://www.booking.com/searchresults.html?ss=Tywyn%2C+Wales&nflt=ht_id%3D208' },
		{ label: 'Trip Advisor — Tywyn B&Bs', url: 'https://www.tripadvisor.co.uk/Hotels-g503829-zfc7-Tywyn_Gwynedd_North_Wales_Wales-Hotels.html' },
	],
};

// ──────────────────────────────────────────────────────────────────────────────
// SQL parser (state machine — handles escaped quotes, nested parens, NULLs)
// ──────────────────────────────────────────────────────────────────────────────

function* iterTuples(sql: string, table: string): Generator<string> {
	const marker = `INSERT INTO \`${PREFIX}${table}\` VALUES `;
	const n = sql.length;
	let i = 0;
	while (true) {
		const idx = sql.indexOf(marker, i);
		if (idx < 0) return;
		i = idx + marker.length;
		while (i < n && sql[i] !== ';') {
			if (sql[i] !== '(') {
				i++;
				continue;
			}
			const start = i;
			i++;
			let depth = 1;
			let inStr = false;
			while (i < n && depth > 0) {
				const c = sql[i];
				if (inStr) {
					if (c === '\\') {
						i += 2;
						continue;
					}
					if (c === "'") {
						inStr = false;
						i++;
						continue;
					}
					i++;
					continue;
				}
				if (c === "'") {
					inStr = true;
					i++;
					continue;
				}
				if (c === '(') depth++;
				else if (c === ')') depth--;
				i++;
			}
			yield sql.slice(start, i);
			while (i < n && ', \n\t\r'.includes(sql[i] ?? '')) i++;
		}
		if (i < n) i++;
	}
}

function splitFields(tup: string): string[] {
	let s = tup.trim();
	if (s.startsWith('(')) s = s.slice(1);
	if (s.endsWith(')')) s = s.slice(0, -1);
	const fields: string[] = [];
	let cur = '';
	let inStr = false;
	const n = s.length;
	let i = 0;
	while (i < n) {
		const c = s[i]!;
		if (inStr) {
			if (c === '\\') {
				cur += s.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (c === "'") {
				inStr = false;
				cur += c;
				i++;
				continue;
			}
			cur += c;
			i++;
			continue;
		}
		if (c === "'") {
			inStr = true;
			cur += c;
			i++;
			continue;
		}
		if (c === ',') {
			fields.push(cur);
			cur = '';
			i++;
			continue;
		}
		cur += c;
		i++;
	}
	if (cur !== '') fields.push(cur);
	return fields;
}

function unq(s: string): string {
	let v = s.trim();
	if (v === 'NULL' || v === 'null') return '';
	if (v.startsWith("'") && v.endsWith("'")) {
		v = v.slice(1, -1);
		v = v
			.replace(/\\'/g, "'")
			.replace(/\\"/g, '"')
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')
			.replace(/\\\//g, '/')
			.replace(/\\\\/g, '\\');
	}
	return v;
}

function unqInt(s: string): number {
	const v = unq(s);
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// PHP unserialize — minimal, handles a:N:{...}, s:N:"...", i:N;, b:0/1, N;
// Enough for ACF + WP option values.
// ──────────────────────────────────────────────────────────────────────────────

class PhpUnserializer {
	private s: string;
	private i: number;
	constructor(s: string) {
		this.s = s;
		this.i = 0;
	}
	parse(): unknown {
		const c = this.s[this.i];
		if (c === undefined) return null;
		if (c === 'N') {
			this.i += 2; // N;
			return null;
		}
		if (c === 'b') {
			this.i += 2;
			const v = this.s[this.i] === '1';
			this.i += 2;
			return v;
		}
		if (c === 'i') {
			this.i += 2;
			const end = this.s.indexOf(';', this.i);
			const n = parseInt(this.s.slice(this.i, end), 10);
			this.i = end + 1;
			return n;
		}
		if (c === 'd') {
			this.i += 2;
			const end = this.s.indexOf(';', this.i);
			const n = parseFloat(this.s.slice(this.i, end));
			this.i = end + 1;
			return n;
		}
		if (c === 's') {
			this.i += 2;
			const colon = this.s.indexOf(':', this.i);
			const len = parseInt(this.s.slice(this.i, colon), 10);
			this.i = colon + 2; // skip :"
			const v = this.s.slice(this.i, this.i + len);
			this.i += len + 2; // skip ";
			return v;
		}
		if (c === 'a') {
			this.i += 2;
			const colon = this.s.indexOf(':', this.i);
			const count = parseInt(this.s.slice(this.i, colon), 10);
			this.i = colon + 2; // skip :{
			const out: Record<string | number, unknown> = {};
			let allIntKeys = true;
			for (let k = 0; k < count; k++) {
				const key = this.parse() as string | number;
				if (typeof key !== 'number') allIntKeys = false;
				const value = this.parse();
				out[key] = value;
			}
			this.i++; // skip }
			if (allIntKeys) {
				const arr: unknown[] = [];
				const keys = Object.keys(out)
					.map((k) => parseInt(k, 10))
					.sort((a, b) => a - b);
				for (const k of keys) arr.push(out[k]);
				return arr;
			}
			return out;
		}
		// Unknown — skip rest
		return null;
	}
}

function phpUnserialize(s: string): unknown {
	if (!s) return null;
	try {
		return new PhpUnserializer(s).parse();
	} catch {
		return null;
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Domain types
// ──────────────────────────────────────────────────────────────────────────────

interface Post {
	id: string;
	title: string;
	slug: string;
	content: string;
	excerpt: string;
	status: string;
	type: string;
	mime: string;
	parent: string;
	guid: string;
	menuOrder: number;
	created: string; // YYYY-MM-DD HH:MM:SS
	modified: string;
}

interface TermTax {
	termTaxonomyId: string;
	termId: string;
	taxonomy: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Load + index
// ──────────────────────────────────────────────────────────────────────────────

console.log(`Reading ${SQL_PATH}…`);
const sql = fs.readFileSync(SQL_PATH, 'utf8');
console.log(`  ${(sql.length / 1024 / 1024).toFixed(1)} MB`);

const posts = new Map<string, Post>();
for (const tup of iterTuples(sql, 'posts')) {
	const fs_ = splitFields(tup);
	if (fs_.length < 23) continue;
	const id = unq(fs_[0]!);
	posts.set(id, {
		id,
		title: unq(fs_[5]!),
		slug: unq(fs_[11]!),
		content: unq(fs_[4]!),
		excerpt: unq(fs_[6]!),
		status: unq(fs_[7]!),
		type: unq(fs_[20]!),
		mime: unq(fs_[21]!),
		parent: unq(fs_[17]!),
		guid: unq(fs_[18]!),
		menuOrder: unqInt(fs_[19]!),
		created: unq(fs_[2]!),
		modified: unq(fs_[14]!),
	});
}
console.log(`  posts: ${posts.size}`);

// post_id -> { meta_key -> meta_value }
const postmeta = new Map<string, Record<string, string>>();
for (const tup of iterTuples(sql, 'postmeta')) {
	const fs_ = splitFields(tup);
	if (fs_.length < 4) continue;
	const pid = unq(fs_[1]!);
	const key = unq(fs_[2]!);
	const val = unq(fs_[3]!);
	let bucket = postmeta.get(pid);
	if (!bucket) {
		bucket = {};
		postmeta.set(pid, bucket);
	}
	bucket[key] = val;
}
console.log(`  postmeta rows: ${[...postmeta.values()].reduce((a, m) => a + Object.keys(m).length, 0)}`);

// term_taxonomy_id -> { term_id, taxonomy }
const termTaxonomies = new Map<string, TermTax>();
for (const tup of iterTuples(sql, 'term_taxonomy')) {
	const fs_ = splitFields(tup);
	if (fs_.length < 6) continue;
	termTaxonomies.set(unq(fs_[0]!), {
		termTaxonomyId: unq(fs_[0]!),
		termId: unq(fs_[1]!),
		taxonomy: unq(fs_[2]!),
	});
}

// post_id -> [term_ids] (only for `category` taxonomy — that's all accommodation uses)
const postCategories = new Map<string, string[]>();
for (const tup of iterTuples(sql, 'term_relationships')) {
	const fs_ = splitFields(tup);
	if (fs_.length < 3) continue;
	const objectId = unq(fs_[0]!);
	const ttId = unq(fs_[1]!);
	const tt = termTaxonomies.get(ttId);
	if (!tt || tt.taxonomy !== 'category') continue;
	let arr = postCategories.get(objectId);
	if (!arr) {
		arr = [];
		postCategories.set(objectId, arr);
	}
	arr.push(tt.termId);
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const attachmentPathById = new Map<string, string>();
for (const post of posts.values()) {
	if (post.type !== 'attachment') continue;
	const meta = postmeta.get(post.id);
	if (!meta) continue;
	const file = meta._wp_attached_file;
	if (!file) continue;
	attachmentPathById.set(post.id, `/wp-content/uploads/${file}`);
}

function attachmentUrl(idOrUrl: string | undefined): string | undefined {
	if (!idOrUrl) return undefined;
	if (/^\d+$/.test(idOrUrl)) {
		return attachmentPathById.get(idOrUrl);
	}
	if (idOrUrl.startsWith('http')) return idOrUrl;
	if (idOrUrl.startsWith('/')) return idOrUrl;
	return undefined;
}

function yamlEscape(s: string): string {
	if (s === '') return "''";
	if (/^[A-Za-z0-9 .,:;\-_/()'"!?£$&%@]+$/.test(s) && !s.includes(': ') && !s.startsWith('-')) {
		// Wrap in quotes only if needed for YAML safety
		if (/[#:&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
			return `'${s.replace(/'/g, "''")}'`;
		}
		return s;
	}
	return `'${s.replace(/'/g, "''")}'`;
}

function yamlBlock(obj: Record<string, unknown>, indent = 0): string[] {
	const pad = '  '.repeat(indent);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined || value === null) continue;
		if (typeof value === 'string') {
			if (value === '') continue;
			lines.push(`${pad}${key}: ${yamlEscape(value)}`);
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			lines.push(`${pad}${key}: ${value}`);
		} else if (Array.isArray(value)) {
			if (value.length === 0) continue;
			lines.push(`${pad}${key}:`);
			for (const item of value) {
				if (typeof item === 'object' && item !== null) {
					const sub = yamlBlock(item as Record<string, unknown>, indent + 1);
					if (sub.length === 0) continue;
					// First sub-line starts the list item (under the dash);
					// subsequent lines get aligned under it (dash plus space = 2 chars)
					const stripChars = (indent + 1) * 2;
					lines.push(`${pad}  - ${sub[0]!.slice(stripChars)}`);
					for (let k = 1; k < sub.length; k++) {
						lines.push(`${pad}    ${sub[k]!.slice(stripChars)}`);
					}
				} else if (typeof item === 'string') {
					lines.push(`${pad}  - ${yamlEscape(item)}`);
				} else {
					lines.push(`${pad}  - ${String(item)}`);
				}
			}
		} else if (typeof value === 'object') {
			const sub = yamlBlock(value as Record<string, unknown>, indent + 1);
			if (sub.length === 0) continue;
			lines.push(`${pad}${key}:`);
			lines.push(...sub);
		}
	}
	return lines;
}

function makeFrontmatter(obj: Record<string, unknown>): string {
	const lines = yamlBlock(obj);
	return `---\n${lines.join('\n')}\n---\n\n`;
}

const uploadReferences = new Set<string>();

function rewriteContent(html: string): string {
	let out = html;

	// Track uploads referenced in the body
	for (const m of out.matchAll(/\/wp-content\/uploads\/[^\s'")<>]+/g)) {
		uploadReferences.add(m[0]);
	}

	// Strip WP shortcodes — these were expanded by plugins server-side
	// (Gravity Forms, Search & Filter, etc) and don't render in Astro.
	// We replace the contact-form shortcode with a placeholder so the
	// page still has a sensible "contact us" call-to-action; the rest
	// are simply removed.
	out = out.replace(
		/\[gravityform[^\]]*\]/gi,
		'<p class="form-placeholder"><em>The contact form is being rebuilt — for now, please reach us via the social links above or by email.</em></p>'
	);
	out = out.replace(/\[searchandfilter[^\]]*\]/gi, '');
	out = out.replace(/\[\/?[a-z][a-z0-9_-]*(?:\s[^\]]*)?\]/gi, '');

	// Strip leading/trailing whitespace runs
	out = out.replace(/^\s+|\s+$/g, '');

	// Drop empty <p></p> that the WP autop filter sometimes produces
	out = out.replace(/<p>\s*<\/p>/g, '');

	// Normalise legacy domain references
	out = out.replace(/https?:\/\/(www\.)?visit-tywyn\.co\.uk\//g, '/');

	return out;
}

function pickYoast(meta: Record<string, string>) {
	const title = meta._yoast_wpseo_title;
	const description = meta._yoast_wpseo_metadesc;
	const canonical = meta._yoast_wpseo_canonical;
	const noindex = meta['_yoast_wpseo_meta-robots-noindex'] === '1';
	const ogImage = meta._yoast_wpseo_opengraph_image;
	const seo: Record<string, unknown> = {};
	if (title) seo.title = title.replace(/%%[a-z_]+%%/g, '').trim();
	if (description) seo.description = description.replace(/%%[a-z_]+%%/g, '').trim();
	if (canonical) seo.canonical = canonical;
	if (ogImage) seo.og_image = ogImage;
	if (noindex) seo.noindex = true;
	return Object.keys(seo).length > 0 ? seo : undefined;
}

function decodeAcfArray(raw: string | undefined): string[] {
	if (!raw) return [];
	const parsed = phpUnserialize(raw);
	if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
	return [];
}

function decodeAcfMap(raw: string | undefined): Record<string, unknown> | null {
	if (!raw) return null;
	const parsed = phpUnserialize(raw);
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		return parsed as Record<string, unknown>;
	}
	return null;
}

function geoFromAcfMap(raw: string | undefined) {
	const m = decodeAcfMap(raw);
	if (!m) return undefined;
	const lat = typeof m.lat === 'string' ? parseFloat(m.lat) : (m.lat as number | undefined);
	const lng = typeof m.lng === 'string' ? parseFloat(m.lng) : (m.lng as number | undefined);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
	const out: Record<string, unknown> = { lat, lng };
	if (typeof m.address === 'string' && m.address) out.address = m.address;
	if (typeof m.zoom === 'string' && m.zoom) out.zoom = parseInt(m.zoom, 10);
	return out;
}

function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

function writeFile(rel: string, body: string): void {
	const abs = path.join(PROJECT_ROOT, rel);
	ensureDir(path.dirname(abs));
	fs.writeFileSync(abs, body, 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────────
// Emit: pages
// ──────────────────────────────────────────────────────────────────────────────

const SKIP_PAGE_IDS = new Set([HOME_PAGE_ID]);

let pagesWritten = 0;
for (const post of posts.values()) {
	if (post.type !== 'page' || post.status !== 'publish') continue;
	if (SKIP_PAGE_IDS.has(post.id)) continue;
	const meta = postmeta.get(post.id) ?? {};
	const subtitle = meta.page_subtitle;
	const heroId = meta.header_image || meta._thumbnail_id;
	const heroSrc = attachmentUrl(heroId);
	const fm: Record<string, unknown> = {
		title: post.title,
		slug: post.slug,
		menu_order: post.menuOrder,
	};
	if (subtitle) fm.subtitle = subtitle;
	if (heroSrc) fm.hero_image = { src: heroSrc, alt: post.title };
	const updated = post.modified.split(' ')[0];
	if (updated && updated !== '0000-00-00') fm.updated = updated;
	const seo = pickYoast(meta);
	if (seo) fm.seo = seo;

	const body = rewriteContent(post.content);
	writeFile(`src/content/pages/${post.slug}.md`, makeFrontmatter(fm) + body + '\n');
	pagesWritten++;
}
console.log(`  pages written: ${pagesWritten}`);

// ──────────────────────────────────────────────────────────────────────────────
// Emit: eating
// ──────────────────────────────────────────────────────────────────────────────

let eatingWritten = 0;
for (const post of posts.values()) {
	if (post.type !== 'eating' || post.status !== 'publish') continue;
	const meta = postmeta.get(post.id) ?? {};
	const photo = attachmentUrl(meta.photo || meta._thumbnail_id);
	const dogFriendly = decodeAcfArray(meta.dog_friendly).includes('yes');
	const fm: Record<string, unknown> = {
		title: post.title,
		summary: meta.intro || post.excerpt || undefined,
		address: meta.address || undefined,
		phone: meta.phone_number || undefined,
		website: meta.webite_link || meta.website || undefined,
		dog_friendly: dogFriendly,
		published: post.created.split(' ')[0],
		// `google_map_location` is the actual ACF field name for eating
		// (vs `google_map` on things_to_do).
		geo: geoFromAcfMap(meta.google_map_location ?? meta.google_map),
	};
	if (photo) fm.photo = { src: photo, alt: post.title };
	if (meta.trip_advisor_link) fm.trip_advisor_link = meta.trip_advisor_link;
	if (meta.facebook_link) fm.facebook_link = meta.facebook_link;
	const seo = pickYoast(meta);
	if (seo) fm.seo = seo;

	const body = rewriteContent(meta.about || post.content);
	writeFile(`src/content/eating/${post.slug}.md`, makeFrontmatter(fm) + body + '\n');
	eatingWritten++;
}
console.log(`  eating written: ${eatingWritten}`);

// ──────────────────────────────────────────────────────────────────────────────
// Emit: things-to-do
// ──────────────────────────────────────────────────────────────────────────────

let ttdWritten = 0;
for (const post of posts.values()) {
	if (post.type !== 'things_to_do' || post.status !== 'publish') continue;
	const meta = postmeta.get(post.id) ?? {};
	const heroSrc = attachmentUrl(meta.header_image || meta._thumbnail_id);
	const galleryIds = decodeAcfArray(meta.gallery);
	const gallery = galleryIds
		.map((id) => attachmentUrl(id))
		.filter((u): u is string => !!u)
		.map((src) => ({ src, alt: post.title }));

	const social: Record<string, string> = {};
	for (const k of ['facebook', 'twitter', 'instagram', 'youtube'] as const) {
		const v = meta[k];
		if (v && /^https?:/.test(v)) social[k] = v;
	}

	const facilities = decodeAcfArray(meta.facilities);

	const fm: Record<string, unknown> = {
		title: post.title,
		subtitle: meta.page_subtitle || undefined,
		summary: post.excerpt || undefined,
		address: meta.address || undefined,
		phone: meta.phone_number || undefined,
		website: meta.website || undefined,
		grid_reference: meta.grid_reference || undefined,
		published: post.created.split(' ')[0],
		geo: geoFromAcfMap(meta.google_map),
	};
	if (heroSrc) fm.hero_image = { src: heroSrc, alt: post.title };
	if (gallery.length > 0) fm.gallery = gallery;
	if (Object.keys(social).length > 0) fm.social = social;
	if (facilities.length > 0) fm.facilities = facilities;
	const seo = pickYoast(meta);
	if (seo) fm.seo = seo;

	const body = rewriteContent(post.content);
	writeFile(`src/content/things-to-do/${post.slug}.md`, makeFrontmatter(fm) + body + '\n');
	ttdWritten++;
}
console.log(`  things-to-do written: ${ttdWritten}`);

// ──────────────────────────────────────────────────────────────────────────────
// Emit: stay-categories (4 generated landings)
// ──────────────────────────────────────────────────────────────────────────────

let scWritten = 0;
for (const [slug, title] of Object.entries(STAY_CATEGORY_TITLES)) {
	const fm: Record<string, unknown> = {
		title,
		subtitle: STAY_CATEGORY_SUBTITLES[slug] ?? '',
		slug,
		menu_order: scWritten,
		intro: STAY_CATEGORY_INTROS[slug] ?? '',
		booking_search_links: STAY_CATEGORY_LINKS[slug] ?? [],
		featured: [],
		seo: {
			title: `${title} | Visit Tywyn`,
			description: STAY_CATEGORY_INTROS[slug],
		},
	};
	const body = `<!--\nThis category landing page replaces the legacy individual ${slug} listings.\nFeatured / sponsored entries can be added to the \`featured\` array in the\nfrontmatter — they'll render as cards above the booking search links.\n-->\n`;
	writeFile(`src/content/stay-categories/${slug}.md`, makeFrontmatter(fm) + body + '\n');
	scWritten++;
}
console.log(`  stay-categories written: ${scWritten}`);

// ──────────────────────────────────────────────────────────────────────────────
// Emit: redirects
// ──────────────────────────────────────────────────────────────────────────────

interface RedirectRow {
	from: string;
	to: string;
	code: number;
	source: string;
}

const redirects: RedirectRow[] = [];

// (a) 59 individual accommodation slugs → /holiday-accommodation/<category>/
let accomCount = 0;
for (const post of posts.values()) {
	if (post.type !== 'accommodation' || post.status !== 'publish') continue;
	accomCount++;
	const termIds = postCategories.get(post.id) ?? [];
	const catSlug = termIds.map((tid) => STAY_CATEGORY_SLUGS[tid]).find(Boolean);
	const dest = catSlug ? `/holiday-accommodation/${catSlug}/` : '/where-to-stay/';
	redirects.push({
		from: `/accommodation/${post.slug}/`,
		to: dest,
		code: 301,
		source: 'accommodation-listing',
	});
}

// (b) Existing Redirection plugin rules
let pluginCount = 0;
for (const tup of iterTuples(sql, 'redirection_items')) {
	const fs_ = splitFields(tup);
	if (fs_.length < 15) continue;
	const status = unq(fs_[9]!);
	if (status !== 'enabled') continue;
	const url = unq(fs_[1]!);
	const action = unq(fs_[10]!);
	const code = unqInt(fs_[11]!);
	const target = unq(fs_[12]!);
	if (action !== 'url' || !url || !target) continue;
	redirects.push({
		from: url,
		to: target,
		code: code || 301,
		source: 'redirection-plugin',
	});
	pluginCount++;
}

// (c) Pagination URL pattern → category landing
for (const slug of Object.values(STAY_CATEGORY_SLUGS)) {
	for (let page = 2; page <= 5; page++) {
		redirects.push({
			from: `/holiday-accommodation/${slug}/${page}/`,
			to: `/holiday-accommodation/${slug}/`,
			code: 301,
			source: 'pagination',
		});
	}
}

// Deduplicate (later-source wins)
const uniqueByFrom = new Map<string, RedirectRow>();
for (const r of redirects) uniqueByFrom.set(r.from, r);
const finalRedirects = [...uniqueByFrom.values()];

// Netlify-style _redirects format: `/from /to 301`
const redirectsFile = finalRedirects
	.sort((a, b) => a.from.localeCompare(b.from))
	.map((r) => `${r.from}  ${r.to}  ${r.code}`)
	.join('\n');

writeFile(
	'public/_redirects',
	`# Generated by tools/export-from-sql.ts.\n# Edit the script if you need to change the rules — this file is regenerated.\n\n${redirectsFile}\n`
);

console.log(
	`  redirects written: ${finalRedirects.length} (accommodation: ${accomCount}, plugin: ${pluginCount}, pagination: ${scWritten * 4})`
);

// ──────────────────────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────────────────────

const report = {
	generatedAt: new Date().toISOString(),
	source: SQL_PATH,
	pages: pagesWritten,
	eating: eatingWritten,
	thingsToDo: ttdWritten,
	stayCategories: scWritten,
	redirects: finalRedirects.length,
	uploadReferences: uploadReferences.size,
};

writeFile('tools/.export-report.json', JSON.stringify(report, null, 2) + '\n');
writeFile('tools/.upload-references.txt', [...uploadReferences].sort().join('\n') + '\n');

console.log('Done.');
console.log(report);
