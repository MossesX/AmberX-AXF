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
import { followSse } from '@console/axf/core/sse';
import { buildRows, liveEntries, probeTicks as probe, SOURCES, tickRequest, type ActivityItem, type Helpers, type LiveEntry, type Row, type SortKey, type Source } from './merge.mjs';
import type { ChangeSummary } from './history.mjs';

export const FOLDER = 'build-manager';
export const ID = 'ai.amberx.axf.console.build-manager';
export const VERSION = '0.2.0';
export const helpers: Helpers = { estimateMinutes: pendingCore.estimateMinutes, formatMinutes: pendingCore.formatMinutes };
export const fmt = (min: number | null | undefined) => (min === 0 ? '0 min' : pendingCore.formatMinutes(min ?? null) || '');

const LIVE_MS = 4_000;
const LIST_MS = 60_000;
/** Fallback polling of the build log while the event stream is down (cheap: the server answers {same} when nothing changed). */
const CHANGES_MS = 5_000;
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
  /** the build log (every session, every machine, through axHub): change-log@1 summaries with build stats */
  changes: ChangeSummary[]; changesAvailable: boolean | null; changesError: string; changesLoaded: boolean; realtime: boolean; now: number;
  /** "Start build now" jobs by row key */
  jobs: Record<string, StartJob>;
}
let st: Store = { rows: [], loaded: false, error: '', offline: false, live: [], liveAvailable: null, liveError: '', finished: [], hiddenFor: '', focus: '', canTickPending: false, canTickQueue: false,
  changes: [], changesAvailable: null, changesError: '', changesLoaded: false, realtime: false, now: Date.now(), jobs: {} };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getStore = () => st;
export const onStore = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(onStore, getStore, getStore);
export const setFocus = (key: string) => set({ focus: key });
export const takeFocus = () => { const f = st.focus; if (f) st = { ...st, focus: '' }; return f; };
export const hideBanner = (key: string) => set({ hiddenFor: key });

/** "Start build now" from the context menu / action: the row opens its Start panel. */
const startSubs = new Set<(key: string) => void>();
let pendingStart = '';
export const onStartRequest = (f: (key: string) => void) => { startSubs.add(f); if (pendingStart) { const k = pendingStart; setTimeout(() => f(k), 0); } return () => { startSubs.delete(f); }; };
export const requestStart = (key: string) => { pendingStart = key; startSubs.forEach((f) => f(key)); setTimeout(() => { if (pendingStart === key) pendingStart = ''; }, 3000); };

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

/* ---------------- the build log: every session's builds, through axHub (Live + Built) ---------------- */

let changesInflight = false;
let stamp = '';
export async function loadChanges(force = false): Promise<void> {
  if (changesInflight) return;
  changesInflight = true;
  try {
    const r = await pluginFetch(FOLDER, `changes${stamp && !force ? `?since=${encodeURIComponent(stamp)}` : ''}`);
    const j = (await r.json().catch(() => ({}))) as { available?: boolean; items?: ChangeSummary[]; stamp?: string; same?: boolean; error?: string };
    if (!r.ok) throw new Error(r.status === 401 ? 'Console token needed for the build log.' : `HTTP ${r.status}`);
    if (j.same) return;
    stamp = j.stamp ?? '';
    set({ changes: j.items ?? [], changesAvailable: j.available !== false, changesError: j.error ?? '', changesLoaded: true, now: Date.now() });
  } catch (e) { set({ changesAvailable: false, changesError: (e as Error).message, changesLoaded: true }); }
  finally { changesInflight = false; }
}

/** Real time: the server's event stream says when any session anywhere wrote to the build log; fall back to polling. */
let stopEvents: (() => void) | null = null;
function followChanges() {
  stopEvents?.();
  stopEvents = followSse(
    (signal) => pluginFetch(FOLDER, 'events', { signal }),
    (f) => { if (f.event === 'changed' || f.event === 'ready') { set({ realtime: true }); void loadChanges(); } },
    { onOpen: () => set({ realtime: true }), onDrop: () => set({ realtime: false }) },
  );
}

/* ---------------- Start build now ---------------- */

export interface StartJob { key: string; state: string; message: string; approvalUrl?: string; changeId?: string; command?: string; attempts?: number; plan?: { model?: string; branch?: string; areas?: string[]; deps?: { id: string; title: string }[] } }
export interface StartPlan { ok: boolean; refuse?: string; wait?: string; model?: string; branch?: string; areas?: string[]; deps?: { id: string; title: string; model: string }[]; order?: string[] | null; brief?: string; verify?: { name: string }[]; estimate?: { minutes?: number; costUsd?: number }; clashes?: { title: string; who: string; paths: string[] }[] }

export async function planBuild(key: string): Promise<StartPlan> {
  const r = await pluginFetch(FOLDER, 'start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, dryRun: true }) });
  const j = (await r.json().catch(() => ({}))) as { plan?: StartPlan; detail?: string };
  if (!r.ok) throw new Error(r.status === 401 ? 'Console token needed.' : j.detail ?? `HTTP ${r.status}`);
  return j.plan ?? { ok: false, refuse: 'No plan.' };
}
export async function startBuild(key: string): Promise<{ job?: StartJob; plan?: StartPlan; ok: boolean }> {
  const r = await pluginFetch(FOLDER, 'start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; job?: StartJob; plan?: StartPlan; detail?: string };
  if (!r.ok) throw new Error(j.detail ?? `HTTP ${r.status}`);
  if (j.job) set({ jobs: { ...st.jobs, [key]: j.job } });
  void loadChanges(true);
  return { ok: !!j.ok, job: j.job, plan: j.plan };
}
export async function loadJobs(): Promise<void> {
  try {
    const r = await pluginFetch(FOLDER, 'jobs');
    if (!r.ok) return;
    const j = (await r.json()) as { items?: StartJob[] };
    set({ jobs: Object.fromEntries((j.items ?? []).map((x) => [x.key, x])) });
  } catch { /* offline */ }
}
export async function verifyBuild(changeId: string): Promise<string> {
  const r = await pluginFetch(FOLDER, 'verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changeId }) });
  const j = (await r.json().catch(() => ({}))) as { verify?: { state: string; summary?: string }; detail?: string };
  if (!r.ok) throw new Error(j.detail ?? `HTTP ${r.status}`);
  void loadChanges(true);
  return `${j.verify?.state ?? '?'}: ${j.verify?.summary ?? ''}`;
}

let started = false;
export function start(runtime: AxfRuntime) {
  rt = runtime;
  if (started) return;
  started = true;
  void loadList().then(() => { void loadLive(); void loadChanges(true); void loadJobs(); });
  followChanges();
  setInterval(() => { if (document.visibilityState === 'visible') void loadLive(); }, LIVE_MS);
  setInterval(() => { if (document.visibilityState === 'visible') { void loadChanges(); if (Object.values(st.jobs).some((j) => ['asking', 'waiting', 'launching'].includes(j.state))) void loadJobs(); } }, CHANGES_MS);
  setInterval(() => { if (document.visibilityState === 'visible') void loadList(); }, LIST_MS);
  setInterval(() => { if (st.finished.length) refreshLive(false); if (st.changes.length && document.visibilityState === 'visible') set({ now: Date.now() }); }, 1_000);
  for (const ev of ['axf:pending-changed', 'axf:plan-changed']) globalThis.addEventListener(ev, () => void loadList());
  globalThis.addEventListener('focus', () => { void loadList(); void loadLive(); void loadChanges(); });
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
