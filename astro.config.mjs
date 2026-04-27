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
			// Don't index the 404 page or any redirected legacy URLs.
			filter: (page) => !page.includes('/404'),
			// Set per-route priority + changefreq based on URL pattern,
			// so the home page and high-traffic listings outrank deep
			// editorial content in crawl prioritisation.
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
			lastmod: new Date(),
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
