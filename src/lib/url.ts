/**
 * URL helpers — kept separate from jsonld.ts so the namespace
 * isn't lying. `absoluteUrl` is used by JSON-LD builders, by the
 * BaseLayout for canonical resolution, and by anywhere else that
 * needs to coerce a path or absolute URL into a fully-qualified
 * `https://…` form.
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
 * src=x onerror=…>` in a venue title would terminate the script
 * element early and execute as HTML. JSON itself doesn't care about
 * angle brackets, so escaping `<` to `<` is a lossless transform
 * that keeps the JSON valid.
 */
export function safeJsonLd(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
