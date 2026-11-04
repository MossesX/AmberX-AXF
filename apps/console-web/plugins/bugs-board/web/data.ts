/**
 * Bugs board data (shared by the banner chip, the settings panel and the lazy-loaded board): one board read kept for
 * every view, refreshed on focus, on a timer and after every change. Every change goes to the server (bugs.mjs).
 */
import { useCallback, useEffect, useState } from 'react';
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'bugs-board';
const POLL_MS = 20000;

export type Status = 'confirmed' | 'in-build' | 'fixed' | 'wontfix';
export type Severity = 'low' | 'normal' | 'high' | 'urgent';
export interface Bug {
  id: string; title: string; details: string; status: Status; severity: Severity; app: string; area: string; tags: string[]; files: string[];
  reportedBy: string; reportedAt: string; said: string; build: string; profile: string; fixedPr: string; order: number;
  needsBrett: boolean; candidates: string[]; history: { at: string; by: string; what: string }[]; createdAt: string; updatedAt: string;
}
export interface BuildChip { tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'; text: string }
export interface BuildInfo {
  id: string; title: string; status: string; live: string; profile: string; profiles: string[]; steps: number; done: number; finishing: boolean;
  pr: string; agent: string; agentName: string; queuePos: number; session: string; chip: BuildChip; target: boolean;
}
export interface Settings { autoOptimize: boolean; maxPerBuild: number; minScore: number; askAi: boolean; chat: boolean; tone: 'street' | 'clean'; whenBounced: 'reroute' | 'ask'; bouncesBeforeAsk: number; scope: 'profile' | 'all'; freshDays: number }
export interface Group { key: string; build: string; label: string; items: Bug[] }
export interface Board {
  ok: boolean; settings: Settings; rev: number; canUndo: boolean; undo: { what: string; at: string } | null;
  bugs: Bug[]; groups: Group[]; builds: BuildInfo[]; apps: string[]; banner: { open: number; unassigned: number; needsBrett: number };
}
export interface Move { bug: string; title?: string; from: string; to: string; score: number; why: string[] }
export interface Filter { status: 'open' | 'all' | 'fixed' | 'wontfix'; app: string; profile: string }

let shared: Board | null = null;
let filter: Filter = { status: 'open', app: '', profile: '' };
const listeners = new Set<() => void>();
const publish = () => { for (const l of listeners) l(); };

export async function load(): Promise<Board> {
  const q = new URLSearchParams({ status: filter.status, app: filter.app, profile: filter.profile });
  const r = await pluginFetch(FOLDER, `board?${q}`);
  const j = (await r.json().catch(() => ({}))) as Board & { detail?: string };
  if (!r.ok || !j.ok) throw new Error(j.detail || `HTTP ${r.status}`);
  shared = j; publish();
  return j;
}
export function setFilter(f: Partial<Filter>) { filter = { ...filter, ...f }; void load().catch(() => undefined); publish(); }
export const getFilter = () => filter;
/** The last board read (or null). */
export const current = () => shared;

export interface ActResult { ok: boolean; log: string[]; chat?: { from: string; text: string }[]; side?: string[]; bug?: Bug | null }
export async function act(change: Record<string, unknown>): Promise<ActResult> {
  const r = await pluginFetch(FOLDER, 'act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
  const j = (await r.json().catch(() => ({}))) as ActResult & { detail?: string };
  if (!r.ok || !j.ok) throw new Error(j.detail || `HTTP ${r.status}`);
  await load().catch(() => undefined);
  return j;
}
export async function preview(): Promise<{ moves: Move[]; unclear: string[] }> {
  const r = await pluginFetch(FOLDER, 'optimize');
  const j = (await r.json().catch(() => ({}))) as { ok: boolean; moves: Move[]; unclear: string[]; detail?: string };
  if (!r.ok || !j.ok) throw new Error(j.detail || `HTTP ${r.status}`);
  return j;
}

/** The board, kept fresh while anything shows it. */
export function useBoard() {
  const [, tick] = useState(0);
  const [error, setError] = useState('');
  const refresh = useCallback(() => load().then(() => setError(''), (e: Error) => setError(e.message)), []);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!shared) void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { listeners.delete(l); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  return { board: shared, error, refresh, filter };
}
