/**
 * Leaves the console scrollable after a reload, a refresh or an update (report:
 * _claude/builds/reports/fix-refreshing-console-jumps-back.md, "Scroll lock after an update").
 *
 * The console's only scroller is `.fx-main`; anything that leaves an inline `overflow` / `pointer-events` /
 * `touch-action` lock or `inert` on `html`, `body`, `#root`, the frame, the shell or the main pane freezes the whole
 * page. The dialog host's history entry (`{ axfDialog: true }`, framework/react/components/Overlays.tsx) also survives a
 * reload with a dialog open, so the first Back afterwards does nothing. `releaseScrollLock` clears both; it runs once on
 * every load, when a restore ends, on pageshow (back-forward cache) and after a soft `console.refresh`.
 */
import type { AxfRuntime } from '../axf/core';

const LOCK_HOSTS = ['html', 'body', '#root', '.fx-frame', '.fx-shell', '.fx-main'];
const LOCK_PROPS = ['overflow', 'overflow-y', 'pointer-events', 'touch-action', 'overscroll-behavior', 'overscroll-behavior-y'] as const;

export interface ScrollLockRelease {
  /** `selector.prop` for every inline lock removed, `selector[inert]` for inert */
  cleared: string[];
  /** a stale dialog history entry was dropped */
  history: boolean;
}

/** Clears leftover scroll locks; returns what it found (empty when the page was fine). */
export function releaseScrollLock(rt: AxfRuntime | null): ScrollLockRelease {
  const out: ScrollLockRelease = { cleared: [], history: false };
  if (typeof document === 'undefined') return out;
  for (const sel of LOCK_HOSTS) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      for (const p of LOCK_PROPS) {
        const v = el.style.getPropertyValue(p);
        // only locks: an inline `overflow: auto` someone set on purpose stays
        if (v && /hidden|clip|none/.test(v)) { el.style.removeProperty(p); out.cleared.push(`${sel}.${p}`); }
      }
      if (el.hasAttribute('inert')) { el.removeAttribute('inert'); out.cleared.push(`${sel}[inert]`); }
    }
  }
  try {
    const st = history.state as Record<string, unknown> | null;
    if (st && st.axfDialog && !rt?.getState().dialog) {
      const { axfDialog: _drop, ...rest } = st;
      history.replaceState(Object.keys(rest).length ? rest : null, '');
      out.history = true;
    }
  } catch { /* history unavailable */ }
  if (out.cleared.length) rt?.terminal.warn('console', `scroll lock cleared: ${out.cleared.join(', ')}`);
  return out;
}

/** Runs the safety net on load (after the first paint) and on pageshow. Returns a remover. */
export function installScrollLockGuard(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const run = () => { releaseScrollLock(rt); };
  const t = setTimeout(run, 0);
  window.addEventListener('pageshow', run);
  return () => { clearTimeout(t); window.removeEventListener('pageshow', run); };
}
