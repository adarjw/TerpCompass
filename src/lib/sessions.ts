/**
 * Class-session generation and "where should I be right now" selection.
 */

import { datesForPattern, localDateTime, toISODate } from './time';
import type { ClassSession, Course, MeetingPattern, SessionStatus } from './types';

/**
 * Generate one session record per concrete meeting of every meeting pattern
 * (lecture, discussion, lab, ...) belonging to a course, between the
 * course's semester dates, skipping any excluded dates (holidays/breaks).
 */
export function generateSessions(
  course: Pick<Course, 'id' | 'semesterStart' | 'semesterEnd'>,
  patterns: MeetingPattern[],
  makeId: () => string,
  excludedDates: ReadonlySet<string> = new Set(),
): ClassSession[] {
  const sessions: ClassSession[] = [];
  for (const pattern of patterns) {
    const dates = datesForPattern(
      course.semesterStart,
      course.semesterEnd,
      pattern.meetingDays,
      excludedDates,
    );
    for (const date of dates) {
      sessions.push({
        id: makeId(),
        courseId: course.id,
        patternId: pattern.id,
        patternLabel: pattern.label,
        date,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        building: pattern.building,
        room: pattern.room,
        status: 'scheduled' as SessionStatus,
      });
    }
  }
  return sessions.sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date),
  );
}

export interface SessionWithCourse {
  session: ClassSession;
  course: Course;
}

export interface NowInfo {
  /** A class in progress right now, if any. */
  current: SessionWithCourse | null;
  /** The next upcoming class (today or later). */
  next: SessionWithCourse | null;
  /** Remaining sessions today (including current/next). */
  todayRemaining: SessionWithCourse[];
}

const ACTIVE: SessionStatus[] = ['scheduled', 'moved'];

export function sessionStart(s: ClassSession): Date | null {
  return localDateTime(s.date, s.startTime);
}

export function sessionEnd(s: ClassSession): Date | null {
  return localDateTime(s.date, s.endTime);
}

/**
 * Answer "where am I supposed to be right now?" given all sessions.
 * Canceled and already-attended/absent sessions are never offered.
 */
export function whereShouldIBe(
  sessions: ClassSession[],
  coursesById: Map<string, Course>,
  now: Date,
): NowInfo {
  const todayISO = toISODate(now);
  const active = sessions
    .filter((s) => ACTIVE.includes(s.status) && coursesById.has(s.courseId))
    .map((s) => ({ session: s, course: coursesById.get(s.courseId)! }));

  let current: SessionWithCourse | null = null;
  let next: SessionWithCourse | null = null;

  const upcoming = active
    .filter((sc) => {
      const end = sessionEnd(sc.session);
      return end != null && end.getTime() > now.getTime();
    })
    .sort((a, b) => {
      const sa = sessionStart(a.session)!.getTime();
      const sb = sessionStart(b.session)!.getTime();
      return sa - sb;
    });

  for (const sc of upcoming) {
    const start = sessionStart(sc.session)!;
    if (start.getTime() <= now.getTime()) {
      if (!current) current = sc;
    } else if (!next) {
      next = sc;
    }
    if (current && next) break;
  }

  const todayRemaining = upcoming.filter((sc) => sc.session.date === todayISO);
  return { current, next, todayRemaining };
}

/** Sessions on a given date, sorted by start time. */
export function sessionsOn(
  sessions: ClassSession[],
  dateISO: string,
): ClassSession[] {
  return sessions
    .filter((s) => s.date === dateISO)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}
