const UPSTREAM_ORIGIN = 'https://environment.data.gov.uk';
const ALLOWED_PREFIX = '/wales/bathing-waters/';

export default {
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (request.method !== 'GET' || !pathname.startsWith(ALLOWED_PREFIX)) {
			return new Response('Not found', { status: 404 });
		}
		const upstream = await fetch(`${UPSTREAM_ORIGIN}${pathname}`, {
			headers: {
				accept: 'application/json',
				'user-agent': 'visit-tywyn-astro/1.0 (+https://visit-tywyn.co.uk)',
			},
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: { 'content-type': 'application/json' },
		});
	},
};
