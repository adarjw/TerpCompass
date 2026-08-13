import { describe, expect, it } from 'vitest';
import { generateSessions, whereShouldIBe } from './sessions';
import type { Course, MeetingPattern } from './types';

let counter = 0;
const makeId = () => `id-${counter++}`;

const baseCourse: Course = {
  id: 'course-1',
  code: 'CMSC216',
  name: 'Intro to Computer Systems',
  professor: 'Prof. Rivera',
  semesterStart: '2026-08-31',
  semesterEnd: '2026-09-11',
  createdAt: new Date().toISOString(),
};

const lecturePattern: MeetingPattern = {
  id: 'pattern-1',
  courseId: 'course-1',
  label: 'lecture',
  building: 'IRB',
  room: '0324',
  meetingDays: [1, 3, 5],
  startTime: '10:00',
  endTime: '10:50',
};

describe('generateSessions', () => {
  it('creates one session per meeting day in range', () => {
    const sessions = generateSessions(baseCourse, [lecturePattern], makeId);
    expect(sessions.map((s) => s.date)).toEqual([
      '2026-08-31', '2026-09-02', '2026-09-04',
      '2026-09-07', '2026-09-09', '2026-09-11',
    ]);
    expect(sessions.every((s) => s.status === 'scheduled')).toBe(true);
    expect(sessions.every((s) => s.building === 'IRB' && s.room === '0324')).toBe(true);
  });

  it('excludes holiday dates', () => {
    const sessions = generateSessions(baseCourse, [lecturePattern], makeId, new Set(['2026-09-07']));
    expect(sessions.find((s) => s.date === '2026-09-07')).toBeUndefined();
  });

  it('generates sessions for every meeting pattern (lecture + discussion)', () => {
    const discussion: MeetingPattern = {
      id: 'pattern-2',
      courseId: 'course-1',
      label: 'discussion',
      building: 'IRB',
      room: '0201',
      meetingDays: [5],
      startTime: '11:00',
      endTime: '11:50',
    };
    const sessions = generateSessions(baseCourse, [lecturePattern, discussion], makeId);
    const discussionSessions = sessions.filter((s) => s.patternLabel === 'discussion');
    // Fridays between 2026-08-31 (Mon) and 2026-09-11 (Fri): 9/4 and 9/11.
    expect(discussionSessions.map((s) => s.date)).toEqual(['2026-09-04', '2026-09-11']);
    expect(discussionSessions.every((s) => s.room === '0201')).toBe(true);
  });
});

describe('whereShouldIBe', () => {
  const coursesById = new Map([[baseCourse.id, baseCourse]]);

  it('reports the current class when now falls within a session', () => {
    const sessions = generateSessions(baseCourse, [lecturePattern], makeId);
    const now = new Date(2026, 7, 31, 10, 20); // Aug 31 2026, 10:20am
    const info = whereShouldIBe(sessions, coursesById, now);
    expect(info.current?.session.date).toBe('2026-08-31');
  });

  it('reports the next class when between sessions', () => {
    const sessions = generateSessions(baseCourse, [lecturePattern], makeId);
    const now = new Date(2026, 7, 31, 11, 0); // just after the Aug 31 class ends
    const info = whereShouldIBe(sessions, coursesById, now);
    expect(info.current).toBeNull();
    expect(info.next?.session.date).toBe('2026-09-02');
  });

  it('never offers a canceled or already-attended session', () => {
    const sessions = generateSessions(baseCourse, [lecturePattern], makeId).map((s) =>
      s.date === '2026-08-31' ? { ...s, status: 'attended' as const } : s,
    );
    const now = new Date(2026, 7, 31, 10, 20);
    const info = whereShouldIBe(sessions, coursesById, now);
    expect(info.current).toBeNull();
    expect(info.next?.session.date).toBe('2026-09-02');
  });
});
