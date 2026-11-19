/**
 * lib-dnd — pointer drag-and-drop for any AXF web app (library@1 `ai.amberx.axf.dnd`).
 *
 * Drop targets are elements with `data-axf-drop="<zone>"` and `data-axf-drop-id="<id>"`; a zone registers what it accepts
 * and what a drop does (`registerZone`). Start a drag from any pointer-down with `startDrag(e, payload)`: a mouse starts
 * after 6 px; a finger only from a grip (`axf-dnd-grip`, touch-action none), so scrolling still works. The hovered target
 * gets `data-axf-over="before|after|inside"`. Mount `<DragLayer />` once: the ghost and the pop-up trash can (for payloads
 * marked `trashable`; dropping calls the payload's `onTrash`, else the handler from `setTrashHandler`).
 * Parts (installed config `libraries.dnd.parts`): zones, touch, ghost {offset}, trash {label, overLabel, side}.
 */
import { useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import spec from './library.json';
import './dnd.css';

export const DND_LIBRARY_ID = 'ai.amberx.axf.dnd';
export type DropPos = 'before' | 'after' | 'inside';
export interface DragPayload { kind: string; id: string; label: string; icon?: string; trashable?: boolean; onTrash?: () => void; data?: unknown }
export interface DropZone {
  accepts: (p: DragPayload, targetId: string) => boolean;
  /** positions that make sense on a target (default before / inside / after by thirds) */
  positions?: (p: DragPayload, targetId: string) => DropPos[];
  /** horizontal targets (toolbar items, timeline blocks) split left / right */
  axis?: 'x' | 'y';
  drop: (p: DragPayload, targetId: string, pos: DropPos) => void;
}
export interface DndConfig {
  touch: boolean;
  ghost: false | { offset: number };
  trash: false | { label: string; overLabel: string; side: 'bottom' | 'top' };
}

const PARTS = (spec as { parts: LibraryPart[] }).parts;
let config: DndConfig = { touch: true, ghost: { offset: 12 }, trash: { label: 'Drop here to delete', overLabel: 'Let go to delete', side: 'bottom' } };
/** Apply an installed config (`libraries.dnd`); called by the library on register, or by hand. */
export function configureDnd(installed: { parts?: Record<string, unknown> } | null | undefined): DndConfig {
  const part = (id: string) => PARTS.find((p) => p.id === id);
  config = {
    touch: partOn(installed, 'touch', PARTS),
    ghost: partOn(installed, 'ghost', PARTS) ? { offset: Number(partParams(installed, 'ghost', part('ghost')).offset ?? 12) } : false,
    trash: partOn(installed, 'trash', PARTS) ? (partParams(installed, 'trash', part('trash')) as DndConfig['trash'] & object) : false,
  };
  return config;
}
export const dndConfig = () => config;

interface DragState { payload: DragPayload | null; x: number; y: number; overTrash: boolean }
let state: DragState = { payload: null, x: 0, y: 0, overTrash: false };
const listeners = new Set<() => void>();
const set = (s: Partial<DragState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
const zones = new Map<string, DropZone>();
let trashHandler: ((p: DragPayload) => void) | null = null;

/** Register a zone; returns the remover (use it as an effect cleanup). */
export function registerZone(name: string, z: DropZone): () => void { zones.set(name, z); return () => { if (zones.get(name) === z) zones.delete(name); }; }
/** What dropping on the trash can does for payloads without their own `onTrash`. */
export function setTrashHandler(fn: ((p: DragPayload) => void) | null) { trashHandler = fn; }
/** The live drag (null payload = nothing dragged). */
export function useDrag(): DragState { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state); }

let overEl: HTMLElement | null = null;
const clearOver = () => { overEl?.removeAttribute('data-axf-over'); overEl = null; };

function hit(x: number, y: number): { el: HTMLElement; zone: DropZone; id: string; pos: DropPos } | null {
  const p = state.payload!;
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-axf-drop]') as HTMLElement | null;
  if (!el) return null;
  const zone = zones.get(el.dataset.axfDrop!); const id = el.dataset.axfDropId ?? '';
  if (!zone || !zone.accepts(p, id)) return null;
  const r = el.getBoundingClientRect();
  const allowed = zone.positions?.(p, id) ?? ['before', 'inside', 'after'];
  const f = zone.axis === 'x' ? (x - r.left) / Math.max(1, r.width) : (y - r.top) / Math.max(1, r.height);
  let pos: DropPos = f < 0.33 ? 'before' : f > 0.67 ? 'after' : 'inside';
  if (!allowed.includes(pos)) pos = allowed.length === 1 ? allowed[0]! : f < 0.5 ? (allowed.includes('before') ? 'before' : allowed[0]!) : (allowed.includes('after') ? 'after' : allowed[allowed.length - 1]!);
  return { el, zone, id, pos };
}

/** Pointer-down handler that starts a drag (mouse: after 6 px; touch / pen: only from an `axf-dnd-grip`, when touch is on). */
export function startDrag(e: RPointerEvent | PointerEvent, payload: DragPayload): void {
  if (e.button !== 0) return;
  const touch = e.pointerType !== 'mouse';
  if (touch && (!config.touch || !(e.target as HTMLElement).closest('.axf-dnd-grip'))) return;
  const sx = e.clientX, sy = e.clientY;
  let started = false;
  const begin = () => { started = true; set({ payload, x: sx, y: sy, overTrash: false }); document.body.classList.add('axf-dnd-dragging'); };
  if (touch) begin();
  const canTrash = !!(payload.trashable && config.trash);
  const move = (ev: PointerEvent) => {
    if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; begin(); }
    ev.preventDefault();
    const tr = canTrash ? document.querySelector('.axf-dnd-trash')?.getBoundingClientRect() : undefined;
    const overTrash = !!(tr && ev.clientX >= tr.left - 12 && ev.clientX <= tr.right + 12 && ev.clientY >= tr.top - 12 && ev.clientY <= tr.bottom + 12);
    set({ x: ev.clientX, y: ev.clientY, overTrash });
    clearOver();
    if (overTrash) return;
    const h = hit(ev.clientX, ev.clientY);
    if (h) { overEl = h.el; h.el.setAttribute('data-axf-over', h.pos); }
  };
  const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
  const end = () => { clearOver(); set({ payload: null, overTrash: false }); document.body.classList.remove('axf-dnd-dragging'); swallowClick(); };
  const up = (ev: PointerEvent) => {
    done(); if (!started) return;
    const p = state.payload!;
    if (state.overTrash) (p.onTrash ?? (() => trashHandler?.(p)))();
    else { const h = hit(ev.clientX, ev.clientY); if (h) h.zone.drop(p, h.id, h.pos); }
    end();
  };
  const cancel = () => { done(); if (started) end(); };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
/** the click that follows a drop must not also select / open */
function swallowClick() {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
}

/** The ghost under the pointer + the pop-up trash can; mount once near the app root. */
export function DragLayer() {
  const d = useDrag();
  if (!d.payload) return null;
  const g = config.ghost, t = config.trash;
  return (
    <>
      {g && <div className="axf-dnd-ghost" style={{ left: d.x + g.offset, top: d.y + g.offset * 0.66 }}><Icon name={d.payload.icon ?? 'file'} size={14} /> <span>{d.payload.label}</span></div>}
      {d.payload.trashable && t && (
        <div className={`axf-dnd-trash axf-dnd-trash--${t.side} ${d.overTrash ? 'is-over' : ''}`} role="presentation">
          <Icon name="trash" size={d.overTrash ? 30 : 24} /><span>{d.overTrash ? t.overLabel : t.label}</span>
        </div>
      )}
    </>
  );
}

export const library: AxfWebLibrary = {
  id: DND_LIBRARY_ID,
  label: 'Drag and drop',
  version: '0.1.0',
  provides: ['axf.dnd'],
  register(rt) { configureDnd((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.dnd); },
};
