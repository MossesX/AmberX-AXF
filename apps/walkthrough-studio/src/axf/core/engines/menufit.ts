/*
 * Menu fit engine (menu-fit@1, Nov 3 2026): where a menu box goes and how tall it may be.
 *
 * Brett, Nov 3 2026: "The application menus need to be scrollable when they reach beyond the screen." Every menu box
 * (application menu drop-downs, their submenus, context menus, ⋯ overflow menus) is placed by `fitMenu`:
 *
 *   1. it opens where it belongs (below its anchor; a submenu to the right of its row),
 *   2. it flips (up; a submenu to the left) when the other side has room and its own side doesn't,
 *   3. it shifts to stay inside the box (the visible viewport minus safe areas, the keyboard and the edge inset),
 *   4. only when it still doesn't fit is its height capped (`maxHeight`) and it scrolls inside (`scroll: true`).
 *
 * Pure: rectangles in, a placement out (all in the same coordinate space, CSS px). The React layer
 * (react/components/menuFit.ts) measures the viewport (visualViewport, safe-area insets) and the menu, and applies it.
 * Web only for now; the Kotlin twin is a deferred gap (framework/spec/PORTING.md).
 */

export interface FitRect { left: number; top: number; right: number; bottom: number }
export interface FitSize { width: number; height: number }

export type FitMode =
  /** opens below the anchor (a menubar button, a ⋯ button); flips above it */
  | 'below'
  /** opens at a point (a context menu); the anchor is a zero-size rect at the pointer */
  | 'point'
  /** opens beside the anchor row (a submenu); flips to the left */
  | 'side';

export interface FitInput {
  mode: FitMode;
  /** what the menu hangs off (button, row, or the pointer as a zero-size rect) */
  anchor: FitRect;
  /** the menu's natural size (uncapped) */
  size: FitSize;
  /** where it may go: the visible viewport minus safe areas and the edge inset */
  box: FitRect;
  /** space between the anchor and the menu (default 0) */
  gap?: number;
  /** a ceiling on the height even when the screen has more room (0 / absent = none) */
  maxHeight?: number;
  /** keep the full box width: phones stretch drop-downs edge to edge, so only the vertical fit applies */
  stretch?: boolean;
}

export interface FitResult {
  left: number;
  top: number;
  /** the height cap to apply (always set: the room it got) */
  maxHeight: number;
  /** true when the menu is taller than its room and scrolls inside */
  scroll: boolean;
  /** 'up' (opened above its anchor) / 'left' (submenu opened on the left) / '' */
  flip: '' | 'up' | 'left';
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a menu of `size` goes next to `anchor` inside `box`. */
export function fitMenu(input: FitInput): FitResult {
  const { mode, anchor, size, box } = input;
  const gap = Math.max(0, input.gap ?? 0);
  const boxH = Math.max(0, box.bottom - box.top);
  const cap = input.maxHeight && input.maxHeight > 0 ? Math.min(input.maxHeight, boxH) : boxH;
  const h = Math.min(size.height, cap);
  let flip: FitResult['flip'] = '';
  let left: number;
  let top: number;
  let room: number;

  if (mode === 'side') {
    // horizontal: right of the row, left when only the left has room, else shifted inside the box
    const right = anchor.right + gap;
    const leftSide = anchor.left - gap - size.width;
    if (right + size.width <= box.right) left = right;
    else if (leftSide >= box.left) { left = leftSide; flip = 'left'; }
    else left = box.right - size.width;
    left = clamp(left, box.left, Math.max(box.left, box.right - size.width));
    // vertical: lined up with the row, moved up to fit, capped to the box when taller than it
    top = clamp(anchor.top, box.top, Math.max(box.top, box.bottom - h));
    room = cap;
  } else {
    // vertical: below the anchor, above it when it doesn't fit below and above has more room
    const pad = mode === 'point' ? 0 : gap; // a point has no button to clear
    const below = Math.max(0, box.bottom - (anchor.bottom + pad));
    const above = Math.max(0, (anchor.top - pad) - box.top);
    if (size.height <= Math.min(below, cap)) { top = anchor.bottom + pad; room = Math.min(below, cap); }
    else if (size.height <= Math.min(above, cap)) { top = anchor.top - pad - size.height; room = Math.min(above, cap); flip = 'up'; }
    else if (mode === 'point') {
      // a context menu that fits neither side shifts over the pointer, filling the box from the bottom
      top = clamp(box.bottom - h, box.top, box.bottom); room = cap;
    } else if (below >= above) { top = anchor.bottom + pad; room = Math.min(below, cap); }
    else { room = Math.min(above, cap); top = anchor.top - pad - Math.min(size.height, room); flip = 'up'; }
    // horizontal: from the anchor's start, shifted inside the box
    if (input.stretch) left = box.left;
    else left = clamp(anchor.left, box.left, Math.max(box.left, box.right - size.width));
  }
  const maxHeight = Math.max(0, Math.floor(room));
  return { left: Math.round(left), top: Math.round(top), maxHeight, scroll: size.height > maxHeight, flip };
}

/** The box a menu may use: the visible viewport minus safe-area insets, minus an edge inset on every side. */
export function menuBox(view: FitRect, insets: Partial<FitRect> = {}, edge = 0): FitRect {
  return {
    left: view.left + (insets.left ?? 0) + edge,
    top: view.top + (insets.top ?? 0) + edge,
    right: view.right - (insets.right ?? 0) - edge,
    bottom: view.bottom - (insets.bottom ?? 0) - edge,
  };
}
