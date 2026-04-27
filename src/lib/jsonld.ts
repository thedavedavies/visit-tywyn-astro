/**
 * Schema.org JSON-LD builders.
 *
 * Each function returns a plain object that BaseLayout serialises
 * into a `<script type="application/ld+json">` block. Centralising
 * them here keeps every page's structured data consistent and easy
 * to audit when search engines tighten their requirements.
 */

import { SITE } from './site';

export type JsonLd = Record<string, unknown>;

/**
 * Resolve a path or absolute URL against the configured site origin.
 * Lets call sites pass either form without thinking about it.
 */
export function absoluteUrl(input: string | URL | undefined, fallback?: string): string | undefined {
	if (!input) return fallback;
	if (input instanceof URL) return input.toString();
	if (/^https?:\/\//i.test(input)) return input;
	return new URL(input, SITE.url).toString();
}

/**
 * Standalone Organization node — used as a publisher reference in
 * other schema objects.
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
 * engines can offer a sitelinks search box. We omit potentialAction
 * because there's no on-site search; including it without a real
 * endpoint would be a lie.
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
 * `<Breadcrumbs>` visual component. Items without `href` (the
 * current page) get the request URL so search engines have a
 * complete trail.
 */
export function breadcrumbList(items: BreadcrumbItem[], currentUrl: string | URL): JsonLd | null {
	if (items.length === 0) return null;
	const current = absoluteUrl(currentUrl)!;
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, idx) => ({
			'@type': 'ListItem',
			position: idx + 1,
			name: item.label,
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
 * ItemList for archive / listing pages. Each entry must at minimum
 * have a URL and a name — image and description boost rich-result
 * eligibility but aren't required.
 */
export function itemList(name: string, entries: ListEntry[]): JsonLd {
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

export function event(input: EventInput): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'Event',
		name: input.name,
		startDate: input.startIso,
		endDate: input.endIso,
		eventStatus: 'https://schema.org/EventScheduled',
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		...(input.location
			? {
					location: {
						'@type': 'Place',
						name: input.location,
						address: {
							'@type': 'PostalAddress',
							addressLocality: 'Tywyn',
							addressRegion: 'Gwynedd',
							addressCountry: 'GB',
						},
					},
			  }
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
}

/**
 * WebPage wrapper for ordinary editorial pages — privacy policy,
 * "getting around", "wales coastal path", etc. Lighter-weight than
 * Article (which is for news-style content) and avoids the schema
 * police flagging missing author/headline fields.
 */
export function webPage(input: ArticleInput): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		url: absoluteUrl(input.url),
		name: input.title,
		...(input.description ? { description: input.description } : {}),
		...(input.image ? { primaryImageOfPage: { '@type': 'ImageObject', url: absoluteUrl(input.image) } } : {}),
		...(input.datePublished ? { datePublished: input.datePublished } : {}),
		...(input.dateModified ? { dateModified: input.dateModified } : {}),
		isPartOf: { '@id': `${SITE.url}/#website` },
		inLanguage: SITE.locale,
		publisher: { '@id': `${SITE.url}/#organization` },
	};
}
