const UPSTREAM_ORIGIN = 'https://environment.data.gov.uk';
const ALLOWED_PREFIX = '/wales/bathing-waters/';

export class UkFetcher {
	async fetch(request) {
		const { pathname } = new URL(request.url);
		const upstream = await fetch(`${UPSTREAM_ORIGIN}${pathname}`, {
			headers: {
				accept: 'application/json',
				'user-agent': 'visit-tywyn-astro/1.0 (+https://visit-tywyn.co.uk)',
			},
		});
		console.log(`${pathname}: upstream ${upstream.status}`);
		if (!upstream.ok) {
			return Response.json(
				{ error: 'upstream refused', upstreamStatus: upstream.status },
				{ status: 502 },
			);
		}
		return new Response(upstream.body, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);
		if (request.method !== 'GET' || !pathname.startsWith(ALLOWED_PREFIX)) {
			return new Response('Not found', { status: 404 });
		}
		const stub = env.UK_FETCHER.get(env.UK_FETCHER.idFromName('uk'), { locationHint: 'weur' });
		return stub.fetch(request);
	},
};
