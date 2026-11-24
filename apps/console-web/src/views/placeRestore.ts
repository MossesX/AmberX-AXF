/**
 * Putting the place back after a reload (the saving is src/place/placeState.ts):
 *
 * - `restoreScroll()` reapplies the scroll offsets saved for the current view: the main scroller and every named pane.
 *   A view's data arrives after it mounts, so each container is retried until its content is tall enough to hold the
 *   offset, then held for a moment so a scroll-to-top that fires after load (the shell's on a view change, a list that
 *   re-renders) is put right. It gives up after a short timeout (as far down as the content goes) and the moment the
 *   person scrolls, taps or types: a restore never fights them. It runs once when the console starts.
 * - `usePlaceTab`, `usePlaceSelection` and `usePlaceSet` are `useState` for a view's chip row, selected item and open
 *   rows that start from the saved place instead of the default, so a reload reopens what was chosen.
 *
 * Addresses are console-control@1 and always start with the view (`view:tracker/tab:tracker.tabs`), so a view reads its
 * own place whatever the store's current view is at that moment.
 */
import { useCallback, useState } from 'react';
import { SCROLL_CONTAINER_ATTR, mainScrollElement } from '../axf/react/scrollControl';
import { placeStore, viewIdOf, type PlaceScroll, type PlaceStore } from '../place/placeState';

/** How long a restore waits for content to grow tall enough (ms). */
export const PLACE_RESTORE_TIMEOUT = 5000;
/** How long an applied offset is watched for a late reset (ms). */
export const PLACE_RESTORE_SETTLE = 400;

export interface RestoreScrollOptions {
  timeout?: number;
  settle?: number;
  now?: () => number;
}

interface Target { name: string; want: PlaceScroll; appliedAt: number | null }

const laidOut = (el: Element): boolean => el.getClientRects().length > 0;

/** The id of the view the shell is showing (`data-axf-view` on its root), else null while nothing is mounted. */
function shownViewId(): string | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-axf-view]')) if (!el.hidden && laidOut(el)) return el.getAttribute('data-axf-view');
  return null;
}

/** The container of a saved offset: `scroll:main` is the main scroller, `scroll:<id>` the named pane on screen. */
function containerOf(name: string): HTMLElement | null {
  const id = name.slice('scroll:'.length);
  if (id === 'main') return mainScrollElement();
  for (const el of document.querySelectorAll<HTMLElement>(`[${SCROLL_CONTAINER_ATTR}]`)) if (el.getAttribute(SCROLL_CONTAINER_ATTR) === id && laidOut(el)) return el;
  return null;
}

function moveTo(el: HTMLElement, want: PlaceScroll): void {
  // instant on purpose: a smooth scroll would still be on its way at the next check
  try { el.scrollTo({ top: want.top, left: want.left, behavior: 'instant' }); } catch { el.scrollTop = want.top; el.scrollLeft = want.left; }
}

const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Reapply the scroll offsets saved under the store's current view. Returns a function that stops it early.
 * The store records nothing from the page while this runs, so the resets of a remount never replace what was saved.
 */
export function restoreScroll(store: PlaceStore = placeStore, options: RestoreScrollOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const view = store.view();
  const viewId = viewIdOf(view);
  if (!view || !viewId) return () => {};
  const prefix = `${view}/`;
  const targets: Target[] = Object.entries(store.get().scroll)
    .filter(([address]) => address.startsWith(prefix) && address.slice(prefix.length).startsWith('scroll:'))
    .map(([address, want]) => ({ name: address.slice(prefix.length), want, appliedAt: null }));
  if (!targets.length) return () => {};

  const timeout = options.timeout ?? PLACE_RESTORE_TIMEOUT;
  const settle = options.settle ?? PLACE_RESTORE_SETTLE;
  const now = options.now ?? Date.now;
  const started = now();
  const release = store.suspend();
  let stopped = false;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    for (const type of CANCEL_EVENTS) window.removeEventListener(type, stop, true);
    release();
  };

  const step = (): void => {
    frame = null; timer = null;
    if (stopped) return;
    const t = now();
    const last = t - started >= timeout;
    // Another view on screen (a deep link won, or the saved view is not open yet): leave its scroll alone.
    let waiting = shownViewId() !== viewId;
    if (!waiting) {
      for (const target of targets) {
        const el = containerOf(target.name);
        if (!el) { waiting = true; continue; }
        const fits = el.scrollHeight - el.clientHeight >= target.want.top - 1 && el.scrollWidth - el.clientWidth >= target.want.left - 1;
        if (!fits && !last) { target.appliedAt = null; waiting = true; continue; }
        if (target.appliedAt === null || (fits && (Math.abs(el.scrollTop - target.want.top) > 1 || Math.abs(el.scrollLeft - target.want.left) > 1))) {
          moveTo(el, target.want);
          target.appliedAt = t;
        }
        if (t - target.appliedAt < settle) waiting = true;
      }
    }
    if (!waiting || last) { stop(); return; }
    // a hidden page gets no animation frames
    if (document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function') timer = setTimeout(step, 100);
    else frame = requestAnimationFrame(step);
  };

  for (const type of CANCEL_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  step();
  return stop;
}

let started = false;
/** The restore for this page load: once, from the place as it was saved before the reload. */
export function startPlaceRestore(): void {
  if (started) return;
  started = true;
  restoreScroll();
}
// At import, before the shell mounts: the saved offsets are read before anything on the new page can replace them.
startPlaceRestore();

/** The id of a saved item (`row:a%2Fb` → `a/b`); anything else stays as it is. */
function itemId(item: string): string {
  return item.startsWith('row:') ? item.slice(4).replace(/%2F/gi, '/').replace(/%25/g, '%') : item;
}

/**
 * `useState` for a view's tab or chip row, kept in the place: `row` is its address (`view:tracker/tab:tracker.tabs`).
 * With `allowed`, a saved value that is no longer one of them falls back to `initial`.
 */
export function usePlaceTab<T extends string>(row: string, initial: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = placeStore.tab(row) as T | null;
    return saved !== null && (!allowed || allowed.includes(saved)) ? saved : initial;
  });
  const set = useCallback((next: T) => { setValue(next); placeStore.setTab(row, next); }, [row]);
  return [value, set];
}

/** `useState` for the one selected item of a list, kept in the place: `scope` is the list's address (`view:x/list:y`). */
export function usePlaceSelection<T extends string | null>(scope: string, initial: T): [string | T, (id: string | T) => void] {
  const [value, setValue] = useState<string | T>(() => { const saved = placeStore.selection(scope)[0]; return saved ? itemId(saved) : initial; });
  const set = useCallback((next: string | T) => { setValue(next); placeStore.setSelection(scope, next); }, [scope]);
  return [value, set];
}

/** `useState` for a set of ids (open rows, ticked items) that starts empty, kept in the place under `scope`. */
export function usePlaceSet(scope: string): [Set<string>, (update: Set<string> | ((current: Set<string>) => Set<string>)) => void] {
  const [value, setValue] = useState<Set<string>>(() => new Set(placeStore.selection(scope).map(itemId)));
  const set = useCallback((update: Set<string> | ((current: Set<string>) => Set<string>)) => {
    setValue((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      placeStore.setSelection(scope, [...next]);
      return next;
    });
  }, [scope]);
  return [value, set];
}
