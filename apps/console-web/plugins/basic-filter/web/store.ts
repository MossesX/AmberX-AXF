/**
 * Basic filter — settings-backed store: which datasets it's attached to, the toolbar config and each dataset's filter.
 * Values live in the app's settings (per key, last save wins), so they follow the console's settings everywhere.
 */
import { useSyncExternalStore } from 'react';
import { useRuntime } from '@console/axf/react';
import {
  EMPTY_STATE, KEY_DATASETS, KEY_STATE, KEY_TOOLBAR, parseDatasets, parseStates, parseToolbar,
  type FilterState, type ToolbarConfig,
} from './core';

type Rt = ReturnType<typeof useRuntime>;

/** Re-render on any settings change (cheap: settings keep a revision counter). */
export function useSettingsRevision(rt: Rt): number {
  return useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision, rt.settings.getRevision);
}

export const readToolbar = (rt: Rt): ToolbarConfig => parseToolbar(rt.settings.get(KEY_TOOLBAR));
export const saveToolbar = (rt: Rt, t: ToolbarConfig) => rt.settings.set(KEY_TOOLBAR, JSON.stringify(t));

export const readAttached = (rt: Rt): string[] => parseDatasets(rt.settings.get(KEY_DATASETS));
export function setAttached(rt: Rt, dataset: string, on: boolean) {
  const cur = readAttached(rt);
  const next = on ? [...new Set([...cur, dataset])] : cur.filter((x) => x !== dataset);
  rt.settings.set(KEY_DATASETS, JSON.stringify(next));
}

export const readState = (rt: Rt, dataset: string): FilterState => parseStates(rt.settings.get(KEY_STATE))[dataset] ?? EMPTY_STATE;
export function saveState(rt: Rt, dataset: string, s: FilterState) {
  const all = parseStates(rt.settings.get(KEY_STATE));
  if (s.query === '' && !s.rules.length && !s.sort.length) delete all[dataset]; else all[dataset] = s;
  rt.settings.set(KEY_STATE, JSON.stringify(all));
}

export function useToolbar(): ToolbarConfig { const rt = useRuntime(); useSettingsRevision(rt); return readToolbar(rt); }
export function useAttached(): string[] { const rt = useRuntime(); useSettingsRevision(rt); return readAttached(rt); }
export function useFilterState(dataset: string): FilterState { const rt = useRuntime(); useSettingsRevision(rt); return readState(rt, dataset); }
