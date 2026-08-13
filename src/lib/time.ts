/**
 * Date/time helpers. All schedule math uses local wall-clock components so
 * daylight-saving transitions cannot shift class times: a 2:00 PM class stays
 * at 2:00 PM local before and after a DST change.
 */

import type { Weekday } from './types';

/** Parse "YYYY-MM-DD" into numeric parts. Returns null if malformed. */
export function parseISODate(
  s: string,
): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to reject impossible dates like 2026-02-30.
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/** Parse "HH:MM" (24h). Returns minutes since midnight, or null. */
export function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime12(hhmm: string): string {
  const mins = parseTime(hhmm);
  if (mins == null) return hhmm;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Build a concrete local Date for a stored date + wall-clock time.
 * Uses the numeric Date constructor, which resolves DST correctly for the
 * local zone (the wall time is preserved across transitions).
 */
export function localDateTime(dateISO: string, hhmm: string): Date | null {
  const dp = parseISODate(dateISO);
  const mins = parseTime(hhmm);
  if (!dp || mins == null) return null;
  return new Date(dp.y, dp.m - 1, dp.d, Math.floor(mins / 60), mins % 60, 0, 0);
}

/** Add n calendar days to a "YYYY-MM-DD" string (DST-safe: noon anchor). */
export function addDaysISO(dateISO: string, n: number): string {
  const dp = parseISODate(dateISO);
  if (!dp) return dateISO;
  const d = new Date(dp.y, dp.m - 1, dp.d, 12, 0, 0);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function weekdayOfISO(dateISO: string): Weekday | null {
  const dp = parseISODate(dateISO);
  if (!dp) return null;
  return new Date(dp.y, dp.m - 1, dp.d, 12).getDay() as Weekday;
}

export function compareISODate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every date between start and end (inclusive) that falls on one of the given
 * weekdays, minus any dates in `excluded` (holidays / breaks).
 */
export function datesForPattern(
  startISO: string,
  endISO: string,
  weekdays: Weekday[],
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (!start || !end || weekdays.length === 0) return [];
  const want = new Set(weekdays);
  const out: string[] = [];
  // Noon anchor avoids any midnight-DST edge cases while iterating.
  const cursor = new Date(start.y, start.m - 1, start.d, 12);
  const stop = new Date(end.y, end.m - 1, end.d, 12);
  // Hard cap: a semester pattern should never exceed ~2 years of days.
  let guard = 800;
  while (cursor.getTime() <= stop.getTime() && guard-- > 0) {
    if (want.has(cursor.getDay() as Weekday)) {
      const iso = toISODate(cursor);
      if (!excluded.has(iso)) out.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export function formatCountdown(msUntil: number): string {
  if (msUntil <= 0) return 'now';
  const totalMin = Math.ceil(msUntil / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatDateHuman(dateISO: string): string {
  const dp = parseISODate(dateISO);
  if (!dp) return dateISO;
  const d = new Date(dp.y, dp.m - 1, dp.d, 12);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
