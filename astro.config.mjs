// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://visit-tywyn.co.uk',
	output: 'static',
	trailingSlash: 'always',
	build: {
		format: 'directory',
	},
	prefetch: {
		prefetchAll: false,
		defaultStrategy: 'hover',
	},
	integrations: [
		sitemap({
			// Exact match — `.includes('/404')` would catch any URL
			// containing that substring (e.g. a future `/404-redirect/`).
			filter: (page) => page !== 'https://visit-tywyn.co.uk/404/',
			// Set per-route priority + changefreq based on URL pattern,
			// so the home page and high-traffic listings outrank deep
			// editorial content in crawl prioritisation.
			//
			// `lastmod` is intentionally NOT set globally. The previous
			// `lastmod: new Date()` stamped every URL with the same
			// build timestamp, which destroyed per-page freshness
			// signal. Until per-entry timestamps are wired through
			// from frontmatter `updated` dates (follow-up), it's
			// better to omit lastmod entirely than ship a fake one.
			serialize: (item) => {
				const url = item.url;
				if (url === 'https://visit-tywyn.co.uk/') {
					return { ...item, priority: 1.0, changefreq: 'daily' };
				}
				if (
					/\/(eating|things-to-do|where-to-stay|events|holiday-accommodation)\/?$/.test(url) ||
					/\/holiday-accommodation\/[^/]+\/$/.test(url)
				) {
					return { ...item, priority: 0.9, changefreq: 'weekly' };
				}
				if (/\/(eating|things-to-do)\/[^/]+\/$/.test(url)) {
					return { ...item, priority: 0.8, changefreq: 'monthly' };
				}
				return { ...item, priority: 0.6, changefreq: 'monthly' };
			},
		}),
	],
	image: {
		// Allow remote images from the legacy S3 bucket and uploads dir during migration.
		domains: ['visit-tywyn.s3.amazonaws.com', 'visit-tywyn.co.uk'],
	},
	vite: {
		css: {
			preprocessorOptions: {
				scss: {
					api: 'modern-compiler',
				},
			},
		},
	},
});
