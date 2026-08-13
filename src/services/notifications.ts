/**
 * Local notification scheduling — no server push anywhere.
 *
 * Strategy: whenever the schedule or settings change, cancel everything we
 * previously scheduled and re-schedule the next batch (OS limits scheduled
 * notifications, so we keep the nearest ~60). Each scheduled id is recorded
 * in the notifications table so a reschedule never orphans anything.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SqlExecutor } from '../db/database';
import { notificationsRepo, settingsRepo } from '../db/repo';
import { makeId } from '../lib/ids';
import { sessionStart } from '../lib/sessions';
import { formatTime12, localDateTime, toISODate } from '../lib/time';
import type {
  CampusLocation,
  CatchUpTask,
  ClassSession,
  Course,
  NotificationKind,
  ScheduledNotificationRecord,
} from '../lib/types';
import { estimateWalk, leaveAt } from '../lib/walking';
import { findBuilding } from '../lib/campus';

const MAX_SCHEDULED = 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

interface PlannedNotification {
  kind: NotificationKind;
  sessionId: string | null;
  fireAt: Date;
  title: string;
  body: string;
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
    });
  }
  if (enabled.before20) {
    out.push({
      kind: 'before_20',
      sessionId: session.id,
      fireAt: new Date(start.getTime() - 20 * 60000),
      title: `${course.code} in 20 minutes`,
      body: `${label} — ${where}.`,
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
    });
  }
  if (enabled.before10) {
    out.push({
      kind: 'before_10',
      sessionId: session.id,
      fireAt: new Date(start.getTime() - 10 * 60000),
      title: `${course.code} in 10 minutes`,
      body: `${where}. Almost time.`,
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

export interface RescheduleInput {
  sessions: ClassSession[];
  courses: Course[];
  buildings: CampusLocation[];
  tasks: CatchUpTask[];
  now?: Date;
}

/**
 * Cancel all previously-scheduled notifications and schedule the upcoming
 * batch according to current settings. Safe to call after any change.
 */
export async function rescheduleAll(
  db: SqlExecutor,
  input: RescheduleInput,
): Promise<{ scheduled: number; permission: boolean }> {
  const now = input.now ?? new Date();
  const settings = await settingsRepo.get(db);
  const n = settings.notifications;

  if (Platform.OS === 'web') {
    return { scheduled: 0, permission: false };
  }
  const permission = await ensurePermissions();
  if (!permission) {
    return { scheduled: 0, permission: false };
  }

  // Cancel everything we own (and anything stale from prior runs).
  await Notifications.cancelAllScheduledNotificationsAsync();

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
    planned.push(
      ...morningSummaries(input.sessions, coursesById, n.morningSummaryTime, now, 7),
    );
  }
  if (n.catchUpReminders) {
    planned.push(...catchUpReminders(input.tasks, coursesById, now));
  }

  planned = planned
    .filter((p) => p.fireAt.getTime() > now.getTime() + 15000)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_SCHEDULED);

  const records: ScheduledNotificationRecord[] = [];
  for (const p of planned) {
    try {
      const osId = await Notifications.scheduleNotificationAsync({
        content: { title: p.title, body: p.body, sound: true },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: p.fireAt,
        },
      });
      records.push({
        id: makeId(),
        osNotificationId: osId,
        sessionId: p.sessionId,
        kind: p.kind,
        fireAt: p.fireAt.toISOString(),
      });
    } catch {
      // A single failed schedule shouldn't abort the rest.
    }
  }
  await notificationsRepo.replaceAll(db, records);
  return { scheduled: records.length, permission: true };
}
