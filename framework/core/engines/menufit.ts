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
  /**
   * How the box moved off its natural place, as space-separated words (`data-fx-flip`, matched with `~=`): `up` (a
   * drop-down opened above its anchor; a submenu moved up past its row's top to fit), `left` (a submenu opened on the
   * left of its row), `left up` (both), '' (where it belongs).
   */
  flip: '' | 'up' | 'left' | 'left up';
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
    // vertical: lined up with the row, moved up to fit (flip `up` once it sits above the row's top), capped to the box
    top = clamp(anchor.top, box.top, Math.max(box.top, box.bottom - h));
    if (top < anchor.top) flip = flip ? 'left up' : 'up';
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

/* ---------------- the menu scrolls, not the page (Brett, Nov 10 2026) ---------------- */

export interface WheelInput {
  /** is any framework menu open? */
  open: boolean;
  /** did the wheel / touch land inside an open menu's scroller? */
  inMenu: boolean;
  /** the scroll the user asked for (px; + = down) */
  deltaY: number;
  /** the scroller's state (only read when `inMenu`) */
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}

/**
 * Who gets a wheel / touch scroll while a menu is open: the menu's own scroller when it can still move that way
 * (`menu`), nothing at all otherwise (`block`: the page under the menu never moves, not even when the menu hits its
 * end or the pointer is outside it). With no menu open the page scrolls as usual (`page`).
 */
export function menuWheel(input: WheelInput): 'page' | 'menu' | 'block' {
  if (!input.open) return 'page';
  if (!input.inMenu) return 'block';
  const top = input.scrollTop ?? 0, height = input.scrollHeight ?? 0, client = input.clientHeight ?? 0;
  const canDown = top + client < height - 1, canUp = top > 1;
  if (input.deltaY > 0 && canDown) return 'menu';
  if (input.deltaY < 0 && canUp) return 'menu';
  return 'block';
}

/* ---------------- keyboard navigation (shared by the app menu and context menus) ---------------- */

export type MenuKeyAction = 'next' | 'prev' | 'first' | 'last' | 'open' | 'close' | 'activate' | 'escape' | null;

/**
 * What a key does on a focused menu row. Open / close keep their arrows whichever side a submenu flipped to (a menu
 * that flipped left still opens with ArrowRight, as every desktop menu does); `hasSub` says the row has a submenu
 * (ArrowRight opens it, Enter / Space open it too), `inSub` that the row is inside a submenu (ArrowLeft and Escape
 * close that submenu and go back to its parent row; at the root Escape closes the whole menu).
 */
export function menuKey(key: string, opts: { hasSub?: boolean; inSub?: boolean } = {}): MenuKeyAction {
  switch (key) {
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'prev';
    case 'Home': case 'PageUp': return 'first';
    case 'End': case 'PageDown': return 'last';
    case 'ArrowRight': return opts.hasSub ? 'open' : null;
    case 'ArrowLeft': return opts.inSub ? 'close' : null;
    case 'Enter': case ' ': return opts.hasSub ? 'open' : 'activate';
    case 'Escape': return opts.inSub ? 'close' : 'escape';
    default: return null;
  }
}

/** The row index a move lands on: wraps at both ends; from nowhere (-1) `next` is the first row and `prev` the last. */
export function nextMenuIndex(count: number, at: number, move: 'next' | 'prev' | 'first' | 'last'): number {
  if (count <= 0) return -1;
  switch (move) {
    case 'first': return 0;
    case 'last': return count - 1;
    case 'next': return at < 0 ? 0 : (at + 1) % count;
    case 'prev': return at < 0 ? count - 1 : (at - 1 + count) % count;
  }
}
