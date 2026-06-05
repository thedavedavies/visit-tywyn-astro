/**
 * Primary navigation.
 *
 * The WordPress Customizer-driven menu becomes a static array here.
 * We will populate this from the SQL export but the structure is
 * stable enough to commit a sensible default now.
 */
import { SITE } from './site';

export interface NavItem {
	label: string;
	/** Optional: a parent that only opens a submenu has no href of its own. */
	href?: string;
	children?: NavItem[];
}

export const PRIMARY_NAV: NavItem[] = [
	{ label: 'Places to eat', href: '/eating/' },
	{ label: 'Things to do', href: '/things-to-do/' },
	{ label: 'Where to stay', href: '/where-to-stay/' },
	{ label: 'Webcam', href: '/webcam/' },
	{
		// Renders as a disclosure button (no href of its own). The
		// /explore-tywyn/ page is reachable as the first submenu link, so
		// every destination works by tap, click, or keyboard. See Nav.astro.
		label: 'Explore Tywyn',
		children: [
			{ label: 'Tywyn FAQs', href: '/explore-tywyn/' },
			{ label: 'Tywyn Cinema', href: '/things-to-do/magic-lantern-cinema/' },
			{ label: 'Getting around Tywyn', href: '/getting-around/' },
			{
				label: 'Discovering the Wales Coastal Path: Aberdyfi to Tywyn',
				href: '/wales-coastal-path/',
			},
		],
	},
];

/**
 * Footer link columns - port of the hardcoded markup in footer.php.
 */
export const FOOTER_COLUMNS = [
	{
		title: 'Tell me more about...',
		links: [
			{ label: 'Things to do in Tywyn', href: '/things-to-do/' },
			{ label: 'Events in Tywyn', href: '/events/' },
			{ label: 'Dog friendly Cafes in Tywyn', href: '/dog-friendly-cafes/' },
			{ label: 'Films in Tywyn Cinema', href: '/things-to-do/magic-lantern-cinema/' },
			{ label: 'Wales Coastal Path', href: '/wales-coastal-path/' },
		],
		showSocial: false,
	},
	{
		title: 'Useful info...',
		links: [
			{ label: 'Getting around Tywyn', href: '/getting-around/' },
			{ label: 'Privacy Policy', href: '/privacy-policy/' },
			{
				label: 'Accessibility Statement',
				href: '/accessibility-statement-for-visit-tywyn/',
			},
		],
		showSocial: false,
	},
	{
		title: 'Contact us...',
		links: [{ label: 'Contact Us', href: '/contact/' }],
		showSocial: true,
	},
] as const;

// Derive social hrefs from SITE so a single edit propagates to JSON-LD
// `sameAs`, the `twitter:site` meta tag (still the platform-spec name
// for X Cards), and the visible footer icons.
export const SOCIAL_LINKS = [
	{
		name: 'Facebook',
		href: SITE.facebook,
		icon: 'facebook',
	},
	{
		// X (formerly Twitter). The SITE.twitterUrl key keeps its
		// internal name because the platform's Card meta spec is
		// still `twitter:site` / `twitter:card`; only the visible
		// brand surface changes here.
		name: 'X',
		href: SITE.twitterUrl,
		icon: 'x',
	},
] as const;
