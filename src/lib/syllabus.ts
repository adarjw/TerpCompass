/**
 * Local text analysis for uploaded resources: chunking, date detection, and
 * topic extraction. Everything here is deterministic — a fact is only
 * emitted when it literally appears in the source text, and each chunk keeps
 * its source filename and page number for citations.
 */

import { parseISODate } from './time';
import type { ResourceChunk } from './types';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Find the first date in a line of text. Supports "9/15", "9/15/2026",
 * "Sep 15", "September 15, 2026", "2026-09-15". Year-less dates resolve
 * against `defaultYear` (typically the semester year).
 */
export function detectDate(line: string, defaultYear: number): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(line);
  if (iso && parseISODate(iso[0])) return iso[0];

  const slash = /(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:$|[^\d/])/.exec(line);
  if (slash) {
    const mo = Number(slash[1]);
    const d = Number(slash[2]);
    let y = slash[3] ? Number(slash[3]) : defaultYear;
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (parseISODate(s)) return s;
    }
  }

  const monthName =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(
      line,
    );
  if (monthName) {
    const mo = MONTHS[monthName[1].toLowerCase()];
    const d = Number(monthName[2]);
    const y = monthName[3] ? Number(monthName[3]) : defaultYear;
    if (mo && d >= 1 && d <= 31) {
      const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (parseISODate(s)) return s;
    }
  }
  return null;
}

/**
 * Extract a topic phrase from a schedule-style line after stripping the date
 * and common prefixes ("Week 3:", "Lecture 7 -"). Returns null rather than
 * inventing anything when nothing meaningful remains.
 */
export function detectTopic(line: string): string | null {
  let s = line
    // Strip detected date forms.
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
      ' ',
    )
    // Strip structural prefixes.
    .replace(/^\s*(week|lecture|class|session|day|unit|module)\s*#?\d+\s*[:.–-]?\s*/i, '')
    .replace(/^\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s*[:.,–-]?\s*/i, '')
    .replace(/^[\s:;,.–—-]+|[\s:;,.–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ');
  if (s.length < 3) return null;
  // A bare number or punctuation is not a topic.
  if (/^[\d\s\W]+$/.test(s)) return null;
  // Syllabus schedule lines are often "Topic. Reading/assignment detail." —
  // keep just the topic sentence; the full line is still stored on the chunk
  // for readings/problems extraction, so nothing is lost, only mislabeled.
  const firstSentence = /^(.+?[a-z0-9)])\.\s+\S/i.exec(s);
  if (firstSentence && firstSentence[1].length >= 3) {
    return firstSentence[1];
  }
  return s;
}

export interface ChunkInput {
  resourceId: string;
  courseId: string;
  sourceFilename: string;
  /** Pages of text; single-element array for non-paginated sources. */
  pages: { page: number | null; text: string }[];
  defaultYear: number;
}

/**
 * Split extracted text into line-group chunks, tagging each with any
 * detected date and topic. Chunks are small (a schedule row or paragraph)
 * so citations point close to the actual content.
 */
export function chunkResourceText(
  input: ChunkInput,
  makeId: () => string,
): ResourceChunk[] {
  const chunks: ResourceChunk[] = [];
  let ordinal = 0;
  for (const { page, text } of input.pages) {
    // Group into paragraphs, but keep single schedule-like lines separate.
    const lines = text.split(/\r\n|\n|\r/);
    let buffer: string[] = [];
    const flush = () => {
      const joined = buffer.join('\n').trim();
      buffer = [];
      if (!joined) return;
      const date = detectDate(joined, input.defaultYear);
      chunks.push({
        id: makeId(),
        resourceId: input.resourceId,
        courseId: input.courseId,
        sourceFilename: input.sourceFilename,
        page,
        text: joined.slice(0, 2000),
        detectedDate: date,
        detectedTopic: date ? detectTopic(joined.split('\n')[0]) : null,
        ordinal: ordinal++,
      });
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        flush();
        continue;
      }
      const hasDate = detectDate(trimmed, input.defaultYear) != null;
      if (hasDate) {
        // Date-bearing lines become their own chunks (schedule rows).
        flush();
        buffer = [trimmed];
        flush();
      } else {
        buffer.push(trimmed);
        if (buffer.join(' ').length > 800) flush();
      }
    }
    flush();
  }
  return chunks;
}

/** Chunks whose detected date matches the given session date exactly. */
export function chunksForDate(
  chunks: ResourceChunk[],
  dateISO: string,
): ResourceChunk[] {
  return chunks.filter((c) => c.detectedDate === dateISO);
}

/**
 * Chunks in a window around the date (for prerequisites / nearby context).
 * `before` and `after` are day counts.
 */
export function chunksNearDate(
  chunks: ResourceChunk[],
  dateISO: string,
  before: number,
  after: number,
): ResourceChunk[] {
  const target = parseISODate(dateISO);
  if (!target) return [];
  const t = new Date(target.y, target.m - 1, target.d, 12).getTime();
  const DAY = 86400000;
  return chunks
    .filter((c) => {
      if (!c.detectedDate) return false;
      const p = parseISODate(c.detectedDate);
      if (!p) return false;
      const ct = new Date(p.y, p.m - 1, p.d, 12).getTime();
      return ct >= t - before * DAY && ct <= t + after * DAY;
    })
    .sort((a, b) => (a.detectedDate! < b.detectedDate! ? -1 : 1));
}
