/**
 * One pointer drag for every calendar on screen: make, move and resize, in any pane of any window, because the target
 * is found under the pointer (`data-cal-col` = a day's time column, `data-cal-day` = a day cell) and not per view. Touch
 * waits for a long press so a finger can still scroll; a quick tap is a tap.
 */
import { useSyncExternalStore } from 'react';
import { hhmm, minuteOf, snap, span, stamp, shiftTime, type Occurrence, type Tone } from './core';

export interface Ghost { mode: 'create' | 'move' | 'resize'; start: string; end: string; allDay: boolean; title: string; tone: Tone; sourceKey: string }
export type Commit = { occ: Occurrence | null; start: string; end: string; allDay: boolean };
export interface DragHooks { onTap(occ: Occurrence | null, at: { date: string; minute: number | null }): void; onDrop(c: Commit): void }

const LONG_PRESS_MS = 350;
const SLOP = 8;
const STEP = 15;

let ghost: Ghost | null = null;
const subs = new Set<() => void>();
const set = (g: Ghost | null) => { ghost = g; subs.forEach((f) => f()); };
export const useGhost = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ghost);

let holding = false;
if (typeof document !== 'undefined') document.addEventListener('touchmove', (e) => { if (holding) e.preventDefault(); }, { passive: false });

/** The time or day under a point, in any calendar. Null over anything else. */
function hit(x: number, y: number): { date: string; minute: number | null } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const col = (el as HTMLElement).closest?.('[data-cal-col]') as HTMLElement | null;
    if (col) {
      const r = col.getBoundingClientRect();
      return { date: col.dataset.calCol!, minute: Math.max(0, Math.min(1439, ((y - r.top) / r.height) * 1440)) };
    }
    const day = (el as HTMLElement).closest?.('[data-cal-day]') as HTMLElement | null;
    if (day) return { date: day.dataset.calDay!, minute: null };
  }
  return null;
}

function edgeScroll(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest('.axp-cal-scroll');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const band = r.height * 0.08;
  if (y < r.top + band) el.scrollTop -= band / 4;
  else if (y > r.bottom - band) el.scrollTop += band / 4;
}

export function startDrag(e: React.PointerEvent, mode: Ghost['mode'], occ: Occurrence | null, hooks: DragHooks, tone: Tone = 'accent') {
  if (e.button !== 0) return;
  const touch = e.pointerType === 'touch';
  const sx = e.clientX; const sy = e.clientY;
  const first = hit(sx, sy);
  if (!first && !occ) return;
  e.stopPropagation();
  let live = false;
  let done = false;
  const length = occ ? span(occ.start, occ.end) : 60;
  // where on the event it was grabbed, so it doesn't jump under the finger
  const grab = occ && first?.minute != null && !occ.allDay ? first.minute - (first.date === occ.start.slice(0, 10) ? minuteOf(occ.start) : 0) : 0;
  const anchor = first?.minute != null ? snap(first.minute, STEP) : 540;
  const anchorDate = first?.date ?? occ?.date ?? '';

  const place = (x: number, y: number): Omit<Ghost, 'mode' | 'title' | 'tone' | 'sourceKey'> | null => {
    const at = hit(x, y);
    if (!at) return null;
    if (mode === 'create') {
      if (at.minute == null) return { start: `${at.date}T00:00`, end: `${at.date}T00:00`, allDay: true };
      const m = snap(at.minute, STEP);
      const from = Math.min(anchor, m); const to = Math.max(anchor, m);
      return { start: stamp(anchorDate, from), end: stamp(anchorDate, Math.max(to, from + STEP)), allDay: false };
    }
    if (mode === 'resize') {
      if (at.minute == null) return null;
      const end = stamp(at.date, snap(at.minute, STEP));
      return span(occ!.start, end) >= STEP ? { start: occ!.start, end, allDay: false } : { start: occ!.start, end: shiftTime(occ!.start, STEP), allDay: false };
    }
    if (at.minute == null) { // a day cell: same time, new day (or all day from a day band)
      const time = occ!.allDay ? '00:00' : hhmm(minuteOf(occ!.start));
      const start = `${at.date}T${time}`;
      return { start, end: shiftTime(start, length), allDay: occ!.allDay };
    }
    const start = stamp(at.date, snap(at.minute - grab, STEP));
    return { start, end: shiftTime(start, occ!.allDay ? 60 : length), allDay: false };
  };

  const show = (x: number, y: number) => {
    const p = place(x, y);
    if (p) set({ mode, title: occ?.title ?? 'New event', tone: occ?.tone ?? tone, sourceKey: occ?.key ?? '', ...p });
    edgeScroll(x, y);
  };
  const go = () => {
    if (live) return;
    live = true;
    holding = touch;
    if (touch) navigator.vibrate?.(10);
    show(sx, sy);
  };
  const timer = touch ? window.setTimeout(go, LONG_PRESS_MS) : 0;

  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    holding = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    const g = ghost;
    set(null);
    if (commit && live && g) hooks.onDrop({ occ, start: g.start, end: g.end, allDay: g.allDay });
    else if (commit && !live) hooks.onTap(occ, first ?? { date: occ?.date ?? '', minute: null });
  };
  const move = (ev: PointerEvent) => {
    if (live) { show(ev.clientX, ev.clientY); return; }
    const far = Math.hypot(ev.clientX - sx, ev.clientY - sy) > SLOP;
    if (far && touch) finish(false); // that's a scroll
    else if (far) go();
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
}
