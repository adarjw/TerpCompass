/**
 * Local notification scheduling — no server push anywhere (web push is the
 * separate, opt-in services/webpush relay).
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
import { planNotifications, type PlanInput } from '../lib/notificationPlan';
import type { ScheduledNotificationRecord } from '../lib/types';

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

export interface RescheduleInput extends PlanInput {
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

  if (Platform.OS === 'web') {
    return { scheduled: 0, permission: false };
  }
  const permission = await ensurePermissions();
  if (!permission) {
    return { scheduled: 0, permission: false };
  }

  // Cancel everything we own (and anything stale from prior runs).
  await Notifications.cancelAllScheduledNotificationsAsync();

  const planned = planNotifications(input, settings, now);

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
