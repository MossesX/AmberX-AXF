/*
 * drop-target@1 for widgets (toolbar-widgets@1): any role="toolbar" element accepts a widget dropped on it, and a widget
 * dragged along a toolbar or from one toolbar to another snaps between the widgets already there (snapIndex, the same
 * rule the arrange mode and the banner use). Installed once per document by AxfProvider; no toolbar needs code of its own.
 *
 * Payload: the drag carries `application/x-axf-widget` = JSON { type, id, from?: <toolbar instance> } (also as text/plain
 * `widget:<type>:<id>`). Sources are every toolbar widget (`[data-axf-toolbar-widget]`), every banner widget
 * (`[data-axf-banner-item]`, the banner keeps its own) and every row of the Attach a widget list
 * (`[data-axf-widget-drag]`). A drop on the same toolbar moves; on another it attaches there (a widget the person added
 * leaves the toolbar it came from); the side and place come from where it was dropped. Mouse / pen drag; on touch the
 * context menu's Move and Attach widget… do the same.
 */
import { snapIndex } from '../core/engines/widgets';
import type { AxfRuntime } from '../core/runtime';
import { toolbarElementId } from './tapConfirm';

export const WIDGET_DRAG_MIME = 'application/x-axf-widget';
export const DROP_TARGET_CONTRACT = 'drop-target@1';
const DROP_CLASS = 'is-widget-drop';

export interface WidgetDragPayload { type: string; id: string; from?: string }

/** Parse a drag payload (JSON or `widget:<type>:<id>` text); null when it is not a widget. */
export function parseWidgetDrag(json: string | null | undefined, text?: string | null): WidgetDragPayload | null {
  if (json) {
    try {
      const o = JSON.parse(json) as Partial<WidgetDragPayload>;
      if (typeof o.type === 'string' && typeof o.id === 'string' && o.type && o.id) return { type: o.type, id: o.id, ...(typeof o.from === 'string' && o.from ? { from: o.from } : {}) };
    } catch { /* fall through to text */ }
  }
  const m = /^widget:([a-z0-9-]{1,40}):([A-Za-z0-9._-]{1,80})$/.exec((text ?? '').trim());
  return m ? { type: m[1]!, id: m[2]! } : null;
}

/** Where a drop at x lands on a toolbar: the side whose widgets are nearest, and the index among them. */
export function dropPlace(bar: HTMLElement, x: number, key: string): { side: string; index: number } {
  const sides = Array.from(bar.querySelectorAll<HTMLElement>(':scope > .fx-toolbar__widgets, :scope > * > .fx-toolbar__widgets'));
  const r = bar.getBoundingClientRect();
  const sideOf = (el: HTMLElement) => (el.classList.contains('is-start') ? 'start' : 'end');
  // over a side's box: that side; else the nearer half of the bar
  const over = sides.find((s) => { const b = s.getBoundingClientRect(); return x >= b.left && x <= b.right; });
  const side = over ? sideOf(over) : x < r.left + r.width / 2 ? 'start' : 'end';
  const box = sides.find((s) => sideOf(s) === side);
  const mids = box ? Array.from(box.querySelectorAll<HTMLElement>('[data-axf-toolbar-widget]')).filter((n) => n.getAttribute('data-axf-toolbar-widget') !== key).map((n) => { const b = n.getBoundingClientRect(); return b.left + b.width / 2; }) : [];
  return { side, index: snapIndex(mids, x) };
}

/** Apply a drop: move on the same toolbar, attach on another (and leave the source when the person had added it there). */
export function dropWidget(rt: AxfRuntime, instance: string, p: WidgetDragPayload, side: string, index: number): boolean {
  const key = `${p.type}:${p.id}`;
  const drawn = Object.values(rt.toolbarInstanceWidgets(instance).sides).flat().some((w) => w.key === key);
  if (!drawn && !rt.addToolbarWidget(instance, p.type, p.id, side)) return false;
  if (p.from && p.from !== instance) {
    const slot = rt.toolbarWidgetSlots(p.from).find((s) => `${s.type}:${s.id}` === key);
    if (slot?.at) rt.removeToolbarWidget(p.from, key);
  }
  return rt.moveToolbarWidget(instance, key, side, index);
}

function payloadOf(el: Element): WidgetDragPayload | null {
  const src = el.closest<HTMLElement>('[data-axf-toolbar-widget], [data-axf-banner-item], [data-axf-widget-drag]');
  if (!src) return null;
  const key = src.getAttribute('data-axf-toolbar-widget') ?? src.getAttribute('data-axf-banner-item') ?? src.getAttribute('data-axf-widget-drag') ?? '';
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const bar = src.hasAttribute('data-axf-toolbar-widget') ? src.closest<HTMLElement>('[role="toolbar"]') : null;
  return { type: key.slice(0, i), id: key.slice(i + 1), ...(bar ? { from: toolbarElementId(bar) } : {}) };
}

/** Install the document's widget drag sources and toolbar drop targets. Returns the uninstaller. */
export function installToolbarWidgetDrop(rt: AxfRuntime, doc: Document = document): () => void {
  let lit: HTMLElement | null = null;
  const light = (el: HTMLElement | null) => { if (lit === el) return; lit?.classList.remove(DROP_CLASS); lit = el; lit?.classList.add(DROP_CLASS); };
  // sources: widget items are draggable while the person may change the look (never while a toolbar arranges by pointer)
  const mark = () => {
    const on = rt.canArrange();
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-axf-toolbar-widget]:not(.fx-arrange__item), [data-axf-banner-item]:not(.fx-arrange__item), [data-axf-widget-drag]'))) {
      if (on && el.getAttribute('draggable') !== 'true') el.setAttribute('draggable', 'true');
      else if (!on && el.hasAttribute('draggable')) el.removeAttribute('draggable');
    }
  };
  const onStart = (e: DragEvent) => {
    const p = e.target instanceof Element ? payloadOf(e.target) : null;
    if (!p || !e.dataTransfer || !rt.canArrange()) return;
    e.dataTransfer.setData(WIDGET_DRAG_MIME, JSON.stringify(p));
    e.dataTransfer.setData('text/plain', `widget:${p.type}:${p.id}`);
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const barAt = (e: DragEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[role="toolbar"]') : null);
  const carries = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(WIDGET_DRAG_MIME);
  const onOver = (e: DragEvent) => {
    const bar = carries(e) ? barAt(e) : null;
    light(bar);
    if (!bar) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  };
  const onDrop = (e: DragEvent) => {
    const bar = barAt(e);
    light(null);
    if (!bar || !e.dataTransfer) return;
    const p = parseWidgetDrag(e.dataTransfer.getData(WIDGET_DRAG_MIME), e.dataTransfer.getData('text/plain'));
    if (!p) return;
    e.preventDefault();
    const { side, index } = dropPlace(bar, e.clientX, `${p.type}:${p.id}`);
    if (!dropWidget(rt, toolbarElementId(bar), p, side, index)) rt.toast(`${p.type} ${p.id} can't go on this toolbar.`, 'warning', 'Toolbar widgets');
  };
  const onEnd = () => light(null);
  let pending: ReturnType<typeof setTimeout> | null = null;
  const later = () => { if (!pending) pending = setTimeout(() => { pending = null; mark(); }, 120); };
  mark();
  const off = rt.subscribe(later);
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later);
  mo?.observe(doc.documentElement, { childList: true, subtree: true });
  doc.addEventListener('dragstart', onStart);
  doc.addEventListener('dragover', onOver);
  doc.addEventListener('drop', onDrop);
  doc.addEventListener('dragend', onEnd);
  return () => {
    off(); mo?.disconnect(); light(null); if (pending) clearTimeout(pending);
    doc.removeEventListener('dragstart', onStart);
    doc.removeEventListener('dragover', onOver);
    doc.removeEventListener('drop', onDrop);
    doc.removeEventListener('dragend', onEnd);
  };
}
