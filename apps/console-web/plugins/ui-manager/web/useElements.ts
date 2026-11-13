/* Every element the manager can select (server registry + the live console) and which of them are on screen now. */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import type { UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { pluginFetch } from '@console/plugins';
import { liveElements, mergeElements, visibleIds } from './live';

export const FOLDER = 'ui-manager';

export type ElementRow = UiElement & { overrides?: number };
interface ElementsAnswer { items?: ElementRow[]; error?: string }

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  return (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as T;
}

/** The last merged list, for actions and the API bridge that run without the window. */
let lastAll: ElementRow[] = [];
let lastVisible: string[] = [];
export const knownElements = () => lastAll;
export const knownVisible = () => lastVisible;

/** Server elements are cached for the session; the live part is re-read on every call. */
let serverCache: ElementRow[] | null = null;
export async function loadServer(fresh = false): Promise<ElementRow[]> {
  if (serverCache && !fresh) return serverCache;
  const j = await fetchJson<ElementsAnswer>('elements');
  if (j.error) throw new Error(j.error);
  serverCache = j.items ?? [];
  return serverCache;
}

/** Everything (server + live) right now, plus the visible ids; used by actions without a window. */
export async function snapshotAll(rt: AxfRuntime): Promise<{ all: ElementRow[]; visible: string[] }> {
  let server: ElementRow[] = [];
  try { server = await loadServer(); } catch { /* the live part still answers */ }
  const all = mergeElements(server, liveElements(rt)) as ElementRow[];
  const visible = visibleIds(all, rt.getState().view);
  lastAll = all; lastVisible = visible;
  return { all, visible };
}

export function useElements(rt: AxfRuntime, rev: number) {
  const [server, setServer] = useState<ElementRow[]>([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { loadServer(rev > 0).then((s) => { setServer(s); setError(''); }, (e: Error) => setError(e.message || 'The UI Manager server part is not answering.')); }, [rev]);
  // the live part follows the console: registry changes, navigation, scroll, resize, and a slow heartbeat
  useEffect(() => {
    let t = 0;
    const bump = () => { if (!t) t = window.setTimeout(() => { t = 0; setTick((n) => n + 1); }, 250); };
    const offReg = (() => { try { return controlRegistry(rt).subscribe(bump); } catch { return () => {}; } })();
    const offRt = rt.subscribe(bump);
    addEventListener('scroll', bump, true); addEventListener('resize', bump);
    const beat = window.setInterval(bump, 2000);
    return () => { offReg(); offRt(); removeEventListener('scroll', bump, true); removeEventListener('resize', bump); clearInterval(beat); clearTimeout(t); };
  }, [rt]);
  const all = useMemo(() => mergeElements(server, liveElements(rt)) as ElementRow[], [server, rt, tick]);
  const visible = useMemo(() => visibleIds(all, rt.getState().view), [all, tick]);
  lastAll = all; lastVisible = visible;
  return { all, visible, error };
}
