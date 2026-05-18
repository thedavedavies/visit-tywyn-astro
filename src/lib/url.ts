/**
 * URL helpers. Kept separate from jsonld.ts so the namespace
 * isn't lying. `absoluteUrl` is used by JSON-LD builders, by the
 * BaseLayout for canonical resolution, and by anywhere else that
 * needs to coerce a path or absolute URL into a fully-qualified
 * `https://...` form.
 */

import { SITE } from './site';

export function absoluteUrl(input: string | URL | undefined): string | undefined {
	if (!input) return undefined;
	if (input instanceof URL) return input.toString();
	if (/^https?:\/\//i.test(input)) return input;
	return new URL(input, SITE.url).toString();
}

/**
 * Escape `</` so a JSON-LD payload embedded with `set:html` cannot
 * break out of its `<script type="application/ld+json">` block.
 *
 * Without this, an editor-controlled string like `Best </script><img
 * src=x onerror=...>` in a venue title would terminate the script
 * element early and execute as HTML. JSON itself doesn't care about
 * angle brackets, so escaping `<` to `<` is a lossless transform
 * that keeps the JSON valid.
 */
export function safeJsonLd(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Convert any string into a safe slug suitable for use as an HTML
 * id, CSS class, or URL segment. Strips diacritics, lowercases,
 * collapses non-alphanumerics to single hyphens, and trims hyphens
 * at the edges. An empty result is replaced with `n` so the output
 * is always a valid HTML id (which must not be empty).
 */
export function slugify(input: string): string {
	const stripped = input
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '');
	const slug = stripped
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'n';
}

/**
 * URL builders for the two slugged collections. Centralising these
 * keeps page templates and JSON-LD builders agreeing on trailing
 * slashes and on what an `id` becomes at the URL level.
 *
 * These return **root-relative** paths (e.g. `/eating/dovey-inn/`),
 * not absolute URLs. HTML `<a href>` attributes inside the site
 * should ship as relative so the markup is portable across hosts
 * (preview vs production), and so visitors don't trigger a full
 * cross-origin reload when clicking an internal link.
 *
 * For JSON-LD `@id` / `url` properties, where Schema.org wants an
 * absolute IRI for canonical entity identity, wrap the result with
 * `absoluteUrl()` at the call site.
 */
export function eatingUrl(id: string): string {
	return `/eating/${id}/`;
}

export function thingsToDoUrl(id: string): string {
	return `/things-to-do/${id}/`;
}
