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
}
