/**
 * Classify syllabus/resource chunks that mention a quiz, exam, or
 * homework/project deadline on their detected date, for the Dashboard's
 * "Detected from your syllabi" section. Deterministic, same rule as the
 * rest of this file's siblings (`syllabus.ts`, `noteSchedule.ts`): a chunk
 * is only classified when its text literally matches one of the keyword
 * patterns below, and only on a line `chunkResourceText` already found an
 * explicit date on — nothing here invents a date or a kind.
 */

import { COLUMN_SEP } from './pdf';
import { detectTopic } from './syllabus';
import type { ResourceChunk } from './types';

export type SyllabusEventKind = 'exam' | 'quiz' | 'homework';

export const SYLLABUS_EVENT_LABEL: Record<SyllabusEventKind, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  homework: 'Homework/Project',
};

/** Lower sorts first — an exam outranks a quiz outranks a homework item
 * when a student needs to decide what to look at first this week. */
export const SYLLABUS_EVENT_PRIORITY: Record<SyllabusEventKind, number> = {
  exam: 0,
  quiz: 1,
  homework: 2,
};

/** Soonest date first, exam-before-quiz-before-homework on a tied date. */
export function compareSyllabusEventPriority(
  a: DetectedSyllabusEvent,
  b: DetectedSyllabusEvent,
): number {
  if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1;
  return SYLLABUS_EVENT_PRIORITY[a.kind] - SYLLABUS_EVENT_PRIORITY[b.kind];
}

// Item words that count as a deliverable when followed by "due" (an item
// name alone, like a stray "project" mentioned in passing, is too generic
// to trust on its own).
const DUE_ITEM = '(?:project|paper|assignment|problem set|pset|hw|homework|deliverable|lab report)';
// Words specific enough to trust as an event on their own, without needing
// "due" nearby — a scheduled presentation or capstone is a dated event by
// nature, not something that merely gets "turned in."
const STANDALONE_HOMEWORK = /\bpresentations?\b|\bcapstone\b/i;

// Checked in order, first match wins — a chunk mentioning both "exam" and
// "due" (e.g. "Midterm review due before exam") is an exam, not a deadline.
// "midterm"/"final" alone don't count as the exam itself when immediately
// followed by one of these — each is a real false-positive found via
// testing: "review" ("Midterm review session" is a lead-up class, not the
// exam), "grade" ("10% of the final grade" is unrelated policy text), and
// "project"/"paper"/"presentation" ("Final project presentations" is a
// homework/project deliverable, not the final exam). The actual exam gets
// its own dated line elsewhere.
const KIND_PATTERNS: { kind: SyllabusEventKind; pattern: RegExp }[] = [
  {
    kind: 'exam',
    pattern: /\bexam\b|\b(?:midterm|final)\b(?!\s+(?:review|grade|project|paper|presentations?))/i,
  },
  { kind: 'quiz', pattern: /\b(quiz|test)\b/i },
  {
    kind: 'homework',
    pattern: new RegExp(`\\b${DUE_ITEM}\\s*(#?\\d+)?\\s*(is\\s+)?due\\b|\\bdue\\b`, 'i'),
  },
  { kind: 'homework', pattern: STANDALONE_HOMEWORK },
];

// Used only when borrowing a keyword from a *neighboring* chunk (see
// findNeighborKeywordText below), where the match is inherently less
// reliable than one on the dated line itself. Bare "midterm"/"final" and a
// bare "due" are dropped here: caught by manual testing, a syllabus's
// attendance-policy paragraph mentioning "10% of the final grade" sitting
// two chunks away from an unrelated date was enough to misclassify it as
// an exam. Same reasoning would apply to a stray "due" in policy text like
// "late work is due within 48 hours." Only the specific, low-ambiguity
// keywords are trusted to jump across chunks.
const NEIGHBOR_KIND_PATTERNS: { kind: SyllabusEventKind; pattern: RegExp }[] = [
  { kind: 'exam', pattern: /\bexam\b/i },
  { kind: 'quiz', pattern: /\b(quiz|test)\b/i },
  {
    kind: 'homework',
    pattern: new RegExp(`\\b${DUE_ITEM}\\s*(#?\\d+)?\\s*(is\\s+)?due\\b`, 'i'),
  },
  { kind: 'homework', pattern: STANDALONE_HOMEWORK },
];

function classifyKind(
  text: string,
  patterns: { kind: SyllabusEventKind; pattern: RegExp }[] = KIND_PATTERNS,
): SyllabusEventKind | null {
  for (const { kind, pattern } of patterns) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

export interface DetectedSyllabusEvent {
  kind: SyllabusEventKind;
  dateISO: string;
  /** Lecture/topic text on that line (or the neighboring line it was
   * matched from), if any — never invented. */
  topic: string | null;
  courseId: string;
  sourceFilename: string;
  page: number | null;
  chunkId: string;
}

/** How many chunks away (same resource, either direction) to look for a
 * keyword when the dated chunk's own text doesn't have one. */
const NEIGHBOR_WINDOW = 2;

/**
 * `chunkResourceText` isolates any date-bearing line into its own small
 * chunk (so citations point at exactly where a date appears) — but that
 * means a two-line "Important Dates" list item ("10/15" on one line,
 * "Midterm Exam" on the next) or a sentence hard-wrapped across lines by
 * PDF text extraction ("The final exam is scheduled for\nDecember 15th...")
 * lands the date and the keyword in two different chunks that never get
 * compared against each other directly.
 *
 * This looks a couple of chunks either side, within the same resource and
 * in original document order, for a keyword — but only in neighbors that
 * have no detected date of their own, so a keyword-less date sitting next
 * to a *different* dated event (e.g. two schedule rows back to back) is
 * never misattributed to the wrong date.
 */
function findNeighborKeywordText(
  ordered: ResourceChunk[],
  index: number,
): string | null {
  for (let offset = 1; offset <= NEIGHBOR_WINDOW; offset++) {
    const before = ordered[index - offset];
    if (before && !before.detectedDate && classifyKind(before.text, NEIGHBOR_KIND_PATTERNS)) {
      return before.text;
    }
    const after = ordered[index + offset];
    if (after && !after.detectedDate && classifyKind(after.text, NEIGHBOR_KIND_PATTERNS)) {
      return after.text;
    }
  }
  return null;
}

/**
 * Scan chunks for a dated line that also mentions an exam/quiz/deadline
 * keyword, falling back to a nearby keyword-only line/chunk when the dated
 * line itself doesn't have one (see `findNeighborKeywordText`). One event
 * per matching chunk, sorted soonest first. Callers filter to future-only
 * and dedupe against existing calendar entries as needed — this function
 * only extracts, it never decides what to show.
 */
export function detectSyllabusEvents(chunks: ResourceChunk[]): DetectedSyllabusEvent[] {
  const byResource = new Map<string, ResourceChunk[]>();
  for (const c of chunks) {
    const list = byResource.get(c.resourceId);
    if (list) list.push(c);
    else byResource.set(c.resourceId, [c]);
  }

  const out: DetectedSyllabusEvent[] = [];
  for (const list of byResource.values()) {
    const ordered = [...list].sort((a, b) => a.ordinal - b.ordinal);
    for (let i = 0; i < ordered.length; i++) {
      const chunk = ordered[i];
      if (!chunk.detectedDate) continue;

      // A PDF table row reconstructed with column separators (see
      // pdf.ts#textFromContentStream) can genuinely hold two independent
      // events in one row — e.g. a "Quiz" column and a separate "Matlab
      // due" column. Check each cell on its own so both surface, rather
      // than classifying (and keeping only) the whole row's text once. A
      // non-table line has no separator, so `cells` is just itself — same
      // single-classification behavior as before.
      const cells = chunk.text.includes(COLUMN_SEP)
        ? chunk.text.split(COLUMN_SEP).map((c) => c.trim()).filter(Boolean)
        : [chunk.text];
      let matchedAny = false;
      for (const cell of cells) {
        const kind = classifyKind(cell);
        if (!kind) continue;
        matchedAny = true;
        out.push({
          kind,
          dateISO: chunk.detectedDate,
          topic: cells.length > 1 ? (detectTopic(cell) ?? chunk.detectedTopic) : chunk.detectedTopic,
          courseId: chunk.courseId,
          sourceFilename: chunk.sourceFilename,
          page: chunk.page,
          chunkId: chunk.id,
        });
      }
      if (matchedAny) continue;

      const neighborText = findNeighborKeywordText(ordered, i);
      if (!neighborText) continue;
      const neighborKind = classifyKind(neighborText, NEIGHBOR_KIND_PATTERNS);
      if (!neighborKind) continue;
      out.push({
        kind: neighborKind,
        dateISO: chunk.detectedDate,
        topic: chunk.detectedTopic ?? detectTopic(neighborText.split('\n')[0]),
        courseId: chunk.courseId,
        sourceFilename: chunk.sourceFilename,
        page: chunk.page,
        chunkId: chunk.id,
      });
    }
  }
  return out.sort(compareSyllabusEventPriority);
}
