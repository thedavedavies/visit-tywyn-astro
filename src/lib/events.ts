/**
 * Events data access. Mirrors the WP `inc/events.php` normaliser.
 *
 * The source is `src/data/events.json` — a hand-edited file that the
 * site owner controls. We normalise it once and cache via Astro's
 * module graph so calling getEvents() many times in a build is free.
 */

import eventsJson from '../data/events.json' with { type: 'json' };

export interface RawEvent {
	title: string;
	summary?: string;
	start_date: string;
	end_date?: string;
	start_time?: string;
	end_time?: string;
	location?: string;
	image?: string;
	image_alt?: string;
	internal_url?: string;
	external_url?: string;
	external_label?: string;
}

export interface NormalisedEvent {
	title: string;
	summary: string;
	location: string;
	image: string | null;
	imageAlt: string;
	startIso: string;
	endIso: string;
	dateLabel: string;
	isPast: boolean;
	isOngoing: boolean;
	isUpcoming: boolean;
	primaryUrl: string | null;
	internalPath: string | null;
	externalUrl: string | null;
	externalLabel: string;
}

const SHORT_FORMATTER = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
});

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
});

function combine(date: string, time?: string): string | null {
	if (!date) return null;
	const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time : '00:00';
	return `${date}T${t}:00`;
}

function fmtRange(startIso: string, endIso: string): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const sameDay = startIso.slice(0, 10) === endIso.slice(0, 10);
	if (sameDay) return SHORT_FORMATTER.format(start);
	return `${DAY_FORMATTER.format(start)} – ${DAY_FORMATTER.format(end)}`;
}

export function getEvents(now: Date = new Date()): NormalisedEvent[] {
	const raw = (eventsJson as { events?: RawEvent[] }).events ?? [];
	const out: NormalisedEvent[] = [];

	for (const ev of raw) {
		const startIso = combine(ev.start_date, ev.start_time);
		if (!startIso) continue;
		const endIsoBase = combine(ev.end_date ?? ev.start_date, ev.end_time ?? ev.start_time);
		const endIso = endIsoBase ?? startIso;
		const start = new Date(startIso);
		const end = new Date(endIso);
		const t = now.getTime();
		const isPast = end.getTime() < t;
		const isOngoing = start.getTime() <= t && t <= end.getTime();
		const isUpcoming = start.getTime() > t;
		const primaryUrl = ev.internal_url ?? ev.external_url ?? null;

		out.push({
			title: ev.title,
			summary: ev.summary ?? '',
			location: ev.location ?? '',
			image: ev.image ?? null,
			imageAlt: ev.image_alt ?? ev.title,
			startIso,
			endIso,
			dateLabel: fmtRange(startIso, endIso),
			isPast,
			isOngoing,
			isUpcoming,
			primaryUrl,
			internalPath: ev.internal_url ?? null,
			externalUrl: ev.external_url ?? null,
			externalLabel: ev.external_label ?? 'Official event website',
		});
	}

	out.sort((a, b) => a.startIso.localeCompare(b.startIso));
	return out;
}

export function upcomingEvents(limit?: number, now: Date = new Date()): NormalisedEvent[] {
	const items = getEvents(now).filter((e) => !e.isPast);
	return typeof limit === 'number' ? items.slice(0, limit) : items;
}
