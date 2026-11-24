/**
 * Pull-down refresh keeps the place. The console has no pull-to-refresh of its own: on a phone the browser's (or the
 * Android shell's) reloads the page when a downward drag finds nothing left to scroll up under the finger. That is a
 * plain reload, so the place comes back the same way as after any other (the place store, read on load); what this
 * adds is the save. pagehide is not a sure thing on that reload (some WebViews skip it), so the moment a drag turns
 * into a pull the place is written exactly as a pushed refresh writes it (`savePlaceNow`: view, tabs, selection and
 * every scroll offset), and again if the gesture is taken away from the page (the shell took over the pull).
 *
 * Nothing here can hold the page: the listeners are passive, never cancel a touch and set no style or attribute, so a
 * pull that is let go short of a reload leaves the pane scrolling as before, and every gesture starts from a clean
 * slate.
 */
import type { AxfRuntime } from '../axf/core';
import { savePlaceNow } from './keepPlace';

/** How far down (CSS px) a drag goes before it counts as a pull: under the browser's and the shell's own thresholds. */
export const PULL_SAVE_DISTANCE = 10;

/** One scroller on the way from the finger to the root: how far it is scrolled and whether it scrolls at all. */
export interface PullChainLink { scrollTop: number; scrolls: boolean }

/** A drag pulls the page down (and may refresh it) only when every scroller under the finger is at its top. */
export function pullReachesRoot(chain: readonly PullChainLink[]): boolean {
  return chain.every((link) => !link.scrolls || link.scrollTop <= 0);
}

/** Has the finger gone far enough, and more down than sideways, for the drag to be a pull? */
export function isPull(dx: number, dy: number, distance = PULL_SAVE_DISTANCE): boolean {
  return dy > distance && dy > Math.abs(dx);
}

function scrolls(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const o = getComputedStyle(el).overflowY;
  return o === 'auto' || o === 'scroll' || o === 'overlay';
}

/** The scrollers from the touched element up to the root (the root itself included). */
function chainOf(target: EventTarget | null): PullChainLink[] {
  const chain: PullChainLink[] = [];
  for (let el = target instanceof Element ? target : null; el && el !== document.documentElement; el = el.parentElement) {
    chain.push({ scrollTop: el.scrollTop, scrolls: scrolls(el) });
  }
  const root = document.scrollingElement;
  if (root) chain.push({ scrollTop: root.scrollTop, scrolls: root.scrollHeight > root.clientHeight });
  return chain;
}

/** Save the place when a pull-down that can refresh the page starts. Returns the uninstall. */
export function installPullRefresh(rt: AxfRuntime, save: (rt: AxfRuntime) => void = savePlaceNow): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let start: { id: number; x: number; y: number } | null = null;
  let pulling = false;
  const reset = () => { start = null; pulling = false; };
  const onStart = (e: TouchEvent) => {
    reset();
    const t = e.touches[0];
    if (e.touches.length === 1 && t && pullReachesRoot(chainOf(e.target))) start = { id: t.identifier, x: t.clientX, y: t.clientY };
  };
  const onMove = (e: TouchEvent) => {
    if (!start || pulling) return;
    if (e.touches.length !== 1) { reset(); return; } // a second finger: a pinch, not a pull
    const t = e.touches[0]!;
    if (t.identifier === start.id && isPull(t.clientX - start.x, t.clientY - start.y)) { pulling = true; save(rt); }
  };
  // The shell's own pull-to-refresh takes the gesture from the page (touchcancel) before it reloads: save once more.
  const onCancel = () => { if (pulling) save(rt); reset(); };
  const opts = { passive: true, capture: true } as const;
  window.addEventListener('touchstart', onStart, opts);
  window.addEventListener('touchmove', onMove, opts);
  window.addEventListener('touchend', reset, opts);
  window.addEventListener('touchcancel', onCancel, opts);
  return () => {
    reset();
    window.removeEventListener('touchstart', onStart, { capture: true });
    window.removeEventListener('touchmove', onMove, { capture: true });
    window.removeEventListener('touchend', reset, { capture: true });
    window.removeEventListener('touchcancel', onCancel, { capture: true });
  };
}
