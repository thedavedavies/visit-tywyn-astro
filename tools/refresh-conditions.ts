/**
 * Refresh src/data/weather.json and src/data/tides.json from the
 * upstream APIs.
 *
 * Run with `npm run refresh:conditions`. Safe to run repeatedly: a
 * source whose snapshot is younger than REFRESH_AFTER_MS is skipped,
 * so the scheduled workflow can tick every 30 minutes (cheap no-ops)
 * while data is actually fetched, committed, and deployed on a ~3h
 * cadence. Set FORCE_REFRESH=1 to bypass the freshness check.
 *
 * This is the build-time equivalent of the WP `vt_sidebar_*_cache`
 * options. Outputs are tiny (<2KB) and meant to be committed so the
 * deploy carries a known-good snapshot if the next refresh fails.
 *
 * Sources:
 *   - Open-Meteo  (CORS-friendly, no key) for current conditions and
 *     the 7-day daily forecast (/weather/)
 *   - Admiralty EasyTide (no CORS) for the week's tide events
 *     (/tide-times/ and the sidebar widget)
 *   - Natural Resources Wales bathing water quality (daily cadence:
 *     an annual classification plus periodic in-season samples)
 *
 * Behaviour on failure:
 *   - Each fetch gets a few attempts with backoff, so a transient 502
 *     or one slow response doesn't sink the run (Open-Meteo had a
 *     morning of exactly that on 2026-06-11).
 *   - We never overwrite an existing JSON with garbage. If an API
 *     still fails after the retries, or returns a shape we don't
 *     recognise, we keep the old snapshot in place. The other source
 *     is refreshed and committed independently, and the next 30-min
 *     tick retries the failed one because its snapshot stayed old.
 *   - The process exits non-zero only when a failing source's
 *     snapshot has outlived its serving TTL (SITE.conditions, the
 *     same thresholds the widgets use for the "last good reading"
 *     badge). Red CI therefore means "visitors are seeing data we
 *     consider too old", not "one upstream request blipped".
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SITE } from '../src/lib/site.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const WEATHER_OUT = path.join(PROJECT_ROOT, 'src/data/weather.json');
const TIDES_OUT = path.join(PROJECT_ROOT, 'src/data/tides.json');
const WATER_OUT = path.join(PROJECT_ROOT, 'src/data/water-quality.json');

const LAT = SITE.location.lat;
const LNG = SITE.location.lng;
const TIDE_STATION = SITE.location.tideStationId;
const BATHING_WATER_ID = SITE.location.bathingWaterId;

const TZ = 'Europe/London';
// 20s rather than 15s: during the 2026-06-11 Open-Meteo degradation,
// otherwise-healthy responses took 17-58s. Still bounded well inside
// the workflow's 5-minute job timeout even at three attempts.
const FETCH_TIMEOUT_MS = 20_000;
// Pauses between fetch attempts; total attempts = length + 1.
const RETRY_DELAYS_MS = [5_000, 15_000];
// Skip a source whose snapshot is younger than this. With the
// workflow ticking every 30 minutes this gives an effective ~3h
// refresh cadence, and a ~30-minute retry loop while a source fails.
const REFRESH_AFTER_MS = 165 * 60 * 1000; // 2h45m
const WATER_REFRESH_AFTER_MS = 20 * 60 * 60 * 1000; // ~daily
const FORCE_REFRESH = process.env.FORCE_REFRESH === '1';
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
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	timeZone: TZ,
});
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
	hour: 'numeric',
	hour12: true,
	timeZone: TZ,
});

// Open-Meteo / WMO weather code => friendly label.
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
	const dirs = [
		'N',
		'NNE',
		'NE',
		'ENE',
		'E',
		'ESE',
		'SE',
		'SSE',
		'S',
		'SSW',
		'SW',
		'WSW',
		'W',
		'WNW',
		'NW',
		'NNW',
	];
	const idx = Math.round((deg % 360) / 22.5) % 16;
	return dirs[idx]!;
}

// Grains/m3 band edges [low<, moderate<, high<], else "very high".
// Grass and birch edges follow the Met Office scales; other trees
// borrow birch's, weeds borrow grass's as the nearest published fit.
const POLLEN_SPECIES: { key: string; name: string; edges: [number, number, number] }[] = [
	{ key: 'grass_pollen', name: 'grass', edges: [30, 50, 150] },
	{ key: 'birch_pollen', name: 'birch', edges: [41, 81, 201] },
	{ key: 'alder_pollen', name: 'alder', edges: [41, 81, 201] },
	{ key: 'olive_pollen', name: 'olive', edges: [41, 81, 201] },
	{ key: 'mugwort_pollen', name: 'mugwort', edges: [30, 50, 150] },
	{ key: 'ragweed_pollen', name: 'ragweed', edges: [30, 50, 150] },
];
const POLLEN_LABELS = ['Low', 'Moderate', 'High', 'Very high'] as const;

interface AirSnapshot {
	pollen: PollenSnapshot | null;
	aqi: { value: number; label: string } | null;
}

interface PollenSnapshot {
	label: (typeof POLLEN_LABELS)[number];
	species: string;
	grainsM3: number;
}

async function fetchAir(): Promise<AirSnapshot> {
	const params = new URLSearchParams({
		latitude: String(LAT),
		longitude: String(LNG),
		current: [...POLLEN_SPECIES.map((s) => s.key), 'european_aqi'].join(','),
	});
	const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;
	try {
		const response = await fetchJsonWithRetry<{ current?: Record<string, unknown> }>('pollen', url);
		const cur = response.current;
		if (!cur) return { pollen: null, aqi: null };
		let aqi: AirSnapshot['aqi'] = null;
		const aqiValue = cur['european_aqi'];
		if (typeof aqiValue === 'number' && Number.isFinite(aqiValue)) {
			aqi = {
				value: Math.round(aqiValue),
				label:
					aqiValue <= 20
						? 'Good'
						: aqiValue <= 40
							? 'Fair'
							: aqiValue <= 60
								? 'Moderate'
								: aqiValue <= 80
									? 'Poor'
									: aqiValue <= 100
										? 'Very poor'
										: 'Extremely poor',
			};
		}
		let worst: (PollenSnapshot & { bandIndex: number }) | null = null;
		for (const species of POLLEN_SPECIES) {
			const grains = cur[species.key];
			if (typeof grains !== 'number' || !Number.isFinite(grains) || grains < 0) continue;
			const bandIndex = species.edges.findIndex((edge) => grains < edge);
			const idx = bandIndex === -1 ? 3 : bandIndex;
			if (!worst || idx > worst.bandIndex || (idx === worst.bandIndex && grains > worst.grainsM3)) {
				worst = {
					label: POLLEN_LABELS[idx]!,
					species: species.name,
					grainsM3: grains,
					bandIndex: idx,
				};
			}
		}
		return {
			pollen: worst
				? { label: worst.label, species: worst.species, grainsM3: worst.grainsM3 }
				: null,
			aqi,
		};
	} catch (err) {
		console.error('  pollen: fetch failed, omitting:', err instanceof Error ? err.message : err);
		return { pollen: null, aqi: null };
	}
}

interface MarineSnapshot {
	seaTempC: number | null;
	waveHeightM: number | null;
	wavePeriodS: number | null;
	waveWeek: { date: string; heightM: number }[];
}

async function fetchMarine(): Promise<MarineSnapshot> {
	const empty: MarineSnapshot = {
		seaTempC: null,
		waveHeightM: null,
		wavePeriodS: null,
		waveWeek: [],
	};
	const params = new URLSearchParams({
		latitude: String(LAT),
		longitude: String(LNG),
		timezone: TZ,
		current: 'sea_surface_temperature,wave_height,wave_period',
		daily: 'wave_height_max',
	});
	const url = `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;
	try {
		const response = await fetchJsonWithRetry<{
			current?: { sea_surface_temperature?: number; wave_height?: number; wave_period?: number };
			daily?: { time?: string[]; wave_height_max?: number[] };
		}>('sea', url);
		const cur = response.current;
		const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		const waveWeek = (response.daily?.time ?? []).flatMap((date, i) => {
			const h = num(response.daily?.wave_height_max?.[i]);
			return h === null ? [] : [{ date, heightM: h }];
		});
		return {
			seaTempC: num(cur?.sea_surface_temperature),
			waveHeightM: num(cur?.wave_height),
			wavePeriodS: num(cur?.wave_period),
			waveWeek,
		};
	} catch (err) {
		console.error('  sea: fetch failed, omitting:', err instanceof Error ? err.message : err);
		return empty;
	}
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
		relative_humidity_2m?: number;
		pressure_msl?: number;
		wind_gusts_10m?: number;
	};
	hourly?: {
		time?: string[];
		precipitation_probability?: number[];
		temperature_2m?: number[];
		weather_code?: number[];
		is_day?: number[];
	};
	daily?: {
		time?: string[];
		weather_code?: number[];
		temperature_2m_max?: number[];
		temperature_2m_min?: number[];
		precipitation_probability_max?: number[];
		wind_speed_10m_max?: number[];
		wind_direction_10m_dominant?: number[];
		sunrise?: string[];
		sunset?: string[];
		uv_index_max?: number[];
		precipitation_hours?: number[];
	};
	utc_offset_seconds?: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			...init,
			signal: controller.signal,
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
	} finally {
		clearTimeout(timer);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Age of the snapshot already on disk, from its `fetchedAt`. Missing,
// unreadable, or unparseable snapshots count as infinitely old, so they
// are always refreshed and always alarm while the refresh keeps failing.
function snapshotAgeMs(file: string): number {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { fetchedAt?: unknown };
		const ts = typeof raw.fetchedAt === 'string' ? Date.parse(raw.fetchedAt) : NaN;
		return Number.isFinite(ts) ? Date.now() - ts : Infinity;
	} catch {
		return Infinity;
	}
}

function formatAge(ms: number): string {
	if (!Number.isFinite(ms)) return 'missing/unreadable';
	const mins = Math.max(0, Math.round(ms / 60_000));
	if (mins < 60) return `${mins}m`;
	return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
}

async function fetchJsonWithRetry<T>(name: string, url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetchJson<T>(url);
		} catch (err) {
			const delay = RETRY_DELAYS_MS[attempt];
			if (delay === undefined) throw err;
			console.error(
				`  ${name}: attempt ${attempt + 1} failed (${err instanceof Error ? err.message : err}); retrying in ${delay / 1000}s`,
			);
			await sleep(delay);
		}
	}
}

async function refreshWeather(): Promise<boolean> {
	const params = new URLSearchParams({
		latitude: String(LAT),
		longitude: String(LNG),
		timezone: TZ,
		forecast_days: '8',
		temperature_unit: 'celsius',
		wind_speed_unit: 'mph',
		current:
			'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day,relative_humidity_2m,pressure_msl,wind_gusts_10m',
		hourly: 'precipitation_probability,temperature_2m,weather_code,is_day',
		daily:
			'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset,uv_index_max,precipitation_hours',
	});
	const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

	let response: OpenMeteoResponse;
	try {
		response = await fetchJsonWithRetry<OpenMeteoResponse>('weather', url);
	} catch (err) {
		console.error(
			'  weather: all fetch attempts failed:',
			err instanceof Error ? err.message : err,
		);
		return false;
	}

	const cur = response.current;
	if (!cur || cur.time === undefined) {
		console.error('  weather: response missing `current` block, keeping previous snapshot');
		return false;
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
	const [air, marine] = await Promise.all([fetchAir(), fetchMarine()]);

	const d = response.daily;
	const offsetMs = (response.utc_offset_seconds ?? 0) * 1000;
	const localIsoToUtc = (naive: string | undefined): string | null => {
		if (!naive) return null;
		const ms = Date.parse(`${naive}Z`);
		return Number.isFinite(ms) ? new Date(ms - offsetMs).toISOString() : null;
	};
	const daily = (d?.time ?? []).flatMap((date, i) => {
		const dayMs = Date.parse(`${date}T12:00:00Z`);
		if (!Number.isFinite(dayMs)) return [];
		const dayCode = typeof d?.weather_code?.[i] === 'number' ? d.weather_code[i]! : null;
		const dayLabels = dayCode !== null ? WEATHER_LABELS[dayCode] : undefined;
		return [
			{
				date,
				label: DAY_FMT.format(new Date(dayMs)),
				code: dayCode,
				summary: dayLabels ? dayLabels[0] : 'Conditions unknown',
				tempMaxC: typeof d?.temperature_2m_max?.[i] === 'number' ? d.temperature_2m_max[i]! : null,
				tempMinC: typeof d?.temperature_2m_min?.[i] === 'number' ? d.temperature_2m_min[i]! : null,
				rainChance:
					typeof d?.precipitation_probability_max?.[i] === 'number'
						? Math.round(d.precipitation_probability_max[i]!)
						: null,
				windMph: typeof d?.wind_speed_10m_max?.[i] === 'number' ? d.wind_speed_10m_max[i]! : null,
				windDir: compass(d?.wind_direction_10m_dominant?.[i]),
				sunriseIso: localIsoToUtc(d?.sunrise?.[i]),
				sunsetIso: localIsoToUtc(d?.sunset?.[i]),
				uvIndexMax: typeof d?.uv_index_max?.[i] === 'number' ? d.uv_index_max[i]! : null,
				precipHours:
					typeof d?.precipitation_hours?.[i] === 'number' ? d.precipitation_hours[i]! : null,
			},
		];
	});

	const h = response.hourly;
	const nowMs = Date.now();
	const hourlyToday = (h?.time ?? [])
		.flatMap((t, i) => {
			const ms = Date.parse(`${t}:00Z`) - offsetMs;
			if (!Number.isFinite(ms) || ms < nowMs - 30 * 60_000) return [];
			return [
				{
					timeIso: new Date(ms).toISOString(),
					label: HOUR_FMT.format(new Date(ms)).replace(/\s/g, ''),
					code: typeof h?.weather_code?.[i] === 'number' ? h.weather_code[i]! : null,
					isDay: !!h?.is_day?.[i],
					tempC: typeof h?.temperature_2m?.[i] === 'number' ? h.temperature_2m[i]! : null,
					rainChance:
						typeof h?.precipitation_probability?.[i] === 'number'
							? Math.round(h.precipitation_probability[i]!)
							: null,
				},
			];
		})
		.slice(0, 8);

	const snapshot = {
		fetchedAt: new Date().toISOString(),
		location: 'Tywyn beach',
		summary,
		code,
		isDay,
		tempC: typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null,
		feelsLikeC: typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : null,
		windMph: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
		windDir: compass(cur.wind_direction_10m),
		gustsMph: typeof cur.wind_gusts_10m === 'number' ? cur.wind_gusts_10m : null,
		humidity: typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null,
		pressureHpa: typeof cur.pressure_msl === 'number' ? Math.round(cur.pressure_msl) : null,
		rainChance,
		observedLabel,
		pollen: air.pollen,
		aqi: air.aqi,
		seaTempC: marine.seaTempC,
		waves:
			marine.waveHeightM !== null || marine.waveWeek.length
				? { heightM: marine.waveHeightM, periodS: marine.wavePeriodS, week: marine.waveWeek }
				: null,
		hourly: hourlyToday,
		daily,
	};

	fs.writeFileSync(WEATHER_OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
	console.log(
		`  weather: ${snapshot.tempC?.toFixed(0)}C ${snapshot.summary} (rain ${snapshot.rainChance ?? '-'}%, ${daily.length} forecast days)`,
	);
	return true;
}

interface BathingWaterRecord {
	result?: {
		primaryTopic?: {
			name?: { _value?: string };
			yearDesignated?: string;
			waterQualityImpactedByHeavyRain?: boolean;
			latestSampleAssessment?: string;
			latestComplianceAssessment?: {
				_about?: string;
				complianceClassification?: { name?: { _value?: string } };
			};
		};
	};
}

interface SampleRecord {
	result?: {
		primaryTopic?: {
			escherichiaColiCount?: number;
			escherichiaColiQualifier?: { countQualifierNotation?: string };
			intestinalEnterococciCount?: number;
			intestinalEnterococciQualifier?: { countQualifierNotation?: string };
			sampleDateTime?: { inXSDDateTime?: { _value?: string } };
		};
	};
}

function classificationYear(uri: string | undefined): number | null {
	const match = /\/year\/(\d{4})/.exec(uri ?? '');
	return match ? Number(match[1]) : null;
}

async function refreshWaterQuality(): Promise<boolean> {
	const base = 'https://environment.data.gov.uk/wales/bathing-waters';
	const url = `${base}/id/bathing-water/${encodeURIComponent(BATHING_WATER_ID)}.json`;

	let record: BathingWaterRecord;
	try {
		record = await fetchJsonWithRetry<BathingWaterRecord>('water', url);
	} catch (err) {
		console.error('  water: all fetch attempts failed:', err instanceof Error ? err.message : err);
		return false;
	}

	const topic = record.result?.primaryTopic;
	const classification = topic?.latestComplianceAssessment?.complianceClassification?.name?._value;
	if (!topic || !classification) {
		console.error('  water: response missing compliance classification, keeping previous snapshot');
		return false;
	}

	let sample: {
		takenIso: string;
		eColi: number | null;
		eColiQualifier: string;
		enterococci: number | null;
		enterococciQualifier: string;
	} | null = null;
	if (typeof topic.latestSampleAssessment === 'string') {
		try {
			const raw = await fetchJsonWithRetry<SampleRecord>(
				'water sample',
				`${topic.latestSampleAssessment}.json`,
			);
			const s = raw.result?.primaryTopic;
			const taken = s?.sampleDateTime?.inXSDDateTime?._value;
			if (s && taken && Number.isFinite(Date.parse(`${taken}Z`))) {
				sample = {
					takenIso: new Date(Date.parse(`${taken}Z`)).toISOString(),
					eColi: typeof s.escherichiaColiCount === 'number' ? s.escherichiaColiCount : null,
					eColiQualifier: s.escherichiaColiQualifier?.countQualifierNotation ?? '=',
					enterococci:
						typeof s.intestinalEnterococciCount === 'number' ? s.intestinalEnterococciCount : null,
					enterococciQualifier: s.intestinalEnterococciQualifier?.countQualifierNotation ?? '=',
				};
			}
		} catch (err) {
			console.error(
				'  water: classification kept, latest sample unavailable:',
				err instanceof Error ? err.message : err,
			);
		}
	}

	const snapshot = {
		fetchedAt: new Date().toISOString(),
		site: topic.name?._value ?? 'Tywyn',
		classification,
		classificationYear: classificationYear(topic.latestComplianceAssessment?._about),
		rainImpacted: topic.waterQualityImpactedByHeavyRain === true,
		sample,
	};

	fs.writeFileSync(WATER_OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
	console.log(
		`  water: ${snapshot.classification}` +
			(snapshot.classificationYear ? ` (${snapshot.classificationYear})` : '') +
			(sample ? `, last sampled ${sample.takenIso.slice(0, 10)}` : ', no sample data'),
	);
	return true;
}

interface EasyTideEvent {
	dateTime?: string;
	eventType?: number; // 0 = high, 1 = low
	height?: number;
}

interface EasyTideResponse {
	tidalEventList?: EasyTideEvent[];
}

function parseUkhoUtc(dateTime: string): number {
	return Date.parse(/([Zz]|[+-]\d{2}:?\d{2})$/.test(dateTime) ? dateTime : `${dateTime}Z`);
}

async function refreshTides(): Promise<boolean> {
	const url = `https://easytide.admiralty.co.uk/Home/GetPredictionData?stationId=${encodeURIComponent(TIDE_STATION)}`;

	let response: EasyTideResponse;
	try {
		response = await fetchJsonWithRetry<EasyTideResponse>('tides', url);
	} catch (err) {
		console.error('  tides: all fetch attempts failed:', err instanceof Error ? err.message : err);
		return false;
	}

	if (!Array.isArray(response.tidalEventList)) {
		console.error('  tides: response missing `tidalEventList`, keeping previous snapshot');
		return false;
	}

	const keepFrom = Date.now() - 30 * 60 * 60 * 1000;
	const upcoming = response.tidalEventList.flatMap((ev) => {
		if (!ev.dateTime || ev.eventType === undefined) return [];
		const t = parseUkhoUtc(ev.dateTime);
		if (!Number.isFinite(t) || t < keepFrom) return [];
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
	});

	if (upcoming.length === 0) {
		console.error('  tides: no upcoming events, keeping previous snapshot');
		return false;
	}

	const snapshot = {
		fetchedAt: new Date().toISOString(),
		station: 'Tywyn',
		upcoming,
	};

	fs.writeFileSync(TIDES_OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
	console.log(
		`  tides: ${upcoming.length} upcoming events, next ${upcoming[0]!.type} at ${upcoming[0]!.timeLabel}`,
	);
	return true;
}

type SourceStatus = 'refreshed' | 'fresh' | 'failed';

async function runSource(
	name: string,
	file: string,
	refresh: () => Promise<boolean>,
	refreshAfterMs: number = REFRESH_AFTER_MS,
): Promise<SourceStatus> {
	const age = snapshotAgeMs(file);
	if (!FORCE_REFRESH && age < refreshAfterMs) {
		console.log(`  ${name}: snapshot is ${formatAge(age)} old, still fresh; skipping`);
		return 'fresh';
	}
	return (await refresh()) ? 'refreshed' : 'failed';
}

// A failed refresh only fails the run once the snapshot we kept has
// outlived its serving TTL (the same threshold that makes the widgets
// show "last good reading"). Anything younger exits 0: the data on
// disk is still fine and the next 30-minute tick retries.
function failureIsAlarming(name: string, file: string, ttlMs: number): boolean {
	const age = snapshotAgeMs(file);
	if (age > ttlMs) {
		console.error(
			`  ${name}: refresh failing and the kept snapshot is ${formatAge(age)} old, ` +
				`past its ${formatAge(ttlMs)} serving TTL. Exiting non-zero so CI surfaces the outage.`,
		);
		return true;
	}
	console.error(
		`  ${name}: keeping the ${formatAge(age)}-old snapshot (within its ` +
			`${formatAge(ttlMs)} serving TTL); the next scheduled tick retries.`,
	);
	return false;
}

console.log('Refreshing sidebar conditions...');
const [weatherStatus, tidesStatus, waterStatus] = await Promise.all([
	runSource('weather', WEATHER_OUT, refreshWeather),
	runSource('tides', TIDES_OUT, refreshTides),
	runSource('water', WATER_OUT, refreshWaterQuality, WATER_REFRESH_AFTER_MS),
]);

let alarm = false;
if (weatherStatus === 'failed') {
	alarm = failureIsAlarming('weather', WEATHER_OUT, SITE.conditions.weatherStaleTtlMs);
}
if (tidesStatus === 'failed') {
	alarm = failureIsAlarming('tides', TIDES_OUT, SITE.conditions.tidesStaleTtlMs) || alarm;
}
if (waterStatus === 'failed') {
	alarm = failureIsAlarming('water', WATER_OUT, SITE.conditions.waterStaleTtlMs) || alarm;
}

if (alarm) process.exit(1);
console.log('Done.');
