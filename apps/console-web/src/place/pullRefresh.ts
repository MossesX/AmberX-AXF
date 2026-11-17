/**
 * Pull-down refresh keeps the place. The console has no pull-to-refresh of its own: on the phone the browser's (or the
 * Android shell WebView's) pull-to-refresh reloads the page when a pull at the top of the main pane chains to the root.
 * pagehide already saves the place, but some WebViews skip it on that reload, so a downward pull that starts with the
 * pane at the top saves the place as soon as it passes the pull distance (`by: 'pull-refresh'`). The reload then restores
 * it like any other reload (placeRestore.ts) and the pane is left unlocked (scrollLock.ts).
 */
import { mainScroller, savePlaceNow } from './placeState';

/** How far (in CSS px, before the browser's own threshold) a pull goes before the place is saved. */
export const PULL_SAVE_DISTANCE = 48;

export function installPullRefreshSave(): () => void {
  if (typeof window === 'undefined') return () => {};
  let start: { id: number; y: number } | null = null;
  let saved = false;
  const atTop = (t: EventTarget | null): boolean => {
    let el = t instanceof Element ? t : null;
    // the pull only reaches the root when every scroller under the finger is at its top
    while (el && el !== document.documentElement) {
      if (el.scrollTop > 0) return false;
      el = el.parentElement;
    }
    return (mainScroller()?.scrollTop ?? 0) <= 0;
  };
  const onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && t && atTop(e.target) ? { id: t.identifier, y: t.clientY } : null;
    saved = false;
  };
  const onMove = (e: TouchEvent) => {
    if (!start || saved) return;
    const t = Array.from(e.touches).find((x) => x.identifier === start!.id);
    if (t && t.clientY - start.y > PULL_SAVE_DISTANCE) { saved = true; savePlaceNow('pull-refresh'); }
  };
  const onEnd = () => { start = null; };
  window.addEventListener('touchstart', onStart, { passive: true, capture: true });
  window.addEventListener('touchmove', onMove, { passive: true, capture: true });
  window.addEventListener('touchend', onEnd, { passive: true, capture: true });
  window.addEventListener('touchcancel', onEnd, { passive: true, capture: true });
  return () => {
    window.removeEventListener('touchstart', onStart, { capture: true });
    window.removeEventListener('touchmove', onMove, { capture: true });
    window.removeEventListener('touchend', onEnd, { capture: true });
    window.removeEventListener('touchcancel', onEnd, { capture: true });
  };
}
