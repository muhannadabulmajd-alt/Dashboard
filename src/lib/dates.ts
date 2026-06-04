import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subDays,
  subMonths,
  getDate,
  getDaysInMonth,
} from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/** Laheeb operates on Baghdad local time; data is stored as UTC. */
export const TZ = 'Asia/Baghdad';

export type RangePreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | 'this_month'
  | 'last_month'
  | 'all'
  | 'custom';

export interface ResolvedRange {
  start: Date;
  end: Date;
  /** Previous comparable window for period-over-period deltas (omitted for "all"). */
  prevStart?: Date;
  prevEnd?: Date;
}

// --- Baghdad-local boundary helpers (return UTC instants) -------------------

function zoned(now: Date): Date {
  return toZonedTime(now, TZ);
}
function dayStart(zonedDate: Date): Date {
  return fromZonedTime(startOfDay(zonedDate), TZ);
}
function dayEnd(zonedDate: Date): Date {
  return fromZonedTime(endOfDay(zonedDate), TZ);
}
function monthStart(zonedDate: Date): Date {
  return fromZonedTime(startOfMonth(zonedDate), TZ);
}
function monthEnd(zonedDate: Date): Date {
  return fromZonedTime(endOfMonth(zonedDate), TZ);
}

/**
 * Resolve a filter range preset into concrete UTC start/end instants aligned to
 * Baghdad-local day/month boundaries, plus a previous comparable window.
 */
export function resolveRange(
  input: { range: RangePreset; from?: string; to?: string },
  now: Date = new Date(),
): ResolvedRange {
  const z = zoned(now);

  switch (input.range) {
    case 'today': {
      const start = dayStart(z);
      const end = dayEnd(z);
      return { start, end, ...prevByDuration(start, end) };
    }
    case 'yesterday': {
      const y = subDays(z, 1);
      const start = dayStart(y);
      const end = dayEnd(y);
      return { start, end, ...prevByDuration(start, end) };
    }
    case '7d': {
      const start = dayStart(subDays(z, 6));
      const end = dayEnd(z);
      return { start, end, ...prevByDuration(start, end) };
    }
    case 'this_month': {
      const start = monthStart(z);
      const end = monthEnd(z);
      const prev = subMonths(z, 1);
      return { start, end, prevStart: monthStart(prev), prevEnd: monthEnd(prev) };
    }
    case 'last_month': {
      const lm = subMonths(z, 1);
      const prev = subMonths(z, 2);
      return {
        start: monthStart(lm),
        end: monthEnd(lm),
        prevStart: monthStart(prev),
        prevEnd: monthEnd(prev),
      };
    }
    case 'custom': {
      const from = input.from ? fromZonedTime(startOfDay(new Date(input.from)), TZ) : dayStart(z);
      const to = input.to ? fromZonedTime(endOfDay(new Date(input.to)), TZ) : dayEnd(z);
      return { start: from, end: to, ...prevByDuration(from, to) };
    }
    case 'all':
    default: {
      const start = new Date('2000-01-01T00:00:00.000Z');
      const end = dayEnd(z);
      return { start, end };
    }
  }
}

function prevByDuration(start: Date, end: Date): { prevStart: Date; prevEnd: Date } {
  const durationMs = end.getTime() - start.getTime();
  // Previous window ends 1ms before the current window starts (no overlap),
  // and spans the same inclusive duration.
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart, prevEnd };
}

/** Stable bucket key for a timestamp, in Baghdad local time. */
export function bucketKey(date: Date, bucket: 'day' | 'hour'): string {
  return bucket === 'hour'
    ? formatInTimeZone(date, TZ, 'HH')
    : formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

/** Human label for a bucket key (day keys -> "MMM d", hour keys -> "HH:00"). */
export function bucketLabel(key: string, bucket: 'day' | 'hour'): string {
  if (bucket === 'hour') return `${key}:00`;
  return key;
}

/** Day-of-month and days-in-month for run-rate projection, in Baghdad time. */
export function monthProgress(now: Date = new Date()): { dayOfMonth: number; daysInMonth: number } {
  const z = zoned(now);
  return { dayOfMonth: getDate(z), daysInMonth: getDaysInMonth(z) };
}

export function formatDate(date: Date, locale: 'ar' | 'en' = 'en'): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}
