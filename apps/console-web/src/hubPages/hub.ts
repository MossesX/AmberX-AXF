/**
 * lib-hub's app catalog, read through the console's hub-pages relay (hub-pages@1) instead of cross-site: the console
 * isn't the hub's origin, and the relay brings the hub session (the browser's, else the console's owner sign-in).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHubApps, type AppsFeed } from '../axf/libs/hub/apps';
import { HUB_CHECK_EVENT } from '../axf/libs/hub/react';
import { hub, relayUrl } from './api';

/** `fetch` for lib-hub that sends `<hub>/apps.json` to the relay (nothing else is allowed through). */
const relayFetch = (url: string, init?: RequestInit): Promise<Response> => {
  const u = new URL(url);
  return fetch(relayUrl(u.pathname.slice(1) + u.search), { ...init, credentials: 'same-origin', redirect: 'error' });
};

/** The app catalog: read when mounted, again on refresh or lib-hub's "check the hub now". */
export function useApps(): { feed: AppsFeed | null; loading: boolean; refresh: () => void } {
  const [feed, setFeed] = useState<AppsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(() => {
    setLoading(true);
    void fetchHubApps(hub(), { fetch: relayFetch }).then((f) => { if (alive.current) { setFeed(f); setLoading(false); } });
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    globalThis.addEventListener?.(HUB_CHECK_EVENT, load);
    return () => { alive.current = false; globalThis.removeEventListener?.(HUB_CHECK_EVENT, load); };
  }, [load]);
  return useMemo(() => ({ feed, loading, refresh: load }), [feed, loading, load]);
}
