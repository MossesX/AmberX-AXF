/**
 * Pointer drag-and-drop for every pane (index tree, status grid, timeline, toolbar items): one engine that works with a
 * mouse and with a finger (drag from the grip; touch-action none there), so it works on the phone too. While anything
 * trashable is dragged, a trash can pops up at the bottom of the screen; dropping on it deletes (to the project trash).
 *
 * Drop targets are plain elements with `data-ws-drop="<zone>"` and `data-ws-drop-id`; zones register what they accept
 * and what a drop does. The hovered target gets `data-ws-over="before|after|inside"` for the drop marker.
 */
import { useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../axf/react';

export type DropPos = 'before' | 'after' | 'inside';
export interface DragPayload { kind: string; id: string; label: string; icon?: string; trashable?: boolean; data?: unknown }
export interface DropZone {
  accepts: (p: DragPayload, targetId: string) => boolean;
  /** which positions make sense on this target (default before/after/inside by thirds) */
  positions?: (p: DragPayload, targetId: string) => DropPos[];
  /** horizontal targets (toolbar items, timeline blocks) split left/right instead of top/bottom */
  axis?: 'x' | 'y';
  drop: (p: DragPayload, targetId: string, pos: DropPos) => void;
}

interface DragState { payload: DragPayload | null; x: number; y: number; overTrash: boolean }
let state: DragState = { payload: null, x: 0, y: 0, overTrash: false };
const ls = new Set<() => void>();
const set = (s: Partial<DragState>) => { state = { ...state, ...s }; ls.forEach((l) => l()); };
const zones = new Map<string, DropZone>();
let trashHandler: ((p: DragPayload) => void) | null = null;

export function registerZone(name: string, z: DropZone) { zones.set(name, z); return () => { zones.delete(name); }; }
export function setTrashHandler(fn: (p: DragPayload) => void) { trashHandler = fn; }
export function useDrag() { return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => state, () => state); }

let overEl: HTMLElement | null = null;
const clearOver = () => { overEl?.removeAttribute('data-ws-over'); overEl = null; };

function hit(x: number, y: number): { el: HTMLElement; zone: DropZone; id: string; pos: DropPos } | null {
  const p = state.payload!;
  const under = document.elementFromPoint(x, y) as HTMLElement | null;
  const el = under?.closest('[data-ws-drop]') as HTMLElement | null;
  if (!el) return null;
  const zone = zones.get(el.dataset.wsDrop!); const id = el.dataset.wsDropId ?? '';
  if (!zone || !zone.accepts(p, id)) return null;
  const r = el.getBoundingClientRect();
  const allowed = zone.positions?.(p, id) ?? ['before', 'inside', 'after'];
  const f = zone.axis === 'x' ? (x - r.left) / Math.max(1, r.width) : (y - r.top) / Math.max(1, r.height);
  let pos: DropPos = f < 0.33 ? 'before' : f > 0.67 ? 'after' : 'inside';
  if (!allowed.includes(pos)) pos = allowed.includes('inside') && allowed.length === 1 ? 'inside' : f < 0.5 ? (allowed.includes('before') ? 'before' : allowed[0]!) : (allowed.includes('after') ? 'after' : allowed[allowed.length - 1]!);
  return { el, zone, id, pos };
}

/**
 * Pointer-down handler that starts a drag. Mouse: starts after a 6 px move. Touch / pen: put it on a grip with
 * `touch-action: none` (class ws-grip) and it starts at once.
 */
export function startDrag(e: RPointerEvent, payload: DragPayload) {
  if (e.button !== 0) return;
  const touch = e.pointerType !== 'mouse';
  if (touch && !(e.target as HTMLElement).closest('.ws-grip')) return;
  const sx = e.clientX, sy = e.clientY;
  let started = false;
  const begin = () => { started = true; set({ payload, x: sx, y: sy, overTrash: false }); document.body.classList.add('ws-dragging'); };
  if (touch) begin();
  const move = (ev: PointerEvent) => {
    if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; begin(); }
    ev.preventDefault();
    const trash = document.querySelector('.ws-trash') as HTMLElement | null;
    const tr = trash?.getBoundingClientRect();
    const overTrash = !!(payload.trashable && tr && ev.clientX >= tr.left - 12 && ev.clientX <= tr.right + 12 && ev.clientY >= tr.top - 12 && ev.clientY <= tr.bottom + 12);
    set({ x: ev.clientX, y: ev.clientY, overTrash });
    clearOver();
    if (overTrash) return;
    const h = hit(ev.clientX, ev.clientY);
    if (h) { overEl = h.el; h.el.setAttribute('data-ws-over', h.pos); }
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    if (!started) return;
    const p = state.payload!;
    if (state.overTrash) trashHandler?.(p);
    else { const h = hit(ev.clientX, ev.clientY); if (h) h.zone.drop(p, h.id, h.pos); }
    end();
  };
  const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); if (started) end(); };
  const end = () => { clearOver(); set({ payload: null, overTrash: false }); document.body.classList.remove('ws-dragging'); suppressClick(); };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
/** the click that follows a drop must not also select / open */
function suppressClick() {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
}

/** the ghost under the finger + the pop-up trash can; mount once at the app root */
export function DragLayer() {
  const d = useDrag();
  if (!d.payload) return null;
  return (
    <>
      <div className="ws-ghost" style={{ left: d.x + 12, top: d.y + 8 }}>
        <Icon name={d.payload.icon ?? 'file'} size={14} /> <span>{d.payload.label}</span>
      </div>
      {d.payload.trashable && (
        <div className={`ws-trash ${d.overTrash ? 'is-over' : ''}`} role="presentation">
          <Icon name="trash" size={d.overTrash ? 30 : 24} />
          <span>{d.overTrash ? 'Let go to delete' : 'Drop here to delete'}</span>
        </div>
      )}
    </>
  );
}
