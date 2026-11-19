/**
 * Where AmberX notes live: axHub's data server through lib-hubstore, folder `amberx-notes/` in hub project
 * `amberx-axf` (tables `lists` and `items`), shared by every device signed in to the hub. The console's Voice notes and
 * Voice Vault notes (folder `voice-notes/`) are read alongside, read-only, under the Voice notes list.
 *
 * Every change goes through `mutate` (or `runIntent`, which calls it): the store changes at once on screen, the changed
 * rows are queued and written to the hub in order. While the hub can't be reached the queue is kept on this device
 * (`localStorage`, key `amberx.notes.queue`) and written once it's back (focus, online, every 30 s). Nothing else is
 * kept on the device.
 */
import { useSyncExternalStore } from 'react';
import { HubData, HubError, type Row } from '../../../axf/libs/hubstore';
import { HUB } from '../../../hub/useHub';
import {
  DATA_FOLDER, HUB_PROJECT, ITEMS_TABLE, LISTS_TABLE, VOICE_NOTES_FOLDER, applyIntent, emptyStore, ensureSystemLists, fromVoiceNotes,
  isShared, normalizeItem, normalizeList, syncPluginLists, validateIntent, type ApplyResult, type Intent, type Item, type NoteList, type Source, type Store,
} from './core';

export const NOTES_ID = 'ai.amberx.amberx.notes';
const QUEUE_KEY = 'amberx.notes.queue';
const DEVICE_KEY = 'amberx.device';

export type HubStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'signed-out';
export interface Snapshot {
  /** own lists + items (what mutate changes) */
  own: Store;
  /** own + the shared Voice notes, for showing */
  view: Store;
  status: HubStatus;
  error: string | null;
  loaded: boolean;
  /** rows waiting to be written to the hub */
  queued: number;
  lastSync: string;
}

type Op = { table: 'lists' | 'items'; id: string; row: Row | null };

let data: HubData | null = null;
let shared: HubData | null = null;
let sharedStore: { lists: NoteList[]; items: Item[] } = { lists: [], items: [] };
let snap: Snapshot = { own: emptyStore(), view: emptyStore(), status: 'idle', error: null, loaded: false, queued: readQueue().length, lastSync: '' };
const subs = new Set<() => void>();

function readQueue(): Op[] {
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(q: Op[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage off: the queue lives in memory */ } }
let queue: Op[] = readQueue();

export function deviceName(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = `${/Android/i.test(navigator.userAgent) ? 'phone' : 'browser'}-${Math.random().toString(36).slice(2, 7)}`; localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch { return 'browser'; }
}

function compose(own: Store): Store {
  const view: Store = { lists: { ...own.lists }, items: { ...own.items } };
  for (const l of sharedStore.lists) view.lists[l.id] = l;
  for (const i of sharedStore.items) view.items[i.id] = i;
  return view;
}
function emit(p: Partial<Snapshot>) {
  snap = { ...snap, ...p };
  if (p.own) snap.view = compose(p.own);
  subs.forEach((f) => f());
}

export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const snapshot = () => snap;
export const useNotes = () => useSyncExternalStore(subscribe, snapshot);

function connect(): boolean {
  if (data) return true;
  try {
    data = new HubData({ hub: HUB, project: HUB_PROJECT, folder: DATA_FOLDER, mode: 'all', appId: NOTES_ID });
    shared = new HubData({ hub: HUB, project: HUB_PROJECT, folder: VOICE_NOTES_FOLDER, mode: 'all', appId: NOTES_ID });
    return true;
  } catch (e) { emit({ status: 'offline', error: (e as Error).message }); return false; }
}

const statusOf = (e: unknown): HubStatus => (e instanceof HubError && e.kind === 'unauthorized' ? 'signed-out' : 'offline');
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

let loading: Promise<void> | null = null;
/** Reads everything from the hub (also on focus, so another device's changes show). Queued changes go first. */
export function load(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    if (!connect()) return;
    emit({ status: snap.loaded ? snap.status : 'loading' });
    try {
      await flush();
      const [lists, items] = await Promise.all([data!.table(LISTS_TABLE).rows(), data!.table(ITEMS_TABLE).rows()]);
      const own: Store = { lists: {}, items: {} };
      for (const [id, r] of Object.entries(lists)) { const l = normalizeList(r, id); if (l) own.lists[id] = l; }
      for (const [id, r] of Object.entries(items)) { const i = normalizeItem(r, id); if (i) own.items[id] = i; }
      // what's still queued wins over what the hub had
      for (const op of queue) {
        const target = op.table === 'lists' ? own.lists : own.items;
        if (op.row === null) delete target[op.id];
        else { const v = op.table === 'lists' ? normalizeList(op.row, op.id) : normalizeItem(op.row, op.id); if (v) (target as Record<string, unknown>)[op.id] = v; }
      }
      const fixed = ensureSystemLists(own);
      try {
        const [vl, vn] = await Promise.all([shared!.table('lists').rows(), shared!.table('notes').rows()]);
        sharedStore = fromVoiceNotes(vl, vn);
      } catch { /* the shared notes are a bonus: keep the last ones */ }
      emit({ own, status: 'ready', error: null, loaded: true, lastSync: new Date().toISOString() });
      if (fixed) for (const id of ['inbox', 'plugins', 'voice-notes']) enqueue({ table: 'lists', id, row: own.lists[id] as unknown as Row });
    } catch (e) {
      emit({ status: statusOf(e), error: reasonOf(e), loaded: true });
    }
  })().finally(() => { loading = null; });
  return loading;
}

function enqueue(op: Op) {
  queue = [...queue.filter((q) => !(q.table === op.table && q.id === op.id)), op];
  writeQueue(queue);
  emit({ queued: queue.length });
  void flush();
}

let flushing: Promise<void> | null = null;
/** Writes queued rows to the hub, oldest first; stops at the first failure (kept for later). */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!queue.length || !connect()) return;
    while (queue.length) {
      const op = queue[0]!;
      try {
        const t = data!.table(op.table === 'lists' ? LISTS_TABLE : ITEMS_TABLE);
        if (op.row === null) await t.remove(op.id); else await t.put(op.id, op.row);
        queue = queue.slice(1);
        writeQueue(queue);
        emit({ queued: queue.length, status: 'ready', error: null, lastSync: new Date().toISOString() });
      } catch (e) {
        emit({ status: statusOf(e), error: reasonOf(e) });
        return;
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Changes the store with `fn` (core functions on a copy), shows it at once and queues every changed row. */
export function mutate<T>(fn: (s: Store) => T): T {
  const before = snap.own;
  const next: Store = structuredClone(before);
  const out = fn(next);
  for (const table of ['lists', 'items'] as const) {
    const a = before[table] as Record<string, unknown>;
    const b = next[table] as Record<string, unknown>;
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (isShared(id)) continue;
      if (!(id in b)) enqueue({ table, id, row: null });
      else if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) enqueue({ table, id, row: b[id] as Row });
    }
  }
  emit({ own: next });
  return out;
}

/** Copies shared Voice notes into an AmberX list (they're read-only where they live). */
export function adoptShared(ids: string[], list: string): number {
  const items = ids.map((id) => snap.view.items[id]).filter((i): i is Item => !!i && isShared(i.id));
  return mutate((s) => {
    for (const it of items) {
      const { id: _id, ...rest } = it;
      const copy = normalizeItem({ ...rest, list, source: 'import' }, `n-${it.id}`);
      if (copy) s.items[copy.id] = copy;
    }
    return items.length;
  });
}

/** Runs an intent from voice, the AI or a button. Validates first, so untrusted intents are safe to pass in. */
export function runIntent(raw: Intent | unknown, ctx: { source?: Source; transcript?: string } = {}): ApplyResult {
  const v = validateIntent(raw);
  if (!v.ok) return { ok: false, changed: false, say: `I didn't understand that (${v.errors.join('; ')}).` };
  // reads and searches look at the shared notes too; changes only touch AmberX's own
  if (['read', 'search', 'open'].includes(v.intent.action)) return applyIntent(structuredClone(snap.view), v.intent, { ...ctx, device: deviceName() });
  let result!: ApplyResult;
  mutate((s) => { result = applyIntent(s, v.intent, { ...ctx, device: deviceName() }); });
  return result;
}

/** Plugins root: called by the notes plugin with every loaded plugin (and again when the list changes). */
export function syncPlugins(plugins: { id: string; name: string }[]) {
  const s = snap.own;
  const missing = plugins.some((p) => !Object.values(s.lists).some((l) => l.system === 'plugin' && l.pluginId === p.id && l.name === (p.name || p.id)));
  if (missing) mutate((st) => syncPluginLists(st, plugins));
}

/** Keeps the hub copy fresh: focus, online, every 30 s while visible. Returns a stopper. */
export function startSync(): () => void {
  const onFocus = () => { if (document.visibilityState === 'visible') void load(); };
  const onOnline = () => void flush().then(load);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('online', onOnline);
  const t = window.setInterval(() => { if (document.visibilityState === 'visible') void (queue.length ? flush() : load()); }, 30_000);
  void load();
  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener('online', onOnline);
    window.clearInterval(t);
  };
}
