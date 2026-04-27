/**
 * Markdown body helpers.
 *
 * Currently just FAQ extraction for FAQPage JSON-LD, but kept
 * here so the regex parser can grow without bloating route files.
 */

export interface FaqEntry {
	question: string;
	answer: string;
}

/**
 * Extract Q/A pairs from a raw markdown/HTML body.
 *
 * Strict scope: returns entries ONLY when the body contains a
 * `<div class="faqs">…</div>` section. Without this guard, *any*
 * page using `<h4>` for sub-headings would produce a FAQPage
 * schema, which is misleading markup that Google can flag.
 *
 * Inside the `.faqs` slice each `<h4>` becomes a question;
 * everything between it and the next `<h2|h3|h4>` (or end of slice)
 * becomes the answer. HTML tags are stripped so the JSON-LD output
 * is plain text.
 */
export function extractFaq(body: string): FaqEntry[] {
	const sliceMatch = body.match(/<div class="faqs">([\s\S]*?)<\/div>/i);
	if (!sliceMatch) return [];

	const scope = sliceMatch[1]!;
	const re = /<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]*?)(?=<h[1-4][^>]*>|$)/gi;
	const out: FaqEntry[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(scope))) {
		const question = m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
		const answer = m[2]!
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (question && answer) out.push({ question, answer });
	}
	return out;
}
