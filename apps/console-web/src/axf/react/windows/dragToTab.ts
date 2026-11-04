import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRuntime } from '../AxfProvider';
import type { AxfRuntime } from '../../core/runtime';
import { TAB_HOLD_MS, TAB_SLOP_PX, type NavDragItem, type TabSpec } from '../../core/engines/windows';

/*
 * Drag to tab (drag-to-tab, Nov 4 2026, Brett: "grab something from the navigation menu, or from one tab, drag it over
 * to another area and drop it as a new tab"). Any screen link (a nav item, a sub menu row, a plugin's own list) can be
 * a drag source: drag it onto a pane's tab strip (it opens there, at that place), a pane's edge (a new pane, dock@1),
 * an empty dock (its first pane) or anywhere else (a floating window). A thing already open comes in as its next copy
 * (molly-multi-instance-tabs). Mouse / pen: press and move a few px; touch: hold, then move (a quick move scrolls as
 * before, a hold released in place opens the item's menu). Every drop can be undone from the toast it shows.
 * The engine side is WindowManager.dragNew / dragEnd / undoDrop (core/engines/windows.ts).
 */

/** What a drag source says it opens; `tab` = an exact tab (else the host's `navTab` / a placed-view tab of `view`). */
export interface DragToTabSource extends NavDragItem { tab?: TabSpec; /** the context target a long-press opens (default nav-item) */ menu?: string }

/** Show the drop's toast with its one-tap Undo (shared with tab moves). */
export function toastDrop(rt: AxfRuntime, what: string): void {
  rt.toast(what, 'success', 'Dropped', { action: { label: 'Undo', action: 'windows.undoDrop' } });
}

/** Where a drop should do nothing: back on a drag source's own nav, or anything marked `data-fx-no-drop`. */
const NO_DROP = '[data-axf-nav], [data-fx-no-drop]';

/**
 * Pointer-down on a drag-to-tab source: call it from the element's onPointerDown (plain function, so a list can use it
 * per row). The element gets `is-armed` while a touch hold has armed it, and the click a drag ends with is swallowed by
 * `dragToTabClick` (put it on onClickCapture).
 */
export function dragToTabDown(rt: AxfRuntime, e: ReactPointerEvent, src: DragToTabSource): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const wm = rt.windows;
  const el = e.currentTarget as HTMLElement;
  delete el.dataset.fxDragged;
  const touch = e.pointerType === 'touch';
  const p = { x: e.clientX, y: e.clientY, held: false, dragging: false, timer: 0 };
  const arm = (on: boolean) => el.classList.toggle('is-armed', on);
  const begin = (x: number, y: number) => {
    const tab = src.tab ?? wm.tabForNav(src);
    if (!tab) { rt.toast(`${src.label} can't open another copy here.`, 'info', 'Drag to tab'); finish(); return false; }
    p.dragging = true; el.dataset.fxDragged = '1'; arm(false);
    wm.dragNew(tab, x, y);
    return true;
  };
  if (touch) p.timer = window.setTimeout(() => { p.held = true; arm(true); navigator.vibrate?.(8); }, TAB_HOLD_MS);
  // a held finger must not scroll the list it is in: the first move after the hold is the drag
  const blockScroll = (ev: TouchEvent) => { if (p.held || p.dragging) ev.preventDefault(); };
  const swallowMenu = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); }; // Android fires contextmenu mid-press
  const move = (ev: PointerEvent) => {
    if (!p.dragging) {
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < TAB_SLOP_PX) return;
      if (touch && !p.held) { finish(); return; } // a scroll, not a drag
      window.clearTimeout(p.timer);
      if (!begin(ev.clientX, ev.clientY)) return;
    }
    ev.preventDefault();
    wm.dragMove(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (p.dragging) {
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      if (over?.closest(NO_DROP) && !wm.state.dockPreview) wm.dragCancel();
      else if (wm.dragEnd()) toastDrop(rt, `${src.label} opened as a new tab.`);
    } else if (touch && p.held) {
      rt.openContext(ev.clientX, ev.clientY, src.menu ?? 'nav-item', src.view);
    }
    finish();
  };
  const cancel = () => { if (p.dragging) wm.dragCancel(); finish(); };
  function finish() {
    window.clearTimeout(p.timer);
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', blockScroll);
    window.setTimeout(() => window.removeEventListener('contextmenu', swallowMenu, true), 0);
    arm(false);
  }
  window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  if (touch) { window.addEventListener('touchmove', blockScroll, { passive: false }); window.addEventListener('contextmenu', swallowMenu, true); }
}

/** onClickCapture of a drag-to-tab source: the click a drag ends with is not a click. */
export function dragToTabClick(e: ReactMouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  if (el.dataset.fxDragged) { delete el.dataset.fxDragged; e.preventDefault(); e.stopPropagation(); }
}

/** Props that make an element a drag-to-tab source (null = not draggable). Keeps the element's own onClick. */
export function useDragToTab(src: DragToTabSource | null): { onPointerDown?: (e: ReactPointerEvent) => void; onClickCapture?: (e: ReactMouseEvent) => void; 'data-fx-tab-source'?: string } {
  const rt = useRuntime();
  if (!src) return {};
  return { onPointerDown: (e) => dragToTabDown(rt, e, src), onClickCapture: dragToTabClick, 'data-fx-tab-source': src.view };
}
