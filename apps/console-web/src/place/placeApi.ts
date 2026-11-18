/**
 * The console's place through the console API (console-control@1; "everything comes with an API", Nov 8 2026). Same
 * targets for every driver:
 *
 *   panel:console-place              state = the saved place, the live place and a running restore
 *   function:console.place.restore   press = put the saved place back (view, tabs, selection, scroll)
 *   function:console.place.get       press = the saved place as a toast (read only)
 *
 *   REST   GET  /api/console-control/state?address=panel:console-place
 *          POST /api/console-control/do { verb: 'press', address: 'function:console.place.restore' }
 *   MCP    console_control_state { address: 'panel:console-place' } · console_control_do { verb: 'press', address: … }
 *   CLI    axf console place get | restore
 *   voice  "put me back", "back to where I was", "restore my place" (console-control-voice.mjs, PLACE_RESTORE_RE)
 *   link   ?axf-open=console.place.restore
 */
import type { AxfRuntime } from '../axf/core';
import { controlRegistry } from '../axf/react';
import { capturePlace, PLACE_FRAME, readPlace, savePlaceNow, viewIdOf } from './placeState';
import { currentRestore, restorePlace } from './placeRestore';
import { releaseScrollLock } from './scrollLock';

export const PLACE_PANEL_ADDRESS = 'panel:console-place';
export const PLACE_RESTORE_ACTION = 'console.place.restore';
export const PLACE_GET_ACTION = 'console.place.get';

/** The readable state: saved place, what is on screen now, and a restore in progress. */
export function placeApiState(rt: AxfRuntime): Record<string, unknown> {
  const run = currentRestore();
  return {
    $axf: PLACE_FRAME,
    saved: readPlace(),
    now: capturePlace(rt, 'api'),
    restoring: run ? { view: run.place.view, pending: run.pending() } : null,
  };
}

/** Puts the saved place back; answers what it did. */
export function restoreSavedPlace(rt: AxfRuntime): { ok: boolean; message: string } {
  const place = readPlace();
  if (!place) return { ok: false, message: 'No saved place in this browser tab yet.' };
  const run = restorePlace(rt, place);
  if (!run) return { ok: false, message: `The saved view ${place.view} can't open here.` };
  void run.finished.then(() => releaseScrollLock(rt));
  return { ok: true, message: `Back on ${viewIdOf(place.view) ?? place.view}.` };
}

export function installPlaceApi(rt: AxfRuntime): () => void {
  const offs: Array<() => void> = [];
  offs.push(rt.actions.register(PLACE_RESTORE_ACTION, () => {
    const r = restoreSavedPlace(rt);
    rt.toast(r.message, r.ok ? 'success' : 'warning', 'Place');
  }, { label: 'Put me back where I was', module: 'console.place', effect: 'write' }));
  offs.push(rt.actions.register(PLACE_GET_ACTION, () => {
    const p = readPlace();
    rt.toast(p ? `Saved: ${p.view}, ${Object.keys(p.tabs).length} tab rows, ${Object.keys(p.scroll).length} scroll offsets (${p.by})` : 'No saved place yet.', 'info', 'Place');
  }, { label: 'Show the saved place', module: 'console.place', effect: 'read' }));
  offs.push(controlRegistry(rt).register({
    address: PLACE_PANEL_ADDRESS, kind: 'panel', label: 'Saved place', detail: 'Where a reload brings you back: view, tabs, selection, scroll',
    icon: 'refresh', keywords: ['place', 'position', 'refresh', 'reload', 'restore', 'where was i'], can: ['state', 'press'],
    state: () => placeApiState(rt),
    invoke: () => restoreSavedPlace(rt),
  }));
  // the same three for scripts and end-to-end checks in the page (scripts/place-refresh.e2e.mjs)
  const w = globalThis as unknown as { axfConsolePlace?: unknown };
  w.axfConsolePlace = { state: () => placeApiState(rt), restore: () => restoreSavedPlace(rt), save: (by = 'api') => savePlaceNow(by, rt) };
  offs.push(() => { delete w.axfConsolePlace; });
  return () => offs.forEach((f) => f());
}
