/**
 * One ranked search over the whole console (console-control@1 `search`, framework/spec/CONSOLE-CONTROL.md).
 *
 * Sources, all scored by the same engine (core/engines/search.ts `scoreEntry`), merged by address:
 *   - screen:    what is rendered now (the live registry: tabs, buttons, grids, grid rows, build steps, settings)
 *   - loaded:    data a view or plugin has loaded but may not render (build steps of a folded build, UI Review items,
 *                chat lines): `addLoadedSource(id, () => LoadedItem[])`, open to any plugin through `@console/control/search`
 *   - inventory: the static index (every view, tab, settings tab, setting, function, button and plugin, rendered or not)
 *   - index:     the framework search index (plan features, tracker items, builds, windows, dialogs, words on the page)
 *   - help:      help@1 entries (title and text), pointing at the control they explain
 * Every hit carries an address, so `focus` / `open` on it pulls it into view; a hit that is an action with an argument
 * carries `value` too (press `function:<id>` with that value).
 *
 * The registry's `search` verb uses this ranking once `installControlSearch` ran (App.tsx, through installConsoleControl).
 */
import type { AxfRuntime } from '../axf/core';
import { scoreEntry } from '../axf/core/engines/search';
import { CONSOLE_CONTROL_WIRE, ConsoleControlError, parseAddress, type ConsoleControlKind, type ControlTarget, type SearchQuery } from '../axf/core/engines/console-control';
import { controlRegistry } from '../axf/react';
import { inventory, inventoryTargets } from './inventory';

export type SearchSource = 'screen' | 'loaded' | 'inventory' | 'index' | 'help';

export interface ConsoleSearchHit {
  address: string;
  kind: ConsoleControlKind;
  label: string;
  detail?: string;
  icon?: string;
  score: number;
  source: SearchSource;
  /** rendered on the screen right now */
  onScreen?: boolean;
  /** the argument a function hit runs with (press address with this value) */
  value?: string;
}

/** Something a view or plugin has loaded: a build step, a review item, a chat line. `address` must parse. */
export interface LoadedItem { address: string; kind: ConsoleControlKind; label: string; detail?: string; icon?: string; keywords?: string[] }
export type LoadedSource = () => LoadedItem[];

const loadedSources = new Map<string, LoadedSource>();

/** Add (or replace) a source of loaded items. Returns a remover. */
export function addLoadedSource(id: string, source: LoadedSource): () => void {
  loadedSources.set(id, source);
  return () => { if (loadedSources.get(id) === source) loadedSources.delete(id); };
}

/** Rank boosts: what is on the screen first, then loaded data, then the rest; among kinds, places before things. */
const SOURCE_BOOST: Record<SearchSource, number> = { screen: 12, loaded: 8, inventory: 0, index: 0, help: -6 };
const KIND_BOOST: Partial<Record<ConsoleControlKind, number>> = { view: 6, tab: 4, subtab: 3, setting: 3, plugin: 3, row: 2, step: 2, panel: 1 };

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 200;

const round = (n: number) => Math.round(n * 1000) / 1000;
const addressIds = (address: string): string[] => { try { return parseAddress(address).map((s) => s.id.replace(/[-_.=]/g, ' ')); } catch { return []; } };
const validAddress = (address: string): boolean => { try { parseAddress(address); return true; } catch { return false; } };
const fnAddress = (id: string) => `function:${id.replace(/%/g, '%25').replace(/\//g, '%2F')}`;

/** The address a framework search-index entry (or a help target) points at, else null. */
export function indexAddress(focus: { kind: string; [k: string]: unknown }): { address: string; kind: ConsoleControlKind; value?: string } | null {
  if (focus.kind === 'control' && typeof focus.address === 'string') {
    try { const p = parseAddress(focus.address); return { address: focus.address, kind: p[p.length - 1]!.kind }; } catch { return null; }
  }
  if ((focus.kind === 'view' || focus.kind === 'text') && typeof focus.view === 'string') return { address: `view:${focus.view}`, kind: 'view' };
  if (focus.kind === 'action' && typeof focus.spec === 'string') {
    const [id, ...rest] = focus.spec.split(':');
    if (!id) return null;
    if (id === 'nav' && rest[0]) return { address: `view:${rest[0]}`, kind: 'view' };
    return { address: fnAddress(id), kind: 'function', ...(rest.length ? { value: rest.join(':') } : {}) };
  }
  if (focus.kind === 'setting' && typeof focus.tab === 'string') return { address: `view:settings/tab:settings.tabs=${focus.tab}`, kind: 'tab' };
  if (focus.kind === 'dialog' && typeof focus.id === 'string') return { address: fnAddress('dialog'), kind: 'function', value: focus.id };
  if (focus.kind === 'window' && typeof focus.id === 'string') return { address: fnAddress('windows.restore'), kind: 'function', value: focus.id };
  return null;
}

/** A help id (`view:x`, `action:x`, a free id) as an address: the screen or the action, else the "What is this?" panel. */
export function helpAddress(target: string): { address: string; kind: ConsoleControlKind; value?: string } {
  const view = /^view:([^/:]+)$/.exec(target);
  if (view) return { address: `view:${view[1]}`, kind: 'view' };
  const action = /^action:([^:]+)$/.exec(target);
  if (action) return { address: fnAddress(action[1]!), kind: 'function' };
  return { address: fnAddress('help.explain'), kind: 'function', value: target };
}

/** Every searchable item, with its source. Live targets first, so their address wins the merge. */
function* candidates(rt: AxfRuntime): Generator<{ t: Pick<ControlTarget, 'address' | 'kind' | 'label' | 'detail' | 'icon' | 'keywords'>; source: SearchSource; onScreen?: boolean; value?: string }> {
  for (const t of controlRegistry(rt).snapshot().targets) yield { t, source: t.virtual ? 'loaded' : 'screen', onScreen: !t.virtual };
  for (const [id, src] of loadedSources) {
    let items: LoadedItem[] = [];
    try { items = src(); } catch (e) { rt.terminal.warn('control', `search source ${id} failed: ${e instanceof Error ? e.message : String(e)}`); }
    for (const t of items) if (validAddress(t.address)) yield { t, source: 'loaded' };
  }
  for (const t of inventoryTargets()) yield { t, source: 'inventory' };
  const inv = inventory as unknown as Record<string, unknown>;
  for (const t of (inv.settingsTabs as { address: string; label: string; id: string }[] | undefined) ?? []) yield { t: { address: t.address, kind: t.address.includes('/subtab:') ? 'subtab' : 'tab', label: t.label, detail: 'Settings', keywords: [t.id, 'settings'] }, source: 'inventory' };
  for (const key of ['settings', 'functions', 'buttons', 'plugins']) {
    for (const t of (inv[key] as ControlTarget[] | undefined) ?? []) if (t?.address) yield { t: { ...t, keywords: [...(t.keywords ?? []), ...((t as { aliases?: string[] }).aliases ?? [])] }, source: 'inventory' };
  }
}

/**
 * Rank everything for a query. Kinds filter by hit kind; the limit is clamped to SEARCH_MAX_LIMIT.
 * Throws `invalid` for an empty query.
 */
export function consoleSearch(rt: AxfRuntime, query: SearchQuery): ConsoleSearchHit[] {
  const q = String(query?.q ?? '').trim();
  if (!q) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'search needs words (query.q)', { field: 'query.q' });
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? SEARCH_DEFAULT_LIMIT)), SEARCH_MAX_LIMIT);
  const kinds = query.kinds?.length ? new Set(query.kinds) : null;
  const best = new Map<string, ConsoleSearchHit>();
  const keep = (h: ConsoleSearchHit) => {
    if (kinds && !kinds.has(h.kind)) return;
    const key = h.value === undefined ? h.address : `${h.address}\u0000${h.value}`;
    const prev = best.get(key);
    if (!prev || h.score > prev.score) best.set(key, prev?.onScreen ? { ...h, onScreen: true } : h);
  };

  for (const { t, source, onScreen, value } of candidates(rt)) {
    const s = scoreEntry({ label: t.label, detail: t.detail, keywords: [...(t.keywords ?? []), ...addressIds(t.address)], kind: t.kind }, q);
    if (s <= 0) continue;
    keep({ address: t.address, kind: t.kind, label: t.label, ...(t.detail ? { detail: t.detail } : {}), ...(t.icon ? { icon: t.icon } : {}), score: round(s + SOURCE_BOOST[source] + (KIND_BOOST[t.kind] ?? 0)), source, ...(onScreen ? { onScreen } : {}), ...(value !== undefined ? { value } : {}) });
  }

  // the framework index: plan features, tracker items, builds, windows, dialogs, words on the page (control targets are already in)
  for (const h of rt.search.query(q, { limit: SEARCH_MAX_LIMIT })) {
    if (h.locked || h.kind === 'target') continue;
    const a = indexAddress(h.focus as { kind: string });
    if (!a) continue;
    keep({ address: a.address, kind: a.kind, label: h.label, ...(h.detail ? { detail: h.detail } : {}), ...(h.icon ? { icon: h.icon } : {}), score: round(h.score + SOURCE_BOOST.index + (KIND_BOOST[a.kind] ?? 0)), source: 'index', ...(a.value !== undefined ? { value: a.value } : {}) });
  }

  // help: title first, the text as keywords
  for (const e of rt.helpIndex().byTarget.values()) {
    const s = scoreEntry({ label: e.title, detail: 'Help', keywords: [e.text, e.target], kind: 'help' }, q);
    if (s <= 0) continue;
    const a = helpAddress(e.target);
    keep({ address: a.address, kind: a.kind, label: e.title, detail: `Help · ${e.text.slice(0, 80)}`, icon: 'help', score: round(s + SOURCE_BOOST.help), source: 'help', ...(a.value !== undefined ? { value: a.value } : {}) });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.address.localeCompare(b.address))
    .slice(0, limit);
}

/** Make the registry's `search` verb (and every transport on it) use the console-wide ranking. Returns a remover. */
export function installControlSearch(rt: AxfRuntime): () => void {
  const reg = controlRegistry(rt);
  reg.setSearcher((query) => consoleSearch(rt, query) as never);
  return () => reg.setSearcher(null);
}
