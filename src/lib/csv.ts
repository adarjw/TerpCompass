/**
 * CSV schedule import. Dependency-free RFC-4180-ish tokenizer plus a
 * forgiving header mapper so exports from spreadsheets "just work".
 *
 * Expected columns (order-independent, case-insensitive, aliases accepted):
 *   code, name, professor, component, building, room, days, start, end,
 *   semester_start, semester_end, attendance_policy, walking_buffer
 *
 * A course with multiple meeting components (lecture + discussion + lab)
 * is represented as multiple rows sharing the same code — one row per
 * component, distinguished by the "component" column (lecture/discussion/
 * lab/seminar/studio; defaults to "lecture" if omitted). Rows sharing a code
 * are merged into a single course with multiple meeting patterns.
 */

import type { CourseDraft, PatternDraft } from './ics';
import { compareISODate, parseISODate, parseTime } from './time';
import type { MeetingComponent, Weekday } from './types';

export interface CsvImportResult {
  courses: (CourseDraft & { attendancePolicy?: string; walkingBufferMin?: number })[];
  warnings: string[];
}

/** Tokenize CSV text into rows of fields, honoring quoted fields. */
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    push();
    // Skip fully empty rows.
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      push();
      i++;
    } else if (c === '\r') {
      i++;
      if (text[i] === '\n') i++;
      pushRow();
    } else if (c === '\n') {
      i++;
      pushRow();
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

const HEADER_ALIASES: Record<string, string[]> = {
  code: ['code', 'course code', 'course_code', 'course'],
  name: ['name', 'course name', 'course_name', 'title'],
  professor: ['professor', 'prof', 'instructor', 'teacher'],
  component: ['component', 'section type', 'meeting type', 'type'],
  building: ['building', 'bldg', 'location'],
  room: ['room', 'rm', 'room number'],
  days: ['days', 'meeting days', 'meeting_days', 'day'],
  start: ['start', 'start time', 'start_time', 'begin'],
  end: ['end', 'end time', 'end_time', 'finish'],
  semesterStart: ['semester_start', 'semester start', 'first day', 'start date', 'start_date'],
  semesterEnd: ['semester_end', 'semester end', 'last day', 'end date', 'end_date'],
  attendancePolicy: ['attendance_policy', 'attendance policy', 'attendance'],
  walkingBuffer: ['walking_buffer', 'walking buffer', 'buffer', 'walk buffer'],
};

const DAY_TOKENS: Record<string, Weekday> = {
  sunday: 0, sun: 0, su: 0, u: 0,
  monday: 1, mon: 1, mo: 1, m: 1,
  // Lone "T" = Tuesday per registrar convention (Testudo writes "TTh").
  tuesday: 2, tues: 2, tue: 2, tu: 2, t: 2,
  wednesday: 3, wed: 3, we: 3, w: 3,
  thursday: 4, thurs: 4, thu: 4, th: 4, r: 4,
  friday: 5, fri: 5, fr: 5, f: 5,
  saturday: 6, sat: 6, sa: 6,
};

/**
 * Parse "MWF", "TuTh", "Mon,Wed", "Monday; Wednesday" etc. into weekdays.
 * Compact strings are scanned greedily (longest token first) so "TuTh" and
 * "MWF" both work; "R" means Thursday per common registrar convention.
 */
export function parseMeetingDays(input: string): Weekday[] {
  const s = input.trim();
  if (!s) return [];
  const found = new Set<Weekday>();
  if (/[,;/ ]/.test(s)) {
    for (const part of s.split(/[,;/ ]+/)) {
      const tok = part.trim().toLowerCase();
      if (tok in DAY_TOKENS) found.add(DAY_TOKENS[tok]);
      else if (tok) {
        for (const d of parseMeetingDays(tok)) found.add(d);
      }
    }
  } else {
    // Compact form: scan longest-first ("Th"/"Tu"/"Su"/"Sa" before single letters).
    let i = 0;
    const lower = s.toLowerCase();
    while (i < lower.length) {
      const two = lower.slice(i, i + 2);
      const one = lower[i];
      if (two in DAY_TOKENS && ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'].includes(two)) {
        found.add(DAY_TOKENS[two]);
        i += 2;
        // Skip trailing lowercase letters of full names ("thu", "thurs").
        while (i < lower.length && /[a-z]/.test(s[i]) && s[i] === lower[i] && /[a-z]/.test(lower[i]) && !(lower[i] in DAY_TOKENS && s[i] !== s[i].toLowerCase())) break;
      } else if (one in DAY_TOKENS) {
        found.add(DAY_TOKENS[one]);
        i += 1;
      } else {
        i += 1; // Unknown character: skip.
      }
    }
  }
  return [...found].sort((a, b) => a - b) as Weekday[];
}

/** Accept "14:00", "2:00 PM", "2pm", "1400". Returns "HH:MM" or null. */
export function normalizeTime(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(s);
  if (!m) {
    m = /^(\d{1,2})\s*(am|pm)$/.exec(s);
    if (m) m = [m[0], m[1], '00', m[2]] as unknown as RegExpExecArray;
  }
  if (!m) {
    const mil = /^(\d{2})(\d{2})$/.exec(s);
    if (mil) m = [mil[0], mil[1], mil[2], undefined] as unknown as RegExpExecArray;
  }
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3];
  if (min > 59) return null;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Accept "2026-08-31", "8/31/2026", "08/31/26". Returns ISO or null. */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  if (parseISODate(s)) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    const iso = `${y}-${String(Number(us[1])).padStart(2, '0')}-${String(
      Number(us[2]),
    ).padStart(2, '0')}`;
    return parseISODate(iso) ? iso : null;
  }
  return null;
}

const COMPONENT_WORDS: Record<string, MeetingComponent> = {
  lecture: 'lecture', lec: 'lecture',
  discussion: 'discussion', dis: 'discussion', disc: 'discussion',
  lab: 'lab', laboratory: 'lab',
  seminar: 'seminar', sem: 'seminar',
  studio: 'studio',
};

function normalizeComponent(input: string): MeetingComponent {
  const key = input.trim().toLowerCase();
  return COMPONENT_WORDS[key] ?? 'lecture';
}

export function parseCsvSchedule(text: string): CsvImportResult {
  const warnings: string[] = [];
  const rows = tokenizeCsv(text);
  if (rows.length < 2) {
    return {
      courses: [],
      warnings: ['CSV needs a header row plus at least one course row.'],
    };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const required = ['code', 'days', 'start', 'end'];
  const missing = required.filter((r) => !(r in col));
  if (missing.length > 0) {
    return {
      courses: [],
      warnings: [
        `CSV is missing required column(s): ${missing.join(', ')}. ` +
          'Expected headers like: code, name, professor, component, building, room, days, start, end, semester_start, semester_end.',
      ],
    };
  }

  const draftsByCode = new Map<
    string,
    CourseDraft & { attendancePolicy?: string; walkingBufferMin?: number }
  >();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (key: string) => (key in col ? (row[col[key]] ?? '').trim() : '');
    const code = get('code');
    const rowLabel = code || `row ${r + 1}`;
    const days = parseMeetingDays(get('days'));
    const start = normalizeTime(get('start'));
    const end = normalizeTime(get('end'));
    const semStart = normalizeDate(get('semesterStart'));
    const semEnd = normalizeDate(get('semesterEnd'));
    if (days.length === 0) {
      warnings.push(`Skipped ${rowLabel}: could not read meeting days "${get('days')}".`);
      continue;
    }
    if (!start || !end) {
      warnings.push(`Skipped ${rowLabel}: could not read start/end time.`);
      continue;
    }
    if (parseTime(end)! <= parseTime(start)!) {
      warnings.push(`Skipped ${rowLabel}: end time is not after start time.`);
      continue;
    }
    if (!semStart || !semEnd) {
      warnings.push(
        `Skipped ${rowLabel}: missing/invalid semester_start or semester_end date.`,
      );
      continue;
    }
    const bufferRaw = get('walkingBuffer');
    const buffer = bufferRaw ? Number(bufferRaw) : undefined;
    const walkingBufferMin =
      buffer !== undefined && Number.isFinite(buffer) && buffer >= 0 ? buffer : undefined;

    const pattern: PatternDraft = {
      label: normalizeComponent(get('component')),
      building: get('building'),
      room: get('room'),
      meetingDays: days,
      startTime: start,
      endTime: end,
    };

    const key = code || `__nocode__${rowLabel}`;
    const existing = draftsByCode.get(key);
    if (existing) {
      existing.patterns.push(pattern);
      if (compareISODate(semStart, existing.semesterStart) < 0) existing.semesterStart = semStart;
      if (compareISODate(semEnd, existing.semesterEnd) > 0) existing.semesterEnd = semEnd;
      existing.attendancePolicy ??= get('attendancePolicy') || undefined;
      existing.walkingBufferMin ??= walkingBufferMin;
    } else {
      draftsByCode.set(key, {
        code,
        name: get('name') || code,
        professor: get('professor'),
        semesterStart: semStart,
        semesterEnd: semEnd,
        patterns: [pattern],
        attendancePolicy: get('attendancePolicy') || undefined,
        walkingBufferMin,
      });
    }
  }

  const courses = [...draftsByCode.values()];
  if (courses.length === 0 && warnings.length === 0) {
    warnings.push('No course rows found in the CSV.');
  }
  return { courses, warnings };
}
