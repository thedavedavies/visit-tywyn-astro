/**
 * Events data access. Mirrors the WP `inc/events.php` normaliser.
 *
 * The source is `src/data/events.json`, a hand-edited file that the
 * site owner controls. We Zod-validate the array so a malformed
 * `start_date` or missing `title` fails the build with a clear error
 * rather than emitting an orphaned card with `Invalid Date` flags
 * silently set to false.
 */

import { z } from 'astro:content';
import eventsJson from '../data/events.json' with { type: 'json' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

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

const RawEventSchema = z.object({
	title: z.string().min(1),
	summary: z.string().optional(),
	start_date: z.string().regex(DATE_RE, 'start_date must be YYYY-MM-DD'),
	end_date: z.string().regex(DATE_RE, 'end_date must be YYYY-MM-DD').optional(),
	start_time: z.string().regex(TIME_RE, 'start_time must be HH:MM').optional(),
	end_time: z.string().regex(TIME_RE, 'end_time must be HH:MM').optional(),
	location: z.string().optional(),
	image: z.string().optional(),
	image_alt: z.string().optional(),
	internal_url: z.string().optional(),
	external_url: z.string().optional(),
	external_label: z.string().optional(),
});

const EventsJsonSchema = z.object({ events: z.array(RawEventSchema).optional() }).passthrough();

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
	timeZone: 'Europe/London',
});

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	timeZone: 'Europe/London',
});

/**
 * Treat hand-edited `YYYY-MM-DD` + `HH:MM` as Europe/London local
 * time. Build servers run UTC; a bare `2026-07-18T11:00:00` string
 * parses as 11:00 in whatever zone `new Date()` thinks it is in,
 * shifting `isPast` / `isUpcoming` by an hour during British Summer
 * Time. Suffixing the appropriate offset keeps the classification
 * stable across CI and local dev.
 */
function combine(date: string, time: string, fallbackEnd: boolean): string {
	const resolvedTime = TIME_RE.test(time) ? time : fallbackEnd ? '23:59' : '00:00';
	const offset = londonOffset(date, resolvedTime);
	return `${date}T${resolvedTime}:00${offset}`;
}

/**
 * Returns `+01:00` for dates inside British Summer Time and `+00:00`
 * for the rest. BST runs from the last Sunday of March (01:00 UTC) to
 * the last Sunday of October (01:00 UTC). We approximate using the
 * date alone, which is correct for every hour that is not the exact
 * cutover hour (a 1h slippage twice per year on a tourism site is
 * acceptable; correctness here would require a tz library).
 */
function londonOffset(date: string, time: string): '+00:00' | '+01:00' {
	const parts = date.split('-').map((n) => Number.parseInt(n, 10));
	const year = parts[0]!;
	const month = parts[1]!;
	const day = parts[2]!;
	const hour = Number.parseInt(time.split(':')[0]!, 10);
	const start = lastSunday(year, 3);
	const end = lastSunday(year, 10);
	const dateOrd = month * 100 + day;
	const startOrd = 3 * 100 + start;
	const endOrd = 10 * 100 + end;
	if (dateOrd < startOrd || dateOrd > endOrd) return '+00:00';
	if (dateOrd > startOrd && dateOrd < endOrd) return '+01:00';
	// Cutover day: BST starts at 01:00 UTC (02:00 local) on the last
	// Sunday of March, ends at 01:00 UTC (02:00 BST) of October.
	if (dateOrd === startOrd) return hour >= 2 ? '+01:00' : '+00:00';
	return hour < 2 ? '+01:00' : '+00:00';
}

function lastSunday(year: number, month: number): number {
	// month is 1-12. Use UTC noon to dodge daylight-saving rounding.
	const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
	const lastDow = new Date(Date.UTC(year, month - 1, lastDay, 12)).getUTCDay();
	return lastDay - lastDow;
}

function fmtRange(startIso: string, endIso: string): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const sameDay = startIso.slice(0, 10) === endIso.slice(0, 10);
	if (sameDay) return SHORT_FORMATTER.format(start);
	return `${DAY_FORMATTER.format(start)} to ${DAY_FORMATTER.format(end)}`;
}

export function getEvents(now: Date = new Date()): NormalisedEvent[] {
	const parsed = EventsJsonSchema.safeParse(eventsJson);
	if (!parsed.success) {
		throw new Error(`src/data/events.json failed validation: ${parsed.error.message}`);
	}
	const raw = parsed.data.events ?? [];
	const out: NormalisedEvent[] = [];

	for (const ev of raw) {
		const startIso = combine(ev.start_date, ev.start_time ?? '', false);
		// When `end_date` is set but `end_time` is missing, default to
		// 23:59 so a multi-day festival stays "upcoming" / "ongoing"
		// for the whole final day rather than flipping to "past" at
		// whatever hour `start_time` happened to be.
		const endDate = ev.end_date ?? ev.start_date;
		const endTime =
			ev.end_time ??
			(ev.end_date && ev.end_date !== ev.start_date ? '23:59' : (ev.start_time ?? '23:59'));
		const endIso = combine(endDate, endTime, true);
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
