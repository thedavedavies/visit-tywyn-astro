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
			changefreq: 'weekly',
			priority: 0.7,
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
