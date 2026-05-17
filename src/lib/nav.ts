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
	href: string;
	children?: NavItem[];
}

export const PRIMARY_NAV: NavItem[] = [
	{ label: 'Places to eat', href: '/eating/' },
	{ label: 'Things to do', href: '/things-to-do/' },
	{ label: 'Where to stay', href: '/where-to-stay/' },
	{ label: 'Webcam', href: '/webcam/' },
	{
		label: 'Explore Tywyn',
		href: '/explore-tywyn/',
		children: [
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
 * Footer link columns — port of the hardcoded markup in footer.php.
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
// `sameAs`, the `twitter:site` meta tag, and the visible footer icons.
export const SOCIAL_LINKS = [
	{
		name: 'Facebook',
		href: SITE.facebook,
		icon: 'facebook',
	},
	{
		name: 'Twitter',
		href: SITE.twitterUrl,
		icon: 'twitter',
	},
] as const;
