/**
 * Saving the place right before a reload the console starts itself (a refresh pushed from the server, soft or hard, and
 * the "Reload for the new version" buttons). The place store already writes on pagehide, but a reload we start is the
 * one moment the live state is known for certain, so it is read from the runtime and the control registry and written
 * at once: the view, the open tab of every tab row on the screen, the focused row, and every scroll offset.
 */
import type { AxfRuntime } from '../axf/core';
import { addressLeaf, addressParent, parseAddress } from '../axf/core/engines/console-control';
import { controlState } from '../control/executor';
import { placeStore, type PlaceStore } from './placeState';

/** The one-time query value a hard refresh adds to get past the HTTP cache. */
export const REFRESH_PARAM = 'axf-refresh';

/** What `savePlaceNow` reads the live place from (the control state is left out when the registry is not installed). */
export interface LivePlace { view: string; tabs?: Record<string, string>; focusedRow?: string | null }

/** Write a live place into a store: the view, the tab rows of that view, and the focused row as its grid's selection. */
export function writeLivePlace(store: PlaceStore, live: LivePlace): void {
  if (live.view) store.setView(live.view);
  // Only rows addressed under a view: a row outside one (chrome, a dialog) belongs to no screen's place.
  for (const [row, value] of Object.entries(live.tabs ?? {})) if (row.startsWith('view:')) store.setTab(row, value);
  if (live.focusedRow?.startsWith('view:')) {
    try {
      const parts = parseAddress(live.focusedRow);
      const scope = addressParent(parts), leaf = addressLeaf(parts);
      if (scope) store.setSelection(scope, `${leaf.kind}:${leaf.id}`);
    } catch { /* not an address: nothing to select */ }
  }
}

/**
 * Save the place now (no debounce). With the runtime the view, tabs and selection are read live; without it only the
 * scroll offsets are read and what the store already holds is written.
 */
export function savePlaceNow(rt?: AxfRuntime, store: PlaceStore = placeStore): void {
  try {
    if (rt) {
      const live: LivePlace = { view: rt.getState().view };
      try { const s = controlState(rt); live.tabs = s.tabs; live.focusedRow = s.focusedRow; } catch { /* the control registry is not installed yet */ }
      writeLivePlace(store, live);
    }
    store.captureScroll();
    store.flush();
  } catch { /* saving the place never stops a reload */ }
}

/** Take the hard refresh's one-time query value out of the address (it did its job once the page loaded). */
export function stripRefreshParam(): void {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(REFRESH_PARAM)) return;
    u.searchParams.delete(REFRESH_PARAM);
    window.history.replaceState(window.history.state, '', u.toString());
  } catch { /* an address that can't be rewritten stays as it is */ }
}
