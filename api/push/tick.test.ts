import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Same regression this guards against as sync.test.ts: @vercel/blob's put()
// throws on an existing path unless `allowOverwrite: true` is passed. tick.ts
// rewrites each device's record (with the sent notifications trimmed out) to
// that same existing path on every run, so this call is hit on essentially
// every tick once a device has ever synced.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (_path: string, _body: string, opts: Record<string, unknown>) => {
    if (!opts?.allowOverwrite) {
      throw new Error(
        'Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.',
      );
    }
    return { url: 'https://blob.example/test' };
  }),
  list: vi.fn(),
  get: vi.fn(),
  del: vi.fn(async () => {}),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => {}),
  },
}));

import { get, list, put } from '@vercel/blob';
import webpush from 'web-push';
import handler from './tick';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as unknown as VercelResponse & { status: typeof status; json: typeof json };
}

function recordStream(record: unknown) {
  return new Response(JSON.stringify(record)).body;
}

const SECRET = 'test-secret';

beforeEach(() => {
  process.env.PUSH_TICK_SECRET = SECRET;
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PUSH_TICK_SECRET;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe('GET /api/push/tick auth', () => {
  it('rejects a missing/incorrect secret', async () => {
    const res = mockRes();
    const req = { headers: {}, query: {} } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts the secret via query param', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [] } as never);
    const res = mockRes();
    const req = { headers: {}, query: { secret: SECRET } } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('sending due notifications', () => {
  it('sends a due notification and rewrites the record with allowOverwrite: true', async () => {
    const record = {
      subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } },
      notifications: [
        { fireAt: new Date().toISOString(), title: 'Leave now', body: 'Go!' },
        { fireAt: new Date(Date.now() + 600000).toISOString(), title: 'Later', body: 'Not yet' },
      ],
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'push/abc.json', url: 'https://blob.example/push/abc.json' }] } as never);
    vi.mocked(get).mockResolvedValue({ stream: recordStream(record) } as never);

    const res = mockRes();
    const req = { headers: {}, query: { secret: SECRET } } as unknown as VercelRequest;

    await handler(req, res);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      'push/abc.json',
      expect.any(String),
      expect.objectContaining({ allowOverwrite: true }),
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true, devices: 1, sent: 1, deleted: 0 });
  });

  it('deletes the record when the subscription is gone (410)', async () => {
    const record = {
      subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } },
      notifications: [{ fireAt: new Date().toISOString(), title: 'Leave now', body: 'Go!' }],
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'push/abc.json', url: 'https://blob.example/push/abc.json' }] } as never);
    vi.mocked(get).mockResolvedValue({ stream: recordStream(record) } as never);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

    const res = mockRes();
    const req = { headers: {}, query: { secret: SECRET } } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, devices: 1, sent: 0, deleted: 1 });
  });
});
