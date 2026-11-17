/**
 * The console's place (view, tabs, selection, scroll) kept across reloads. `installPlace` runs once in main.tsx before
 * the first render: it starts saving and puts the saved place back (a URL deep link wins). See placeState.ts.
 */
import type { AxfRuntime } from '../axf/core';
import { installPlaceSaving } from './placeState';
import { restoreOnLoad } from './placeRestore';
import { installScrollAndSelectionSteps } from './placeScroll';

export * from './placeState';
export * from './placeRestore';

let installed = false;

export function installPlace(rt: AxfRuntime): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installScrollAndSelectionSteps();
  installPlaceSaving(rt);
  restoreOnLoad(rt);
  // a hard `console.refresh` reloads past the HTTP cache with a one-time `?axf-refresh=`: drop it once loaded
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('axf-refresh')) { u.searchParams.delete('axf-refresh'); history.replaceState(history.state, '', u.toString()); }
  } catch { /* no URL here */ }
}
