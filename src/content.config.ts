import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Shared SEO frontmatter — Yoast equivalents.
 */
const seoSchema = z
	.object({
		title: z.string().optional(),
		description: z.string().optional(),
		canonical: z.string().url().optional(),
		og_image: z.string().optional(),
		noindex: z.boolean().optional(),
	})
	.optional();

/**
 * Shared geo / map fields used by eating + things-to-do.
 */
const geoSchema = z
	.object({
		lat: z.number(),
		lng: z.number(),
		address: z.string().optional(),
		zoom: z.number().int().min(1).max(20).default(15),
	})
	.optional();

const imageSchema = z.object({
	src: z.string(),
	alt: z.string().default(''),
	width: z.number().int().optional(),
	height: z.number().int().optional(),
});

/**
 * Generic editorial pages — About, Contact, Where to Stay parent, etc.
 * Migrated 1:1 from the 14 WP pages (minus the home page which is bespoke).
 */
const pages = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
	schema: z.object({
		title: z.string(),
		subtitle: z.string().optional(),
		slug: z.string().optional(),
		hero_image: imageSchema.optional(),
		menu_order: z.number().int().default(0),
		updated: z.coerce.date().optional(),
		seo: seoSchema,
	}),
});

/**
 * Eating venues — cafes, pubs, restaurants. ~18 entries.
 */
const eating = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/eating' }),
	schema: z.object({
		title: z.string(),
		summary: z.string().optional(),
		photo: imageSchema.optional(),
		gallery: z.array(imageSchema).default([]),
		website: z.string().url().optional(),
		phone: z.string().optional(),
		address: z.string().optional(),
		dog_friendly: z.boolean().default(false),
		geo: geoSchema,
		trip_advisor_link: z.string().url().optional(),
		facebook_link: z.string().url().optional(),
		published: z.coerce.date().optional(),
		seo: seoSchema,
	}),
});

/**
 * Things to do — attractions, activities, experiences. ~11 entries.
 */
const thingsToDo = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/things-to-do' }),
	schema: z.object({
		title: z.string(),
		subtitle: z.string().optional(),
		summary: z.string().optional(),
		hero_image: imageSchema.optional(),
		gallery: z.array(imageSchema).default([]),
		website: z.string().url().optional(),
		phone: z.string().optional(),
		address: z.string().optional(),
		grid_reference: z.string().optional(),
		geo: geoSchema,
		social: z
			.object({
				facebook: z.string().url().optional(),
				twitter: z.string().url().optional(),
				instagram: z.string().url().optional(),
				youtube: z.string().url().optional(),
			})
			.optional(),
		facilities: z.array(z.string()).default([]),
		published: z.coerce.date().optional(),
		seo: seoSchema,
	}),
});

/**
 * Stay categories — replaces 59 individual accommodation listings.
 * Each markdown is a category landing page with intro, external booking
 * search links, and an optional `featured` array for future affiliate /
 * sponsored placements.
 */
const stayCategories = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/stay-categories' }),
	schema: z.object({
		title: z.string(),
		subtitle: z.string().optional(),
		slug: z.string(),
		intro: z.string(),
		hero_image: imageSchema.optional(),
		menu_order: z.number().int().default(0),
		booking_search_links: z
			.array(
				z.object({
					label: z.string(),
					url: z.string().url(),
					note: z.string().optional(),
				})
			)
			.default([]),
		featured: z
			.array(
				z.object({
					name: z.string(),
					summary: z.string(),
					url: z.string().url(),
					image: imageSchema.optional(),
					sponsored: z.boolean().default(false),
					affiliate_id: z.string().optional(),
				})
			)
			.default([]),
		seo: seoSchema,
	}),
});

export const collections = {
	pages,
	eating,
	'things-to-do': thingsToDo,
	'stay-categories': stayCategories,
};
