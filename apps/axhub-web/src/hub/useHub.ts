/**
 * React glue: the hub address this app talks to, the live approvals feed and the app catalog.
 *
 * The address comes from the app manifest's `developer.hub` (the same value the look is read from),
 * so there is one hub per build and nothing to type in.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HubWatcher, HUB_DEFAULT, normalizeHub, type HubWatchState } from '../axf/libs/hub';
import { CHECK_EVENT } from '../actions';
import { fetchApps } from './client';
import type { AppsFeed } from './feed';
import manifest from '../../axf.manifest.json';

/** The hub this build belongs to. */
export const HUB: string = normalizeHub((manifest as { developer?: { hub?: string } }).developer?.hub) ?? HUB_DEFAULT;

/** The approvals feed, polled while the page is visible. One watcher for the whole app. */
let watcher: HubWatcher | null = null;
const hubWatcher = (): HubWatcher => (watcher ??= new HubWatcher({ hub: HUB, everyMs: 5_000 }));

export function useApprovals(): { state: HubWatchState; refresh: () => void } {
  const w = hubWatcher();
  const state = useSyncExternalStore(w.subscribe, () => w.state, () => w.state);
  useEffect(() => {
    w.start();
    const again = () => void w.check();
    globalThis.addEventListener?.(CHECK_EVENT, again);
    return () => {
      globalThis.removeEventListener?.(CHECK_EVENT, again);
      w.stop();
    };
  }, [w]);
  return { state, refresh: useCallback(() => void w.check(), [w]) };
}

export interface AppsState {
  feed: AppsFeed | null;
  loading: boolean;
}

/** The app catalog, read once when the view opens and on demand. */
export function useApps(): AppsState & { refresh: () => void } {
  const [feed, setFeed] = useState<AppsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(() => {
    setLoading(true);
    void fetchApps(HUB).then((f) => {
      if (alive.current) {
        setFeed(f);
        setLoading(false);
      }
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    globalThis.addEventListener?.(CHECK_EVENT, load);
    return () => {
      alive.current = false;
      globalThis.removeEventListener?.(CHECK_EVENT, load);
    };
  }, [load]);
  return useMemo(() => ({ feed, loading, refresh: load }), [feed, loading, load]);
}
