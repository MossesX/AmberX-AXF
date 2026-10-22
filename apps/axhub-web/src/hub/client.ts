/**
 * Reading the hub from the browser. Both feeds are read with the browser's **own hub session**
 * (`credentials: 'include'`), exactly as the console's approvals banner does (axHub decision #85):
 * this app never holds a hub token, and deciding an approval still happens on the hub's own page,
 * under its Origin and CSRF rules.
 *
 * Redirects are refused (`redirect: 'error'`) so a session never follows the hub somewhere else,
 * and replies are read through a byte cap.
 */
import { normalizeHub, readCapped, type HubFetch } from '../axf/libs/hub';
import { APPS_FEED_MAX_BYTES, interpretApps, type AppsFeed } from './feed';

export interface FetchOptions {
  fetch?: HubFetch;
}

const failed = (error: string): AppsFeed => ({ status: 'unreachable', updatedAt: null, apps: [], error });

/**
 * The hub's app catalog. The hub allows this cross-site only for https origins under its cookie
 * domain (decision #90); from anywhere else the browser blocks it and the view offers the hub's own
 * Apps page instead.
 */
export async function fetchApps(base: string, opts: FetchOptions = {}): Promise<AppsFeed> {
  const hub = normalizeHub(base);
  if (!hub) return failed("That hub address isn't usable.");
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  let r: Response;
  try {
    r = await f(`${hub}/apps.json`, { credentials: 'include', cache: 'no-store', redirect: 'error' });
  } catch (e) {
    return failed(((e as Error)?.message || "Can't reach the hub.").slice(0, 120));
  }
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return interpretApps(hub, r.status || 302, '');
  if (r.status !== 200) return interpretApps(hub, r.status, '');
  let body: string | null;
  try {
    body = await readCapped(r, APPS_FEED_MAX_BYTES);
  } catch (e) {
    return failed(((e as Error)?.message || "Can't reach the hub.").slice(0, 120));
  }
  if (body === null) return failed('The catalog is larger than this app reads.');
  return interpretApps(hub, 200, body);
}
