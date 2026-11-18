/**
 * Restore steps for selection and scroll (see placeRestore.ts). Registered once from place/index.ts.
 *
 *   selection  each saved `grid:` target gets its row back through the target's `set` (the grid clicks the row, so the
 *              view's own selection state and detail pane follow) once the row is rendered;
 *   scroll     the main pane and each named pane go back to their offset once the content is tall enough. A step only
 *              counts once the offset has held for HOLD_TICKS checks, so a data refresh that briefly empties the list
 *              (and clamps the pane to the top) can't undo it; a pane that never grows tall enough gets as close as it
 *              can when the restore times out.
 */
import type { AxfRuntime } from '../axf/core';
import { controlRegistry } from '../axf/react';
import { belongsToView, scrollers, type ConsolePlace } from './placeState';
import { addRestoreSteps } from './placeRestore';

const HOLD_TICKS = 2;

function scrollStep(address: string, top: number) {
  let held = 0;
  return {
    address,
    apply: (): boolean => {
      const el = scrollers().get(address);
      if (!el) return false;
      const room = el.scrollHeight - el.clientHeight;
      if (top > 0 && room + 1 < top) { el.scrollTop = Math.max(0, room); held = 0; return false; }
      if (Math.abs(el.scrollTop - top) > 1) { el.scrollTop = top; held = 0; return false; }
      held += 1;
      return held >= HOLD_TICKS;
    },
  };
}

function selectionStep(rt: AxfRuntime, address: string, value: string) {
  let tries = 0;
  return {
    address,
    apply: (): boolean => {
      const e = controlRegistry(rt).entry(address);
      if (!e?.def.set) return false;
      try { if (String(e.def.get?.() ?? '') === value) return true; } catch { /* getter before render */ }
      // the row may not be rendered yet (data still loading): `set` answers a message instead of clicking
      try { const r = e.def.set(value); if (typeof r === 'string' && ++tries < 40) return false; } catch { return false; }
      return true;
    },
  };
}

export function installScrollAndSelectionSteps(): void {
  addRestoreSteps((rt: AxfRuntime, place: ConsolePlace) => [
    ...Object.entries(place.selection).filter(([a]) => belongsToView(a, place.view)).map(([a, v]) => selectionStep(rt, a, v)),
    // scroll last: selecting a row can open a detail pane that changes the height
    ...Object.entries(place.scroll).map(([a, top]) => scrollStep(a, top)),
  ]);
}
