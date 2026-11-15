/**
 * Demonstration Designer + Book Builder: the pure model shared by the designer, the player, the books page and the
 * glossary page (no DOM except the selector helpers). The contracts live in the framework (demonstration@1, book@1,
 * clip@1, docs@1: core/engines/demo-rules.mjs); the server keeps the assets (demos.mjs) and this file only shapes them.
 */
import { useSyncExternalStore } from 'react';
import type { BookData, ClipData, DemoStep, DemonstrationData, DocsData, Walkthrough } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import type { Catalog, Entry } from './core';

export const FOLDER = 'glossary-index';
export const api = pluginApi(FOLDER, 'Glossary & Index');

export interface Asset<T> { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: T; updatedAt?: string }
export type DemoAsset = Asset<DemonstrationData>;
export type BookAsset = Asset<BookData>;
export type ClipAsset = Asset<ClipData>;
export type DocsAsset = Asset<DocsData>;
export type DemoType = 'demonstration' | 'book' | 'clip' | 'docs';

/** What the lists show (demos.mjs summarize). */
export interface Summary {
  type: DemoType; id: string; name: string; description: string; tags: string[]; updatedAt: string; keywords: number;
  about?: string; steps?: number; seconds?: number; surface?: string; app?: string; generated?: string; chain?: string[];
  chapters?: number; items?: number; minutes?: number; style?: string; docs?: string;
  kind?: string; source?: { kind: string; id: string; chapter: string }; video?: string; recordedAt?: string; entries?: string[];
  depth?: string; format?: string; interactive?: string; files?: number; generatedAt?: string;
}

/** Settings keys (lib-settings). */
export const DEMO_KEYS = {
  speak: 'glossary.demo.speak', run: 'glossary.demo.runSteps', voice: 'glossary.demo.voiceControl', auto: 'glossary.demo.autoAdvance',
  designerTab: 'glossary.designer.tab', booksPicker: 'glossary.books.pickerKind',
} as const;

export const APPS = [{ value: 'console', label: 'Dev Console' }, { value: 'axhub-web', label: 'axHub web' }, { value: 'amberx-droid', label: 'AmberX' }];
export const SURFACES = [{ value: 'live', label: 'Live UI' }, { value: 'preview', label: 'Preview window' }, { value: 'recorder', label: 'Recorder' }];
export const SPEEDS = [{ value: '0.75', label: 'Slow (0.75×)' }, { value: '1', label: 'Normal' }, { value: '1.25', label: 'Brisk (1.25×)' }, { value: '1.5', label: 'Fast (1.5×)' }];
export const STYLES = [
  { id: 'quickstart', title: 'Quickstart', text: 'The shortest path to doing something: a few minutes, no detours.', icon: 'zap' },
  { id: 'tutorial', title: 'Tutorial', text: 'Step by step, one idea per chapter, each building on the last.', icon: 'list' },
  { id: 'tour', title: 'Tour', text: 'A walk through the screens: what is where and what it is for.', icon: 'monitor' },
  { id: 'reference', title: 'Reference', text: 'Every setting, control and API named and explained; for looking things up.', icon: 'search' },
  { id: 'deep-dive', title: 'Deep dive', text: 'How it works underneath: engines, contracts, data flows.', icon: 'layers' },
];
export const DEPTHS = [{ value: 'light', label: 'Light: one page' }, { value: 'standard', label: 'Standard: a page per chapter' }, { value: 'deep', label: 'Deep: a page per item with its API' }, { value: 'extreme', label: 'Extreme: runnable examples, live components, search' }];
export const FORMATS = [{ value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }, { value: 'interactive-html-ts', label: 'Interactive HTML + TypeScript' }];
export const INTERACTIVES = [{ value: 'none', label: 'Static' }, { value: 'examples', label: 'Runnable API examples' }, { value: 'live', label: 'Live components from the real app' }];
export const CLIP_KINDS = ['clip', 'demo', 'chapter', 'walkthrough', 'video'];

/* ---------------- the catalog, loaded once per page visit (shared by every view of the plugin) ---------------- */

interface CatState { cat: Catalog | null; error: string; loading: boolean }
let catSt: CatState = { cat: null, error: '', loading: false };
const catSubs = new Set<() => void>();
const setCat = (p: Partial<CatState>) => { catSt = { ...catSt, ...p }; catSubs.forEach((f) => f()); };
export const useCatalog = () => useSyncExternalStore((f) => { catSubs.add(f); return () => { catSubs.delete(f); }; }, () => catSt);
export async function loadCatalog(force = false) {
  if (catSt.loading || (catSt.cat && !force)) return;
  setCat({ loading: true, error: '' });
  try { setCat({ cat: await api.call<Catalog>('catalog'), loading: false }); } catch (e) { setCat({ error: (e as Error).message, loading: false }); }
}
export async function rebuildCatalog(): Promise<string> {
  const r = await api.post('rebuild', { reason: 'console' }) as { wrote?: boolean; total?: number; diff?: { added: number; changed: number; removed: number } };
  await loadCatalog(true);
  return r.wrote ? `Rebuilt: ${(r.total ?? 0).toLocaleString()} entries (+${r.diff?.added ?? 0} new, ${r.diff?.changed ?? 0} changed, ${r.diff?.removed ?? 0} gone).` : 'Already up to date.';
}
export const entryOf = (id: string): Entry | undefined => catSt.cat?.entries.find((e) => e.id === id);

/* ---------------- the demo store (every asset of the four types) ---------------- */

interface DemoState { items: Record<DemoType, Summary[]>; loaded: boolean; loading: boolean; error: string }
let st: DemoState = { items: { demonstration: [], book: [], clip: [], docs: [] }, loaded: false, loading: false, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<DemoState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useDemoStore = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);

export async function loadDemos(force = false) {
  if (st.loading || (st.loaded && !force)) return;
  set({ loading: true, error: '' });
  try {
    const r = await api.call<{ items: Summary[] }>('demos');
    const items: DemoState['items'] = { demonstration: [], book: [], clip: [], docs: [] };
    for (const s of r.items) (items[s.type] ??= []).push(s);
    set({ items, loaded: true, loading: false });
  } catch (e) { set({ error: (e as Error).message, loading: false }); }
}
export const getAsset = <T,>(type: DemoType, id: string) => api.call<Asset<T>>(`demo?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
export async function saveAsset<T>(type: DemoType, asset: Asset<T>): Promise<Asset<T>> { const a = await api.post('demo', { type, asset }) as Asset<T>; await loadDemos(true); return a; }
export async function deleteAsset(type: DemoType, id: string) { await api.del(`demo?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`); await loadDemos(true); }
export async function generateDemo(entry: string, save = true): Promise<DemoAsset> { const a = await api.post('demo/generate', { entry, save }) as DemoAsset; if (save) await loadDemos(true); return a; }
export const walkthroughOf = (type: DemoType, id: string) => api.call<Walkthrough>(`demo/walkthrough?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
export async function newBook(wizard: Record<string, unknown>): Promise<BookAsset> { const a = await api.post('book/new', wizard) as BookAsset; await loadDemos(true); return a; }
export async function changeBook(id: string, change: Record<string, unknown>): Promise<BookAsset> { const a = await api.post('book/change', { id, change }) as BookAsset; await loadDemos(true); return a; }
export const recordBook = (id: string, dryRun = false) => api.post('book/record', { id, dryRun }) as Promise<{ file: string; job: Record<string, unknown> | null; dryRun: boolean }>;
export async function registerClip(asset: Record<string, unknown>): Promise<ClipAsset> { const a = await api.post('clip/register', { asset }) as ClipAsset; await loadDemos(true); return a; }
export async function clipFromDemo(id: string, media: Record<string, unknown>, recorded: Record<string, unknown> = {}): Promise<ClipAsset> { const a = await api.post('clip/from-demo', { id, media, recorded }) as ClipAsset; await loadDemos(true); return a; }
export async function generateDocs(source: { kind: string; id?: string; entries?: string[] }, options: Record<string, unknown>): Promise<DocsAsset> { const a = await api.post('docs/generate', { source, options }) as DocsAsset; await loadDemos(true); return a; }
export const docsFileUrl = (id: string, path: string) => `docs/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`;

/* ---------------- pure helpers ---------------- */

/** A new, empty demonstration (the designer's "Blank demonstration"). */
export function blankDemo(name = 'New demonstration'): DemoAsset {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'new-demonstration';
  return {
    $axf: 'asset@1', type: 'demonstration', id: id.length < 2 ? `${id}-demo` : id, name, version: '1.0.0', description: '', tags: ['demonstration'],
    data: { about: '', entries: [], app: 'console', surface: 'live', steps: [{ say: 'Say what this step shows.', do: '', target: '' }], voice: { narrator: '', speed: 1 }, chain: [], keywords: [], generated: { from: 'manual', at: '', build: '' }, editable: true },
  };
}

export const emptyStep = (): DemoStep => ({ say: '', do: '', target: '' });
export function moveStep<T>(list: T[], i: number, dir: -1 | 1): T[] { const j = i + dir; if (j < 0 || j >= list.length) return list; const out = [...list]; [out[i], out[j]] = [out[j]!, out[i]!]; return out; }
export const replaceAt = <T,>(list: T[], i: number, v: T): T[] => list.map((x, k) => (k === i ? v : x));
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, k) => k !== i);

export function fmtSeconds(s: number): string {
  const n = Math.max(0, Math.round(s));
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${String(n % 60).padStart(2, '0')} s`;
}
export const fmtMinutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m * 10) / 10} min`);

/** The element a target names: `[data-axf-id]`, a view (`[data-view]`), a tab, an id, else a CSS selector (walkthrough@1 rule). */
export function targetSelectors(target: string): string[] {
  const t = target.trim();
  if (!t) return [];
  const esc = t.replace(/["\\]/g, '');
  return [`[data-axf-id="${esc}"]`, `[data-view="${esc}"]`, `[data-tab="${esc}"]`, `[data-axf-help="${esc}"]`, `#${/^[a-z][\w-]*$/i.test(t) ? t : '__none__'}`, t];
}

/** Spoken commands in the player: next, back, repeat, stop. */
export function voiceMove(heard: string): 'next' | 'prev' | 'repeat' | 'close' | null {
  const n = heard.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(next|go on|continue|ok next|done|got it|forward)$/.test(n)) return 'next';
  if (/^(back|previous|go back)$/.test(n)) return 'prev';
  if (/^(repeat|again|say again|what)$/.test(n)) return 'repeat';
  if (/^(stop|close|cancel|exit|thanks|thank you|quit)$/.test(n)) return 'close';
  return null;
}

/** The ref a glossary entry or an asset gets inside a book. */
export const refOf = (kind: 'entry' | DemoType, id: string) => (kind === 'entry' ? id : `${kind}/${id}`);

/** A label for a book item ref from the catalog and the store. */
export function refLabel(ref: string, cat: Catalog | null, items: DemoState['items']): { label: string; kind: string; icon: string } {
  const m = /^(demonstration|clip|book)\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(ref);
  if (m) {
    const a = items[m[1] as DemoType]?.find((x) => x.id === m[2]);
    return { label: a ? `${a.name}${m[3] ? ` › ${m[3]}` : ''}` : ref, kind: m[1]!, icon: m[1] === 'demonstration' ? 'play' : m[1] === 'clip' ? 'monitor' : 'file' };
  }
  const e = cat?.entries.find((x) => x.id === ref);
  return { label: e?.term ?? ref, kind: e?.kind ?? 'entry', icon: 'list' };
}
