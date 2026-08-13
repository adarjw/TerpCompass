/**
 * Free-text schedule parser for the "paste from a screenshot" / OCR flow.
 *
 * Input arrives two ways: text the OS copied out of a screenshot (iOS Live
 * Text / Google Lens) or text recognized in-app by tesseract.js. Both are
 * noisy, so parsing is structural and forgiving:
 *
 *  - A course block starts at a line with a course code ("COMM 107 (9601)").
 *  - Inside a block, rows starting with Lec/Dis/Lab/Sem/Studio each become a
 *    meeting pattern; "Final: TBA" rows are skipped (nothing to schedule).
 *  - Component rows follow Testudo's shape: days, time range, timezone,
 *    building+room — e.g. "Lec  TTh 12:30pm - 1:45pm EST  SKN 1112".
 *  - Days are matched *before* the time within the row, accepting registrar
 *    compact forms including lone letters (M, T=Tue, W, Th, F, R=Thu).
 *  - Common OCR damage is repaired first: letter O inside times → zero,
 *    table/border artifacts stripped.
 *
 * Lines that still can't be parsed are returned as `partial` so the user can
 * fix them manually; nothing is guessed.
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
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|~|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
/**
 * A run of day tokens: full-ish names, two-letter registrar pairs, or lone
 * letters (M, T, W, F, R for Thursday, plus Th/Tu/Sa/Su). Matched only in
 * the day *slot* of a component row (before the time), so a lone capital
 * letter can't be mistaken for one elsewhere.
 */
const DAYS_RE =
  /\b((?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*[,/ ]*)+|(?:Mo|Tu|We|Th|Fr|Sa|Su|[MTWFR])+)\b/;
const LOCATION_RE = /\b([A-Z]{2,4}|[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})\s+(\d{4}[A-Z]?|\d{3}[A-Z]?)\b/;

/** Matches a meeting-component row header, e.g. "Lec", "Dis", "Lab", "Final". */
const COMPONENT_LINE_RE =
  /^\s*(lec(?:ture)?|lee|dis(?:c(?:ussion)?)?|lab(?:oratory)?|sem(?:inar)?|studio|final)\b\.?:?\s*(.*)$/i;

function componentLabel(word: string): MeetingComponent {
  const w = word.toLowerCase();
  if (w.startsWith('lec') || w === 'lee') return 'lecture';
  if (w.startsWith('dis')) return 'discussion';
  if (w.startsWith('lab')) return 'lab';
  if (w.startsWith('sem')) return 'seminar';
  if (w.startsWith('studio')) return 'studio';
  return 'other';
}

/**
 * Repair common OCR damage before parsing:
 *  - table borders / bullets / stray glyphs → spaces
 *  - letter O standing in for zero inside times ("12:3Opm", "1O:00am")
 *  - fancy dashes normalized happens in TIME_RANGE_RE itself
 */
function cleanOcrLine(line: string): string {
  let s = line.replace(/[|©®•★»«_{}[\]]+/g, ' ');
  // O→0 when adjacent to digits or inside a time ("1O:30", "12:3Opm").
  s = s.replace(/(\d)[oO](?=\d|:|\s*[ap]m)/gi, '$10');
  s = s.replace(/(:)[oO](\d)/g, '$10$2');
  s = s.replace(/\b[oO](\d:\d{2})/g, '0$1');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Parse one component row's text (days, time range, location) into a pattern. */
function parseComponentRow(label: MeetingComponent, rowText: string): PatternDraft | null {
  const row = cleanOcrLine(rowText);
  const timeMatch = TIME_RANGE_RE.exec(row);
  if (!timeMatch) return null;
  const times = resolveAmPm(timeMatch[1], timeMatch[2]);
  if (!times) return null;

  // Days come before the time in registrar layouts ("TTh 12:30pm…"), so
  // search only that segment first; fall back to the remainder.
  const beforeTime = row.slice(0, timeMatch.index);
  const afterTime = row.slice(timeMatch.index + timeMatch[0].length);
  let daysMatch = DAYS_RE.exec(beforeTime);
  if (!daysMatch) daysMatch = DAYS_RE.exec(afterTime.replace(/\bE[SD]T\b/g, ' '));
  const days: Weekday[] = daysMatch ? parseMeetingDays(daysMatch[1]) : [];
  if (days.length === 0) return null;

  // Location: strip timezone tokens, then look after the time first
  // (Testudo puts the room at the end of the row).
  const locSource = (afterTime + ' ' + beforeTime.replace(daysMatch![0], ' ')).replace(
    /\bE[SD]T\b/g,
    ' ',
  );
  const locMatch = LOCATION_RE.exec(locSource);

  return {
    label,
    building: locMatch ? locMatch[1] : '',
    room: locMatch ? locMatch[2] : '',
    meetingDays: days,
    startTime: times[0],
    endTime: times[1],
  };
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

export function parseScheduleText(text: string): ScheduleTextResult {
  const warnings: string[] = [];
  const partial: string[] = [];
  const courses: ScheduleTextResult['courses'] = [];

  // Group consecutive non-empty lines: screenshots often put code, title,
  // and one row per meeting component (Lec/Dis/Lab/Final) together.
  const blocks: string[] = [];
  let buf: string[] = [];
  for (const line of (text ?? '').split(/\r\n|\n|\r/)) {
    const t = cleanOcrLine(line);
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
        !COMPONENT_LINE_RE.test(l) &&
        !/^\d/.test(stripped) &&
        !LOCATION_RE.test(l) &&
        !/section|face-to-face|online|blended/i.test(stripped)
      ) {
        name = stripped.replace(/^[-:–(]\s*/, '').replace(/[)\s]+$/, '');
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
      const pattern = parseComponentRow('lecture', block.replace(/\n/g, ' '));
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

    // Location recovery: room links are right-aligned on Testudo, so OCR
    // sometimes emits them column-wise — on their own lines, possibly after
    // a "Final TBA" row this parser skips. Collect every building+room
    // token in the block (in reading order), mark the ones a pattern
    // already claimed inline, and hand the leftovers to location-less
    // patterns in order.
    const orphanPatterns = patterns.filter((p) => !p.building && !p.room);
    if (orphanPatterns.length > 0) {
      const claimed = new Set(
        patterns.filter((p) => p.building).map((p) => `${p.building} ${p.room}`.toUpperCase()),
      );
      const tokens: { building: string; room: string }[] = [];
      const locScan = new RegExp(LOCATION_RE.source, 'g');
      let lm: RegExpExecArray | null;
      const blockNoCode = block.replace(CODE_RE, ' ');
      while ((lm = locScan.exec(blockNoCode)) !== null) {
        const key = `${lm[1]} ${lm[2]}`.toUpperCase();
        if (claimed.has(key)) {
          claimed.delete(key); // consume one claim per inline use
        } else {
          tokens.push({ building: lm[1], room: lm[2] });
        }
      }
      for (const pattern of orphanPatterns) {
        const token = tokens.shift();
        if (!token) break;
        pattern.building = token.building;
        pattern.room = token.room;
      }
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
