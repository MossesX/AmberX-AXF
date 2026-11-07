/**
 * The calendar's store: axHub's data server, folder `amberx-calendar/` in hub project `amberx-axf`, one table per row kind
 * (core.ts `TABLES`). Same rules as the notes store next door: no app keeps a copy, a change shows at once and is queued
 * in order, the queue waits on the device while the hub can't be reached, and table heads are watched while the page is
 * visible so a change anywhere shows within seconds. `replies` and `mail` are the console server's: read here, never
 * written, which is how a guest's answer reaches every screen.
 */
import { useSyncExternalStore } from 'react';
import { HubData, HubError, dataUrl, tableHeadPath, type Row } from '@console/axf/libs/hubstore';
import { hubAddress } from '@console/notesHost';
import { pluginApi } from '@console/plugins';
import { HUB_PROJECT } from '../notes/core';
import { deviceName, NOTES_ID } from '../notes/store';
import { CAL_FOLDER, NORMALIZE, SERVER_TABLES, TABLES, emptyCal, ensureDefaults, type CalStore, type TableName } from './core';

export const calendarApi = pluginApi('notes-tasks', 'Calendar');
const LIVE_MS = 3000;
const QUEUE_KEY = 'amberx.calendar.queue';

type Status = 'idle' | 'loading' | 'ready' | 'offline' | 'signed-out';
export interface CalSnapshot { store: CalStore; status: Status; error: string | null; loaded: boolean; queued: number }
type Op = { table: TableName; id: string; row: Row | null };

let data: HubData | null = null;
let snap: CalSnapshot = { store: emptyCal(), status: 'idle', error: null, loaded: false, queued: 0 };
const subs = new Set<() => void>();
function readQueue(): Op[] { try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); return Array.isArray(q) ? q : []; } catch { return []; } }
function writeQueue(q: Op[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage off: the queue lives in memory */ } }
let queue = readQueue();

function emit(p: Partial<CalSnapshot>) { snap = { ...snap, ...p }; subs.forEach((f) => f()); }
export const subscribeCal = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const calSnapshot = () => snap;
export const useCalendar = () => useSyncExternalStore(subscribeCal, calSnapshot);
export const byWhom = () => `app:${deviceName()}`;

function connect(): boolean {
  if (data) return true;
  const hub = hubAddress();
  if (!hub || hub === 'off') { emit({ status: 'offline', error: 'This app runs without axHub, and the calendar lives there.', loaded: true }); return false; }
  try { data = new HubData({ hub, project: HUB_PROJECT, folder: CAL_FOLDER, mode: 'all', appId: NOTES_ID }); return true; } catch (e) { emit({ status: 'offline', error: (e as Error).message }); return false; }
}
const statusOf = (e: unknown): Status => (e instanceof HubError && e.kind === 'unauthorized' ? 'signed-out' : 'offline');
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

let loading: Promise<void> | null = null;
export function loadCal(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    if (!connect()) return;
    if (!snap.loaded) emit({ status: 'loading' });
    try {
      await flushCal();
      const tables = await Promise.all(TABLES.map((t) => data!.table(t).rows()));
      const next = emptyCal();
      TABLES.forEach((t, i) => {
        const target = next[t] as Record<string, unknown>;
        for (const [id, r] of Object.entries(tables[i]!)) { const v = NORMALIZE[t](r, id); if (v) target[id] = v; }
      });
      for (const op of queue) { // what's still queued wins over what the hub had
        const target = next[op.table] as Record<string, unknown>;
        if (op.row === null) delete target[op.id];
        else { const v = NORMALIZE[op.table](op.row, op.id); if (v) target[op.id] = v; }
      }
      const seeded = ensureDefaults(next);
      emit({ store: next, status: 'ready', error: null, loaded: true });
      if (seeded) for (const c of Object.values(next.calendars)) enqueue({ table: 'calendars', id: c.id, row: c as unknown as Row });
    } catch (e) { emit({ status: statusOf(e), error: reasonOf(e), loaded: true }); }
  })().finally(() => { loading = null; });
  return loading;
}

function enqueue(op: Op) {
  queue = [...queue.filter((q) => !(q.table === op.table && q.id === op.id)), op];
  writeQueue(queue);
  emit({ queued: queue.length });
  void flushCal();
}
let flushing: Promise<void> | null = null;
export function flushCal(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!queue.length || !connect()) return;
    while (queue.length) {
      const op = queue[0]!;
      try {
        const t = data!.table(op.table);
        if (op.row === null) await t.remove(op.id); else await t.put(op.id, op.row);
        queue = queue.slice(1);
        writeQueue(queue);
        emit({ queued: queue.length, status: 'ready', error: null });
      } catch (e) { emit({ status: statusOf(e), error: reasonOf(e) }); return; }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Changes the store on a copy, shows it at once and queues every changed row. */
export function mutateCal<T>(fn: (s: CalStore) => T): T {
  const before = snap.store;
  const next = structuredClone(before);
  const out = fn(next);
  const at = new Date().toISOString();
  for (const table of TABLES) {
    if (SERVER_TABLES.includes(table)) continue;
    const a = before[table] as Record<string, unknown>;
    const b = next[table] as Record<string, Record<string, unknown>>;
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(id in b)) { enqueue({ table, id, row: null }); continue; }
      if (JSON.stringify(a[id]) === JSON.stringify(b[id])) continue;
      b[id]!.updatedAt = at;
      enqueue({ table, id, row: b[id] as Row });
    }
  }
  emit({ store: next });
  return out;
}

const heads = new Map<string, string>();
async function headsMoved(): Promise<boolean> {
  let moved = false;
  for (const t of TABLES) {
    const r = await fetch(dataUrl(hubAddress(), HUB_PROJECT, tableHeadPath(CAL_FOLDER, t)), { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
    if (!r.ok && r.status !== 404) return false;
    const seen = r.status === 404 ? 'none' : r.headers.get('etag') ?? await r.text();
    moved = (heads.has(t) && heads.get(t) !== seen) || moved;
    heads.set(t, seen);
  }
  return moved;
}

let users = 0;
let stop: (() => void) | null = null;
/** Keeps the hub copy fresh while anything shows the calendar. Returns the release. */
export function startCalSync(): () => void {
  if (users++ === 0) {
    let busy = false;
    const onFocus = () => { if (document.visibilityState === 'visible') void loadCal(); };
    const onOnline = () => void flushCal().then(loadCal);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    const live = window.setInterval(() => {
      if (busy || document.visibilityState !== 'visible' || !data) return;
      busy = true;
      void headsMoved().then((moved) => (moved && !queue.length ? loadCal() : undefined)).catch(() => undefined).finally(() => { busy = false; });
    }, LIVE_MS);
    const slow = window.setInterval(() => { if (document.visibilityState === 'visible') void (queue.length ? flushCal() : loadCal()); }, 30_000);
    void loadCal();
    stop = () => {
      window.clearInterval(live); window.clearInterval(slow);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }
  return () => { if (--users === 0) { stop?.(); stop = null; } };
}
