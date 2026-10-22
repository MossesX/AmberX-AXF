/**
 * Installer look store: the saved look document on axHub's data server (like the app's appearance document), applied
 * to the app's runtime. Theme and control picks are ordinary swaps (so the app's appearance source saves them too);
 * rolled or hand-edited themes are registered as `handoff-look-<type>` assets and their bodies kept in this document,
 * so they come back on every device. Without a hub (local dev, `AXF_APPEARANCE_HUB=off`) the document lives in the
 * app's settings instead.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { hubOrigin } from '@console/hubAppearance';
import {
  ASSET_TYPES, type InstallerLayout, type LookDoc, type LookType, type Marks, type RollResult, type TreeInput, type TypeSpec,
  customId, emptyDoc, normalizeLayout, parseDoc,
} from './look-core';

export const LOOK_PROJECT = 'shared';
export const LOOK_PATH = 'settings/claude-handoff-look.json';
const LOCAL_KEY = 'claude-handoff.look';

type Json = Record<string, unknown>;
interface State { doc: LookDoc; where: 'loading' | 'hub' | 'local'; error: string; undo: Snapshot | null }
interface Snapshot { active: Partial<Record<LookType, string>>; doc: LookDoc }
let st: State = { doc: emptyDoc(), where: 'loading', error: '', undo: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useLook = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
export const lookState = () => st;
export const installerLayout = (): InstallerLayout => st.doc.layout;

let rt: AxfRuntime | null = null;
let version: string | null = null;
let hub: string | null = null;

const hubUrl = () => `${hub}/data/${LOOK_PROJECT}/${LOOK_PATH}`;
function pickHub(): string | null {
  try { const h = hubOrigin(); return h && h !== 'off' ? new URL(h).origin : null; } catch { return null; }
}

async function fetchDoc(): Promise<LookDoc | null> {
  const r = await fetch(hubUrl(), { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
  if (r.status === 404) { version = null; return null; }
  if (r.status === 401 || r.status === 403) throw new Error(`Sign in to ${hub} to keep the installer look there.`);
  if (!r.ok) throw new Error(`${hub} answered ${r.status}.`);
  version = r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? null;
  return parseDoc(JSON.parse((await r.text()) || '{}'));
}

/** Load the document (hub, else the app's settings) and apply its custom assets. */
export async function loadLook(runtime: AxfRuntime): Promise<void> {
  rt = runtime;
  hub = pickHub();
  let doc: LookDoc | null = null;
  if (hub) {
    try { doc = await fetchDoc(); set({ where: 'hub', error: '' }); }
    catch (e) { set({ error: (e as Error).message }); hub = null; }
  }
  if (!hub) {
    try { const raw = rt.settings.get(LOCAL_KEY); doc = typeof raw === 'string' && raw ? parseDoc(JSON.parse(raw)) : null; } catch { doc = null; }
    set({ where: 'local' });
  }
  const d = doc ?? emptyDoc();
  set({ doc: d });
  for (const t of ASSET_TYPES) {
    const data = d.custom[t];
    if (!data) continue;
    if (register(t, data) && rt.getState().active[t as never] !== customId(t)) rt.swap(t as never, customId(t));
  }
}

/** Re-read the saved document (another device or tab may have saved since). */
export async function reloadLook(): Promise<void> { if (rt && !timer) await loadLook(rt); }

let timer: ReturnType<typeof setTimeout> | null = null;
function save(doc: LookDoc): void {
  const next = { ...doc, updatedAt: new Date().toISOString() };
  set({ doc: next });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void persist(next); }, 500);
}

async function persist(doc: LookDoc, retry = true): Promise<void> {
  if (!hub) { try { rt?.settings.set(LOCAL_KEY, JSON.stringify(doc)); } catch { /* settings unavailable: kept in memory */ } return; }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (version) headers['If-Match'] = `"${version}"`; else headers['If-None-Match'] = '*';
    const r = await fetch(hubUrl(), { method: 'PUT', credentials: 'include', redirect: 'error', headers, body: JSON.stringify(doc) });
    if (r.status === 409 || r.status === 412) {
      // someone saved in between: take their version number and write ours on top (last save wins, as everywhere)
      await fetchDoc().catch(() => null);
      if (retry) return persist(doc, false);
    }
    if (!r.ok && r.status !== 409 && r.status !== 412) throw new Error(`${hub} refused the save (${r.status}).`);
    version = r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? version;
    set({ error: '' });
  } catch (e) { set({ error: (e as Error).message }); }
}

function register(type: LookType, data: Json): boolean {
  if (!rt) return false;
  const label = { 'style-theme': 'style theme', 'color-theme': 'colour theme', gauge: 'gauge', meter: 'progress meter' }[type as string] ?? type;
  const r = rt.registry.register({ $axf: 'asset@1', type, id: customId(type), name: `Rolled ${label}`, version: '1.0.0', description: 'Rolled or edited in the Claude handoff installer look', author: 'Claude handoff', tags: ['rolled'], data }, 'app', 'claude-handoff');
  return !!r.ok;
}

const snapshot = (): Snapshot => ({ active: Object.fromEntries(ASSET_TYPES.map((t) => [t, String(rt?.getState().active[t as never] ?? '')])) as Snapshot['active'], doc: st.doc });

/** The tree's inputs from the live runtime: active data, every registered asset per type, and the type specs. */
export function treeInput(spec: Record<string, TypeSpec>): TreeInput & { ids: Partial<Record<LookType, string[]>> } {
  const current: TreeInput['current'] = { 'installer-layout': { ...st.doc.layout } };
  const options: TreeInput['options'] = {};
  const ids: Partial<Record<LookType, string[]>> = {};
  for (const t of ASSET_TYPES) {
    const active = rt?.assetOrNull(t as never) as { data?: Json } | null | undefined;
    current[t] = (active?.data ?? {}) as Json;
    const list = (rt?.registry.list(t as never) ?? []).filter((a) => a.id !== customId(t));
    options[t] = list.map((a) => a.data as Json);
    ids[t] = list.map((a) => a.id);
  }
  return { current, options, spec: spec as TreeInput['spec'], ids };
}

/** Pick a theme / gauge / meter (the switches): an ordinary swap; drops this type's rolled copy. */
export function pickAsset(type: LookType, id: string): void {
  if (!rt) return;
  set({ undo: snapshot() });
  rt.swap(type as never, id);
  const custom = { ...st.doc.custom };
  delete custom[type];
  save({ ...st.doc, custom });
}

export function setLayout(patch: Partial<InstallerLayout>): void {
  set({ undo: snapshot() });
  save({ ...st.doc, layout: normalizeLayout({ ...st.doc.layout, ...patch }) });
}

export function setMarks(marks: Marks): void { save({ ...st.doc, marks }); }
export function setTreeOpen(open: boolean): void { save({ ...st.doc, treeOpen: open }); }

/** Apply a roll (or a hand edit, as a one-type result). */
export function applyRoll(r: RollResult, ids: Partial<Record<LookType, string[]>>): void {
  if (!rt) return;
  set({ undo: snapshot() });
  const custom = { ...st.doc.custom };
  let layout = st.doc.layout;
  for (const [t, data] of Object.entries(r.data) as [LookType, Json][]) {
    if (t === 'installer-layout') { layout = normalizeLayout(data as Partial<InstallerLayout>); continue; }
    const whole = r.whole[t];
    const donorId = whole !== undefined ? ids[t]?.[whole] : undefined;
    if (donorId) { rt.swap(t as never, donorId); delete custom[t]; continue; }
    if (register(t, data)) { rt.swap(t as never, customId(t)); custom[t] = data; }
  }
  save({ ...st.doc, custom, layout });
}

export function undoLast(): void {
  const u = st.undo;
  if (!u || !rt) return;
  for (const t of ASSET_TYPES) {
    const id = u.active[t];
    const data = u.doc.custom[t];
    if (data) register(t, data);
    if (id && rt.registry.has(t as never, id)) rt.swap(t as never, id);
  }
  set({ undo: null });
  save(u.doc);
}

/** Back to the app's own look for every type the installer look changed. */
export function resetLook(defaults: Partial<Record<LookType, string>>): void {
  if (!rt) return;
  set({ undo: snapshot() });
  for (const t of ASSET_TYPES) { const id = defaults[t]; if (id && rt.registry.has(t as never, id)) rt.swap(t as never, id); }
  save({ ...emptyDoc(), marks: st.doc.marks, treeOpen: st.doc.treeOpen });
}

export const lookWhere = () => (st.where === 'hub' ? `axHub (${hub}/data/${LOOK_PROJECT}/${LOOK_PATH})` : st.where === 'local' ? 'this app’s settings (no hub configured)' : 'loading…');
