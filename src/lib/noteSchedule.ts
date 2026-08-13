/**
 * Class-notes schedule hints: a deterministic scan for an exam/deadline
 * mention paired with a day reference ("exam Thursday", "paper due next
 * Monday", "quiz tomorrow"). Like the email-cancellation detector, this only
 * *suggests* a schedule addition — the note screen always confirms with the
 * user before writing anything to calendar_events.
 */

import { detectDate } from './syllabus';
import { addDaysISO, weekdayOfISO } from './time';

const EXAM_RE = /\b(exam|midterm|final|quiz|test)\b/i;
const DEADLINE_RE = /\b(due|deadline|submit|project|assignment|paper|hw|homework|presentation)\b/i;

const WEEKDAY_RE =
  /\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r?s?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/i;

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

export interface NoteScheduleHint {
  kind: 'exam' | 'deadline';
  /** Resolved date, "YYYY-MM-DD". */
  dateISO: string;
  /** The note text that triggered detection, for the confirm screen. */
  evidence: string;
}

/** Nearest date on/after `referenceISO` matching the named weekday; one week
 * later again when prefixed with "next". */
function resolveWeekday(match: RegExpExecArray, referenceISO: string): string | null {
  const target = WEEKDAY_INDEX[match[2].toLowerCase()];
  const refWeekday = weekdayOfISO(referenceISO);
  if (target === undefined || refWeekday === null) return null;
  let offset = (target - refWeekday + 7) % 7;
  if (match[1]) offset += 7; // "next <day>"
  return addDaysISO(referenceISO, offset);
}

/**
 * Scan note text for a schedule-relevant date, relative to `referenceISO`
 * (typically the session's own date). Returns null unless both a keyword
 * (exam/quiz/.../due/deadline/...) and a resolvable day are present — the
 * app never invents a date the user didn't actually write.
 */
export function detectScheduleHint(text: string, referenceISO: string): NoteScheduleHint | null {
  const kind = EXAM_RE.test(text) ? 'exam' : DEADLINE_RE.test(text) ? 'deadline' : null;
  if (!kind) return null;

  const lower = text.toLowerCase();
  let dateISO: string | null = null;
  if (/\btoday\b/.test(lower)) {
    dateISO = referenceISO;
  } else if (/\btomorrow\b/.test(lower)) {
    dateISO = addDaysISO(referenceISO, 1);
  } else {
    const wd = WEEKDAY_RE.exec(text);
    dateISO = wd ? resolveWeekday(wd, referenceISO) : detectDate(text, Number(referenceISO.slice(0, 4)));
  }
  if (!dateISO) return null;

  return { kind, dateISO, evidence: text.trim().slice(0, 200) };
}
