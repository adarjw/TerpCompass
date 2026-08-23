/**
 * Pure notification planning — shared by the native scheduler (OS-level
 * local notifications) and the web-push sync (which mails the same plan to
 * the app's own tiny relay so a closed PWA can still get reminders).
 */

import { findBuilding } from './campus';
import { sessionStart } from './sessions';
import { formatTime12, localDateTime, toISODate } from './time';
import type {
  AppSettings,
  CampusLocation,
  CatchUpTask,
  ClassSession,
  Course,
  NotificationKind,
} from './types';
import { estimateWalk, leaveAt } from './walking';

export const MAX_SCHEDULED = 60;

export interface PlannedNotification {
  kind: NotificationKind;
  sessionId: string | null;
  fireAt: Date;
  title: string;
  body: string;
  /** ISO string of the class start time, used for client-side countdown timers. */
  startTime?: string;
}

export interface PlanInput {
  sessions: ClassSession[];
  courses: Course[];
  buildings: CampusLocation[];
  tasks: CatchUpTask[];
}

function planForSession(
  session: ClassSession,
  course: Course,
  buildings: CampusLocation[],
  home: { lat: number | null; lon: number | null },
  walkingSpeedMps: number,
  enabled: Record<string, boolean>,
): PlannedNotification[] {
  const start = sessionStart(session);
  if (!start) return [];
  const building = session.overrideBuilding ?? session.building;
  const room = session.overrideRoom ?? session.room;
  const where = [building, room].filter(Boolean).join(' ') || 'location not set';
  const label = `${course.code} at ${formatTime12(session.startTime)}`;
  const out: PlannedNotification[] = [];

  if (enabled.before45) {
    out.push({
      kind: 'before_45',
      sessionId: session.id,
      fireAt: new Date(start.getTime() - 45 * 60000),
      title: `${course.code} in 45 minutes`,
      body: `${label} — ${where}.`,
      startTime: start.toISOString(),
    });
  }
  if (enabled.before20) {
    out.push({
      kind: 'before_20',
      sessionId: session.id,
      fireAt: new Date(start.getTime() - 20 * 60000),
      title: `${course.code} in 20 minutes`,
      body: `${label} — ${where}.`,
      startTime: start.toISOString(),
    });
  }
  if (enabled.leaveNow) {
    const loc = findBuilding(buildings, building);
    const walk = estimateWalk(home, loc, walkingSpeedMps);
    const leave = leaveAt(start, walk, course);
    out.push({
      kind: 'leave_now',
      sessionId: session.id,
      fireAt: leave,
      title: `Leave now for ${course.code}`,
      body: `~${walk.minutes} min walk to ${where}. Class starts ${formatTime12(session.startTime)}.`,
      startTime: start.toISOString(),
    });
  }
  if (enabled.before10) {
    out.push({
      kind: 'before_10',
      sessionId: session.id,
      fireAt: new Date(start.getTime() - 10 * 60000),
      title: `${course.code} in 10 minutes`,
      body: `${where}. Almost time.`,
      startTime: start.toISOString(),
    });
  }
  return out;
}

function morningSummaries(
  sessions: ClassSession[],
  coursesById: Map<string, Course>,
  summaryTime: string,
  now: Date,
  days: number,
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12);
    const iso = toISODate(day);
    const todays = sessions
      .filter((s) => s.date === iso && (s.status === 'scheduled' || s.status === 'moved'))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (todays.length === 0) continue;
    const fireAt = localDateTime(iso, summaryTime);
    if (!fireAt || fireAt.getTime() <= now.getTime()) continue;
    const lines = todays.map((s) => {
      const c = coursesById.get(s.courseId);
      if (!c) return '';
      const where = [s.overrideBuilding ?? s.building, s.overrideRoom ?? s.room]
        .filter(Boolean)
        .join(' ');
      return `${formatTime12(s.startTime)} ${c.code}${where ? ` (${where})` : ''}`;
    });
    out.push({
      kind: 'morning_summary',
      sessionId: null,
      fireAt,
      title: `Today: ${todays.length} class${todays.length === 1 ? '' : 'es'}`,
      body: lines.filter(Boolean).join(' · '),
    });
  }
  return out;
}

function catchUpReminders(
  tasks: CatchUpTask[],
  coursesById: Map<string, Course>,
  now: Date,
): PlannedNotification[] {
  // One reminder per open plan-task with a due date, the evening before at 18:00.
  const out: PlannedNotification[] = [];
  for (const t of tasks) {
    if (t.done || !t.dueDate) continue;
    const evening = localDateTime(t.dueDate, '18:00');
    if (!evening) continue;
    const fireAt = new Date(evening.getTime() - 24 * 3600 * 1000);
    if (fireAt.getTime() <= now.getTime()) continue;
    const code = coursesById.get(t.courseId)?.code ?? '';
    out.push({
      kind: 'catch_up_reminder',
      sessionId: null,
      fireAt,
      title: `Catch-up: ${code}`,
      body: t.title,
    });
  }
  return out;
}

/**
 * The full upcoming plan given current data + settings: per-class reminders,
 * morning summaries, catch-up nudges — future only, soonest first, capped at
 * MAX_SCHEDULED (both the OS and the relay keep only the nearest batch).
 */
export function planNotifications(
  input: PlanInput,
  settings: AppSettings,
  now: Date,
): PlannedNotification[] {
  const n = settings.notifications;
  const coursesById = new Map(input.courses.map((c) => [c.id, c]));
  const enabled = {
    before45: n.before45,
    before20: n.before20,
    leaveNow: n.leaveNow,
    before10: n.before10,
  };
  const home = { lat: settings.homeLat, lon: settings.homeLon };

  let planned: PlannedNotification[] = [];
  for (const session of input.sessions) {
    if (session.status !== 'scheduled' && session.status !== 'moved') continue;
    const course = coursesById.get(session.courseId);
    if (!course) continue;
    planned.push(
      ...planForSession(session, course, input.buildings, home, settings.walkingSpeedMps, enabled),
    );
  }
  if (n.morningSummary) {
    planned.push(...morningSummaries(input.sessions, coursesById, n.morningSummaryTime, now, 7));
  }
  if (n.catchUpReminders) {
    planned.push(...catchUpReminders(input.tasks, coursesById, now));
  }

  return planned
    .filter((p) => p.fireAt.getTime() > now.getTime() + 15000)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_SCHEDULED);
}
