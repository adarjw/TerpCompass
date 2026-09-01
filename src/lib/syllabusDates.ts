/**
 * Classify syllabus/resource chunks that mention a quiz, exam, or
 * homework/project deadline on their detected date, for the Dashboard's
 * "Detected from your syllabi" section. Deterministic, same rule as the
 * rest of this file's siblings (`syllabus.ts`, `noteSchedule.ts`): a chunk
 * is only classified when its text literally matches one of the keyword
 * patterns below, and only on a line `chunkResourceText` already found an
 * explicit date on — nothing here invents a date or a kind.
 */

import { detectTopic } from './syllabus';
import type { ResourceChunk } from './types';

export type SyllabusEventKind = 'exam' | 'quiz' | 'homework';

export const SYLLABUS_EVENT_LABEL: Record<SyllabusEventKind, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  homework: 'Homework/Project',
};

// Checked in order, first match wins — a chunk mentioning both "exam" and
// "due" (e.g. "Midterm review due before exam") is an exam, not a deadline.
// "midterm"/"final" alone don't count as the exam itself when immediately
// followed by "review" ("Midterm review session" is a lead-up class, not
// the exam) — the actual exam gets its own dated line elsewhere.
const KIND_PATTERNS: { kind: SyllabusEventKind; pattern: RegExp }[] = [
  { kind: 'exam', pattern: /\bexam\b|\b(?:midterm|final)\b(?!\s+review)/i },
  { kind: 'quiz', pattern: /\b(quiz|test)\b/i },
  {
    kind: 'homework',
    pattern:
      /\b(project|paper|assignment|problem set|pset|hw|homework)\s*(#?\d+)?\s*(is\s+)?due\b|\bdue\b/i,
  },
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
    pattern: /\b(project|paper|assignment|problem set|pset|hw|homework)\s*(#?\d+)?\s*(is\s+)?due\b/i,
  },
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

      const kind = classifyKind(chunk.text);
      if (kind) {
        out.push({
          kind,
          dateISO: chunk.detectedDate,
          topic: chunk.detectedTopic,
          courseId: chunk.courseId,
          sourceFilename: chunk.sourceFilename,
          page: chunk.page,
          chunkId: chunk.id,
        });
        continue;
      }

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
  return out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
}
