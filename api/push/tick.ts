/**
 * Relay tick: called every ~1 minute by an external cron pinger (GitHub
 * Actions' own `schedule:` trigger is unreliable below ~5 minutes in
 * practice regardless of the cron expression, so it's kept only as a
 * redundant backup — see .github/workflows/push-tick.yml). Sends every
 * reminder that is due, rewrites each record with only what's still
 * pending, and deletes records whose subscription is gone (410/404) or
 * that have been empty for 45+ days. Protected by PUSH_TICK_SECRET.
 */

import { del, get, list, put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';

/** Send anything due within the next 60 seconds: sized to a ~1-minute tick
 * cadence, so "leave now" fires close to on-time without drifting minutes
 * early the way a wider window would on a tighter cadence. */
const EARLY_WINDOW_MS = 60000;
const EMPTY_TTL_MS = 45 * 24 * 3600 * 1000;

interface StoredRecord {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  notifications: { fireAt: string; title: string; body: string; startTime?: string }[];
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.PUSH_TICK_SECRET;
  const auth = req.headers.authorization ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.query.secret ?? '');
  if (!secret || given !== secret) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    return res.status(500).json({ error: 'VAPID keys are not configured.' });
  }
  webpush.setVapidDetails(process.env.VAPID_CONTACT ?? 'mailto:push@classcompass.app', pub, priv);

  const now = Date.now();
  let sent = 0;
  let deleted = 0;
  let devices = 0;

  try {
    const { blobs } = await list({ prefix: 'push/' });
    for (const blob of blobs) {
      devices++;
      let record: StoredRecord;
      try {
        const result = await get(blob.pathname, { access: 'private' });
        if (!result?.stream) throw new Error('empty');
        record = (await new Response(result.stream).json()) as StoredRecord;
      } catch {
        await del(blob.url);
        deleted++;
        continue;
      }

      const due = record.notifications.filter((n) => {
        const t = Date.parse(n.fireAt);
        return t <= now + EARLY_WINDOW_MS && t > now - EARLY_WINDOW_MS;
      });
      const remaining = record.notifications.filter(
        (n) => Date.parse(n.fireAt) > now + EARLY_WINDOW_MS,
      );

      let gone = false;
      for (const n of due) {
        try {
          const payload: Record<string, string> = { title: n.title, body: n.body };
          if (n.startTime) {
            payload.startTime = n.startTime;
            // Recalculate body to show actual time-to-class at send time, not pre-planned time.
            const startTime = new Date(n.startTime);
            const minsToStart = Math.round((startTime.getTime() - now) / 60000);
            if (minsToStart > 0) {
              payload.body = `${minsToStart} min${minsToStart === 1 ? '' : 's'} to class. ${n.body}`;
            }
          }
          await webpush.sendNotification(record.subscription, JSON.stringify(payload));
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone = true; // Subscription expired/revoked — forget this device.
            break;
          }
          // Transient failure: drop this reminder rather than re-sending a
          // stale "leave now" on the next tick.
        }
      }

      const emptyAndStale =
        remaining.length === 0 && now - Date.parse(record.updatedAt) > EMPTY_TTL_MS;
      if (gone || emptyAndStale) {
        await del(blob.url);
        deleted++;
      } else if (due.length > 0) {
        await put(
          blob.pathname,
          JSON.stringify({ ...record, notifications: remaining }),
          { access: 'private', addRandomSuffix: false, contentType: 'application/json' },
        );
      }
    }
    return res.status(200).json({ ok: true, devices, sent, deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /BLOB_READ_WRITE_TOKEN/i.test(msg)
      ? 'Blob storage is not connected to this deployment yet.'
      : msg;
    return res.status(500).json({ error: hint });
  }
}
