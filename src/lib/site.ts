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
	googleAnalyticsId: 'UA-28386547-1',
	adsenseClient: 'ca-pub-4920514279045356',
	// Default Open Graph image — used on pages that don't supply
	// their own (home, simple content pages). Pick something
	// recognisably Tywyn so social shares aren't generic.
	defaultOgImage: '/wp-content/uploads/2022/05/explore.jpg',
	themeColor: '#046d8b',
	location: {
		lat: 52.58643,
		lng: -4.08916,
		// Admiralty EasyTide station ID for Aberdovey (closest reliable station to Tywyn).
		tideStationId: '0486',
	},
} as const;

export type SiteConfig = typeof SITE;
