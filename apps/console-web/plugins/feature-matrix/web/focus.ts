/**
 * Which matrix the page should open (set by a grid's row hook or the app menu, read by the page). A tiny store, no
 * React state outside the hook, so a hook fired from any grid opens the right row even before the page is mounted.
 */
import { useSyncExternalStore } from 'react';
import * as fm from './fm-core.mjs';

export const VIEW = 'feature-matrix';
export const FOLDER = 'feature-matrix';
export const ID = 'ai.amberx.axf.console.feature-matrix';
export const KEYS = { sort: 'feature-matrix.sort', rowButton: 'feature-matrix.rowButton', history: 'feature-matrix.history' } as const;

export interface Focus { id: string; ref: fm.BuildRef | null; profile: string; at: number }
let focus: Focus | null = null;
const subs = new Set<() => void>();
export function setFocus(ref: fm.BuildRef | string, profile?: string) {
  if (typeof ref === 'string') focus = { id: ref, ref: null, profile: ref.split(':')[0] ?? '', at: Date.now() };
  else { const r = fm.normRef(ref); if (!r) return; const p = fm.slug(profile ?? '') || ''; focus = { id: p ? fm.matrixId(r, p) : '', ref: r, profile: p, at: Date.now() }; }
  subs.forEach((f) => f());
}
export const clearFocus = () => { focus = null; subs.forEach((f) => f()); };
export const useFocus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => focus, () => focus);
