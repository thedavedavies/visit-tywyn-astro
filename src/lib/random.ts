/**
 * Deterministic pseudo-random helpers.
 *
 * Used by detail pages to pick "related items" without breaking
 * Astro's per-page caching. `Math.random()` makes every build
 * different, which thrashes diffs and caches; this module gives
 * us a stable shuffle keyed on a seed string (typically the page
 * slug).
 *
 * The PRNG is a tiny Linear Congruential Generator — not
 * cryptographically secure, but uniform enough for picking N
 * items out of M with no observable bias.
 */

function hashSeed(seed: string): number {
	let h = 0;
	for (let i = 0; i < seed.length; i++) {
		h = (h * 31 + seed.charCodeAt(i)) | 0;
	}
	// LCG works on positive integers; bring h into 0..2^31-1.
	return h & 0x7fffffff || 1;
}

function nextLcg(state: number): number {
	return ((state * 1103515245 + 12345) | 0) & 0x7fffffff;
}

/**
 * Fisher-Yates shuffle seeded by an arbitrary string. Returns a
 * new array; does not mutate the input.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
	const out = items.slice();
	let state = hashSeed(seed);
	for (let i = out.length - 1; i > 0; i--) {
		state = nextLcg(state);
		const j = state % (i + 1);
		const tmp = out[i]!;
		out[i] = out[j]!;
		out[j] = tmp;
	}
	return out;
}
