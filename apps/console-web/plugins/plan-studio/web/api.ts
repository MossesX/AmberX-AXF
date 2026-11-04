/** Plan Studio: the server calls (pluginApi: console token + standard messages) and the page's shared state. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';
import * as pc from './plan-core.mjs';
import type { CatalogEntry, History, Plan, SavedView, Template } from './plan-core.mjs';
import type { Op } from './plan-ai.mjs';

export const FOLDER = 'plan-studio';
export const VIEW = 'plan-studio';
export const KEYS = {
  layout: 'plan-studio.layout', sort: 'plan-studio.sort', group: 'plan-studio.group', autoApply: 'plan-studio.autoApply',
  banner: 'plan-studio.banner', voiceLang: 'plan-studio.voiceLang', voiceOut: 'plan-studio.voiceOut', autosave: 'plan-studio.autosave',
} as const;
export const api = pluginApi(FOLDER, 'Plan Studio', { unavailable: 'Plan Studio is switched off or its server part is not running.' });

export interface StudioState {
  ok: boolean; error?: string; plans: Plan[]; categories: { paths: string[] }; templates: { items: Template[]; all: Template[] }; views: { items: SavedView[] };
  profiles: { id: string; label: string }[]; activeProfile: string; store: string; onHub: boolean; synced: string[];
}
export interface AiResult {
  ok: boolean; error?: string; via?: string; ops?: Op[]; summary?: string[]; answer?: string; ask?: string; say?: string; plan?: Plan | null; others?: Plan[]; created?: Plan[];
  needsAi?: boolean; aiMissing?: boolean; model?: string;
}
export interface SaveResult { ok: boolean; plan: Plan; duplicates?: { id: string; title: string; status: string; score: number }[]; unchanged?: boolean; created?: boolean; error?: string }

export const call = <T,>(op: string, body: Record<string, unknown> = {}) => api.post<T>('api', { op, ...body });

/* ---------------------------------------------------------------- one store for the page (and the quick capture dialog) */

let state: StudioState | null = null;
let loading: Promise<void> | null = null;
let failed = '';
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
export async function reload(): Promise<void> {
  loading = (async () => {
    try { const r = await api.call<StudioState>('state'); if (!r.ok) throw new Error(r.error || 'no data'); state = r; failed = ''; }
    catch (e) { failed = (e as Error).message; }
    finally { loading = null; tell(); }
  })();
  return loading;
}
/** Put one saved plan into the store without a reload. */
export function putPlan(p: Plan) { if (!state) return; state = { ...state, plans: [...state.plans.filter((x) => x.id !== p.id), p] }; tell(); }
export function dropPlan(id: string) { if (!state) return; state = { ...state, plans: state.plans.filter((x) => x.id !== id) }; tell(); }
export function setPart(part: Partial<StudioState>) { if (!state) return; state = { ...state, ...part }; tell(); }
const snap = () => state;
export function useStudio(): { state: StudioState | null; error: string; reload: () => Promise<void> } {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, snap, snap);
  useEffect(() => { if (!state && !loading) void reload(); }, []);
  return { state: s, error: failed, reload };
}

/* ---------------------------------------------------------------- calls */

export async function savePlan(plan: Plan, opts: { kind?: string; note?: string; force?: boolean } = {}): Promise<SaveResult> {
  const r = await call<SaveResult>('save', { plan, ...opts });
  if (r.ok && r.plan) putPlan(r.plan);
  return r;
}
export async function getPlan(id: string): Promise<{ plan: Plan; history: History }> { return call('get', { id }); }
export async function deletePlan(id: string) { await call('delete', { id }); dropPlan(id); }
export async function restorePlan(id: string, v: number) { const r = await call<SaveResult>('restore', { id, v }); if (r.plan) putPlan(r.plan); return r; }
export async function catalog(): Promise<CatalogEntry[]> { const r = await api.call<{ ok: boolean; entries: CatalogEntry[]; error?: string }>('catalog'); if (!r.ok) throw new Error(r.error || 'no catalog'); return r.entries; }
export async function aiStatus(): Promise<{ available: boolean; message?: string; setup?: string; profiles?: { id: string; label: string; model: string }[] }> { return api.call('ai/status'); }
export async function askAi(text: string, plan?: string): Promise<AiResult> { return api.post<AiResult>('ai', { text, plan: plan ?? '' }); }
export async function applyAi(ops: Op[], text: string, plan?: string): Promise<{ ok: boolean; saved: Plan[]; summary: string[]; say: string }> {
  const r = await call<{ ok: boolean; saved: Plan[]; summary: string[]; say: string }>('ai-apply', { ops, text, plan: plan ?? '' });
  for (const p of r.saved ?? []) putPlan(p);
  return r;
}
export async function turnIntoBuild(id: string, profile: string, preview: boolean, buildId?: string) {
  const r = await call<{ ok: boolean; preview?: boolean; change?: ReturnType<typeof pc.toBuild>; minutes?: number; plan?: Plan; build?: { profile: string; id: string }; error?: string }>('build', { id, profile, preview, buildId });
  if (r.plan) putPlan(r.plan);
  return r;
}

/** Undo for an applied AI edit: put every changed plan back as it was, remove the plans it created. */
export function undoFor(before: Plan[], saved: Plan[], text: string): () => Promise<string> {
  return async () => {
    for (const p of saved) {
      const old = before.find((b) => b.id === p.id);
      if (old) await savePlan({ ...old, version: p.version }, { kind: 'ai', note: `Undo AI edit: ${text.slice(0, 200)}`, force: true });
      else await deletePlan(p.id);
    }
    return 'Undone.';
  };
}

/** Is the AI there? Asked once per page load. */
let aiInfo: Promise<{ available: boolean; message?: string; setup?: string }> | null = null;
export function useAiInfo() {
  const [info, setInfo] = useState<{ available: boolean; message?: string; setup?: string } | null>(null);
  useEffect(() => { aiInfo = aiInfo ?? aiStatus().catch(() => ({ available: false, message: 'Could not reach the AI status.' })); void aiInfo.then(setInfo); }, []);
  return info;
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError((e as Error).message); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

export const statusInfo = (s: string) => pc.STATUSES.find((x) => x.id === s) ?? pc.STATUSES[1]!;
export const fmtDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
export const fmtWhen = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
