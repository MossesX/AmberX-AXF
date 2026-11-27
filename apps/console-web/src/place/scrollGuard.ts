/**
 * Scroll guard: after an update or a refresh the console must scroll again, whatever the page before it left behind.
 *
 * Nothing in the console locks scrolling on purpose (build fix-refreshing-console-jumps-back, step s2), so anything
 * found here is a leftover: an inline overflow / pointer-events / touch-action lock on the page roots, an `inert`
 * root, the drag class of a drag that never ended, or the banner-strip flag with no strip on screen. `clearScrollLocks`
 * removes them. `installScrollGuard` runs it on load, when the page comes back from the back/forward cache and when
 * the tab is shown again (a pushed refresh or an update can land while it was hidden).
 */

const LOCK_PROPS = ['overflow', 'overflow-x', 'overflow-y', 'pointer-events', 'touch-action', 'overscroll-behavior', 'overscroll-behavior-y'] as const;
const DRAG_CLASS = 'axf-dnd-dragging';

/** Remove every leftover scroll / pointer lock from the page roots. Returns what it cleared (empty when clean). */
export function clearScrollLocks(doc: Document | undefined = globalThis.document): string[] {
  const cleared: string[] = [];
  if (!doc) return cleared;
  const html = doc.documentElement;
  const roots: [string, HTMLElement | null][] = [['html', html], ['body', doc.body], ['#root', doc.getElementById('root')]];
  for (const [name, el] of roots) {
    if (!el) continue;
    for (const prop of LOCK_PROPS) {
      if (!el.style.getPropertyValue(prop)) continue;
      el.style.removeProperty(prop);
      cleared.push(`${name} ${prop}`);
    }
    // a fixed body is the other common way of freezing the page behind an overlay
    if (el.style.position === 'fixed') { el.style.removeProperty('position'); el.style.removeProperty('top'); el.style.removeProperty('width'); cleared.push(`${name} position`); }
    if (el.hasAttribute('inert')) { el.removeAttribute('inert'); cleared.push(`${name} inert`); }
  }
  // a drag whose pointerup never arrived (the page was hidden or replaced mid-drag); the class only sets the cursor
  if (doc.body?.classList.contains(DRAG_CLASS)) { doc.body.classList.remove(DRAG_CLASS); cleared.push('body drag class'); }
  // the banner-strip flag stops the main pane scrolling; it is only right while a strip is on screen
  if (html.dataset.axfStrip && !doc.querySelector('.fx-banner-strip')) { delete html.dataset.axfStrip; cleared.push('html strip flag'); }
  return cleared;
}

let installed = false;

/** Clear leftovers now and every time the page is shown again. Safe to call more than once. */
export function installScrollGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // after the first paint, so the check for an on-screen strip sees the mounted page
  const run = () => requestAnimationFrame(() => { clearScrollLocks(); });
  run();
  window.addEventListener('pageshow', run);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
}
