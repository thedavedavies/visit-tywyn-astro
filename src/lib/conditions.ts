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
 * If a snapshot is older than the TTL (SITE.conditions in site.ts,
 * shared with the refresh tool) we still return it but flag
 * `stale: true` so the widget can show a subtle indicator. If the
 * snapshot is malformed (manual edit, corrupt write, schema drift on
 * the upstream API) we return null so the widget renders its
 * graceful "loading" fallback instead of `undefined` slots.
 */

import { z } from 'astro:content';
import { SITE } from './site';
import weatherJson from '../data/weather.json' with { type: 'json' };
import tidesJson from '../data/tides.json' with { type: 'json' };

const DailyForecastSchema = z.object({
	date: z.string(),
	label: z.string(),
	code: z.number().nullable(),
	summary: z.string(),
	tempMaxC: z.number().nullable(),
	tempMinC: z.number().nullable(),
	rainChance: z.number().nullable(),
	windMph: z.number().nullable(),
	windDir: z.string().nullable(),
	sunriseIso: z.string().nullable().optional(),
	sunsetIso: z.string().nullable().optional(),
	uvIndexMax: z.number().nullable().optional(),
	precipHours: z.number().nullable().optional(),
});

const HourForecastSchema = z.object({
	timeIso: z.string(),
	label: z.string(),
	code: z.number().nullable(),
	isDay: z.boolean(),
	tempC: z.number().nullable(),
	rainChance: z.number().nullable(),
});

const WeatherSchema = z.object({
	fetchedAt: z.string(),
	location: z.string(),
	summary: z.string(),
	code: z.number().nullable().optional(),
	isDay: z.boolean().optional(),
	tempC: z.number().nullable(),
	feelsLikeC: z.number().nullable(),
	windMph: z.number().nullable(),
	windDir: z.string().nullable(),
	rainChance: z.number().nullable(),
	observedLabel: z.string(),
	pollen: z
		.object({
			label: z.string(),
			species: z.string(),
			grainsM3: z.number(),
		})
		.nullable()
		.optional(),
	seaTempC: z.number().nullable().optional(),
	gustsMph: z.number().nullable().optional(),
	humidity: z.number().nullable().optional(),
	pressureHpa: z.number().nullable().optional(),
	aqi: z.object({ value: z.number(), label: z.string() }).nullable().optional(),
	waves: z
		.object({
			heightM: z.number().nullable(),
			periodS: z.number().nullable(),
			week: z.array(z.object({ date: z.string(), heightM: z.number() })),
		})
		.nullable()
		.optional(),
	hourly: z.array(HourForecastSchema).optional(),
	daily: z.array(DailyForecastSchema).optional(),
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

export interface DailyForecast {
	date: string;
	label: string;
	code: number | null;
	summary: string;
	tempMaxC: number | null;
	tempMinC: number | null;
	rainChance: number | null;
	windMph: number | null;
	windDir: string | null;
	sunriseIso?: string | null;
	sunsetIso?: string | null;
	uvIndexMax?: number | null;
	precipHours?: number | null;
}

export interface HourForecast {
	timeIso: string;
	label: string;
	code: number | null;
	isDay: boolean;
	tempC: number | null;
	rainChance: number | null;
}

export interface WeatherSnapshot {
	fetchedAt: string;
	location: string;
	summary: string;
	code?: number | null;
	isDay?: boolean;
	tempC: number | null;
	feelsLikeC: number | null;
	windMph: number | null;
	windDir: string | null;
	rainChance: number | null;
	observedLabel: string;
	pollen?: { label: string; species: string; grainsM3: number } | null;
	seaTempC?: number | null;
	gustsMph?: number | null;
	humidity?: number | null;
	pressureHpa?: number | null;
	aqi?: { value: number; label: string } | null;
	waves?: {
		heightM: number | null;
		periodS: number | null;
		week: { date: string; heightM: number }[];
	} | null;
	hourly?: HourForecast[];
	daily?: DailyForecast[];
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

const WIND_DIRECTION_NOUNS: Record<string, string> = {
	N: 'north',
	NNE: 'north-northeast',
	NE: 'northeast',
	ENE: 'east-northeast',
	E: 'east',
	ESE: 'east-southeast',
	SE: 'southeast',
	SSE: 'south-southeast',
	S: 'south',
	SSW: 'south-southwest',
	SW: 'southwest',
	WSW: 'west-southwest',
	W: 'west',
	WNW: 'west-northwest',
	NW: 'northwest',
	NNW: 'north-northwest',
};

export function windDirectionName(dir: string | null | undefined): string | null {
	if (!dir) return null;
	const noun = WIND_DIRECTION_NOUNS[dir];
	if (!noun) return dir;
	return noun.charAt(0).toUpperCase() + noun.slice(1) + 'erly';
}

export function windDirectionFrom(dir: string | null | undefined): string | null {
	if (!dir) return null;
	const noun = WIND_DIRECTION_NOUNS[dir];
	return noun ? `from the ${noun}` : null;
}

export function windDirectionDegrees(dir: string | null | undefined): number | null {
	if (!dir) return null;
	const index = Object.keys(WIND_DIRECTION_NOUNS).indexOf(dir);
	return index === -1 ? null : index * 22.5;
}

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
		stale: isStale(parsed.data.fetchedAt, SITE.conditions.weatherStaleTtlMs),
	};
}

export function getTidesSnapshot(
	now: Date = new Date(),
	opts: { includePast?: boolean } = {},
): TidesSnapshot | null {
	const parsed = TidesSchema.safeParse(tidesJson);
	if (!parsed.success) return null;
	// Drop events that are already in the past at render time. The
	// snapshot was filtered at write time, but a stale cache (failed
	// cron, no fresh build) can leave every entry behind us. Rendering
	// "next high tide: yesterday 11:00" with a subtle "stale" badge is
	// worse than rendering the graceful loading state. The tide chart
	// passes `includePast` to keep the snapshot's ~30h of history so
	// the curve has context behind the "now" marker.
	const cutoffMs = opts.includePast ? now.getTime() - 30 * 60 * 60 * 1000 : now.getTime();
	const upcoming: TideEvent[] = parsed.data.upcoming.filter((ev) => {
		const t = Date.parse(ev.timeIso);
		return Number.isFinite(t) && t >= cutoffMs;
	});
	if (upcoming.length === 0) return null;
	return {
		...parsed.data,
		upcoming,
		stale: isStale(parsed.data.fetchedAt, SITE.conditions.tidesStaleTtlMs),
	};
}
