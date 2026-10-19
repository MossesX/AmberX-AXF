/**
 * Plugin Manager choices are settings (Settings → Plugins → Plugin Manager), so they follow the UI-editor rules:
 * saves are per key and the last save wins, and the manager re-reads them (useEditorSync → rt.refreshFromSaved)
 * whenever it opens, loads or comes back into focus.
 */
import { useCallback, useEffect, useState } from 'react';
import { useEditorSync, useRuntime } from '@console/axf/react';

export const LAYOUTS = [
  { id: 'studio', label: 'Studio', icon: 'layout', note: 'Side rail, soft cards, details on the right' },
  { id: 'mission', label: 'Mission control', icon: 'chart', note: 'Status tiles, live board, alerts column' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', note: 'Monospace console with a command line' },
  { id: 'catalog', label: 'Catalog', icon: 'star', note: 'Store-style shelves with a featured plugin' },
] as const;
export const VIEWS = [
  { id: 'grid', label: 'Cards', icon: 'grid' },
  { id: 'table', label: 'Table', icon: 'list' },
  { id: 'detail', label: 'Detail', icon: 'layers' },
  { id: 'graph', label: 'Dependencies', icon: 'branch' },
  { id: 'install', label: 'Install', icon: 'download' },
] as const;
export type LayoutId = (typeof LAYOUTS)[number]['id'];
export type ViewId = (typeof VIEWS)[number]['id'];
export const FILTERS = ['all', 'enabled', 'off', 'problems', 'editors'] as const;
export type FilterId = (typeof FILTERS)[number];
export const SORTS = ['name', 'health', 'size', 'deps'] as const;
export type SortId = (typeof SORTS)[number];

export const KEYS = {
  layout: 'plugin-manager.layout',
  view: 'plugin-manager.view',
  filter: 'plugin-manager.filter',
  sort: 'plugin-manager.sort',
  selected: 'plugin-manager.selected',
} as const;

export interface Prefs { layout: LayoutId; view: ViewId; filter: FilterId; sort: SortId; selected: string }

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

export function usePrefs() {
  const rt = useRuntime();
  const read = useCallback((): Prefs => ({
    layout: pick(rt.settings.get(KEYS.layout), LAYOUTS.map((l) => l.id), 'studio'),
    view: pick(rt.settings.get(KEYS.view), VIEWS.map((v) => v.id), 'grid'),
    filter: pick(rt.settings.get(KEYS.filter), FILTERS, 'all'),
    sort: pick(rt.settings.get(KEYS.sort), SORTS, 'name'),
    selected: String(rt.settings.get(KEYS.selected) ?? ''),
  }), [rt]);
  const [prefs, setPrefs] = useState<Prefs>(read);
  // Fresh on open / load / focus (Brett's UI-editor rule).
  useEditorSync({ onRefresh: () => setPrefs(read()) });
  useEffect(() => {
    const offs = Object.values(KEYS).map((k) => rt.settings.onChange(k, () => setPrefs(read())));
    return () => offs.forEach((o) => o());
  }, [rt, read]);
  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    rt.settings.set(KEYS[key], value); // per-key save: last one wins, other keys untouched
    setPrefs((p) => ({ ...p, [key]: value }));
  }, [rt]);
  return { prefs, set };
}
