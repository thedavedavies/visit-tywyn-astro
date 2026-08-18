/**
 * Build-time copy generation for the tide times page. Pure functions
 * over the tide snapshot, mirroring weather-copy.ts: the page template
 * stays declarative and the tone lives in one place.
 */

import type { TideEvent } from './conditions';

const TZ = 'Europe/London';
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZone: TZ,
});
const DAY_KEY_FMT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: TZ });

const time = (iso: string) => TIME_FMT.format(new Date(iso)).replace(/\s/g, '');

export function eventsOn(events: TideEvent[], day: Date): TideEvent[] {
	const key = DAY_KEY_FMT.format(day);
	return events.filter((e) => DAY_KEY_FMT.format(new Date(e.timeIso)) === key);
}

export function rangeFigure(events: TideEvent[]): string | null {
	if (events.length < 2) return null;
	const heights = events.map((e) => e.heightM);
	return `${Math.min(...heights).toFixed(1)}m to ${Math.max(...heights).toFixed(1)}m`;
}

export function rangeNote(events: TideEvent[]): string | null {
	if (!events.length) return null;
	const parts: string[] = [];
	const lows = events.filter((e) => e.type === 'low').map((e) => time(e.timeIso));
	const highs = events.filter((e) => e.type === 'high').map((e) => time(e.timeIso));
	const list = (a: string[]) =>
		a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0];
	if (lows.length) parts.push(`Low water ${list(lows)}.`);
	if (highs.length) parts.push(`High water ${list(highs)}.`);
	return parts.join(' ');
}

export function aboutRangeSentence(events: TideEvent[]): string {
	const figure = rangeFigure(events);
	const base =
		'Tywyn sits on Cardigan Bay, where the tide comes in and goes out twice a day, a little under half an hour later each day.';
	if (!figure) return base;
	const heights = events.map((e) => e.heightM);
	const span = Math.max(...heights) - Math.min(...heights);
	return `${base} Today the water moves between ${figure}, a range of about ${span.toFixed(1)}m.`;
}

/**
 * Spring/neap direction from how the daily range changes across the
 * snapshot: whether the big tides are building or easing off.
 */
export function springNeapSentence(events: TideEvent[]): string {
	const byDay = new Map<string, number[]>();
	for (const e of events) {
		const key = DAY_KEY_FMT.format(new Date(e.timeIso));
		byDay.set(key, [...(byDay.get(key) ?? []), e.heightM]);
	}
	const ranges = [...byDay.values()]
		.filter((h) => h.length > 1)
		.map((h) => Math.max(...h) - Math.min(...h));
	const tail =
		'Around the new and full moon the range is at its greatest, uncovering the widest stretch of firm sand at low water.';
	if (ranges.length < 3) return tail;
	const drift = ranges[ranges.length - 1]! - ranges[0]!;
	if (drift < -0.5)
		return `${tail} This week the range is easing off day by day, so expect smaller tides by the weekend.`;
	if (drift > 0.5)
		return `${tail} This week the range is building, so the biggest tides come later on.`;
	return `${tail} The range holds fairly steady across this week.`;
}

export function biggestDay(events: TideEvent[]): { label: string; rangeM: number } | null {
	const byDay = new Map<string, TideEvent[]>();
	for (const e of events) {
		const key = DAY_KEY_FMT.format(new Date(e.timeIso));
		byDay.set(key, [...(byDay.get(key) ?? []), e]);
	}
	let best: { label: string; rangeM: number } | null = null;
	const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: TZ });
	for (const group of byDay.values()) {
		if (group.length < 2) continue;
		const heights = group.map((e) => e.heightM);
		const rangeM = Math.max(...heights) - Math.min(...heights);
		if (!best || rangeM > best.rangeM) {
			best = { label: fmt.format(new Date(group[0]!.timeIso)), rangeM };
		}
	}
	return best;
}
