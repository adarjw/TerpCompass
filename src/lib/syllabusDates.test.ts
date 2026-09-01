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

  it('sorts multiple events soonest first', () => {
    const events = detectSyllabusEvents([
      chunk({ text: '2026-12-10: Final exam', detectedDate: '2026-12-10' }),
      chunk({ text: '2026-09-22: Quiz 1', detectedDate: '2026-09-22' }),
      chunk({ text: '2026-11-03: Project 1 due', detectedDate: '2026-11-03' }),
    ]);
    expect(events.map((e) => e.dateISO)).toEqual(['2026-09-22', '2026-11-03', '2026-12-10']);
  });
});
