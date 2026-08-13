/**
 * Minimal, dependency-free iCalendar (.ics) parser for schedule import.
 *
 * Supports the subset produced by Testudo/Google Calendar/Outlook exports:
 * VEVENT with SUMMARY, LOCATION, DTSTART/DTEND (floating, TZID, or UTC "Z"),
 * and weekly RRULEs (BYDAY + UNTIL/COUNT). Non-recurring events whose titles
 * look like exams/deadlines are surfaced separately so the dashboard can show
 * them. Anything unparseable is reported as a warning — never guessed.
 *
 * A course can export multiple recurring VEVENTs that share the same course
 * code (lecture + discussion + lab, each with its own room/time) — these are
 * merged into one CourseDraft with multiple meeting patterns.
 */

import { addDaysISO, compareISODate, parseISODate, toISODate } from './time';
import type { MeetingComponent, Weekday } from './types';

export interface PatternDraft {
  label: MeetingComponent;
  building: string;
  room: string;
  meetingDays: Weekday[];
  startTime: string;
  endTime: string;
}

export interface CourseDraft {
  code: string;
  name: string;
  professor: string;
  semesterStart: string;
  semesterEnd: string;
  patterns: PatternDraft[];
}

export interface CalendarEventDraft {
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  kind: 'exam' | 'deadline' | 'other';
}

export interface IcsImportResult {
  courses: CourseDraft[];
  events: CalendarEventDraft[];
  warnings: string[];
}

const BYDAY_MAP: Record<string, Weekday> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const COMPONENT_RE = /\b(lec(?:ture)?|dis(?:c(?:ussion)?)?|lab(?:oratory)?|sem(?:inar)?|studio)\b/i;

function detectComponent(summary: string): MeetingComponent {
  const m = COMPONENT_RE.exec(summary);
  if (!m) return 'lecture';
  const word = m[1].toLowerCase();
  if (word.startsWith('lec')) return 'lecture';
  if (word.startsWith('dis')) return 'discussion';
  if (word.startsWith('lab')) return 'lab';
  if (word.startsWith('sem')) return 'seminar';
  if (word.startsWith('studio')) return 'studio';
  return 'other';
}

interface RawEvent {
  props: Record<string, { params: Record<string, string>; value: string }[]>;
}

/** Unfold RFC 5545 folded lines (continuation lines start with space/tab). */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseProperty(
  line: string,
): { name: string; params: Record<string, string>; value: string } | null {
  const colon = findUnquotedColon(line);
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) {
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }
  return { name, params, value };
}

function findUnquotedColon(line: string): number {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) return i;
  }
  return -1;
}

function extractEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = { props: {} };
    } else if (upper === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const prop = parseProperty(line);
      if (prop) {
        (current.props[prop.name] ??= []).push({
          params: prop.params,
          value: prop.value,
        });
      }
    }
  }
  return events;
}

interface ParsedDT {
  date: string; // YYYY-MM-DD (local wall date)
  time: string | null; // HH:MM local wall time
}

/**
 * Parse an iCal date-time value. Floating and TZID values are treated as
 * wall-clock (correct for class schedules — a 2pm class is 2pm local).
 * UTC ("Z") values are converted through the device's local zone.
 */
function parseDT(value: string): ParsedDT | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, time: null };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!dt) return null;
  const [, y, mo, d, h, mi, , z] = dt;
  if (z) {
    const utc = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)),
    );
    return {
      date: toISODate(utc),
      time: `${String(utc.getHours()).padStart(2, '0')}:${String(
        utc.getMinutes(),
      ).padStart(2, '0')}`,
    };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

function parseRRule(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/** "CMSC131 Object-Oriented Programming" -> code + name split. */
function splitSummary(summary: string): { code: string; name: string } {
  const cleaned = summary.replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
  const m = /^([A-Z]{2,5}\s?\d{3}[A-Z]?)\b[\s:–-]*(.*)$/.exec(cleaned);
  if (m) {
    return { code: m[1].replace(/\s+/g, ''), name: m[2].trim() || m[1] };
  }
  return { code: '', name: cleaned };
}

/** "IRB 0324" or "Iribe Center Rm 0324" -> building + room. */
function splitLocation(location: string): { building: string; room: string } {
  const cleaned = location.replace(/\\,/g, ',').trim();
  if (!cleaned) return { building: '', room: '' };
  const m = /^(.*?)[\s,]+(?:rm\.?|room)?\s*([0-9][0-9A-Za-z.-]*)$/i.exec(cleaned);
  if (m && m[1].trim()) return { building: m[1].trim(), room: m[2] };
  return { building: cleaned, room: '' };
}

const EXAM_RE = /\b(exam|midterm|final|quiz|test)\b/i;
const DEADLINE_RE = /\b(due|deadline|submit|project|assignment|paper|hw|homework)\b/i;

export function parseIcs(text: string): IcsImportResult {
  const warnings: string[] = [];
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) {
    return {
      courses: [],
      events: [],
      warnings: ['This file does not look like an iCalendar (.ics) file.'],
    };
  }
  const events = extractEvents(unfoldLines(text));
  if (events.length === 0) {
    warnings.push('No events (VEVENT) found in this calendar file.');
  }

  const draftsByCode = new Map<string, CourseDraft>();
  const oneOffs: CalendarEventDraft[] = [];

  for (const ev of events) {
    const summary = ev.props['SUMMARY']?.[0]?.value ?? '';
    const location = ev.props['LOCATION']?.[0]?.value ?? '';
    const dtstartRaw = ev.props['DTSTART']?.[0];
    const dtendRaw = ev.props['DTEND']?.[0];
    const rruleRaw = ev.props['RRULE']?.[0]?.value;

    if (!dtstartRaw) {
      warnings.push(`Skipped "${summary || 'untitled event'}": missing start time.`);
      continue;
    }
    const start = parseDT(dtstartRaw.value);
    if (!start) {
      warnings.push(`Skipped "${summary || 'untitled event'}": unreadable start time.`);
      continue;
    }
    const end = dtendRaw ? parseDT(dtendRaw.value) : null;

    if (!rruleRaw) {
      const title = summary.replace(/\\,/g, ',').trim() || 'Untitled event';
      const kind = EXAM_RE.test(title)
        ? 'exam'
        : DEADLINE_RE.test(title)
          ? 'deadline'
          : 'other';
      oneOffs.push({ title, date: start.date, time: start.time, kind });
      continue;
    }

    const rrule = parseRRule(rruleRaw);
    if ((rrule['FREQ'] ?? '').toUpperCase() !== 'WEEKLY') {
      warnings.push(
        `Skipped "${summary}": only weekly recurring events are supported (found FREQ=${rrule['FREQ'] ?? 'none'}).`,
      );
      continue;
    }

    const byday = (rrule['BYDAY'] ?? '')
      .split(',')
      .map((d) => BYDAY_MAP[d.trim().toUpperCase()])
      .filter((d): d is Weekday => d !== undefined);
    let meetingDays: Weekday[] = byday;
    if (meetingDays.length === 0) {
      // No BYDAY: recur on the weekday of DTSTART.
      const dp = parseISODate(start.date);
      if (dp) meetingDays = [new Date(dp.y, dp.m - 1, dp.d, 12).getDay() as Weekday];
    }
    if (meetingDays.length === 0 || !start.time) {
      warnings.push(`Skipped "${summary}": could not determine meeting days/time.`);
      continue;
    }

    let semesterEnd: string | null = null;
    if (rrule['UNTIL']) {
      const until = parseDT(rrule['UNTIL']);
      semesterEnd = until?.date ?? null;
    } else if (rrule['COUNT']) {
      const count = Number(rrule['COUNT']);
      if (Number.isFinite(count) && count > 0) {
        // COUNT occurrences across meetingDays.length days/week.
        const weeks = Math.ceil(count / meetingDays.length);
        semesterEnd = addDaysISO(start.date, weeks * 7);
      }
    }
    if (!semesterEnd) {
      // ~16 weeks is a standard UMD semester; flagged so the user can edit.
      semesterEnd = addDaysISO(start.date, 16 * 7);
      warnings.push(
        `"${summary}": no end date in the calendar — assumed a 16-week semester. Edit the course to fix.`,
      );
    }

    const { code, name } = splitSummary(summary);
    const { building, room } = splitLocation(location);
    const label = detectComponent(summary);
    const pattern: PatternDraft = {
      label,
      building,
      room,
      meetingDays,
      startTime: start.time,
      endTime: end?.time ?? start.time,
    };

    const key = code || `__nocode__${name}`;
    const existing = draftsByCode.get(key);
    if (existing) {
      existing.patterns.push(pattern);
      if (compareISODate(start.date, existing.semesterStart) < 0) {
        existing.semesterStart = start.date;
      }
      if (compareISODate(semesterEnd, existing.semesterEnd) > 0) {
        existing.semesterEnd = semesterEnd;
      }
    } else {
      draftsByCode.set(key, {
        code,
        name,
        professor: '',
        semesterStart: start.date,
        semesterEnd,
        patterns: [pattern],
      });
    }
  }

  return { courses: [...draftsByCode.values()], events: oneOffs, warnings };
}
