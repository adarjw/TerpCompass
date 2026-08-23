/**
 * Web Push for the installed PWA (opt-in, off by default).
 *
 * A closed browser tab can't fire OS alarms, so web reminders are delivered
 * as real push notifications: the browser holds a push subscription, and the
 * app's own relay (/api/push on the same Vercel deployment) sends each
 * reminder at its scheduled minute.
 *
 * Privacy: the relay stores exactly one record per subscription — the push
 * endpoint plus the pending reminder texts — replaced wholesale on every
 * sync, trimmed as reminders are sent, and deleted on disable. Nothing else
 * leaves the device.
 */

import { Platform } from 'react-native';
import { planNotifications, type PlanInput } from '../lib/notificationPlan';
import type { AppSettings } from '../lib/types';

/** VAPID public key — public by design; the private half lives only in the relay's env. */
export const VAPID_PUBLIC_KEY =
  'BIawmPcRlL3XZN4zm8-xYrv4tL47T19rQujZ1-4auThhR7UTplUkcydGf3xuedYnhKzQkkOW__uVGwgCywAhl7s';

export function isPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export type PushResult = { ok: true } | { ok: false; error: string };

/** Ask permission and subscribe. Must be called from a user gesture. */
export async function enableWebPush(): Promise<PushResult> {
  if (!isPushSupported()) {
    return {
      ok: false,
      error:
        'Push is not available in this browser. On iPhone, add the app to your home screen first (iOS 16.4+), then enable this from the installed app.',
    };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, error: 'Notification permission was declined.' };
    }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) {
      await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Replace the relay's record for this device with the current upcoming plan.
 * No-op unless push is enabled, supported, and subscribed.
 */
export async function syncWebPush(
  input: PlanInput,
  settings: AppSettings,
  now: Date = new Date(),
): Promise<void> {
  if (!settings.webPushEnabled) return;
  const sub = await getSubscription();
  if (!sub) return;
  const planned = planNotifications(input, settings, now);
  try {
    const res = await fetch('/api/push/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        notifications: planned.map((p) => ({
          fireAt: p.fireAt.toISOString(),
          title: p.title,
          body: p.body,
          ...(p.startTime && { startTime: p.startTime }),
        })),
      }),
    });
    // fetch() only rejects on network-level failures — a 4xx/5xx response
    // resolves normally, so an unchecked call here would silently treat a
    // broken relay as a successful sync indefinitely (this is exactly how a
    // real production bug went unnoticed: every sync after the first for a
    // device 500'd, and nothing surfaced it until a user reported missing
    // notifications). Logging keeps a future regression visible in the
    // console instead of failing silently forever.
    if (!res.ok) {
      console.error(`Web push sync failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error('Web push sync failed (network error):', e);
    // Offline failures still aren't fatal — the next schedule change or app
    // open (see AppContext's sync-on-open effect) retries automatically.
  }
}

/** Unsubscribe and delete this device's record from the relay. */
export async function disableWebPush(): Promise<void> {
  const sub = await getSubscription();
  if (!sub) return;
  try {
    await fetch('/api/push/sync', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Even if the relay is unreachable, still unsubscribe locally; its
    // record dies on the next failed send or the staleness sweep.
  }
  try {
    await sub.unsubscribe();
  } catch {
    // Ignore — the subscription may already be gone.
  }
}
