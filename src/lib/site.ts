/**
 * Site-wide constants. Single source of truth - do not duplicate in components.
 */
export const SITE = {
	url: 'https://visit-tywyn.co.uk',
	name: 'Visit Tywyn',
	tagline: 'Your guide to Tywyn, Mid Wales',
	description:
		'Tywyn is a coastal town in Gwynedd, Mid Wales. Find out where to stay, what to do, and where to eat.',
	// BCP-47 form, used for <html lang> and Schema.org `inLanguage`.
	locale: 'en-GB',
	// Open Graph protocol uses an underscore between ISO 639 and
	// ISO 3166. Mixing the two formats: BCP-47 hyphen for HTML / JSON-LD,
	// OG-protocol underscore for the og:locale meta tag.
	ogLocale: 'en_GB',
	twitter: '@visittywyn',
	twitterUrl: 'https://x.com/visittywyn',
	facebook: 'https://www.facebook.com/VisitTywyn',
	// GA4 measurement ID. Replaces the dead UA-28386547-1 tag the
	// WordPress site is still emitting; on the live site that UA
	// call was silently relayed into this GA4 property via Google's
	// Connected Site Tag fallback, which is brittle and disappearing.
	// BaseLayout skips the gtag snippet when this is empty, so an
	// accidental reset stops shipping a half-configured tracker
	// rather than emitting `id=`.
	gaMeasurementId: 'G-QG6TSQ40PV',
	adsenseClient: 'ca-pub-4920514279045356',
	// Google Search Console HTML-tag verification token. Carried over
	// verbatim from the WordPress site so the existing GSC property
	// stays verified through DNS cutover - without it Google's periodic
	// re-check fails and we lose access to the property (and submitted
	// sitemaps) right when launch monitoring matters most. Emitted as a
	// <meta google-site-verification> by BaseLayout when non-empty.
	gscVerification: 'IxBPx06knoRIhbThdxKgUdunU1tgXwUrTfyAu2Boc8Y',
	themeColor: '#046d8b',
	location: {
		lat: 52.58643,
		lng: -4.08916,
		// Admiralty EasyTide station ID for Aberdovey (closest reliable station to Tywyn).
		tideStationId: '0486',
	},
} as const;

export type SiteConfig = typeof SITE;
