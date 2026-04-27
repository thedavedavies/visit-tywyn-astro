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
 * `stale: true` so the widget can show a subtle indicator. This
 * matches the WP behaviour where the cache survived API outages.
 */

import weatherJson from '../data/weather.json' with { type: 'json' };
import tidesJson from '../data/tides.json' with { type: 'json' };

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

function isStale(fetchedAt: string | undefined, ttlMs: number): boolean {
	if (!fetchedAt) return true;
	const ts = Date.parse(fetchedAt);
	if (Number.isNaN(ts)) return true;
	return Date.now() - ts > ttlMs;
}

export function getWeatherSnapshot(): WeatherSnapshot | null {
	const snap = weatherJson as Partial<WeatherSnapshot>;
	if (!snap.fetchedAt || snap.tempC === undefined) return null;
	return {
		...(snap as WeatherSnapshot),
		stale: isStale(snap.fetchedAt, 6 * HOUR),
	};
}

export function getTidesSnapshot(): TidesSnapshot | null {
	const snap = tidesJson as Partial<TidesSnapshot>;
	if (!snap.fetchedAt || !Array.isArray(snap.upcoming) || snap.upcoming.length === 0) {
		return null;
	}
	return {
		...(snap as TidesSnapshot),
		stale: isStale(snap.fetchedAt, 12 * HOUR),
	};
}
