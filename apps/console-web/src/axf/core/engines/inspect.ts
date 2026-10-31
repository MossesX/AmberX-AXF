/**
 * element-inspector@1 — the pointer model of the element inspector (AshesUI on the web, ElementInspector in Compose).
 *
 * Pure, so both ports behave the same; the Kotlin kernel mirrors it as `InspectEngine` and both replay
 * spec/fixtures/element-inspector.json (web: framework/spec/check-inspector.mts).
 *
 * Left button only (a mouse's main button, or the primary touch / pen); every other button passes through untouched:
 *  - press on the page: the follow panel opens at the pointer and shows the element under it (`look`)
 *  - drag: the panel follows the pointer, a fresh `look` on every move (live)
 *  - release (or cancel): the panel closes
 *  - double click (two presses within `doubleMs` and `doubleDist`): pins a panel on the element under the second
 *    press (`pinned`); the pinned panel stays, showing that element live, while presses keep inspecting
 *  - pinned panel: press its head and drag to move it, its corner to resize it (clamped to the viewport, never under
 *    `min`); `unpin` closes it
 * A press that inspected the page swallows the click that follows (`consume`), so inspecting a button doesn't press it.
 */
export const INSPECT_VERSION = 'element-inspector@1';

/** Where a press landed: the page, or a part of the pinned panel (its body, head, resize corner). */
export type InspectOn = 'page' | 'panel' | 'head' | 'resize';
export interface InspectPointer { type: 'down' | 'move' | 'up' | 'cancel'; t: number; x: number; y: number; button?: number; primary?: boolean; on?: InspectOn }
export type InspectEvent = InspectPointer | { type: 'unpin' } | { type: 'viewport'; w: number; h: number };
export interface InspectPoint { x: number; y: number }
export interface InspectSize { w: number; h: number }
export interface InspectRect { x: number; y: number; w: number; h: number }

export interface InspectConfig {
  /** two presses this close in time (ms) and space (px) are a double click */
  doubleMs: number; doubleDist: number;
  /** gap between the pointer and the follow panel (px); the panel never comes closer than `margin` to an edge */
  offset: number; margin: number;
  /** the pinned panel's first size, and the smallest it can be resized to */
  panel: InspectSize; min: InspectSize;
}
export const INSPECT_DEFAULTS: InspectConfig = { doubleMs: 320, doubleDist: 24, offset: 16, margin: 4, panel: { w: 320, h: 280 }, min: { w: 200, h: 120 } };

export interface InspectPin { at: InspectPoint; panel: InspectRect }
export interface InspectGrab { kind: 'move' | 'resize'; x: number; y: number; from: InspectRect }
export interface InspectState {
  viewport: InspectSize;
  /** a left press on the page is held */
  pressed: boolean;
  /** where the follow panel is anchored (the pointer), null = closed */
  follow: InspectPoint | null;
  /** the last page press, for double clicks */
  last: { t: number; x: number; y: number } | null;
  pin: InspectPin | null;
  /** the pinned panel is being moved or resized */
  grab: InspectGrab | null;
}
export interface InspectResult {
  state: InspectState;
  /** hit-test here and show that element in the follow panel */
  look: InspectPoint | null;
  /** a pin was made: hit-test here and keep that element in the pinned panel */
  pinned: InspectPoint | null;
  /** swallow this press / release (and the click it would make) */
  consume: boolean;
}

export function inspectInit(viewport: InspectSize): InspectState {
  return { viewport: { w: viewport.w, h: viewport.h }, pressed: false, follow: null, last: null, pin: null, grab: null };
}

/** Is this the left button (or the primary touch / pen)? `button` defaults to 0, `primary` to true. */
export const isLeftPress = (e: Pick<InspectPointer, 'button' | 'primary'>): boolean => (e.button ?? 0) === 0 && e.primary !== false;

/** Where the follow panel goes: past the pointer by `offset`, flipped to the other side to stay on screen. */
export function followPanel(at: InspectPoint, size: InspectSize, viewport: InspectSize, cfg: InspectConfig = INSPECT_DEFAULTS): InspectPoint {
  const m = cfg.margin;
  let x = at.x + cfg.offset, y = at.y + cfg.offset;
  if (x + size.w > viewport.w - m) x = Math.max(m, at.x - cfg.offset - size.w);
  if (y + size.h > viewport.h - m) y = Math.max(m, at.y - cfg.offset - size.h);
  return { x, y };
}

/** A panel kept inside the viewport: at least `min`, at most the viewport less the margins, then moved fully on screen. */
export function clampPanel(r: InspectRect, viewport: InspectSize, cfg: InspectConfig = INSPECT_DEFAULTS): InspectRect {
  const m = cfg.margin;
  const w = Math.max(cfg.min.w, Math.min(r.w, viewport.w - 2 * m));
  const h = Math.max(cfg.min.h, Math.min(r.h, viewport.h - 2 * m));
  const x = Math.max(m, Math.min(r.x, viewport.w - m - w));
  const y = Math.max(m, Math.min(r.y, viewport.h - m - h));
  return { x, y, w, h };
}

/** The panel moved by (dx, dy), kept on screen. */
export function movePanel(from: InspectRect, dx: number, dy: number, viewport: InspectSize, cfg: InspectConfig = INSPECT_DEFAULTS): InspectRect {
  return clampPanel({ x: from.x + dx, y: from.y + dy, w: from.w, h: from.h }, viewport, cfg);
}

/** The panel resized from its bottom-right corner by (dw, dh): the top-left stays, the corner stops at the viewport edge. */
export function resizePanel(from: InspectRect, dw: number, dh: number, viewport: InspectSize, cfg: InspectConfig = INSPECT_DEFAULTS): InspectRect {
  const m = cfg.margin;
  const w = Math.max(cfg.min.w, Math.min(from.w + dw, viewport.w - m - from.x));
  const h = Math.max(cfg.min.h, Math.min(from.h + dh, viewport.h - m - from.y));
  return clampPanel({ x: from.x, y: from.y, w, h }, viewport, cfg);
}

/** Where a new pin's panel goes: beside the pointer like the follow panel, at the configured size. */
export function pinPanel(at: InspectPoint, viewport: InspectSize, cfg: InspectConfig = INSPECT_DEFAULTS): InspectRect {
  const p = followPanel(at, cfg.panel, viewport, cfg);
  return clampPanel({ x: p.x, y: p.y, w: cfg.panel.w, h: cfg.panel.h }, viewport, cfg);
}

const none = (state: InspectState): InspectResult => ({ state, look: null, pinned: null, consume: false });

/** One pointer (or panel) event → the next state and what the host does now. */
export function inspectStep(s: InspectState, e: InspectEvent, cfg: InspectConfig = INSPECT_DEFAULTS): InspectResult {
  if (e.type === 'unpin') return none({ ...s, pin: null, grab: null });
  if (e.type === 'viewport') {
    const viewport = { w: e.w, h: e.h };
    return none({ ...s, viewport, pin: s.pin ? { at: s.pin.at, panel: clampPanel(s.pin.panel, viewport, cfg) } : null });
  }
  const pt = { x: e.x, y: e.y };
  const on = e.on ?? 'page';
  switch (e.type) {
    case 'down': {
      if (!isLeftPress(e)) return none(s);
      if (on !== 'page') {
        if (!s.pin || on === 'panel') return none(s);
        return none({ ...s, grab: { kind: on === 'head' ? 'move' : 'resize', x: e.x, y: e.y, from: s.pin.panel } });
      }
      const last = s.last;
      const double = !!last && e.t - last.t <= cfg.doubleMs && Math.hypot(e.x - last.x, e.y - last.y) <= cfg.doubleDist;
      if (double) {
        const pin = { at: pt, panel: pinPanel(pt, s.viewport, cfg) };
        return { state: { ...s, pressed: true, follow: pt, last: null, pin, grab: null }, look: pt, pinned: pt, consume: true };
      }
      return { state: { ...s, pressed: true, follow: pt, last: { t: e.t, x: e.x, y: e.y }, grab: null }, look: pt, pinned: null, consume: true };
    }
    case 'move': {
      if (s.grab && s.pin) {
        const dx = e.x - s.grab.x, dy = e.y - s.grab.y;
        const panel = s.grab.kind === 'move' ? movePanel(s.grab.from, dx, dy, s.viewport, cfg) : resizePanel(s.grab.from, dx, dy, s.viewport, cfg);
        return none({ ...s, pin: { at: s.pin.at, panel } });
      }
      if (!s.pressed) return none(s);
      return { state: { ...s, follow: pt }, look: pt, pinned: null, consume: false };
    }
    case 'up': {
      if (!isLeftPress(e)) return none(s);
      if (s.grab) return none({ ...s, grab: null });
      if (!s.pressed) return none(s);
      return { state: { ...s, pressed: false, follow: null }, look: null, pinned: null, consume: true };
    }
    case 'cancel':
      return none({ ...s, pressed: false, follow: null, grab: null });
  }
}
