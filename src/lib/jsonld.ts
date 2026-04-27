/**
 * Schema.org JSON-LD builders.
 *
 * Each function returns a plain object that BaseLayout serialises
 * into a `<script type="application/ld+json">` block (escaped via
 * `safeJsonLd` so editor-controlled strings can't break out).
 *
 * Centralising the builders here keeps every page's structured
 * data consistent and easy to audit when search engines tighten
 * their requirements. Builders that have nothing to emit return
 * `null` so callers can filter them out of jsonLd arrays without
 * special-casing each one.
 */

import { SITE } from './site';
import { absoluteUrl } from './url';

export type JsonLd = Record<string, unknown>;

/**
 * Standalone Organization node — used as a publisher reference in
 * other schema objects via `@id`.
 */
export function organization(): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': `${SITE.url}/#organization`,
		name: SITE.name,
		url: SITE.url,
		sameAs: [SITE.facebook, `https://twitter.com/${SITE.twitter.replace(/^@/, '')}`],
	};
}

/**
 * Standalone WebSite node — emitted on the home page so search
 * engines can tie the site identity together. We omit
 * `potentialAction` because there's no on-site search; including
 * it without a real endpoint would be misleading markup.
 */
export function website(): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		'@id': `${SITE.url}/#website`,
		url: SITE.url,
		name: SITE.name,
		description: SITE.description,
		inLanguage: SITE.locale,
		publisher: { '@id': `${SITE.url}/#organization` },
	};
}

/**
 * Tourist destination summary for the home page.
 */
export function touristDestination(): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'TouristDestination',
		'@id': `${SITE.url}/#destination`,
		name: SITE.name,
		url: SITE.url,
		description: SITE.description,
		inLanguage: SITE.locale,
		geo: {
			'@type': 'GeoCoordinates',
			latitude: SITE.location.lat,
			longitude: SITE.location.lng,
		},
		containedInPlace: {
			'@type': 'AdministrativeArea',
			name: 'Gwynedd, Wales',
		},
	};
}

interface BreadcrumbItem {
	label: string;
	href?: string;
}

/**
 * BreadcrumbList from the same array we already pass to the
 * `<Breadcrumbs>` visual component. Returns null when there's
 * nothing to render so callers can filter the result out of
 * their jsonLd arrays.
 */
export function breadcrumbList(items: BreadcrumbItem[], currentUrl: string | URL): JsonLd | null {
	if (items.length === 0) return null;
	const current = absoluteUrl(currentUrl);
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, idx) => ({
			'@type': 'ListItem',
			position: idx + 1,
			name: item.label,
			// Trailing items (no href) refer to the current page.
			item: item.href ? absoluteUrl(item.href) : current,
		})),
	};
}

interface ListEntry {
	url: string;
	name: string;
	image?: string;
	description?: string;
}

/**
 * ItemList for archive / listing pages. Returns null on empty
 * input so we don't ship `numberOfItems: 0` to search engines —
 * which Google explicitly calls out as low-quality markup.
 */
export function itemList(name: string, entries: ListEntry[]): JsonLd | null {
	if (entries.length === 0) return null;
	return {
		'@context': 'https://schema.org',
		'@type': 'ItemList',
		name,
		numberOfItems: entries.length,
		itemListElement: entries.map((entry, idx) => ({
			'@type': 'ListItem',
			position: idx + 1,
			url: absoluteUrl(entry.url),
			name: entry.name,
			...(entry.image ? { image: absoluteUrl(entry.image) } : {}),
			...(entry.description ? { description: entry.description } : {}),
		})),
	};
}

interface RestaurantInput {
	id: string;
	title: string;
	address?: string;
	phone?: string;
	website?: string;
	dogFriendly?: boolean;
	photo?: string;
	geo?: { lat: number; lng: number };
	sameAs?: (string | undefined)[];
	description?: string;
}

export function restaurant(input: RestaurantInput): JsonLd {
	const url = `${SITE.url}/eating/${input.id}/`;
	const node: JsonLd = {
		'@context': 'https://schema.org',
		'@type': input.dogFriendly ? 'Restaurant' : 'FoodEstablishment',
		'@id': `${url}#${input.dogFriendly ? 'restaurant' : 'establishment'}`,
		name: input.title,
		url,
		...(input.description ? { description: input.description } : {}),
		...(input.phone ? { telephone: input.phone } : {}),
		...(input.address ? { address: input.address } : {}),
		...(input.photo ? { image: absoluteUrl(input.photo) } : {}),
		...(input.geo
			? {
					geo: {
						'@type': 'GeoCoordinates',
						latitude: input.geo.lat,
						longitude: input.geo.lng,
					},
			  }
			: {}),
	};
	const sameAs = (input.sameAs ?? []).filter((u): u is string => !!u);
	if (input.website) sameAs.unshift(input.website);
	if (sameAs.length > 0) node.sameAs = sameAs;
	return node;
}

interface AttractionInput {
	id: string;
	title: string;
	description?: string;
	address?: string;
	phone?: string;
	website?: string;
	heroImage?: string;
	geo?: { lat: number; lng: number };
	sameAs?: (string | undefined)[];
}

export function touristAttraction(input: AttractionInput): JsonLd {
	const url = `${SITE.url}/things-to-do/${input.id}/`;
	const node: JsonLd = {
		'@context': 'https://schema.org',
		'@type': 'TouristAttraction',
		'@id': `${url}#attraction`,
		name: input.title,
		url,
		...(input.description ? { description: input.description } : {}),
		...(input.phone ? { telephone: input.phone } : {}),
		...(input.address ? { address: input.address } : {}),
		...(input.heroImage ? { image: absoluteUrl(input.heroImage) } : {}),
		...(input.geo
			? {
					geo: {
						'@type': 'GeoCoordinates',
						latitude: input.geo.lat,
						longitude: input.geo.lng,
					},
			  }
			: {}),
	};
	const sameAs = [input.website, ...(input.sameAs ?? [])].filter((u): u is string => !!u);
	if (sameAs.length > 0) node.sameAs = sameAs;
	return node;
}

interface EventInput {
	name: string;
	startIso: string;
	endIso: string;
	location?: string;
	url?: string | null;
	image?: string | null;
	description?: string;
}

/**
 * Event node. Exported as `eventSchema` (not `event`) to avoid
 * shadowing the global `Event` constructor and the `event`
 * variable name commonly used in handlers.
 *
 * `location` is a string-only Place name — we no longer synthesise
 * a Tywyn PostalAddress for it, since some events sit outside
 * Tywyn (Aberdyfi, Dolgellau, etc.) and a hardcoded address would
 * misrepresent them. If structured addresses become important,
 * widen the input shape later.
 */
export function eventSchema(input: EventInput): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'Event',
		name: input.name,
		startDate: input.startIso,
		endDate: input.endIso,
		eventStatus: 'https://schema.org/EventScheduled',
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		...(input.location
			? { location: { '@type': 'Place', name: input.location } }
			: {}),
		...(input.url ? { url: absoluteUrl(input.url) } : {}),
		...(input.image ? { image: absoluteUrl(input.image) } : {}),
		...(input.description ? { description: input.description } : {}),
		organizer: {
			'@type': 'Organization',
			name: SITE.name,
			url: SITE.url,
		},
	};
}

interface ArticleInput {
	title: string;
	description?: string;
	url: string | URL;
	image?: string;
	datePublished?: string;
	dateModified?: string;
	speakableSelector?: string[];
}

/**
 * WebPage wrapper for ordinary editorial pages — privacy policy,
 * "getting around", "wales coastal path", etc. Lighter-weight than
 * Article (which is for news-style content) and avoids the schema
 * police flagging missing author/headline fields.
 *
 * `isPartOf` / `publisher` references that pointed at @ids only
 * defined on the home page have been removed — dangling cross-
 * page references make some validators unhappy without measurable
 * search-engine benefit. The Organization + WebSite nodes are
 * still emitted on the home page where they belong.
 *
 * Pass `speakableSelector` to mark sections that voice assistants
 * can read aloud. Targets must be selectors present in the
 * rendered DOM — CSS-modules-hashed class names won't match, so
 * use data attributes (`[data-speakable="title"]`) or unscoped
 * global classes.
 */
export function webPage(input: ArticleInput): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		url: absoluteUrl(input.url),
		name: input.title,
		...(input.description ? { description: input.description } : {}),
		...(input.image
			? { primaryImageOfPage: { '@type': 'ImageObject', url: absoluteUrl(input.image) } }
			: {}),
		...(input.datePublished ? { datePublished: input.datePublished } : {}),
		...(input.dateModified ? { dateModified: input.dateModified } : {}),
		...(input.speakableSelector?.length
			? {
					speakable: {
						'@type': 'SpeakableSpecification',
						cssSelector: input.speakableSelector,
					},
			  }
			: {}),
		inLanguage: SITE.locale,
	};
}

interface FaqInput {
	question: string;
	answer: string;
}

/**
 * FAQPage schema. Returns null on empty input so callers can
 * filter without checking length.
 */
export function faqPage(entries: FaqInput[]): JsonLd | null {
	if (entries.length === 0) return null;
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: entries.map((entry) => ({
			'@type': 'Question',
			name: entry.question,
			acceptedAnswer: {
				'@type': 'Answer',
				text: entry.answer,
			},
		})),
	};
}
