/**
 * Classify syllabus/resource chunks that mention a quiz, exam, or
 * homework/project deadline on their detected date, for the Dashboard's
 * "Detected from your syllabi" section. Deterministic, same rule as the
 * rest of this file's siblings (`syllabus.ts`, `noteSchedule.ts`): a chunk
 * is only classified when its text literally matches one of the keyword
 * patterns below, and only on a line `chunkResourceText` already found an
 * explicit date on — nothing here invents a date or a kind.
 */

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

function classifyKind(text: string): SyllabusEventKind | null {
  for (const { kind, pattern } of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

export interface DetectedSyllabusEvent {
  kind: SyllabusEventKind;
  dateISO: string;
  /** Lecture/topic text on that line, if any — never invented. */
  topic: string | null;
  courseId: string;
  sourceFilename: string;
  page: number | null;
  chunkId: string;
}

/**
 * Scan chunks for a dated line that also mentions an exam/quiz/deadline
 * keyword. One event per matching chunk, sorted soonest first. Callers
 * filter to future-only and dedupe against existing calendar entries as
 * needed — this function only extracts, it never decides what to show.
 */
export function detectSyllabusEvents(chunks: ResourceChunk[]): DetectedSyllabusEvent[] {
  const out: DetectedSyllabusEvent[] = [];
  for (const chunk of chunks) {
    if (!chunk.detectedDate) continue;
    const kind = classifyKind(chunk.text);
    if (!kind) continue;
    out.push({
      kind,
      dateISO: chunk.detectedDate,
      topic: chunk.detectedTopic,
      courseId: chunk.courseId,
      sourceFilename: chunk.sourceFilename,
      page: chunk.page,
      chunkId: chunk.id,
    });
  }
  return out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
}
