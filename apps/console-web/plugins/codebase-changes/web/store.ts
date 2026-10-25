/*
 * Codebase changes — data: the open entries for the banner (polled), the log browser's pages and the actions
 * (close everywhere, close all, show in the banner again). One store for the banner, the view, search and the menu.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime, SettingValue } from '@console/axf/core';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'codebase-changes';
export const ID = 'ai.amberx.axf.console.codebase-changes';
export const VERSION = '0.1.0';
export const VIEW = 'codebase-changes';
export const KEYS = { banner: 'codebase-changes.banner' } as const;
const POLL_MS = 15_000;

export const api = pluginApi(FOLDER, 'The Codebase changes plugin');

export type StepState = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
export type EntryState = 'running' | 'done' | 'failed' | 'partial' | 'cancelled';
export interface Step { text: string; state: StepState; startedAt?: string; finishedAt?: string; note?: string }
export interface Result { state: Exclude<EntryState, 'running'>; summary: string; branch?: string; commits?: { sha: string; message?: string }[]; filesChanged?: number; tests?: Record<string, { before?: string; after?: string; state?: 'pass' | 'fail' | 'skip' }>; links?: Record<string, string> }
export interface Entry { id: string; createdAt: string; updatedAt: string; kind: string; title: string; asked: string; repos: string[]; model: string; who: { session?: string; where?: string; user?: string; host?: string }; state: EntryState; steps: Step[]; result: Result | null; closed: { at: string; by: string } | null; resume?: Resume }
/** What another machine or Claude account needs to carry the work on (change-log@1 `resume`). */
export interface Resume { repo?: string; folder?: string; branch?: string; base?: string; head?: string; pushed?: boolean; dirty?: number; pr?: string; plan?: string; next?: string; notes?: string; files?: string[]; tests?: string[]; read?: string[]; at?: string }
export interface Summary { id: string; createdAt: string; updatedAt: string; kind: string; title: string; asked: string; state: EntryState; repos: string[]; model: string; where: string; steps: { total: number; done: number; failed: number; running: string }; result: { state: string; summary: string } | null; closed: string | null; status?: string; startedAt?: string; lastSeenAt?: string }
export interface Counts { total: number; open: number; byKind: Record<string, number>; byState: Record<string, number> }
export interface Page { items: Summary[]; total: number; nextCursor: string | null; counts: Counts; where: string }

export const KIND_LABEL: Record<string, string> = { build: 'Build', edit: 'Edit', remove: 'Remove', fix: 'Fix', other: 'Other' };
export const KIND_ICON: Record<string, string> = { build: 'plus', edit: 'edit', remove: 'trash', fix: 'zap', other: 'code' };
export const STATE_LABEL: Record<string, string> = { running: 'In progress', done: 'Done', failed: 'Failed', partial: 'Partly done', cancelled: 'Cancelled', queued: 'Queued', skipped: 'Skipped' };
export const STATE_ICON: Record<string, string> = { running: 'refresh', done: 'check-circle', failed: 'x-circle', partial: 'alert', cancelled: 'minus', queued: 'clock', skipped: 'minus' };
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

/* ---------------- settings ---------------- */

let rt: AxfRuntime | null = null;
const setting = (k: string, d: SettingValue): SettingValue => { try { return rt?.settings.get(k) ?? d; } catch { return d; } };
export const bannerOn = () => setting(KEYS.banner, true) !== false;

/* ---------------- store ---------------- */

export interface Store { open: Summary[]; openTotal: number; loaded: boolean; error: string; focus: string; busy: string; known: Map<string, Summary> }
let st: Store = { open: [], openTotal: 0, loaded: false, error: '', focus: '', busy: '', known: new Map() };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getStore = () => st;
export const onStore = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => useSyncExternalStore(onStore, getStore, getStore);
export const setFocus = (id: string) => set({ focus: id });
export const takeFocus = () => { const f = st.focus; if (f) st = { ...st, focus: '' }; return f; };
/** Remember summaries seen anywhere (banner, log pages) for search. */
export function remember(items: Summary[]) { const m = new Map(st.known); for (const i of items) m.set(i.id, i); set({ known: m }); }

let inflight = false;
export async function loadOpen(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const p = await api.call<Page>('entries?open=1&limit=50');
    set({ open: p.items, openTotal: p.total, loaded: true, error: '' });
    remember(p.items);
  } catch (e) { set({ loaded: true, error: (e as Error).message }); }
  finally { inflight = false; }
}

export interface Filters { q: string; kind: string; state: string; open: '' | 'open' | 'closed'; repo: string; from: string; to: string }
export const NO_FILTERS: Filters = { q: '', kind: '', state: '', open: '', repo: '', from: '', to: '' };
export async function loadPage(f: Filters, cursor = '', limit = 30): Promise<Page> {
  const p = new URLSearchParams({ limit: String(limit) });
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.kind) p.set('kind', f.kind);
  if (f.state) p.set('state', f.state);
  if (f.open === 'open') p.set('open', '1');
  if (f.open === 'closed') p.set('closed', '1');
  if (f.repo.trim()) p.set('repo', f.repo.trim());
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (cursor) p.set('cursor', cursor);
  const page = await api.call<Page>(`entries?${p}`);
  remember(page.items);
  return page;
}
export const loadEntry = (id: string) => api.call<Entry>(`entries/${encodeURIComponent(id)}`);
export const loadResume = (id: string) => api.call<{ id: string; resume: Resume; prompt: string }>(`entries/${encodeURIComponent(id)}/resume`);

/** Fired after any close/reopen so every view reloads. */
export const CHANGED = 'axf:codebase-changes-changed';
const changed = () => { globalThis.dispatchEvent(new Event(CHANGED)); void loadOpen(); };

export async function closeEntry(id: string): Promise<void> {
  set({ busy: id, open: st.open.filter((e) => e.id !== id), openTotal: Math.max(0, st.openTotal - 1) }); // gone at once; the server confirms
  try { await api.post(`entries/${encodeURIComponent(id)}/close`, {}); } finally { set({ busy: '' }); changed(); }
}
/** No word from its session for 10 min, or running for 30+ min (Brett, Oct 22 2026): the banner offers the trash can. */
export const NO_WORD_MS = 10 * 60_000;
export const STUCK_MS = 30 * 60_000;
const msOf = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
export const startedMs = (e: Summary) => msOf(e.startedAt) ?? msOf(e.createdAt);
export const quietMs = (e: Summary, now: number) => now - (msOf(e.lastSeenAt) ?? msOf(e.updatedAt) ?? now);
export const isActive = (e: Summary) => !e.result && (e.status ?? e.state) !== 'done' && (e.status ?? e.state) !== 'failed';
export function stuckWhy(e: Summary, now: number): '' | 'no-word' | 'long' {
  if (!isActive(e)) return '';
  if (quietMs(e, now) > NO_WORD_MS) return 'no-word';
  const st = startedMs(e);
  return st != null && now - st >= STUCK_MS ? 'long' : '';
}
/** Throw a stuck entry away: finished as failed (stalled) and closed on every device; it stays in the log. */
export async function abandonEntry(id: string): Promise<void> {
  set({ busy: id, open: st.open.filter((e) => e.id !== id), openTotal: Math.max(0, st.openTotal - 1) });
  try { await api.post(`entries/${encodeURIComponent(id)}/abandon`, {}); } finally { set({ busy: '' }); changed(); }
}
export async function closeAll(): Promise<number> {
  set({ busy: '*' });
  try { const r = await api.post<{ closed: number }>('close-all', {}); return r.closed; } finally { set({ busy: '' }); changed(); }
}
export async function reopenEntry(id: string): Promise<void> {
  set({ busy: id });
  try { await api.post(`entries/${encodeURIComponent(id)}/reopen`, {}); } finally { set({ busy: '' }); changed(); }
}

let started = false;
export function start(runtime: AxfRuntime) {
  rt = runtime;
  if (started) return;
  started = true;
  void loadOpen();
  setInterval(() => { if (document.visibilityState === 'visible') void loadOpen(); }, POLL_MS);
  globalThis.addEventListener('focus', () => void loadOpen());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void loadOpen(); });
  runtime.settings.subscribe(() => subs.forEach((f) => f()));
}

/* ---------------- time ---------------- */

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export function took(a?: string, b?: string): string {
  if (!a || !b) return '';
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A result link as something to open: https URLs as they are, repo paths on GitHub (first repo, main branch). */
export function linkHref(v: string, repos: string[]): string | null {
  if (/^https:\/\//i.test(v)) return v;
  if (repos[0] && /^[A-Za-z0-9_.][A-Za-z0-9_./ -]*$/.test(v) && !v.split('/').includes('..')) return `https://github.com/${repos[0]}/blob/main/${v.split('/').map(encodeURIComponent).join('/')}`;
  return null;
}
