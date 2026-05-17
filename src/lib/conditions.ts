/**
 * Weather + tides data access. Mirrors the WP `inc/sidebar-conditions.php`
 * helpers but reads from build-time JSON snapshots rather than the
 * database.
 *
 * The snapshots are written by `tools/refresh-conditions.ts`, which can
 * be run:
 *   - manually (`npm run refresh:conditions`),
 *   - in CI before each build,
 *   - or by a scheduled job that commits the JSON back so the next
 *     deploy carries fresh data.
 *
 * If a snapshot is older than the TTL we still return it but flag
 * `stale: true` so the widget can show a subtle indicator. If the
 * snapshot is malformed (manual edit, corrupt write, schema drift on
 * the upstream API) we return null so the widget renders its
 * graceful "loading" fallback instead of `undefined` slots.
 */

import { z } from 'astro:content';
import weatherJson from '../data/weather.json' with { type: 'json' };
import tidesJson from '../data/tides.json' with { type: 'json' };

const WeatherSchema = z.object({
	fetchedAt: z.string(),
	location: z.string(),
	summary: z.string(),
	tempC: z.number().nullable(),
	feelsLikeC: z.number().nullable(),
	windMph: z.number().nullable(),
	windDir: z.string().nullable(),
	rainChance: z.number().nullable(),
	observedLabel: z.string(),
});

const TideEventSchema = z.object({
	type: z.enum(['high', 'low']),
	timeIso: z.string(),
	timeLabel: z.string(),
	heightM: z.number(),
});

const TidesSchema = z.object({
	fetchedAt: z.string(),
	station: z.string(),
	upcoming: z.array(TideEventSchema),
});

export interface WeatherSnapshot {
	fetchedAt: string;
	location: string;
	summary: string;
	tempC: number | null;
	feelsLikeC: number | null;
	windMph: number | null;
	windDir: string | null;
	rainChance: number | null;
	observedLabel: string;
	stale?: boolean;
}

export interface TideEvent {
	type: 'high' | 'low';
	timeIso: string;
	timeLabel: string;
	heightM: number;
}

export interface TidesSnapshot {
	fetchedAt: string;
	station: string;
	upcoming: TideEvent[];
	stale?: boolean;
}

const HOUR = 60 * 60 * 1000;

function isStale(fetchedAt: string, ttlMs: number): boolean {
	const ts = Date.parse(fetchedAt);
	if (Number.isNaN(ts)) return true;
	return Date.now() - ts > ttlMs;
}

export function getWeatherSnapshot(): WeatherSnapshot | null {
	const parsed = WeatherSchema.safeParse(weatherJson);
	if (!parsed.success) return null;
	return {
		...parsed.data,
		stale: isStale(parsed.data.fetchedAt, 6 * HOUR),
	};
}

export function getTidesSnapshot(now: Date = new Date()): TidesSnapshot | null {
	const parsed = TidesSchema.safeParse(tidesJson);
	if (!parsed.success) return null;
	// Drop events that are already in the past at render time. The
	// snapshot was filtered at write time, but a stale cache (failed
	// cron, no fresh build) can leave every entry behind us. Rendering
	// "next high tide: yesterday 11:00" with a subtle "stale" badge is
	// worse than rendering the graceful loading state.
	const nowMs = now.getTime();
	const upcoming: TideEvent[] = parsed.data.upcoming.filter((ev) => {
		const t = Date.parse(ev.timeIso);
		return Number.isFinite(t) && t >= nowMs;
	});
	if (upcoming.length === 0) return null;
	return {
		...parsed.data,
		upcoming,
		stale: isStale(parsed.data.fetchedAt, 12 * HOUR),
	};
}
