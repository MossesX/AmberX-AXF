/** `@console/hubAppearance` in Patches: the hub this app runs with (from /api/me), for plugins that read the hub. */
const DEFAULT_HUB = 'https://axhub.amberxai.com';
let hub = DEFAULT_HUB;

void (async () => {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    const j = (await r.json()) as { hub?: unknown };
    if (typeof j.hub === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(j.hub)) hub = j.hub;
  } catch { /* keep the default */ }
})();

export const hubOrigin = () => hub;
