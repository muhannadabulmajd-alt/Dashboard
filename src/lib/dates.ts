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
      // Month-to-date, compared against the same span of the previous month.
      const start = monthStart(z);
      const end = dayEnd(z);
      const prevStart = monthStart(subMonths(z, 1));
      const prevEnd = new Date(prevStart.getTime() + (end.getTime() - start.getTime()));
      return { start, end, prevStart, prevEnd };
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
      // Parse the YYYY-MM-DD strings directly as Baghdad-local boundaries so the
      // result is independent of the runtime's timezone.
      const from = input.from ? fromZonedTime(`${input.from}T00:00:00.000`, TZ) : dayStart(z);
      const to = input.to ? fromZonedTime(`${input.to}T23:59:59.999`, TZ) : dayEnd(z);
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

export function monthBucketKey(date: Date): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM');
}

/** Day-of-month and days-in-month for run-rate projection, in Baghdad time. */
export function monthProgress(now: Date = new Date()): { dayOfMonth: number; daysInMonth: number } {
  const z = zoned(now);
  return { dayOfMonth: getDate(z), daysInMonth: getDaysInMonth(z) };
}

// Displayed dates use DD/MM/YYYY everywhere (CR-1). Storage stays UTC/ISO;
// `<input type="date">` values are formatted separately as yyyy-MM-dd.
export function formatDate(date: Date, _locale: 'ar' | 'en' = 'en'): string {
  void _locale;
  return formatInTimeZone(date, TZ, 'dd/MM/yyyy');
}

/** Date + time (Baghdad), DD/MM/YYYY HH:mm — e.g. for the audit log. */
export function formatDateTime(date: Date, _locale: 'ar' | 'en' = 'en'): string {
  void _locale;
  return formatInTimeZone(date, TZ, 'dd/MM/yyyy HH:mm');
}

/** Baghdad-local yyyy-MM-dd for prefilling `<input type="date">` defaults. */
export function dateInputValue(date: Date = new Date()): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

/** Parse explicit instants as-is and naive date/time values as Baghdad local time. */
export function parseBaghdadDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const candidate = hasExplicitZone
    ? new Date(text)
    : fromZonedTime(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text, TZ);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}
