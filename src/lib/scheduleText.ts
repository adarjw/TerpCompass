/**
 * Free-text schedule parser for the "paste from a screenshot" flow.
 *
 * iOS Live Text and Android Lens can copy text straight out of a schedule
 * screenshot (Testudo, ELMS, advisor emails). This parser deterministically
 * pulls course code, meeting component (Lec/Dis/Lab/...), days, times, and
 * building/room from that pasted text — no OCR or AI needed inside the app.
 * A course block with several component rows (e.g. "Lec" + "Dis") becomes
 * one course with multiple meeting patterns. Lines it cannot parse are
 * returned as leftovers so the user can fix them manually; nothing is guessed.
 */

import { parseMeetingDays, normalizeTime } from './csv';
import type { CourseDraft, PatternDraft } from './ics';
import type { MeetingComponent, Weekday } from './types';

export interface ScheduleTextResult {
  courses: Omit<CourseDraft, 'semesterStart' | 'semesterEnd'>[];
  /** Course blocks found, but with one or more component rows unparsed. */
  partial: string[];
  warnings: string[];
}

const CODE_RE = /\b([A-Z]{4}\d{3}[A-Z]?|[A-Z]{2,4}\s?\d{3}[A-Z]?)\b/;
const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
const DAYS_RE = /\b((?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*[,/ ]*)+|(?:M|Tu|W|Th|F|Sa|Su){2,}|MWF|TuTh|MW|WF|TR)\b/;
const LOCATION_RE = /\b([A-Z]{2,4}|[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})\s+(\d{4}[A-Z]?|\d{3}[A-Z]?)\b/;

/** Matches a meeting-component row header, e.g. "Lec", "Dis", "Lab", "Final". */
const COMPONENT_LINE_RE = /^\s*(lec(?:ture)?|dis(?:c(?:ussion)?)?|lab(?:oratory)?|sem(?:inar)?|studio|final)\b\.?\s*(.*)$/i;

function componentLabel(word: string): MeetingComponent {
  const w = word.toLowerCase();
  if (w.startsWith('lec')) return 'lecture';
  if (w.startsWith('dis')) return 'discussion';
  if (w.startsWith('lab')) return 'lab';
  if (w.startsWith('sem')) return 'seminar';
  if (w.startsWith('studio')) return 'studio';
  return 'other';
}

/** Infer am/pm when a range like "2:00-3:15" omits both markers (classes run 7am-10pm). */
function resolveAmPm(startRaw: string, endRaw: string): [string, string] | null {
  const hasMarker = (s: string) => /am|pm/i.test(s);
  let start = startRaw.trim();
  let end = endRaw.trim();
  if (!hasMarker(start) && hasMarker(end)) {
    // "2:00-3:15pm" — start shares end's marker unless that puts start after end.
    const marker = /pm/i.test(end) ? 'pm' : 'am';
    const st = normalizeTime(`${start}${marker}`);
    const en = normalizeTime(end);
    if (st && en && st < en) return [st, en];
    const stAlt = normalizeTime(`${start}${marker === 'pm' ? 'am' : 'pm'}`);
    if (stAlt && en && stAlt < en) return [stAlt, en];
    return null;
  }
  if (!hasMarker(start) && !hasMarker(end)) {
    // Bare "14:00-15:15" 24h, or ambiguous "2:00-3:15" — assume daytime:
    // hours 1-6 are almost certainly PM for a class.
    const bump = (s: string) => {
      const t = normalizeTime(s);
      if (!t) return null;
      const h = Number(t.slice(0, 2));
      if (h >= 1 && h <= 6) return normalizeTime(`${s}pm`);
      return t;
    };
    const st = bump(start);
    const en = bump(end);
    if (st && en && st < en) return [st, en];
    return null;
  }
  const st = normalizeTime(start);
  const en = normalizeTime(end);
  if (st && en && st < en) return [st, en];
  return null;
}

/** Parse one component row's text (time range, days, location) into a pattern. */
function parseComponentRow(label: MeetingComponent, rowText: string): PatternDraft | null {
  const timeMatch = TIME_RANGE_RE.exec(rowText);
  const daysMatch = DAYS_RE.exec(rowText.replace(TIME_RANGE_RE, ' '));
  const days: Weekday[] = daysMatch ? parseMeetingDays(daysMatch[1]) : [];
  const times = timeMatch ? resolveAmPm(timeMatch[1], timeMatch[2]) : null;
  if (!times || days.length === 0) return null;

  const rest = rowText.replace(timeMatch![0], ' ').replace(daysMatch![0], ' ');
  const locMatch = LOCATION_RE.exec(rest);
  return {
    label,
    building: locMatch ? locMatch[1] : '',
    room: locMatch ? locMatch[2] : '',
    meetingDays: days,
    startTime: times[0],
    endTime: times[1],
  };
}

export function parseScheduleText(text: string): ScheduleTextResult {
  const warnings: string[] = [];
  const partial: string[] = [];
  const courses: ScheduleTextResult['courses'] = [];

  // Group consecutive non-empty lines: screenshots often put code, title,
  // and one row per meeting component (Lec/Dis/Lab/Final) together.
  const blocks: string[] = [];
  let buf: string[] = [];
  for (const line of (text ?? '').split(/\r\n|\n|\r/)) {
    const t = line.trim();
    if (!t) {
      if (buf.length) blocks.push(buf.join('\n'));
      buf = [];
    } else {
      buf.push(t);
      // A new course code starts a new block.
      if (buf.length > 1 && CODE_RE.test(t) && CODE_RE.test(buf[0]) && t !== buf[0]) {
        const last = buf.pop()!;
        blocks.push(buf.join('\n'));
        buf = [last];
      }
    }
  }
  if (buf.length) blocks.push(buf.join('\n'));

  for (const block of blocks) {
    const codeMatch = CODE_RE.exec(block);
    if (!codeMatch) continue;
    const code = codeMatch[1].replace(/\s+/g, '');
    const lines = block.split('\n');

    // Course name: first line without the code and not a component/location row.
    let name = '';
    for (const l of lines) {
      const stripped = l.replace(CODE_RE, '').replace(TIME_RANGE_RE, '').trim();
      if (
        stripped.length > 4 &&
        !DAYS_RE.test(l) &&
        !COMPONENT_LINE_RE.test(l) &&
        !/^\d/.test(stripped) &&
        !LOCATION_RE.test(l)
      ) {
        name = stripped.replace(/^[-:–]\s*/, '');
        break;
      }
    }

    // Split the block into component rows: text from one "Lec"/"Dis"/"Lab"/
    // "Final" line up to (not including) the next such line.
    const componentStarts: { label: MeetingComponent; skip: boolean; startIdx: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = COMPONENT_LINE_RE.exec(lines[i]);
      if (m) {
        componentStarts.push({
          label: componentLabel(m[1]),
          skip: m[1].toLowerCase() === 'final',
          startIdx: i,
        });
      }
    }

    const patterns: PatternDraft[] = [];
    let anyUnparsed = false;

    if (componentStarts.length === 0) {
      // No explicit component row — treat the whole block as one lecture.
      const pattern = parseComponentRow('lecture', block);
      if (pattern) patterns.push(pattern);
      else anyUnparsed = true;
    } else {
      for (let i = 0; i < componentStarts.length; i++) {
        const { label, skip, startIdx } = componentStarts[i];
        if (skip) continue; // "Final: TBA" has nothing to schedule.
        const endIdx = i + 1 < componentStarts.length ? componentStarts[i + 1].startIdx : lines.length;
        const firstLine = COMPONENT_LINE_RE.exec(lines[startIdx])?.[2] ?? '';
        const rowText = [firstLine, ...lines.slice(startIdx + 1, endIdx)].join(' ');
        const pattern = parseComponentRow(label, rowText);
        if (pattern) patterns.push(pattern);
        else anyUnparsed = true;
      }
    }

    if (patterns.length === 0) {
      partial.push(block.slice(0, 200));
      continue;
    }
    if (anyUnparsed) {
      warnings.push(`"${code}": at least one meeting row could not be read — check it after import.`);
    }

    courses.push({
      code,
      name: name || code,
      professor: '',
      patterns,
    });
  }

  if (courses.length === 0 && partial.length === 0) {
    warnings.push(
      'No course codes found. Paste the text copied from your schedule screenshot (long-press the image → copy text).',
    );
  }
  if (partial.length > 0) {
    warnings.push(
      `${partial.length} course(s) were found but missing days or times — add them manually below.`,
    );
  }
  return { courses, partial, warnings };
}
