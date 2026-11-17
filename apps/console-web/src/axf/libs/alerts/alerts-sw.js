/* AmberX AXF alerts — web push service worker (alerts library). The app registers it from Settings → Alerts.
 * A push payload is JSON: { title, body, url, tag, severity, actions? }. Tapping the notification opens `url` (same app
 * only). `actions` (alert-actions@1, e.g. a veto pass's Approve / Deny): `{ id, label, post, body }` POSTs `body` to this
 * app's `post` path in the background (the app is not opened; the answer shows as a follow-up notification), `{ id,
 * label, url }` opens that page. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Offline chunk cache: an app may keep hashed build files (/assets/…) in Cache Storage `axf-plugin-chunks` (the console's
// plugin lazy loader does); those are answered from it, every other request is left to the browser as before.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return;
  event.respondWith(caches.open('axf-plugin-chunks').then((c) => c.match(req)).then((hit) => hit || fetch(req)).catch(() => fetch(req)));
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Alert', body: event.data ? event.data.text() : '' }; }
  const title = String(d.title || 'Alert').slice(0, 120);
  const acts = (Array.isArray(d.actions) ? d.actions : []).filter((a) => a && typeof a.id === 'string' && typeof a.label === 'string' && (typeof a.post === 'string' || typeof a.url === 'string')).slice(0, 3);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || '').slice(0, 400),
    tag: d.tag ? String(d.tag).slice(0, 120) : undefined,
    renotify: !!d.tag,
    requireInteraction: d.severity === 'critical' || acts.length > 0,
    ...(acts.length ? { actions: acts.map((a) => ({ action: a.id, title: a.label })) } : {}),
    data: { url: typeof d.url === 'string' ? d.url : '/', actions: acts, tag: d.tag ? String(d.tag).slice(0, 120) : undefined },
  }));
});

/** A same-origin URL for `raw`, or null (a payload never sends the worker to another site). */
function sameOrigin(raw) {
  try { const u = new URL(raw, self.location.origin); return u.origin === self.location.origin ? u : null; } catch { return null; }
}

/** A background action: POST its body, then say how it went in a follow-up notification (same tag: it replaces the ask). */
async function runPost(a, data) {
  const u = sameOrigin(a.post);
  let title = 'Not sent'; let body = '';
  if (u) {
    try {
      const r = await fetch(u.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.body || {}), credentials: 'omit', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      title = j && j.ok ? String(j.text || `${a.label}: done`) : `${a.label} failed`;
      body = j && j.ok ? '' : String((j && (j.message || j.code)) || `HTTP ${r.status}`);
    } catch (e) { title = `${a.label} failed`; body = String((e && e.message) || e); }
  }
  await self.registration.showNotification(title.slice(0, 120), { body: body.slice(0, 400), tag: data.tag, data: { url: data.url || '/' } });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const act = event.action ? (Array.isArray(data.actions) ? data.actions : []).find((a) => a.id === event.action) : null;
  if (act && typeof act.post === 'string') { event.waitUntil(runPost(act, data)); return; }
  const raw = (act && typeof act.url === 'string' && act.url) || data.url || '/';
  // only open pages of this app (never an arbitrary site from a payload)
  let url = new URL('/', self.location.origin);
  try { const u = new URL(raw, self.location.origin); if (u.origin === self.location.origin) url = u; } catch { /* keep the app root */ }
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const t of tabs) if (new URL(t.url).origin === url.origin && 'focus' in t) { await t.focus(); if ('navigate' in t) await t.navigate(url.href).catch(() => {}); return; }
    await self.clients.openWindow(url.href);
  })());
});
