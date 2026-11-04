/*
 * Tab strips as drop targets (main-tabs@1): any element with `data-fx-tabstrip="<group id>"` (the main area's strips
 * and every tab group bar) takes a dragged tab or a dragged floating window. DOM only; the window manager does the move.
 */

/** The strip under a point (main or floating), skipping anything inside `skip` (the window being dragged). */
export function stripAt(x: number, y: number, skip?: Element | null): { el: HTMLElement; group: string } | null {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    if (skip && skip.contains(el)) continue;
    const s = (el as HTMLElement).closest?.('[data-fx-tabstrip]') as HTMLElement | null;
    if (s && !(skip && skip.contains(s))) return { el: s, group: s.getAttribute('data-fx-tabstrip') ?? '' };
  }
  return null;
}

/** Mark the strip a drag would land on (one at a time; `.is-drop-target` draws the highlight). Null clears it. */
let marked: HTMLElement | null = null;
export function markStrip(group: string | null) {
  const el = group && typeof document !== 'undefined' ? document.querySelector<HTMLElement>(`[data-fx-tabstrip="${CSS.escape(group)}"]`) : null;
  if (marked && marked !== el) marked.classList.remove('is-drop-target');
  if (el) el.classList.add('is-drop-target');
  marked = el;
}
