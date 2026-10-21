/*
 * Build manager — data: the build list (pending list + build queue + plan, merged by merge.mjs) and the live feed
 * (GET live on this plugin's server part, which reads the activity feed through capability axf.activity@1).
 * One shared store for the view, the tracker, the banner, search and the context menu.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime, SettingValue } from '@console/axf/core';
import * as api from '@console/api';
import { pluginFetch } from '@console/plugins';
import * as pendingCore from '@console/axf/plan/pending-core.mjs';
import * as queueCore from '@console/axf/plan/build-queue-core.mjs';
import type { QFeature } from '@console/axf/plan/build-queue-core.mjs';
import { buildRows, liveEntries, probeTicks as probe, SOURCES, tickRequest, type ActivityItem, type Helpers, type LiveEntry, type Row, type SortKey, type Source } from './merge.mjs';

export const FOLDER = 'build-manager';
export const ID = 'ai.amberx.axf.console.build-manager';
export const VERSION = '0.1.0';
export const helpers: Helpers = { estimateMinutes: pendingCore.estimateMinutes, formatMinutes: pendingCore.formatMinutes };
export const fmt = (min: number | null | undefined) => (min === 0 ? '0 min' : pendingCore.formatMinutes(min ?? null) || '');

const LIVE_MS = 4_000;
const LIST_MS = 60_000;
/** Finished builds stay on the tracker (and the banner) this long, then leave. */
export const LINGER_MS = 4_000;

/* ---------------- settings (Settings → Plugins → Build manager) ---------------- */

export const KEYS = { banner: 'build-manager.banner', sort: 'build-manager.sort', sources: 'build-manager.sources' } as const;
let rt: AxfRuntime | null = null;
const setting = (k: string, d: SettingValue): SettingValue => { try { return rt?.settings.get(k) ?? d; } catch { return d; } };
export const bannerOn = () => setting(KEYS.banner, true) !== false;
export const defaultSort = (): SortKey => { const s = setting(KEYS.sort, 'order'); return s === 'left' || s === 'model' ? s : 'order'; };
export const enabledSources = (): Source[] => { const v = setting(KEYS.sources, [...SOURCES]); return Array.isArray(v) ? (v.filter((x) => (SOURCES as string[]).includes(x)) as Source[]) : [...SOURCES]; };

/* ---------------- store ---------------- */

export interface Store {
  rows: Row[]; loaded: boolean; error: string; offline: boolean;
  live: LiveEntry[]; liveAvailable: boolean | null; liveError: string;
  /** recently finished tracker entries, kept for LINGER_MS from when they finished (or we noticed) */
  finished: (LiveEntry & { until: number })[];
  hiddenFor: string; focus: string;
  canTickPending: boolean; canTickQueue: boolean;
}
let st: Store = { rows: [], loaded: false, error: '', offline: false, live: [], liveAvailable: null, liveError: '', finished: [], hiddenFor: '', focus: '', canTickPending: false, canTickQueue: false };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getStore = () => st;
export const onStore = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(onStore, getStore, getStore);
export const setFocus = (key: string) => set({ focus: key });
export const takeFocus = () => { const f = st.focus; if (f) st = { ...st, focus: '' }; return f; };
export const hideBanner = (key: string) => set({ hiddenFor: key });

/**
 * Step ticks write through the console's own routes (pending list: `step` action; build queue: `/build-queue/steps`).
 * Probed against the shared cores this console ships, so an older console shows them read-only instead of failing.
 */
const probeTicks = () => probe(pendingCore, queueCore);

let loading = false;
export async function loadList(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const [pending, plan, queueState] = await Promise.all([
      api.loadPending().catch(() => null),
      api.loadPlan().catch(() => null),
      api.loadBuildQueueState().catch(() => null),
    ]);
    const features = (plan?.features ?? []) as unknown as QFeature[];
    const queue = features.length ? queueCore.computeQueue(features, queueState) : null;
    const items = pending ? pendingCore.normalizeState(pending).items : [];
    // normalizeState drops fields it doesn't know yet (step done/doneAt); keep them from the raw file.
    const raw = new Map(((pending as { items?: { id: string; subPrompts?: unknown[] }[] } | null)?.items ?? []).map((i) => [i.id, i]));
    const merged = items.map((i) => ({ ...i, subPrompts: (raw.get(i.id)?.subPrompts as typeof i.subPrompts | undefined) ?? i.subPrompts }));
    const rows = buildRows({ pending: merged, queue, queueState, features }, helpers);
    set({ rows, loaded: true, error: !pending && !plan ? 'Couldn’t load the pending list or the plan.' : '', offline: !api.isBackendUp(), ...probeTicks() });
    refreshLive(false);
  } catch (e) { set({ loaded: true, error: (e as Error).message }); }
  finally { loading = false; }
}

/* ---------------- live ---------------- */

let activity: ActivityItem[] = [];
let lastRunning = new Map<string, LiveEntry>();
function refreshLive(fetchNew = true) {
  const now = Date.now();
  const all = liveEntries(activity, st.rows, now);
  const running = all.filter((e) => ['queued', 'running', 'waiting'].includes(e.activityState));
  const done = all.filter((e) => !running.includes(e));
  const runningIds = new Set(running.map((e) => e.id));
  let finished = st.finished.filter((f) => f.until > now && !runningIds.has(f.id));
  const add = (e: LiveEntry, at: number) => { if (!finished.some((f) => f.id === e.id)) finished = [...finished, { ...e, until: at + LINGER_MS }]; };
  // finished in the feed within the linger window
  for (const e of done) if (e.finishedAt && now - e.finishedAt < LINGER_MS) add(e, e.finishedAt);
  // was running last time, gone now (or finished outside the window we saw): linger from now
  for (const [id, e] of lastRunning) if (!runningIds.has(id) && fetchNew) add({ ...e, state: done.find((d) => d.id === id)?.activityState || 'done', activityState: done.find((d) => d.id === id)?.activityState || 'done', finishedAt: now }, now);
  lastRunning = new Map(running.map((e) => [e.id, e]));
  set({ live: running, finished });
}

let liveInflight = false;
export async function loadLive(): Promise<void> {
  if (liveInflight) return;
  liveInflight = true;
  try {
    const r = await pluginFetch(FOLDER, 'live');
    const j = (await r.json().catch(() => ({}))) as { available?: boolean; items?: ActivityItem[]; error?: string };
    if (!r.ok) throw new Error(r.status === 401 ? 'Console token needed for the live tracker.' : r.status === 404 ? 'Build manager server part is off.' : `HTTP ${r.status}`);
    activity = j.items ?? [];
    set({ liveAvailable: j.available !== false, liveError: j.error ?? '' });
  } catch (e) { activity = []; set({ liveAvailable: false, liveError: (e as Error).message }); }
  finally { liveInflight = false; refreshLive(true); }
}

let started = false;
export function start(runtime: AxfRuntime) {
  rt = runtime;
  if (started) return;
  started = true;
  void loadList().then(() => loadLive());
  setInterval(() => { if (document.visibilityState === 'visible') void loadLive(); }, LIVE_MS);
  setInterval(() => { if (document.visibilityState === 'visible') void loadList(); }, LIST_MS);
  setInterval(() => { if (st.finished.length) refreshLive(false); }, 1_000);
  for (const ev of ['axf:pending-changed', 'axf:plan-changed']) globalThis.addEventListener(ev, () => void loadList());
  globalThis.addEventListener('focus', () => { void loadList(); void loadLive(); });
  runtime.settings.subscribe(() => subs.forEach((f) => f()));
}

/* ---------------- step ticks ---------------- */

export async function tickStep(row: Row, index: number, done: boolean): Promise<string | null> {
  try {
    const req = tickRequest(row, index, done);
    if (!req) return 'Plan features have no steps to tick.';
    if (row.source === 'pending' && !st.canTickPending) return 'Ticking steps needs the pending list’s step action (not on this console yet).';
    if (row.source === 'queue' && !st.canTickQueue) return 'Ticking steps needs the build queue’s steps action (not on this console yet).';
    const r = await api.post(req.path, req.body);
    if (!r.ok) return r.error ?? 'failed';
    globalThis.dispatchEvent(new CustomEvent(row.source === 'pending' ? 'axf:pending-changed' : 'axf:plan-changed'));
    await loadList();
    return null;
  } catch (e) { return (e as Error).message; }
}
