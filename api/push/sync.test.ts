import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Regression guard for a real production incident: @vercel/blob's put()
// rejects writes to an existing path unless `allowOverwrite: true` is
// passed. This relay always writes to the same deterministic path per
// device (one record per subscription, replaced wholesale on every sync),
// so a missing `allowOverwrite` breaks every sync after the first for a
// given device with a silent-looking 500. The mock below reproduces that
// exact failure so any regression fails loudly here instead of on a
// student's phone.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (_path: string, _body: string, opts: Record<string, unknown>) => {
    if (!opts?.allowOverwrite) {
      throw new Error(
        'Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.',
      );
    }
    return { url: 'https://blob.example/test' };
  }),
  list: vi.fn(async () => ({ blobs: [] })),
  del: vi.fn(async () => {}),
}));

import { del, list, put } from '@vercel/blob';
import handler from './sync';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  return { status, json, setHeader } as unknown as VercelResponse & {
    status: typeof status;
    json: typeof json;
  };
}

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/real-device-token',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('POST /api/push/sync', () => {
  it('stores a fresh subscription (first-ever sync for a device)', async () => {
    const res = mockRes();
    const req = {
      method: 'POST',
      body: {
        subscription: validSubscription,
        notifications: [
          { fireAt: new Date(Date.now() + 600000).toISOString(), title: 'Leave now', body: 'Go!' },
        ],
      },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, pending: 1 });
  });

  it('overwrites an existing subscription record without throwing (repeat sync)', async () => {
    // The exact scenario that broke in production: a second sync for the
    // same device, which writes to the same blob path as the first.
    const res = mockRes();
    const req = {
      method: 'POST',
      body: { subscription: validSubscription, notifications: [] },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, pending: 0 });
  });

  it('always passes allowOverwrite: true to put()', async () => {
    const res = mockRes();
    const req = {
      method: 'POST',
      body: { subscription: validSubscription, notifications: [] },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ allowOverwrite: true }),
    );
  });

  it('rejects a subscription missing keys', async () => {
    const res = mockRes();
    const req = {
      method: 'POST',
      body: { subscription: { endpoint: 'https://example.com/x' }, notifications: [] },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('drops notifications outside the future/30-day window', async () => {
    const res = mockRes();
    const req = {
      method: 'POST',
      body: {
        subscription: validSubscription,
        notifications: [
          { fireAt: new Date(Date.now() - 60000).toISOString(), title: 'Past', body: 'x' },
          { fireAt: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(), title: 'Far', body: 'x' },
          { fireAt: new Date(Date.now() + 600000).toISOString(), title: 'Valid', body: 'x' },
        ],
      },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, pending: 1 });
  });
});

describe('DELETE /api/push/sync', () => {
  it('deletes the matching blob', async () => {
    vi.mocked(list).mockResolvedValueOnce({
      blobs: [{ url: 'https://blob.example/push/abc.json' }],
    } as never);
    const res = mockRes();
    const req = {
      method: 'DELETE',
      body: { endpoint: 'https://fcm.googleapis.com/fcm/send/real-device-token' },
    } as unknown as VercelRequest;

    await handler(req, res);

    expect(del).toHaveBeenCalledWith('https://blob.example/push/abc.json');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('requires an endpoint', async () => {
    const res = mockRes();
    const req = { method: 'DELETE', body: {} } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('unsupported methods', () => {
  it('returns 405', async () => {
    const res = mockRes();
    const req = { method: 'GET', body: {} } as unknown as VercelRequest;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
