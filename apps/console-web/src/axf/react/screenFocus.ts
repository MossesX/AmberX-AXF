/**
 * Every view answers `<view>.focus:<key>` (screen-focus.ts). The shell registers this generic one for each view that
 * doesn't declare its own; a screen's own (tabs, filters, folded rows it keeps in state) replaces it whenever it lands.
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime } from '../core/runtime';
import { SCREEN_FOCUS_EVENT, askScreenFocus, focusActionId, focusKeyOf, focusOnPage, wantedScreenFocus, type FocusHit } from '../core/screen-focus';

/** Open a view in front of everything (a covering dialog closes) and bring the key forward on it. */
export function openAndFocus(rt: AxfRuntime, view: string, arg?: string): Promise<FocusHit> {
  if (rt.getState().dialog) rt.closeDialog();
  rt.navigate(view);
  const key = focusKeyOf(arg);
  if (!key) return Promise.resolve('none');
  askScreenFocus(view, key);
  return focusOnPage(key);
}

const done = new WeakMap<AxfRuntime, Set<string>>();

/** Give every view without a focus action of its own the generic one (once per runtime and view). */
export function registerScreenFocus(rt: AxfRuntime, views: readonly string[]): void {
  const seen = done.get(rt) ?? new Set<string>();
  done.set(rt, seen);
  for (const view of views) {
    const id = focusActionId(view);
    if (seen.has(view) || rt.actions.get(id)) continue;
    seen.add(view);
    rt.actions.register(id, ([arg]) => {
      void openAndFocus(rt, view, arg).then((hit) => { if (hit === 'none' && focusKeyOf(arg)) rt.toast(`Nothing called "${focusKeyOf(arg)}" on this screen.`, 'warning'); });
    }, { label: `Bring a tab, group or item forward on ${view}`, params: true, effect: 'navigate', module: 'axf.framework' });
  }
}

export function useScreenFocusActions(rt: AxfRuntime, views: readonly string[]): void {
  const key = views.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerScreenFocus(rt, views), [rt, key]);
}

/**
 * For a screen with its own state: the key asked of `view` (now, or within 30 s before it mounted), with a counter so
 * the same key asked twice runs again. Put the item's tab / filter / folded state right, then call focusOnPage(key).
 */
export function useScreenFocus(view: string): { key: string; n: number } {
  const [ask, setAsk] = useState(() => ({ key: wantedScreenFocus(view), n: 0 }));
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ view: string; key: string }>).detail; if (d?.view === view) setAsk((a) => ({ key: d.key, n: a.n + 1 })); };
    globalThis.addEventListener(SCREEN_FOCUS_EVENT, on);
    return () => globalThis.removeEventListener(SCREEN_FOCUS_EVENT, on);
  }, [view]);
  return ask;
}
