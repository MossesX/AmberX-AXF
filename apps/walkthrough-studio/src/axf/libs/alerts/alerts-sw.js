/* AmberX AXF alerts — web push service worker (alerts library). The app registers it from Settings → Alerts.
 * A push payload is JSON: { title, body, url, tag, severity }. Tapping the notification opens `url` (same app only). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Alert', body: event.data ? event.data.text() : '' }; }
  const title = String(d.title || 'Alert').slice(0, 120);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || '').slice(0, 400),
    tag: d.tag ? String(d.tag).slice(0, 120) : undefined,
    renotify: !!d.tag,
    requireInteraction: d.severity === 'critical',
    data: { url: typeof d.url === 'string' ? d.url : '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  // only open pages of this app (never an arbitrary site from a payload)
  let url = new URL('/', self.location.origin);
  try { const u = new URL(raw, self.location.origin); if (u.origin === self.location.origin) url = u; } catch { /* keep the app root */ }
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const t of tabs) if (new URL(t.url).origin === url.origin && 'focus' in t) { await t.focus(); if ('navigate' in t) await t.navigate(url.href).catch(() => {}); return; }
    await self.clients.openWindow(url.href);
  })());
});
