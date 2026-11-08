/**
 * Walkthrough Generator (investor demos): the console's client for walkthroughs.mjs (over the plugin's REST routes) and
 * the pure picker model. The formats and rules are walkthrough-rules.mjs, shared with the server and the CLI.
 */
import { useSyncExternalStore } from 'react';
import type { Bundle, BundleSummary, WalkRequest } from '../walkthrough-rules.mjs';
import { api } from './demos-core';

export type { Bundle, BundleSummary, WalkRequest } from '../walkthrough-rules.mjs';

/** Settings keys (lib-settings). */
export const WT_KEYS = {
  tryWait: 'glossary.walkthrough.tryWait',
  docsOpen: 'glossary.walkthrough.docsOpen',
  mode: 'glossary.walkthrough.mode',
  audience: 'glossary.walkthrough.audience',
  depth: 'glossary.walkthrough.depth',
} as const;

export const AUDIENCES = [
  { value: 'investors', label: 'Investors' }, { value: 'customers', label: 'Customers' },
  { value: 'developers', label: 'Developers' }, { value: 'team', label: 'The team' },
];
export const WT_STYLES = [
  { value: 'showcase', label: 'Showcase' }, { value: 'tour', label: 'Tour' }, { value: 'tutorial', label: 'Tutorial' }, { value: 'deep-dive', label: 'Deep dive' },
];
export const WT_DEPTHS = [
  { value: 'brief', label: 'Brief: about 3 steps a feature' }, { value: 'standard', label: 'Standard: about 5' }, { value: 'deep', label: 'Deep: about 8' },
];
export const WT_MODES = [
  { value: 'claude', label: 'Claude writes it (one call per feature)' }, { value: 'template', label: 'Template only (zero tokens)' },
];

export { MAX_TERMS, PICKER_ROWS, moveTerm, pickerEntries, selectAll, toggleTerm, topCategories, type PickFilter } from './walkthrough-pick';

/* ---------------- server calls ---------------- */

export interface Job { job: string; state: 'running' | 'done' | 'failed'; step: number; total: number; doing: string; log: string[]; ai: boolean; mode: string; id?: string; title?: string; brief?: string; result?: BundleSummary; error?: string }
export interface Plan { id: string; title: string; brief: string; request: WalkRequest; missing: string[]; features: { entry: string; term: string }[] }
export interface VersionRow { version: string; at: string; mode: string; model: string; features: number; note: string; current: boolean; diff: { added: string[]; removed: string[]; changed: string[] } | null }

export const planWalkthrough = (request: Partial<WalkRequest>) => api.post('walkthrough/plan', { request }) as Promise<Plan>;
export const startGenerate = (request: Partial<WalkRequest>) => api.post('walkthrough/generate', { request }) as Promise<Job>;
export const jobOf = (id: string) => api.call<Job>(`walkthrough/job?id=${encodeURIComponent(id)}`);
export const cancelJob = (id: string) => api.post('walkthrough/job/cancel', { id }) as Promise<Job>;
export const getBundle = (id: string, version = '') => api.call<Bundle>(`walkthrough?id=${encodeURIComponent(id)}${version ? `&version=${encodeURIComponent(version)}` : ''}`);
export const versionsOf = (id: string) => api.call<VersionRow[]>(`walkthrough/versions?id=${encodeURIComponent(id)}`);
export const exportOf = (id: string) => api.call<Record<string, unknown>>(`walkthrough/export?id=${encodeURIComponent(id)}`);
export async function restoreVersion(id: string, version: string) { const r = await api.post('walkthrough/restore', { id, version }) as BundleSummary; await loadWalkthroughs(true); return r; }
export async function deleteWalkthrough(id: string) { await api.del(`walkthrough?id=${encodeURIComponent(id)}`); await loadWalkthroughs(true); }
export async function importWalkthrough(file: unknown) { const r = await api.post('walkthrough/import', file as Record<string, unknown>) as BundleSummary; await loadWalkthroughs(true); return r; }

/* ---------------- the saved list (shared by the page and the player) ---------------- */

interface ListState { items: BundleSummary[]; ai: boolean; loaded: boolean; loading: boolean; error: string }
let st: ListState = { items: [], ai: false, loaded: false, loading: false, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<ListState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useWalkthroughs = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
export async function loadWalkthroughs(force = false) {
  if (st.loading || (st.loaded && !force)) return;
  set({ loading: true, error: '' });
  try { const r = await api.call<{ items: BundleSummary[]; ai: boolean }>('walkthroughs'); set({ items: r.items, ai: r.ai, loaded: true, loading: false }); } catch (e) { set({ error: (e as Error).message, loading: false }); }
}

/** Follow a job until it ends (polls every `ms`); `on` hears every update. */
export async function followJob(id: string, on: (j: Job) => void, ms = 1200): Promise<Job> {
  for (;;) {
    const j = await jobOf(id);
    on(j);
    if (j.state !== 'running') { if (j.state === 'done') await loadWalkthroughs(true); return j; }
    await new Promise((r) => setTimeout(r, ms));
  }
}
