/**
 * The console's place through the console API (console-control@1, framework/spec/CONSOLE-CONTROL.md). The same two
 * targets for every driver:
 *
 *   panel:console-place              state = the saved place (read only), the place this page loaded with, the live
 *                                    place and a restore that is still running; press = put the place back (view,
 *                                    tabs, selection, scroll) and answer what was put back, or `unavailable`
 *   function:console.place.restore   the same restore as an action (menus, the palette, `axf console action`)
 *
 *   REST   GET  /api/console-control/place            POST /api/console-control/place/restore
 *   MCP    console_control_place [restore=true]
 *   CLI    axf console place [get|restore]
 *   voice  "put me back", "back to where I was", "restore my place" (console-control-voice.mjs, PLACE_RESTORE_RE)
 *
 * The store follows the person as they move, so on a page that has been open a while "saved" is where they are now.
 * What a restore puts back is the place this page load found saved (`loaded`: where they were before the reload), the
 * one a reload is meant to come back to; a page that loaded with nothing saved puts back the store's own. The press
 * value picks one explicitly: `loaded` or `saved`.
 */
import type { AxfRuntime } from '../axf/core';
import { ConsoleControlError, CONSOLE_CONTROL_WIRE } from '../axf/core/engines/console-control';
import { controlRegistry } from '../axf/react';
import { controlState } from '../control/executor';
import { restoreScroll } from '../views/placeRestore';
import { placeStore, viewIdOf, type PlaceState, type PlaceStore } from './placeState';

export const PLACE_FRAME = 'console-place@1';
export const PLACE_PANEL_ADDRESS = 'panel:console-place';
export const PLACE_RESTORE_ACTION = 'console.place.restore';
export const PLACE_RESTORE_ADDRESS = `function:${PLACE_RESTORE_ACTION}`;
/** How long a restore waits for the saved view's tab rows and rows to render (ms). */
export const PLACE_API_WAIT = 5000;

export type PlaceSource = 'loaded' | 'saved';

/** What a restore put back (the counts are what the place holds for its view, not what has landed yet). */
export interface PlaceRestoreResult { from: PlaceSource; view: string; tabs: number; selection: number; scroll: number; message: string }

/** The place as this page load found it, read before anything on the new page could change it. */
const loadedPlace: PlaceState = placeStore.get();

const hasPlace = (p: PlaceState | null | undefined): p is PlaceState => !!p && !!viewIdOf(p.view);

/** The entries of one map that belong to a view (`view:x/…`). */
function ofView<T>(map: Record<string, T>, view: string): [string, T][] {
  return Object.entries(map).filter(([address]) => address.startsWith(`${view}/`));
}

/** The place the screen shows now: the view, the open tab of each of its tab rows, the focused row and the scroll. */
function livePlace(rt: AxfRuntime): Record<string, unknown> {
  const s = controlState(rt);
  return { view: `view:${s.screen}`, tabs: s.tabs, focusedRow: s.focusedRow, ...(s.scroll ? { scroll: s.scroll } : {}) };
}

let running: { view: string; from: PlaceSource; pending: () => string[]; stop: () => void } | null = null;

/** The readable state of `panel:console-place`. */
export function placeApiState(rt: AxfRuntime, store: PlaceStore = placeStore): Record<string, unknown> {
  return {
    $axf: PLACE_FRAME,
    saved: store.get(),
    loaded: hasPlace(loadedPlace) ? loadedPlace : null,
    now: livePlace(rt),
    restoring: running ? { view: running.view, from: running.from, pending: running.pending() } : null,
  };
}

/** Which place a restore puts back: the one asked for, else the loaded one, else the saved one. Null when there is none. */
export function placeToRestore(value: unknown, store: PlaceStore = placeStore, loaded: PlaceState = loadedPlace): { from: PlaceSource; place: PlaceState } | null {
  const want = value === 'loaded' || value === 'saved' ? value : null;
  const saved = store.get();
  if (want !== 'saved' && hasPlace(loaded)) return { from: 'loaded', place: loaded };
  if (want !== 'loaded' && hasPlace(saved)) return { from: 'saved', place: saved };
  return null;
}

const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Put a place back: open its view, switch its tab rows, select its rows and reapply its scroll offsets. Tab rows and
 * rows that are not rendered yet are switched as they render, for at most `PLACE_API_WAIT`; the moment the person
 * scrolls, taps or types it stops (a restore never fights them). Throws `unavailable` when there is no place to put back.
 */
export function restoreSavedPlace(rt: AxfRuntime, value?: unknown, store: PlaceStore = placeStore): PlaceRestoreResult {
  const pick = placeToRestore(value, store);
  if (!pick) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, 'no saved place in this browser tab yet', { because: 'no saved place' });
  const { from, place } = pick;
  const view = place.view!, viewId = viewIdOf(view)!;
  running?.stop();

  // Nothing is recorded from the page while the view opens: the scroll-to-top of a view change is not the place.
  const release = store.suspend();
  if (rt.getState().view !== viewId && !rt.takenByHost({ view: viewId })) rt.navigateHere(viewId);
  if (rt.getState().view !== viewId) {
    release();
    throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `the saved screen ${viewId} can't open here`, { because: 'view not available' });
  }
  const tabs = ofView(place.tabs, view), selection = ofView(place.selection, view), scroll = ofView(place.scroll, view);
  // The store is what the views and the scroll restore read from: it gets the place being put back.
  store.setView(view);
  for (const [row, tab] of tabs) store.setTab(row, tab);
  for (const [scope, items] of selection) store.setSelection(scope, items);
  for (const [container, at] of scroll) store.setScroll(container, at.top, at.left);
  for (const [container] of ofView(store.get().scroll, view)) if (!(container in place.scroll)) store.setScroll(container, 0, 0);
  store.flush();

  const reg = controlRegistry(rt);
  const pendingTabs = new Map(tabs);
  const pendingRows = new Set(selection.flatMap(([scope, items]) => items.map((item) => `${scope}/${item}`)));
  const apply = (): void => {
    for (const [row, tab] of [...pendingTabs]) {
      const def = reg.entry(row)?.def;
      if (!def) continue;
      // a tab row answers nothing when it switched, and says why when it could not (no such tab yet)
      try { if (def.get?.() === tab || def.set?.(tab) === undefined) pendingTabs.delete(row); } catch { /* not ready: stays pending */ }
    }
    for (const address of [...pendingRows]) {
      const def = reg.entry(address)?.def;
      if (!def) continue;
      try { def.select?.(); } catch { /* a row that can't be selected is left as it is */ }
      pendingRows.delete(address);
    }
  };

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    offRegistry();
    clearTimeout(timer);
    for (const type of CANCEL_EVENTS) window.removeEventListener(type, stop, true);
    if (running?.stop === stop) running = null;
  };
  const offRegistry = reg.subscribe(() => { apply(); if (!pendingTabs.size && !pendingRows.size) stop(); });
  const timer = setTimeout(stop, PLACE_API_WAIT);
  for (const type of CANCEL_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  running = { view, from, pending: () => [...pendingTabs.keys(), ...pendingRows], stop };
  // restoreScroll holds its own suspend until the offsets have settled (it ends by itself and on the person's first
  // touch), so ours can go.
  restoreScroll(store);
  release();
  apply();
  if (!pendingTabs.size && !pendingRows.size) stop();

  return { from, view, tabs: tabs.length, selection: selection.length, scroll: scroll.length, message: `Back on ${viewId}.` };
}

/** Register the action and the panel target. Returns the remover. */
export function installPlaceApi(rt: AxfRuntime): () => void {
  const offAction = rt.actions.register(PLACE_RESTORE_ACTION, (args) => {
    try {
      const r = restoreSavedPlace(rt, args[0]);
      rt.toast(r.message, 'success', 'Place');
      return true;
    } catch (e) {
      rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Place');
      return false;
    }
  }, { label: 'Put me back where I was', params: true, module: 'console.place', effect: 'navigate' });
  const offPanel = controlRegistry(rt).register({
    address: PLACE_PANEL_ADDRESS, kind: 'panel', label: 'Saved place', detail: 'Where a reload brings you back: screen, tabs, selection, scroll',
    icon: 'refresh', keywords: ['place', 'position', 'refresh', 'reload', 'restore', 'where was i', 'put me back'], can: ['state', 'press'],
    state: () => placeApiState(rt),
    invoke: (value) => restoreSavedPlace(rt, value),
  });
  return () => { offAction(); offPanel(); running?.stop(); };
}
