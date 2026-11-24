/**
 * Plan Studio 2.0, the builds of sent plans as the page holds them: one read per plan from the server
 * (GET plans/<planId>/build, which reads the builds store on every call), kept only in memory.
 *
 * Live: while a panel is on screen the page follows the console's builds event stream (`/api/builds/events`, the event
 * `builds.updated` the VPS pipeline and the lander send through the console server). Every event reads the watched
 * plans and the tree again, so the plan rows and the build panels move at the same moment as the orchestrator's
 * screen. The event carries no step data: the store stays the one source. The page also reads again when its tab or
 * window comes back to the front, and when a plan row's own state changes (the page's poll), so a console without the
 * stream still follows the build. The stream is closed when the last panel goes.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { BuildInfo, StepInfo } from './live-core.mjs';
import { api, reload } from './api';

export const EVENTS_URL = '/api/builds/events';
export const EVENT = 'builds.updated';
const SETTLE_MS = 250;

export interface PlanBuild { ok: boolean; error?: string; plan?: { id: string; title: string; status: string }; build: BuildInfo | null; steps: StepInfo[]; earlier?: { id: string; number: string; status: string }[] }
export interface Entry { data: PlanBuild | null; error: string; loading: boolean }
const EMPTY: Entry = Object.freeze({ data: null, error: '', loading: false });

const entries = new Map<string, Entry>();
const wire = new Map<string, string>();
const flying = new Map<string, Promise<void>>();
const watched = new Map<string, number>();
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const put = (id: string, p: Partial<Entry>) => { entries.set(id, { ...(entries.get(id) ?? EMPTY), ...p }); tell(); };

/** Read one plan's build from the server now (one read at a time per plan). The same answer keeps the same object. */
export function refreshPlanBuild(planId: string): Promise<void> {
  const busy = flying.get(planId);
  if (busy) return busy;
  if (!entries.get(planId)?.data) put(planId, { loading: true });
  const run = (async () => {
    try {
      const r = await api.call<PlanBuild>(`plans/${encodeURIComponent(planId)}/build`);
      if (!r.ok) throw new Error(r.error || 'no data');
      const next = JSON.stringify([r.build, r.steps]);
      if (next === wire.get(planId) && entries.get(planId)?.data) put(planId, { error: '', loading: false });
      else { wire.set(planId, next); put(planId, { data: r, error: '', loading: false }); }
    } catch (e) { put(planId, { error: (e as Error).message, loading: false }); } finally { flying.delete(planId); }
  })();
  flying.set(planId, run);
  return run;
}

let settle: ReturnType<typeof setTimeout> | null = null;
/** Read every watched plan and the tree again, once for a burst of events. */
export function refreshWatched(): void {
  if (settle) return;
  settle = setTimeout(() => {
    settle = null;
    for (const id of watched.keys()) void refreshPlanBuild(id);
    void reload();
  }, SETTLE_MS);
}

type ESLike = { close(): void; addEventListener(type: string, fn: () => void): void; onmessage: (() => void) | null; onerror: (() => void) | null; readyState: number };
let stream: ESLike | null = null;
let listening = false;
const onFront = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshWatched(); };

function openStream(): void {
  if (!listening && typeof window !== 'undefined') { listening = true; window.addEventListener('focus', onFront); document.addEventListener('visibilitychange', onFront); }
  const ES = (globalThis as { EventSource?: new (url: string) => ESLike }).EventSource;
  if (stream || !ES) return;
  try {
    const es = new ES(EVENTS_URL);
    es.addEventListener(EVENT, refreshWatched);
    es.onmessage = refreshWatched;
    // a console without the stream answers once and the source closes for good: the page's own reads carry on
    es.onerror = () => { if (es.readyState === 2 && stream === es) stream = null; };
    stream = es;
  } catch { stream = null; }
}
function closeStream(): void {
  if (stream) { stream.close(); stream = null; }
  if (listening && typeof window !== 'undefined') { listening = false; window.removeEventListener('focus', onFront); document.removeEventListener('visibilitychange', onFront); }
  if (settle) { clearTimeout(settle); settle = null; }
}
/** Is the builds event stream open right now? */
export const streamOpen = () => !!stream;

/** Follow one plan's build while a panel shows it. → stop (the stream closes with the last one). */
export function watchPlanBuild(planId: string): () => void {
  watched.set(planId, (watched.get(planId) ?? 0) + 1);
  openStream();
  void refreshPlanBuild(planId);
  return () => {
    const n = (watched.get(planId) ?? 1) - 1;
    if (n > 0) watched.set(planId, n); else watched.delete(planId);
    if (!watched.size) closeStream();
  };
}

const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/**
 * The build of a sent plan, followed live while the caller is on screen. `sig` is the plan row's own state as the tree
 * last read it (build, status, time): when it moves, the build is read again, stream or no stream.
 */
export function usePlanBuild(planId: string, sig = ''): Entry {
  const e = useSyncExternalStore(sub, () => entries.get(planId) ?? EMPTY, () => EMPTY);
  useEffect(() => watchPlanBuild(planId), [planId]);
  useEffect(() => { if (sig && entries.get(planId)?.data) void refreshPlanBuild(planId); }, [planId, sig]);
  return e;
}
