/**
 * Relay sync: one record per device, replaced wholesale on every call.
 *
 * POST   { subscription, notifications: [{fireAt, title, body}] }
 * DELETE { endpoint }
 *
 * Data minimization: only the push subscription and the still-pending
 * reminder texts are stored (nearest 60, future-only, nothing past 30 days
 * out). Records die on DELETE, on push failure (410/404), and in the tick
 * sweep once empty and stale.
 */

import { del, list, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_NOTIFICATIONS = 60;
const MAX_HORIZON_MS = 30 * 24 * 3600 * 1000;

export function blobPathFor(endpoint: string): string {
  return `push/${createHash('sha256').update(endpoint).digest('hex')}.json`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') {
      const { subscription, notifications } = req.body ?? {};
      const endpoint: unknown = subscription?.endpoint;
      if (
        typeof endpoint !== 'string' ||
        !endpoint.startsWith('https://') ||
        typeof subscription?.keys?.p256dh !== 'string' ||
        typeof subscription?.keys?.auth !== 'string'
      ) {
        return res.status(400).json({ error: 'Invalid subscription.' });
      }
      const now = Date.now();
      const pending = (Array.isArray(notifications) ? notifications : [])
        .filter(
          (n: unknown): n is { fireAt: string; title: string; body: string; startTime?: string } =>
            typeof (n as { fireAt?: unknown })?.fireAt === 'string' &&
            typeof (n as { title?: unknown })?.title === 'string' &&
            typeof (n as { body?: unknown })?.body === 'string',
        )
        .map((n) => ({
          fireAt: n.fireAt,
          title: n.title.slice(0, 120),
          body: n.body.slice(0, 300),
          ...(typeof n.startTime === 'string' && { startTime: n.startTime }),
        }))
        .filter((n) => {
          const t = Date.parse(n.fireAt);
          return Number.isFinite(t) && t > now && t < now + MAX_HORIZON_MS;
        })
        .sort((a, b) => a.fireAt.localeCompare(b.fireAt))
        .slice(0, MAX_NOTIFICATIONS);

      await put(
        blobPathFor(endpoint),
        JSON.stringify({
          subscription: {
            endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          notifications: pending,
          updatedAt: new Date(now).toISOString(),
        }),
        { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' },
      );
      return res.status(200).json({ ok: true, pending: pending.length });
    }

    if (req.method === 'DELETE') {
      const endpoint: unknown = req.body?.endpoint;
      if (typeof endpoint !== 'string') {
        return res.status(400).json({ error: 'Missing endpoint.' });
      }
      const path = blobPathFor(endpoint);
      const existing = await list({ prefix: path, limit: 1 });
      for (const blob of existing.blobs) await del(blob.url);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /BLOB_READ_WRITE_TOKEN/i.test(msg)
      ? 'Blob storage is not connected to this deployment yet.'
      : msg;
    return res.status(500).json({ error: hint });
  }
}
