/**
 * Site-wide constants. Single source of truth — do not duplicate in components.
 */
export const SITE = {
	url: 'https://visit-tywyn.co.uk',
	name: 'Visit Tywyn',
	tagline: 'Your guide to Tywyn, Mid Wales',
	description:
		'Tywyn is a coastal town in Gwynedd, Mid Wales. Find out where to stay, what to do, and where to eat.',
	locale: 'en-GB',
	twitter: '@visit_tywyn',
	facebook: 'https://www.facebook.com/visittywyn',
	// GA4 measurement ID. The previous UA-28386547-1 tag was sunset
	// in July 2023 and has been collecting nothing since. Leave this
	// empty until a real `G-XXXXXXX` ID is provisioned — BaseLayout
	// skips the gtag snippet entirely when the ID is falsy, so the
	// build does not ship a half-configured tracker.
	gaMeasurementId: '',
	adsenseClient: 'ca-pub-4920514279045356',
	// Default Open Graph image — used on pages that don't supply
	// their own. The current asset is 1908x397, outside the 1.91:1
	// / 2:1 range social platforms expect; BaseLayout omits
	// og:image:width/height for that reason. Follow-up: generate a
	// 1200x630 social card and re-add the width/height/type tags.
	defaultOgImage: '/img/2022/05/explore.jpg',
	themeColor: '#046d8b',
	location: {
		lat: 52.58643,
		lng: -4.08916,
		// Admiralty EasyTide station ID for Aberdovey (closest reliable station to Tywyn).
		tideStationId: '0486',
	},
} as const;

export type SiteConfig = typeof SITE;
