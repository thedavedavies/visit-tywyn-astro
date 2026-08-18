/**
 * Build-time copy generation for the weather page. Every phrase the
 * redesigned page shows is derived here from snapshot data, so the
 * page template stays declarative and the tone lives in one place.
 * All functions are pure and degrade to null/'' when a field is
 * missing rather than printing gaps.
 */

import type { DailyForecast, HourForecast, WeatherSnapshot } from './conditions';
import { windDirectionName } from './conditions';

const TZ = 'Europe/London';
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZone: TZ,
});
const LONG_DATE_FMT = new Intl.DateTimeFormat('en-GB', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	timeZone: TZ,
});
const HOUR_OF_DAY_FMT = new Intl.DateTimeFormat('en-GB', {
	hour: 'numeric',
	hour12: false,
	timeZone: TZ,
});

export function breezePhrase(mph: number): string {
	if (mph < 1) return 'hardly a breath of wind';
	if (mph < 4) return 'just a whisper of wind';
	if (mph < 8) return 'a light breeze';
	if (mph < 13) return 'a gentle breeze';
	if (mph < 19) return 'a moderate breeze';
	if (mph < 25) return 'a fresh breeze';
	if (mph < 32) return 'a strong wind';
	if (mph < 39) return 'a near gale';
	if (mph < 47) return 'a gale';
	return 'a storm-force wind';
}

function breezeWithDirection(mph: number, dir: string | null): string {
	const phrase = breezePhrase(mph);
	const adj = windDirectionName(dir);
	if (!adj) return phrase;
	const words = phrase.split(' ');
	words.splice(words.length - 1, 0, adj.toLowerCase());
	return words.join(' ');
}

function precipWord(code: number | null): string {
	if (code === null) return 'rain';
	if (code >= 51 && code <= 57) return 'drizzle';
	if (code >= 80 && code <= 82) return 'showers';
	if (code >= 71 && code <= 86) return 'wintry showers';
	if (code >= 95) return 'thundery rain';
	return 'rain';
}

export function heroHeadline(snap: WeatherSnapshot): string | null {
	if (snap.tempC === null) return null;
	const summary =
		snap.summary && snap.summary !== 'Conditions unknown'
			? ` and ${snap.summary.toLowerCase()}`
			: '';
	return `It's ${snap.tempC.toFixed(0)}°C${summary} at Tywyn beach right now.`;
}

export function heroSupport(snap: WeatherSnapshot, today: DailyForecast | undefined): string {
	const parts: string[] = [];
	if (snap.feelsLikeC !== null && snap.windMph !== null) {
		parts.push(
			`Feels like ${snap.feelsLikeC.toFixed(0)}° in ${breezeWithDirection(snap.windMph, snap.windDir)}.`,
		);
	} else if (snap.feelsLikeC !== null) {
		parts.push(`Feels like ${snap.feelsLikeC.toFixed(0)}°.`);
	}
	const rain = snap.rainChance ?? today?.rainChance;
	const word = precipWord(snap.code ?? today?.code ?? null);
	if (rain != null && rain >= 70) {
		parts.push(`There's a ${rain}% chance of ${word} later, so a light coat is a good idea.`);
	} else if (rain != null && rain >= 40) {
		parts.push(`There's a ${rain}% chance of a little ${word} later, so keep a coat handy.`);
	} else if (rain != null) {
		parts.push(`Only a ${rain}% chance of ${word}: it should stay dry.`);
	}
	return parts.join(' ');
}

export function updatedLine(snap: WeatherSnapshot): string {
	const fetched = Date.parse(snap.fetchedAt);
	if (!Number.isFinite(fetched)) return `Updated ${snap.observedLabel}`;
	return `Updated ${TIME_FMT.format(new Date(fetched))}, ${LONG_DATE_FMT.format(new Date(fetched))}`;
}

export function dayOutlook(day: DailyForecast): string {
	const code = day.code ?? -1;
	const rain = day.rainChance ?? 0;
	const warm = (day.tempMaxC ?? 0) >= 20;
	const mild = (day.tempMinC ?? 0) >= 15;
	const wet = (day.precipHours ?? 0) >= 12;
	if (code === 0 || code === 1) return warm ? 'Warm and sunny' : 'Sunny and dry';
	if (code === 2) return warm ? 'Warm with sunny spells' : 'Sunny spells';
	if (code === 3) return rain < 25 ? 'Cloudy but mostly dry' : 'Grey with damp spells';
	if (code === 45 || code === 48)
		return rain < 30 ? 'Misty start, bright afternoon' : 'Murky and damp';
	if (code >= 51 && code <= 53)
		return wet
			? 'Drizzly for much of the day'
			: mild
				? 'Drizzly and mild'
				: 'Light drizzle at times';
	if (code >= 55 && code <= 57) return 'Heavier drizzle';
	if (code >= 61 && code <= 63) return wet ? 'Wet for much of the day' : 'Rain at times';
	if (code >= 65 && code <= 67) return 'Heavy rain at times';
	if (code >= 71 && code <= 77) return 'Wintry showers';
	if (code >= 80 && code <= 82)
		return (day.windMph ?? 0) >= 18 ? 'Blustery showers' : 'Sunshine and showers';
	if (code >= 85 && code <= 86) return 'Wintry showers';
	if (code >= 95) return 'Thundery bursts';
	return 'Changeable';
}

export function pickOfWeekIndex(days: DailyForecast[]): number | null {
	if (days.length < 2) return null;
	let best = -1;
	let bestScore = -Infinity;
	days.forEach((day, i) => {
		if (i === 0) return;
		if (day.tempMaxC === null || day.rainChance === null) return;
		const score = day.tempMaxC - day.rainChance / 8 - (day.windMph ?? 0) / 8;
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	});
	return best === -1 ? null : best;
}

export function pickOfWeekNote(day: DailyForecast): string {
	if ((day.tempMaxC ?? 0) >= 19 && (day.rainChance ?? 100) <= 30)
		return 'Warmest and driest: one for the beach.';
	if ((day.rainChance ?? 100) <= 30) return 'The driest window of the week.';
	return 'The best of the bunch this week.';
}

function slotWord(hour: HourForecast): string {
	const h = Number(HOUR_OF_DAY_FMT.format(new Date(hour.timeIso)));
	if (h < 9) return 'early on';
	if (h < 12) return 'mid-morning';
	if (h < 15) return 'around lunchtime';
	if (h < 18) return 'around teatime';
	if (h < 21) return 'in the evening';
	return 'late in the evening';
}

export function todayNarrative(
	hourly: HourForecast[],
	sunsetIso: string | null | undefined,
): string | null {
	if (!hourly.length) return null;
	const wetIdx = hourly.findIndex((h) => (h.rainChance ?? 0) >= 50);
	const peak = hourly.reduce((a, b) => ((b.rainChance ?? 0) > (a.rainChance ?? 0) ? b : a));
	const word = precipWord(peak.code);
	let sentence: string;
	if (wetIdx === -1) {
		sentence = 'Staying mostly dry through the rest of the day';
	} else if (wetIdx === 0) {
		sentence = `${word.charAt(0).toUpperCase()}${word.slice(1)} about now, coming and going ${slotWord(peak)}`;
	} else {
		sentence = `Driest until about ${hourly[wetIdx]!.label}, with ${word} likeliest ${slotWord(peak)}`;
	}
	if (sunsetIso) {
		const ms = Date.parse(sunsetIso);
		if (Number.isFinite(ms))
			return `${sentence}. The sun sets at ${TIME_FMT.format(new Date(ms))}.`;
	}
	return `${sentence}.`;
}

export function wavesHeadline(heightM: number): string {
	const feel =
		heightM < 0.3 ? 'glassy' : heightM < 0.7 ? 'gentle' : heightM < 1.2 ? 'lively' : 'rough';
	return `Around ${heightM.toFixed(1)}m and ${feel}`;
}

export function wavesDetail(heightM: number, periodS: number | null): string {
	if (heightM < 0.7 && periodS !== null)
		return `A relaxed ${periodS.toFixed(1)} second rhythm: calm enough for a paddle.`;
	if (heightM < 0.7) return 'Calm enough for a paddle.';
	if (heightM < 1.2) return 'Some push in the water: one for confident swimmers.';
	return 'Serious water today: best admired from the promenade.';
}

export function swellNarrative(week: { date: string; heightM: number }[]): string | null {
	if (week.length < 3) return null;
	const peak = week.reduce((a, b) => (b.heightM > a.heightM ? b : a));
	const end = week[week.length - 1]!;
	const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: TZ }).format(
		new Date(`${peak.date}T12:00:00Z`),
	);
	const when =
		weekday === 'Mon'
			? 'early in the week'
			: weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun'
				? 'over the weekend'
				: 'midweek';
	if (peak.heightM - end.heightM > 0.2) {
		return `Peaks near ${peak.heightM.toFixed(1)}m ${when}, then settles back to ${end.heightM.toFixed(1)}m by the weekend.`;
	}
	const avg = week.reduce((sum, d) => sum + d.heightM, 0) / week.length;
	return `Steady around ${avg.toFixed(1)}m all week.`;
}

export function seaVsAir(seaC: number, airC: number | null): string {
	if (airC === null) return '';
	if (seaC > airC + 0.5) return 'Warmer than the air today.';
	if (seaC < airC - 0.5) return 'A touch cooler than the air today.';
	return 'About the same as the air today.';
}

export function uvInfo(uvMax: number): { value: number; band: string; advice: string } {
	const value = Math.round(uvMax);
	if (uvMax < 3)
		return { value, band: 'low', advice: 'No sunscreen needed for most: enjoy the light.' };
	if (uvMax < 6)
		return {
			value,
			band: 'moderate',
			advice: 'Tops out around midday: sunscreen if the cloud breaks.',
		};
	if (uvMax < 8) return { value, band: 'high', advice: 'Sunscreen and a hat for the beach today.' };
	return { value, band: 'very high', advice: 'Strong sun: cover up and reapply often.' };
}

export function aqiFlavour(label: string): string {
	if (label === 'Good') return 'Lovely fresh sea air, straight off the bay.';
	if (label === 'Fair') return 'Fresh sea air with barely a smudge.';
	if (label === 'Moderate') return 'Middling air today: fine for most.';
	return 'Poorer air than usual for the coast.';
}

export function pollenFlavour(pollen: { label: string; species: string }): string {
	if (pollen.label === 'Low') return 'Easy breathing on the prom.';
	if (pollen.label === 'Moderate') return `Hay fever types may notice the ${pollen.species}.`;
	return `A tough day for hay fever: ${pollen.species} pollen is up.`;
}

export function daylightDuration(
	sunriseIso: string | null | undefined,
	sunsetIso: string | null | undefined,
): string | null {
	if (!sunriseIso || !sunsetIso) return null;
	const rise = Date.parse(sunriseIso);
	const set = Date.parse(sunsetIso);
	if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) return null;
	const mins = Math.round((set - rise) / 60_000);
	return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
