/**
 * ClassCompass service worker: shows web-push reminders and focuses the app
 * when one is tapped. No fetch interception — the app itself stays fully
 * network-served (no offline caching surprises).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'ClassCompass', body: '', startTime: null };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  let notifBody = payload.body;
  if (payload.startTime) {
    const start = new Date(payload.startTime);
    const now = new Date();
    const diffMs = start.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins > 0) {
      notifBody += ` (${diffMins} min)`;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: notifBody,
      icon: '/icons/terpcompass-180.png',
      badge: '/icons/terpcompass-180.png',
      tag: payload.startTime ? 'class-reminder' : undefined,
      data: payload.startTime ? { startTime: payload.startTime } : undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const url = event.notification.data?.startTime
        ? `/?showCountdown=${encodeURIComponent(event.notification.data.startTime)}`
        : '/';
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
