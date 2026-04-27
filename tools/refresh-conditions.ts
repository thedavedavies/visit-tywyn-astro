/**
 * Refresh src/data/weather.json and src/data/tides.json from the
 * upstream APIs.
 *
 * Run with `npm run refresh:conditions`. Safe to run repeatedly.
 *
 * This is the build-time equivalent of the WP `vt_sidebar_*_cache`
 * options. Outputs are tiny (<2KB) and meant to be committed so the
 * deploy carries a known-good snapshot if the next refresh fails.
 *
 * Sources:
 *   - Open-Meteo  (CORS-friendly, no key) for current conditions
 *   - Admiralty EasyTide (no CORS) for upcoming tide events
 *
 * Behaviour on failure:
 *   - We never overwrite an existing JSON with garbage. If the API
 *     returns an error or shape we don't recognise, we keep the old
 *     snapshot in place. This way a deploy run by CI doesn't end up
 *     publishing an empty widget.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const WEATHER_OUT = path.join(PROJECT_ROOT, 'src/data/weather.json');
const TIDES_OUT = path.join(PROJECT_ROOT, 'src/data/tides.json');

const LAT = 52.58643;
const LNG = -4.08916;
const TIDE_STATION = '0486'; // Aberdovey — closest reliable EasyTide station to Tywyn

const TZ = 'Europe/London';
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZone: TZ,
});
const DAYTIME_FMT = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZone: TZ,
});

// Open-Meteo / WMO weather code → friendly label.
const WEATHER_LABELS: Record<number, [string, string]> = {
	0: ['Clear sky', 'Clear night'],
	1: ['Mainly clear', 'Mainly clear'],
	2: ['Partly cloudy', 'Partly cloudy'],
	3: ['Overcast', 'Overcast'],
	45: ['Fog', 'Fog'],
	48: ['Freezing fog', 'Freezing fog'],
	51: ['Light drizzle', 'Light drizzle'],
	53: ['Drizzle', 'Drizzle'],
	55: ['Heavy drizzle', 'Heavy drizzle'],
	56: ['Light freezing drizzle', 'Light freezing drizzle'],
	57: ['Freezing drizzle', 'Freezing drizzle'],
	61: ['Light rain', 'Light rain'],
	63: ['Rain', 'Rain'],
	65: ['Heavy rain', 'Heavy rain'],
	66: ['Light freezing rain', 'Light freezing rain'],
	67: ['Freezing rain', 'Freezing rain'],
	71: ['Light snow', 'Light snow'],
	73: ['Snow', 'Snow'],
	75: ['Heavy snow', 'Heavy snow'],
	77: ['Snow grains', 'Snow grains'],
	80: ['Light showers', 'Light showers'],
	81: ['Showers', 'Showers'],
	82: ['Heavy showers', 'Heavy showers'],
	85: ['Light snow showers', 'Light snow showers'],
	86: ['Snow showers', 'Snow showers'],
	95: ['Thunderstorm', 'Thunderstorm'],
	96: ['Thunderstorm w/ hail', 'Thunderstorm w/ hail'],
	99: ['Severe thunderstorm', 'Severe thunderstorm'],
};

function compass(deg: number | null | undefined): string | null {
	if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
	const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	const idx = Math.round(((deg % 360) / 22.5)) % 16;
	return dirs[idx]!;
}

interface OpenMeteoResponse {
	current?: {
		time?: string;
		temperature_2m?: number;
		apparent_temperature?: number;
		wind_speed_10m?: number;
		wind_direction_10m?: number;
		weather_code?: number;
		is_day?: number;
	};
	hourly?: {
		time?: string[];
		precipitation_probability?: number[];
	};
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers ?? {}),
			'user-agent': 'visit-tywyn-astro/1.0 (+https://visit-tywyn.co.uk)',
			accept: 'application/json',
		},
	});
	if (!res.ok) {
		throw new Error(`${url}: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as T;
}

async function refreshWeather(): Promise<void> {
	const params = new URLSearchParams({
		latitude: String(LAT),
		longitude: String(LNG),
		timezone: TZ,
		forecast_days: '1',
		temperature_unit: 'celsius',
		wind_speed_unit: 'mph',
		current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day',
		hourly: 'precipitation_probability',
	});
	const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

	let response: OpenMeteoResponse;
	try {
		response = await fetchJson<OpenMeteoResponse>(url);
	} catch (err) {
		console.error('  weather: fetch failed —', err instanceof Error ? err.message : err);
		console.error('  weather: keeping previous snapshot');
		return;
	}

	const cur = response.current;
	if (!cur || cur.time === undefined) {
		console.error('  weather: response missing `current` block, keeping previous snapshot');
		return;
	}

	const code = typeof cur.weather_code === 'number' ? cur.weather_code : null;
	const isDay = !!cur.is_day;
	const labelPair = code !== null ? WEATHER_LABELS[code] : undefined;
	const summary = labelPair ? (isDay ? labelPair[0] : labelPair[1]) : 'Conditions unknown';

	let rainChance: number | null = null;
	const hourly = response.hourly;
	if (hourly?.time && hourly.precipitation_probability) {
		const idx = hourly.time.indexOf(cur.time);
		if (idx >= 0 && typeof hourly.precipitation_probability[idx] === 'number') {
			rainChance = Math.round(hourly.precipitation_probability[idx]!);
		}
	}

	const observedDate = new Date(cur.time);
	const observedLabel = TIME_FMT.format(observedDate);

	const snapshot = {
		fetchedAt: new Date().toISOString(),
		location: 'Tywyn beach',
		summary,
		tempC: typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null,
		feelsLikeC: typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : null,
		windMph: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
		windDir: compass(cur.wind_direction_10m),
		rainChance,
		observedLabel,
	};

	fs.writeFileSync(WEATHER_OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
	console.log(`  weather: ${snapshot.tempC?.toFixed(0)}°C ${snapshot.summary} (rain ${snapshot.rainChance ?? '–'}%)`);
}

interface EasyTideEvent {
	dateTime?: string;
	eventType?: number; // 0 = high, 1 = low
	height?: number;
}

interface EasyTideResponse {
	tidalEventList?: EasyTideEvent[];
}

async function refreshTides(): Promise<void> {
	const url = `https://easytide.admiralty.co.uk/Home/GetPredictionData?stationId=${encodeURIComponent(TIDE_STATION)}`;

	let response: EasyTideResponse;
	try {
		response = await fetchJson<EasyTideResponse>(url);
	} catch (err) {
		console.error('  tides: fetch failed —', err instanceof Error ? err.message : err);
		console.error('  tides: keeping previous snapshot');
		return;
	}

	if (!Array.isArray(response.tidalEventList)) {
		console.error('  tides: response missing `tidalEventList`, keeping previous snapshot');
		return;
	}

	const now = Date.now();
	const upcoming = response.tidalEventList
		.flatMap((ev) => {
			if (!ev.dateTime || ev.eventType === undefined) return [];
			const t = Date.parse(ev.dateTime);
			if (!Number.isFinite(t) || t < now) return [];
			const type: 'high' | 'low' = ev.eventType === 0 ? 'high' : 'low';
			const date = new Date(t);
			return [
				{
					type,
					timeIso: date.toISOString(),
					timeLabel: DAYTIME_FMT.format(date),
					heightM: typeof ev.height === 'number' ? ev.height : 0,
				},
			];
		})
		.slice(0, 6);

	if (upcoming.length === 0) {
		console.error('  tides: no upcoming events, keeping previous snapshot');
		return;
	}

	const snapshot = {
		fetchedAt: new Date().toISOString(),
		station: 'Tywyn',
		upcoming,
	};

	fs.writeFileSync(TIDES_OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
	console.log(`  tides: ${upcoming.length} upcoming events — next ${upcoming[0]!.type} at ${upcoming[0]!.timeLabel}`);
}

console.log('Refreshing sidebar conditions…');
await refreshWeather();
await refreshTides();
console.log('Done.');
