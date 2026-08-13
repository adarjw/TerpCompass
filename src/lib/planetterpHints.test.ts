import { describe, expect, it } from 'vitest';
import { extractAttendanceHints, summarizePolicyFromHints } from './planetterpHints';
import { defaultSemesterId, SEMESTER_PRESETS } from './semesters';

const REVIEWS = [
  {
    course: 'MATH246',
    rating: 2,
    review:
      'Her lectures were hard to follow. Attendance is taken via clickers every single class. The exams were fair though.',
  },
  {
    course: 'MATH246',
    rating: 4,
    review: 'Great professor. There are pop quizzes at the start of most lectures, so show up.',
  },
  {
    course: 'MATH140',
    rating: 3,
    review: 'Different course, but attendance was mandatory here too.',
  },
  {
    course: null,
    rating: 5,
    review: 'Nice person. Nothing about showing up to class in this one.',
  },
];

describe('extractAttendanceHints', () => {
  it('extracts only attendance-related sentences, course-tagged first', () => {
    const hints = extractAttendanceHints(REVIEWS, 'MATH246');
    expect(hints.length).toBeGreaterThanOrEqual(2);
    expect(hints[0].course).toBe('MATH246');
    expect(hints.every((h) => /attendance|clicker|pop quiz|show up|mandatory/i.test(h.text))).toBe(true);
    // The lecture-quality sentence should not leak in.
    expect(hints.some((h) => /hard to follow/i.test(h.text))).toBe(false);
  });

  it('returns nothing when reviews say nothing about attendance', () => {
    const hints = extractAttendanceHints(
      [{ course: 'CMSC216', rating: 5, review: 'Best class ever. Learned so much about C.' }],
      'CMSC216',
    );
    expect(hints).toEqual([]);
  });

  it('does not mistake "never got behind/got the hang" for attendance talk', () => {
    const hints = extractAttendanceHints(
      [
        { course: 'MATH241', rating: 4, review: 'We never got behind. I never got the hang of her exams.' },
        { course: 'MATH241', rating: 4, review: "You don't need to go to lecture honestly." },
      ],
      'MATH241',
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].text).toMatch(/don't need to go/i);
  });
});

describe('summarizePolicyFromHints', () => {
  it('composes a source-prefixed digest from hint themes', () => {
    const hints = extractAttendanceHints(REVIEWS, 'MATH246');
    const summary = summarizePolicyFromHints(hints);
    expect(summary).toMatch(/^\(From PlanetTerp student reviews/);
    expect(summary).toMatch(/clicker/i);
    expect(summary).toMatch(/quiz/i);
  });

  it('returns null instead of inventing a policy from unrelated hints', () => {
    expect(summarizePolicyFromHints([])).toBeNull();
  });
});

describe('semester presets', () => {
  it('only Summer carries sub-sessions', () => {
    const withSessions = SEMESTER_PRESETS.filter((s) => s.sessions?.length);
    expect(withSessions.map((s) => s.id)).toEqual(['summer2027']);
  });

  it('defaults to the semester containing today, else the next upcoming', () => {
    expect(defaultSemesterId(new Date(2026, 9, 15))).toBe('fall2026'); // mid-Fall
    expect(defaultSemesterId(new Date(2026, 11, 20))).toBe('winter2027'); // between terms
    expect(defaultSemesterId(new Date(2027, 6, 1))).toBe('summer2027');
  });
});
