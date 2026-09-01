import { describe, expect, it } from 'vitest';
import { detectSyllabusEvents } from './syllabusDates';
import type { ResourceChunk } from './types';

let n = 0;
function chunk(overrides: Partial<ResourceChunk>): ResourceChunk {
  n += 1;
  return {
    id: `c${n}`,
    resourceId: 'r1',
    courseId: 'course1',
    sourceFilename: 'syllabus.pdf',
    page: 1,
    text: '',
    detectedDate: null,
    detectedTopic: null,
    ordinal: n,
    ...overrides,
  };
}

describe('detectSyllabusEvents', () => {
  it('classifies a dated exam line', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '2026-10-14: Midterm exam', detectedDate: '2026-10-14', detectedTopic: 'Midterm exam' }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('exam');
    expect(events[0].dateISO).toBe('2026-10-14');
  });

  it('classifies a dated quiz line', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '9/22: Quiz 2 on recursion', detectedDate: '2026-09-22', detectedTopic: 'Quiz 2 on recursion' }),
    ]);
    expect(events[0].kind).toBe('quiz');
  });

  it('classifies a dated homework-due line', () => {
    const events = detectSyllabusEvents([
      chunk({ text: 'Nov 3: Problem set 4 due', detectedDate: '2026-11-03', detectedTopic: 'Problem set 4 due' }),
    ]);
    expect(events[0].kind).toBe('homework');
  });

  it('treats an exam+due line as an exam, not a deadline', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '2026-12-10: Final exam, study guide due', detectedDate: '2026-12-10' }),
    ]);
    expect(events[0].kind).toBe('exam');
  });

  it('ignores chunks with no detected date, even with exam keywords', () => {
    const events = detectSyllabusEvents([
      chunk({ text: 'The final exam will cover chapters 1-10.', detectedDate: null }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('does not classify a review session as the exam itself', () => {
    // Regression: caught by manual testing — "Midterm review session" was
    // wrongly tagged as an exam on the dashboard, when the actual midterm
    // has its own dated line elsewhere in the syllabus.
    const events = detectSyllabusEvents([
      chunk({
        text: 'Midterm review session. Attendance strongly recommended.',
        detectedDate: '2026-10-10',
      }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('still classifies the actual exam when "review" is not adjacent', () => {
    const events = detectSyllabusEvents([
      chunk({ text: 'Midterm exam in class', detectedDate: '2026-10-13' }),
    ]);
    expect(events[0].kind).toBe('exam');
  });

  it('ignores dated chunks with no exam/quiz/deadline keyword', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '2026-09-01: Introduction to the course', detectedDate: '2026-09-01' }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('carries through course, citation, and topic fields untouched', () => {
    const events = detectSyllabusEvents([
      chunk({
        text: '2026-10-14: Midterm exam',
        detectedDate: '2026-10-14',
        detectedTopic: 'Midterm exam',
        courseId: 'cmsc131',
        sourceFilename: 'cmsc131-syllabus.pdf',
        page: 2,
      }),
    ]);
    expect(events[0]).toMatchObject({
      courseId: 'cmsc131',
      sourceFilename: 'cmsc131-syllabus.pdf',
      page: 2,
      topic: 'Midterm exam',
    });
  });

  it('detects an exam from a two-line "date / description" list item', () => {
    // A common "Important Dates" list format: the date and the event
    // description are separate bullet lines, not one schedule-row line.
    const events = detectSyllabusEvents([
      chunk({ text: '10/15', detectedDate: '2026-10-15', ordinal: 1 }),
      chunk({ text: 'Midterm Exam', detectedDate: null, ordinal: 2 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'exam', dateISO: '2026-10-15' });
  });

  it('detects an exam from a sentence hard-wrapped across lines (keyword before the date)', () => {
    // PDF text extraction often preserves visual line wraps, splitting one
    // sentence into separate chunks: the keyword lands in the line before
    // the one bearing the date.
    const events = detectSyllabusEvents([
      chunk({ text: 'The final exam is scheduled for', detectedDate: null, ordinal: 1 }),
      chunk({ text: 'December 15th at 2:00 PM in the usual room.', detectedDate: '2026-12-15', ordinal: 2 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'exam', dateISO: '2026-12-15' });
  });

  it('derives a topic from the neighboring line when the dated line has none', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '10/15', detectedDate: '2026-10-15', detectedTopic: null, ordinal: 1 }),
      chunk({ text: 'Midterm Exam', detectedDate: null, ordinal: 2 }),
    ]);
    expect(events[0].topic).toBe('Midterm Exam');
  });

  it('does not misattribute a keyword to an unrelated adjacent dated chunk', () => {
    // Two back-to-back schedule rows, each with its own date — the
    // keyword-less first row must not borrow "exam" from the second row's
    // own, separately-dated event.
    const events = detectSyllabusEvents([
      chunk({ text: '2026-09-10: Discussion section', detectedDate: '2026-09-10', ordinal: 1 }),
      chunk({ text: '2026-09-13: Midterm exam', detectedDate: '2026-09-13', ordinal: 2 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].dateISO).toBe('2026-09-13');
  });

  it('matches a keyword two chunks away (within the neighbor window)', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '10/15', detectedDate: '2026-10-15', ordinal: 1 }),
      chunk({ text: '(in the usual classroom)', detectedDate: null, ordinal: 2 }),
      chunk({ text: 'Final Exam', detectedDate: null, ordinal: 3 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('exam');
  });

  it('does not match a keyword three chunks away (outside the neighbor window)', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '10/15', detectedDate: '2026-10-15', ordinal: 1 }),
      chunk({ text: 'filler one', detectedDate: null, ordinal: 2 }),
      chunk({ text: 'filler two', detectedDate: null, ordinal: 3 }),
      chunk({ text: 'Final Exam', detectedDate: null, ordinal: 4 }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('does not borrow "final" from an unrelated attendance-policy sentence', () => {
    // Regression: found via manual testing against the demo syllabus. A
    // "Midterm review session" chunk (correctly not an exam on its own) sat
    // two chunks away from an attendance-policy line mentioning "10% of the
    // final grade" — an unrelated use of "final". The neighbor fallback
    // must not borrow it and misclassify the review session as an exam.
    const events = detectSyllabusEvents([
      chunk({ text: '2026-09-08: Signals. Read Chapter 8.', detectedDate: '2026-09-08', ordinal: 1 }),
      chunk({
        text: '2026-09-10: Midterm review session. Attendance strongly recommended.',
        detectedDate: '2026-09-10',
        ordinal: 2,
      }),
      chunk({ text: '2026-09-13: Midterm exam in class.', detectedDate: '2026-09-13', ordinal: 3 }),
      chunk({
        text: 'Attendance policy: In-class exercises count 10% of the final grade. No make-ups.',
        detectedDate: null,
        ordinal: 4,
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].dateISO).toBe('2026-09-13');
  });

  it('does not borrow a bare "due" from unrelated policy text', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '10/1', detectedDate: '2026-10-01', ordinal: 1 }),
      chunk({ text: 'Guest lecture on compilers', detectedDate: null, ordinal: 2 }),
      chunk({ text: 'Late work is due within 48 hours of the original deadline.', detectedDate: null, ordinal: 3 }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('keeps neighbor matching scoped to chunks from the same resource', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '10/15', detectedDate: '2026-10-15', ordinal: 1, resourceId: 'rA' }),
      chunk({ text: 'Midterm Exam', detectedDate: null, ordinal: 2, resourceId: 'rB' }),
    ]);
    expect(events).toHaveLength(0);
  });

  it('sorts multiple events soonest first', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '2026-12-10: Final exam', detectedDate: '2026-12-10' }),
      chunk({ text: '2026-09-22: Quiz 1', detectedDate: '2026-09-22' }),
      chunk({ text: '2026-11-03: Project 1 due', detectedDate: '2026-11-03' }),
    ]);
    expect(events.map((e) => e.dateISO)).toEqual(['2026-09-22', '2026-11-03', '2026-12-10']);
  });
});
