/*
 * Drop-zone preview (drag-move@1, spec/DRAG-MOVE.md): when a move is previewed or deep-linked by API (drag.preview,
 * drag.show, Follow Amber), the item is outlined and every place it may land gets a marker: a bar on the edge it would
 * drop at (before / after another item), an outline on a container it would land in (into, a side), and the chosen
 * landing spot drawn stronger. Nothing is drawn for a pointer drag (the pointer has its own feedback). Theme tokens only
 * (framework/ui/axf.css, drag preview section); it clears itself after a few seconds, on Escape or on a click.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/** One marker: an element and how to draw it. `edge` = a bar on that edge (before / after); none = an outline. */
export interface DragPreviewMark { element: Element; edge?: 'start' | 'end' | 'top' | 'bottom'; target?: boolean; label?: string }
export interface DragPreviewState { item: Element | null; marks: DragPreviewMark[]; until: number; note?: string }

/** How long a preview stays up (ms). */
export const DRAG_PREVIEW_MS = 6000;

let state: DragPreviewState | null = null;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
const emit = () => subs.forEach((f) => f());

/** Show a preview (replaces the one up now). */
export function showDragPreview(p: Omit<DragPreviewState, 'until'>, ms = DRAG_PREVIEW_MS): void {
  if (timer) clearTimeout(timer);
  state = { ...p, until: Date.now() + ms };
  timer = setTimeout(clearDragPreview, ms);
  emit();
}
export function clearDragPreview(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (state) { state = null; emit(); }
}
/** The preview up now (tests, the console's state read). */
export function dragPreviewState(): DragPreviewState | null { return state; }

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Is the element laid out top to bottom (a vertical list) rather than left to right? Read from its parent's flow. */
export function verticalFlow(el: Element): boolean {
  const parent = el.parentElement;
  if (!parent || typeof getComputedStyle === 'undefined') return false;
  const cs = getComputedStyle(parent);
  if (cs.display.includes('flex')) return cs.flexDirection.startsWith('column');
  if (cs.display.includes('grid')) return cs.gridAutoFlow.startsWith('row') && cs.gridTemplateColumns.split(' ').length <= 1;
  return true; // block flow stacks
}

function Box({ el, className, edge, label }: { el: Element; className: string; edge?: DragPreviewMark['edge']; label?: string }) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const style = edge === 'start' ? { left: r.left, top: r.top, height: r.height } : edge === 'end' ? { left: r.right, top: r.top, height: r.height }
    : edge === 'top' ? { left: r.left, top: r.top, width: r.width } : edge === 'bottom' ? { left: r.left, top: r.bottom, width: r.width }
    : { left: r.left, top: r.top, width: r.width, height: r.height };
  return <span className={`${className}${edge ? ` is-edge is-${edge}` : ''}`} style={style} aria-hidden="true">{label && !edge ? <span className="fx-dragpv__label">{label}</span> : null}</span>;
}

/** Mount once (AxfProvider does): draws the preview up now over the page. */
export function DragPreviewLayer() {
  const s = useSyncExternalStore(subscribe, () => state, () => null);
  const [, tick] = useState(0);
  // follow scrolling and resizing while it is up
  useEffect(() => {
    if (!s) return;
    const re = () => tick((n) => n + 1);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') clearDragPreview(); };
    window.addEventListener('scroll', re, true); window.addEventListener('resize', re);
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', clearDragPreview, true);
    return () => { window.removeEventListener('scroll', re, true); window.removeEventListener('resize', re); window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', clearDragPreview, true); };
  }, [s]);
  if (!s || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fx-dragpv" data-axf-drag-preview="" role="presentation">
      {s.marks.map((m, i) => <Box key={i} el={m.element} edge={m.edge} label={m.label} className={`fx-dragpv__zone${m.target ? ' is-target' : ''}`} />)}
      {s.item && <Box el={s.item} className="fx-dragpv__item" label={s.note} />}
    </div>,
    document.body,
  );
}
