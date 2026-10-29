/*
 * Window / tab-group / docking engine — web port of the Android kernel's contract/Windows.kt (API level 1).
 * Pure state + rules; framework/react/windows renders it. Every window is built from a WindowSpec (the
 * "window schema"); floating windows force toolbars on (ELEMENT windows default off); tab groups split
 * into nested layouts; tabs move between groups and windows; floating windows minimize to a corner
 * (stacked or lined-up title bars) or to a floating toolbar at the cursor.
 */

export type WindowType = 'main' | 'dock' | 'tool' | 'dialog' | 'panel' | 'floating' | 'element';
export type MinimizeMode = 'stacked' | 'lined';
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
export type MinimizeTarget = 'corner-titlebar' | 'floating-toolbar';
export type SplitMode = 'vertical' | 'horizontal' | 'four' | 'grid';
export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
export const nextCorner = (c: Corner): Corner => CORNERS[(CORNERS.indexOf(c) + 1) % CORNERS.length] ?? 'bottom-right';

export interface WindowSettings { corner: Corner; mode: MinimizeMode; toolbarAsset?: string | null; alwaysOnTop: boolean; opacity: number }
export const defaultSettings = (): WindowSettings => ({ corner: 'bottom-right', mode: 'stacked', toolbarAsset: null, alwaysOnTop: false, opacity: 1 });

/** The window schema. `toolbarsAllowed` = whether a toolbar may attach; floating windows force `toolbarEnabled`. */
export interface WindowSpec {
  id: string; type: WindowType; title: string;
  toolbarsAllowed: boolean; toolbarEnabled: boolean;
  /** where it came from: the tab-group id it was undocked from, a route, a dialog… */
  origin?: string | null;
  settings: WindowSettings;
  x: number; y: number; width: number; height: number;
  minimized: MinimizeTarget | null; minimizedAtX: number; minimizedAtY: number;
  closable: boolean; z: number;
  /** content view mode the window's toolbar can toggle (`tree` | `grid` | app-defined) */
  mode: string;
  /** the interface scope it was opened from ('' / absent = the app itself); each scope's host draws only its own */
  scope?: string;
  /** who draws the title bar (absent = `standard`); see WindowFrame */
  frame?: WindowFrame;
  /** filling the viewport; `restore` is the rect it goes back to (null = never maximized) */
  maximized?: boolean;
  restore?: Rect | null;
  /** per-window size floor (absent = WINDOW_MIN); the engine never lets a resize go below it */
  minWidth?: number; minHeight?: number;
}

/* ---------- geometry: rects, resize handles, maximize (windows-terminal s17) ---------- */

export interface Rect { x: number; y: number; width: number; height: number }
export interface SizeLimits { minWidth: number; minHeight: number; maxWidth?: number; maxHeight?: number }
/** The eight resize handles, named by compass side (`n` = top edge, `se` = bottom-right corner). */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
/** Default size floor for every window (px, root units). */
export const WINDOW_MIN: SizeLimits = { minWidth: 200, minHeight: 160 };
/** Width of the band along each edge that counts as a resize handle (mouse) and the wider band for touch. Corners take a square of twice the band. */
export const RESIZE_HANDLE = 8;
export const RESIZE_HANDLE_TOUCH = 16;

export const rectOf = (w: Rect): Rect => ({ x: w.x, y: w.y, width: w.width, height: w.height });
export const limitsOf = (w: Pick<WindowSpec, 'minWidth' | 'minHeight'>): SizeLimits => ({ minWidth: Math.max(1, w.minWidth ?? WINDOW_MIN.minWidth), minHeight: Math.max(1, w.minHeight ?? WINDOW_MIN.minHeight) });

/**
 * Which resize handle a point is on. The band straddles the edge (`handle` px inside and outside the rect, so a finger
 * can grab a thin border); a point within `2 * handle` of two edges is the corner. Null = not on a handle (inside the
 * window body, or clearly outside). Points outside by more than `handle` never hit.
 */
export function hitResizeEdge(r: Rect, px: number, py: number, handle = RESIZE_HANDLE): ResizeEdge | null {
  const h = Math.max(1, handle), corner = h * 2;
  const left = px - r.x, right = r.x + r.width - px, top = py - r.y, bottom = r.y + r.height - py;
  if (left < -h || right < -h || top < -h || bottom < -h) return null;
  const nearW = left <= corner, nearE = right <= corner, nearN = top <= corner, nearS = bottom <= corner;
  if (nearN && nearW) return 'nw'; if (nearN && nearE) return 'ne'; if (nearS && nearW) return 'sw'; if (nearS && nearE) return 'se';
  if (top <= h) return 'n'; if (bottom <= h) return 's'; if (left <= h) return 'w'; if (right <= h) return 'e';
  return null;
}

/** The cursor a handle wants (CSS names; ports map them). */
export const resizeCursor = (e: ResizeEdge): string => ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' })[e];

/**
 * Resize `start` by dragging `edge` through (dx, dy). Opposite edges stay put: a west drag moves x and shrinks width,
 * and when the size would go under its floor (or over its ceiling) the moving edge stops, so the fixed edge never
 * drifts. Rounded to whole px. No viewport clamp: windows may leave the screen (Brett, Oct 28 2026: no keep-on-screen).
 */
export function resizeRect(start: Rect, edge: ResizeEdge, dx: number, dy: number, limits: SizeLimits = WINDOW_MIN): Rect {
  const minW = Math.max(1, limits.minWidth), minH = Math.max(1, limits.minHeight);
  const maxW = limits.maxWidth && limits.maxWidth >= minW ? limits.maxWidth : Infinity, maxH = limits.maxHeight && limits.maxHeight >= minH ? limits.maxHeight : Infinity;
  let { x, y, width, height } = start;
  const right = start.x + start.width, bottom = start.y + start.height;
  if (edge.includes('e')) width = Math.min(maxW, Math.max(minW, start.width + dx));
  if (edge.includes('w')) { width = Math.min(maxW, Math.max(minW, start.width - dx)); x = right - width; }
  if (edge.includes('s')) height = Math.min(maxH, Math.max(minH, start.height + dy));
  if (edge.includes('n')) { height = Math.min(maxH, Math.max(minH, start.height - dy)); y = bottom - height; }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** The rect a maximized window fills: the whole viewport (or `work`, the area left after fixed chrome). */
export const maximizedRect = (viewport: { width: number; height: number }, work?: Rect | null): Rect => work ?? { x: 0, y: 0, width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)) };

/** Maximize: remember the current rect and fill the viewport. Already maximized = unchanged (the restore rect is kept). */
export function maximizeWindow(w: WindowSpec, viewport: { width: number; height: number }, work?: Rect | null): WindowSpec {
  if (isMaximized(w)) return w;
  return { ...w, ...maximizedRect(viewport, work), maximized: true, restore: rectOf(w) };
}
/** Restore from maximized to the remembered rect (a window never maximized is unchanged). */
export function restoreWindow(w: WindowSpec): WindowSpec {
  if (!isMaximized(w)) return w;
  const r = w.restore ?? rectOf(w);
  return { ...w, ...r, maximized: false, restore: null };
}
export const toggleMaximized = (w: WindowSpec, viewport: { width: number; height: number }, work?: Rect | null): WindowSpec => (isMaximized(w) ? restoreWindow(w) : maximizeWindow(w, viewport, work));

/**
 * Dragging a maximized title bar restores the window under the pointer, like Windows: the restored window keeps the
 * pointer at the same fraction of its width, and its top edge at the pointer's y minus the grab offset within the bar.
 */
export function dragRestore(w: WindowSpec, pointerX: number, pointerY: number, grabOffsetY = 0): WindowSpec {
  if (!isMaximized(w)) return w;
  const r = restoreWindow(w);
  const frac = w.width > 0 ? Math.min(1, Math.max(0, (pointerX - w.x) / w.width)) : 0.5;
  return { ...r, x: Math.round(pointerX - r.width * frac), y: Math.round(pointerY - Math.max(0, grabOffsetY)) };
}
/**
 * Window frame (Oct 28 2026, windows-terminal s17): `standard` = the host draws the title bar (name, badge, buttons);
 * `frameless` = the content draws its own title bar (the Terminal's tab strip) and drives the window through the
 * frame hooks (move, resize, minimize, maximize, close). Absent = `standard`, so every existing WindowSpec still reads.
 */
export type WindowFrame = 'standard' | 'frameless';
export const windowFrame = (w: Pick<WindowSpec, 'frame'>): WindowFrame => (w.frame === 'frameless' ? 'frameless' : 'standard');
export const isMaximized = (w: Pick<WindowSpec, 'maximized'>) => w.maximized === true;

export const isFloating = (w: WindowSpec) => w.type === 'floating' || w.type === 'dock' || w.type === 'element';
export const forcesToolbar = (w: WindowSpec) => isFloating(w) && w.type !== 'element';
export const effectiveToolbar = (w: WindowSpec) => w.toolbarsAllowed && (w.toolbarEnabled || forcesToolbar(w));

/** A tab: what it shows is up to the app (`kind` + `payload`), the engine only moves it around. */
export interface TabSpec { id: string; title: string; kind: string; payload?: string; icon?: string | null; closable?: boolean }

/** Nested layout of a window's content: a leaf group, a split with weights, or a grid of groups. */
export type Pane =
  | { kind: 'leaf'; groupId: string }
  | { kind: 'split'; vertical: boolean; children: Pane[]; weights: number[] }
  | { kind: 'grid'; rows: number; cols: number; cells: Pane[] };

/* ---------- snapping: screen edges, window edges, half / quarter zones, no overlap, drop to split (s18) ---------- */

/** What snaps while a window is dragged. `threshold` = px within which an edge pulls; `zoneMargin` = px band at the viewport edge that arms a half / quarter zone. */
export interface SnapRules { edges: boolean; windows: boolean; zones: boolean; split: boolean; noOverlap: boolean; threshold: number; zoneMargin: number; splitDwellMs: number }
export const DEFAULT_SNAP_RULES: SnapRules = { edges: true, windows: true, zones: true, split: true, noOverlap: false, threshold: 12, zoneMargin: 24, splitDwellMs: 450 };

export type SnapSide = 'left' | 'right' | 'top' | 'bottom';
/** One edge pull: the moving rect's `side` lands on `at`, the edge of the viewport or of window `#to` (index into `others`). */
export interface SnapHit { kind: 'viewport' | 'window'; side: SnapSide; at: number; to?: number }
export interface SnapResult { rect: Rect; x: SnapHit | null; y: SnapHit | null }

const nearest = (cands: (SnapHit & { delta: number })[], threshold: number) => cands.filter((c) => Math.abs(c.delta) <= threshold).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || (a.kind === 'viewport' ? -1 : 1))[0] ?? null;

/**
 * Pull a dragged rect onto the viewport edges and onto other windows' edges (abutting: my left to their right, or
 * aligning: my left to their left), one pull per axis, the nearest wins (the viewport wins a tie). Nothing within
 * `threshold` = the rect is returned as is. Never clamps: a window may still leave the screen.
 */
export function snapRect(r: Rect, viewport: { width: number; height: number } | null, others: Rect[], rules: Pick<SnapRules, 'edges' | 'windows' | 'threshold'> = DEFAULT_SNAP_RULES): SnapResult {
  const t = Math.max(0, rules.threshold);
  const xs: (SnapHit & { delta: number })[] = [], ys: (SnapHit & { delta: number })[] = [];
  const right = r.x + r.width, bottom = r.y + r.height;
  if (rules.edges && viewport) {
    xs.push({ kind: 'viewport', side: 'left', at: 0, delta: 0 - r.x }, { kind: 'viewport', side: 'right', at: viewport.width, delta: viewport.width - right });
    ys.push({ kind: 'viewport', side: 'top', at: 0, delta: 0 - r.y }, { kind: 'viewport', side: 'bottom', at: viewport.height, delta: viewport.height - bottom });
  }
  if (rules.windows) others.forEach((o, i) => {
    const oR = o.x + o.width, oB = o.y + o.height;
    // only windows that overlap on the other axis pull (an edge far above never attracts)
    if (o.y - t < bottom && oB + t > r.y) xs.push({ kind: 'window', side: 'left', at: oR, to: i, delta: oR - r.x }, { kind: 'window', side: 'right', at: o.x, to: i, delta: o.x - right }, { kind: 'window', side: 'left', at: o.x, to: i, delta: o.x - r.x }, { kind: 'window', side: 'right', at: oR, to: i, delta: oR - right });
    if (o.x - t < right && oR + t > r.x) ys.push({ kind: 'window', side: 'top', at: oB, to: i, delta: oB - r.y }, { kind: 'window', side: 'bottom', at: o.y, to: i, delta: o.y - bottom }, { kind: 'window', side: 'top', at: o.y, to: i, delta: o.y - r.y }, { kind: 'window', side: 'bottom', at: oB, to: i, delta: oB - bottom });
  });
  const hx = nearest(xs, t), hy = nearest(ys, t);
  const out: Rect = { ...r, x: Math.round(hx ? r.x + hx.delta : r.x), y: Math.round(hy ? r.y + hy.delta : r.y) };
  const strip = (h: (SnapHit & { delta: number }) | null): SnapHit | null => (h ? (h.to === undefined ? { kind: h.kind, side: h.side, at: h.at } : { kind: h.kind, side: h.side, at: h.at, to: h.to }) : null);
  return { rect: out, x: strip(hx), y: strip(hy) };
}

/** Half / quarter zones at the viewport edges (Windows: left / right halves, corners = quarters, top = maximize). */
export type SnapZone = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const SNAP_ZONES: SnapZone[] = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** The zone a pointer at (px, py) arms: within `margin` of two edges = that corner, of one edge = that side, else null. */
export function snapZoneAt(px: number, py: number, viewport: { width: number; height: number }, margin = DEFAULT_SNAP_RULES.zoneMargin): SnapZone | null {
  const m = Math.max(1, margin);
  const l = px <= m, r = px >= viewport.width - m, t = py <= m, b = py >= viewport.height - m;
  if (!l && !r && !t && !b) return null;
  if (px < -m || py < -m || px > viewport.width + m || py > viewport.height + m) return null;
  if (t && l) return 'top-left'; if (t && r) return 'top-right'; if (b && l) return 'bottom-left'; if (b && r) return 'bottom-right';
  if (l) return 'left'; if (r) return 'right'; if (t) return 'top'; return 'bottom';
}

/** The rect a zone fills inside `area` (the viewport or the work area). `top` is the whole area (maximize). */
export function snapZoneRect(zone: SnapZone, area: Rect): Rect {
  const hw = Math.round(area.width / 2), hh = Math.round(area.height / 2);
  const mx = area.x + hw, my = area.y + hh, rw = area.width - hw, bh = area.height - hh;
  switch (zone) {
    case 'left': return { x: area.x, y: area.y, width: hw, height: area.height };
    case 'right': return { x: mx, y: area.y, width: rw, height: area.height };
    case 'top': return { ...area };
    case 'bottom': return { x: area.x, y: my, width: area.width, height: bh };
    case 'top-left': return { x: area.x, y: area.y, width: hw, height: hh };
    case 'top-right': return { x: mx, y: area.y, width: rw, height: hh };
    case 'bottom-left': return { x: area.x, y: my, width: hw, height: bh };
    default: return { x: mx, y: my, width: rw, height: bh };
  }
}

export const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export const rectContains = (r: Rect, px: number, py: number) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;

/**
 * No-overlap: push `r` out of every rect in `others` along the axis with the smaller overlap (the pointer's side wins
 * when `prefer` is given), up to `passes` rounds, so windows tile instead of stacking. The pushed rect may leave the
 * screen (no keep-on-screen). Returns the rect unchanged when nothing overlaps.
 */
export function resolveOverlap(r: Rect, others: Rect[], passes = 8): Rect {
  let cur = { ...r };
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (const o of others) {
      if (!rectsOverlap(cur, o)) continue;
      const pushLeft = cur.x + cur.width - o.x, pushRight = o.x + o.width - cur.x, pushUp = cur.y + cur.height - o.y, pushDown = o.y + o.height - cur.y;
      const best = Math.min(pushLeft, pushRight, pushUp, pushDown);
      if (best === pushLeft) cur.x -= pushLeft; else if (best === pushRight) cur.x += pushRight; else if (best === pushUp) cur.y -= pushUp; else cur.y += pushDown;
      moved = true;
    }
    if (!moved) break;
  }
  return { ...cur, x: Math.round(cur.x), y: Math.round(cur.y) };
}

/** Drop a window onto another to split: the dropped one takes the half the pointer is nearest, the target keeps the rest. */
export interface SplitDrop { side: SnapSide; dropped: Rect; target: Rect }
export function splitDrop(target: Rect, px: number, py: number): SplitDrop {
  const nx = target.width > 0 ? (px - target.x) / target.width - 0.5 : 0, ny = target.height > 0 ? (py - target.y) / target.height - 0.5 : 0;
  const side: SnapSide = Math.abs(nx) >= Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'top' : 'bottom');
  const hw = Math.round(target.width / 2), hh = Math.round(target.height / 2);
  switch (side) {
    case 'left': return { side, dropped: { x: target.x, y: target.y, width: hw, height: target.height }, target: { x: target.x + hw, y: target.y, width: target.width - hw, height: target.height } };
    case 'right': return { side, dropped: { x: target.x + hw, y: target.y, width: target.width - hw, height: target.height }, target: { x: target.x, y: target.y, width: hw, height: target.height } };
    case 'top': return { side, dropped: { x: target.x, y: target.y, width: target.width, height: hh }, target: { x: target.x, y: target.y + hh, width: target.width, height: target.height - hh } };
    default: return { side, dropped: { x: target.x, y: target.y + hh, width: target.width, height: target.height - hh }, target: { x: target.x, y: target.y, width: target.width, height: hh } };
  }
}

/** The topmost rect (highest `z`) under the pointer, or -1. */
export function topmostAt(rects: (Rect & { z: number })[], px: number, py: number): number {
  let best = -1;
  rects.forEach((r, i) => { if (rectContains(r, px, py) && (best < 0 || r.z > rects[best]!.z)) best = i; });
  return best;
}

/** Split arms only after the pointer has rested over the same target for `dwellMs` (a drag passing over a window never splits it). */
export interface SplitArm { target: string | null; since: number; armed: boolean }
export function armSplit(prev: SplitArm | null, target: string | null, now: number, dwellMs = DEFAULT_SNAP_RULES.splitDwellMs): SplitArm {
  if (!target) return { target: null, since: now, armed: false };
  if (!prev || prev.target !== target) return { target, since: now, armed: dwellMs <= 0 };
  return { target, since: prev.since, armed: now - prev.since >= dwellMs };
}

/** What the host previews while a window is dragged: a zone, a split, or nothing (plain snapping moves the window itself). */
export interface DragPreview { kind: 'zone' | 'split'; rect: Rect; zone?: SnapZone; target?: string; side?: SnapSide; targetRect?: Rect }

/* ---------- placement rules (behaviour theme → windows) ---------- */

/** The `windows` group of the behaviour theme the window manager honours: how new windows stack, whether they snap, how they minimize. */
export interface WindowPlacementRules { stack: 'cascade' | 'center' | 'remember' | string; snap: boolean; snapGrid: number; minimize: 'cursor' | 'dock' | 'none' | string }
export const DEFAULT_WINDOW_PLACEMENT: WindowPlacementRules = { stack: 'cascade', snap: false, snapGrid: 8, minimize: 'cursor' };
export const CASCADE_ORIGIN = { x: 24, y: 72 } as const;
export const CASCADE_STEP = 28;

/** A coordinate snapped to the grid when snapping is on (grid ≤ 1 = no snapping). */
export function snapCoord(v: number, rules: WindowPlacementRules): number {
  const g = rules.snap ? Math.max(0, Math.floor(rules.snapGrid)) : 0;
  return g > 1 ? Math.round(v / g) * g : Math.round(v);
}

/**
 * Where the n-th floating window opens. `cascade` steps down-right from the origin (wrapping inside the viewport),
 * `center` centres it, `remember` reuses the last position a window with the same key had (else cascades). Snapping applies after.
 */
export function placeNewWindow(rules: WindowPlacementRules, index: number, size: { width: number; height: number }, viewport?: { width: number; height: number } | null, remembered?: { x: number; y: number } | null): { x: number; y: number } {
  let x: number; let y: number;
  if (rules.stack === 'center' && viewport) { x = Math.max(0, (viewport.width - size.width) / 2); y = Math.max(0, (viewport.height - size.height) / 2); }
  else if (rules.stack === 'remember' && remembered) { x = remembered.x; y = remembered.y; }
  else {
    const steps = viewport ? Math.max(1, Math.floor(Math.max(0, Math.min(viewport.width - size.width, viewport.height - size.height) - CASCADE_ORIGIN.y) / CASCADE_STEP) + 1) : Number.MAX_SAFE_INTEGER;
    const i = steps === Number.MAX_SAFE_INTEGER ? index : index % steps;
    x = CASCADE_ORIGIN.x + CASCADE_STEP * i; y = CASCADE_ORIGIN.y + CASCADE_STEP * i;
  }
  if (viewport) { x = Math.max(0, Math.min(x, Math.max(0, viewport.width - size.width))); y = Math.max(0, Math.min(y, Math.max(0, viewport.height - size.height))); }
  return { x: snapCoord(x, rules), y: snapCoord(y, rules) };
}

/** What a minimize request becomes under the rules: `cursor` = as asked, `dock` = always a corner title bar, `none` = refused (null). */
export function minimizeTargetFor(rules: WindowPlacementRules, requested: MinimizeTarget): MinimizeTarget | null {
  if (rules.minimize === 'none') return null;
  if (rules.minimize === 'dock') return 'corner-titlebar';
  return requested;
}

export const paneGroups = (p: Pane): string[] => p.kind === 'leaf' ? [p.groupId] : p.kind === 'split' ? p.children.flatMap(paneGroups) : p.cells.flatMap(paneGroups);
export function paneReplace(p: Pane, groupId: string, w: Pane): Pane {
  if (p.kind === 'leaf') return p.groupId === groupId ? w : p;
  if (p.kind === 'split') return { ...p, children: p.children.map((c) => paneReplace(c, groupId, w)) };
  return { ...p, cells: p.cells.map((c) => paneReplace(c, groupId, w)) };
}
export function paneRemove(p: Pane, groupId: string): Pane | null {
  if (p.kind === 'leaf') return p.groupId === groupId ? null : p;
  if (p.kind === 'split') {
    const kept: [Pane, number][] = [];
    p.children.forEach((c, i) => { const r = paneRemove(c, groupId); if (r) kept.push([r, p.weights[i] ?? 1]); });
    const first = kept[0];
    return !first ? null : kept.length === 1 ? first[0] : { ...p, children: kept.map((k) => k[0]), weights: kept.map((k) => k[1]) };
  }
  const kept = p.cells.map((c) => paneRemove(c, groupId)).filter((c): c is Pane => !!c);
  const only = kept[0];
  return !only ? null : kept.length === 1 ? only : kept.length === p.cells.length ? { ...p, cells: kept } : { kind: 'split', vertical: false, children: kept, weights: kept.map(() => 1) };
}

export interface TabGroup { id: string; tabs: TabSpec[]; active: number; windowId: string }
export const activeTab = (g: TabGroup) => g.tabs[g.active];
export interface TabDrag { tabId: string; fromGroup: string; x: number; y: number }
export interface WindowState { windows: WindowSpec[]; groups: Record<string, TabGroup>; layouts: Record<string, Pane>; focused: string | null; drag: TabDrag | null; /** the snap / split preview of a window drag in progress (s18) */ preview?: DragPreview | null }

/** `checked` = check-mark binding, same forms as MenuItem.checked (`setting:<key>` | `counter:<name>` | `slot:<type>` | `hidden:<type>`). */
export interface MenuEntry { id: string; label?: string; icon?: string; action?: string; separator?: boolean; checked?: string; items?: MenuEntry[] }

/** Even distribution: the first `size % n` groups get one extra tab (5 → 3 + 2, 7 in four → 2,2,2,1). Empty parts are kept so the grid has every cell. */
export function distribute<T>(items: T[], n: number): T[][] {
  const base = Math.floor(items.length / n), extra = items.length % n; let i = 0;
  return Array.from({ length: n }, (_, k) => { const take = base + (k < extra ? 1 : 0); const part = items.slice(i, i + take); i += take; return part; });
}

type Listener = (s: WindowState) => void;

/**
 * The windowing store. One per app. All mutations are pure updates on `state`; the React host renders
 * windows/groups and reports pointer events (drag positions, group bounds) back.
 */
export class WindowManager {
  private _state: WindowState;
  private listeners = new Set<Listener>();
  private seq = 0;
  /** Group bounds in root coordinates, reported by the UI for drop targeting: groupId → [left, top, right, bottom]. */
  readonly groupBounds = new Map<string, [number, number, number, number]>();
  windowDefaults: (type: WindowType) => WindowSettings = () => defaultSettings();
  /** From the active behaviour theme (`windows` group); the runtime sets it on every swap. */
  placement: WindowPlacementRules = { ...DEFAULT_WINDOW_PLACEMENT };
  /** The viewport the UI reports (for `center` stacking and keeping windows on screen); null = unknown. */
  viewport: { width: number; height: number } | null = null;
  /** Last position per remember-key (title or origin) for `stack: remember`. */
  private readonly remembered = new Map<string, { x: number; y: number }>();
  setPlacement(rules: Partial<WindowPlacementRules>) { this.placement = { ...DEFAULT_WINDOW_PLACEMENT, ...rules }; }
  private rememberKey(w: WindowSpec) { return w.origin ?? w.title; }

  constructor(readonly mainWindowId = 'main') {
    this._state = { windows: [this.spec(mainWindowId, 'main', 'Main', { toolbarEnabled: false, closable: false })], groups: {}, layouts: {}, focused: mainWindowId, drag: null };
  }
  get state() { return this._state; }
  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private set(f: (s: WindowState) => WindowState) { const n = f(this._state); if (n !== this._state) { this._state = n; this.listeners.forEach((l) => l(n)); } }
  private nextId(prefix: string) { return `${prefix}-${++this.seq}-${(Date.now() & 0xffff).toString(36)}`; }
  /** the interface scope new windows are stamped with (the runtime sets it on `enterScope`) */
  scopeHint = '';
  private spec(id: string, type: WindowType, title: string, o: Partial<WindowSpec> = {}): WindowSpec {
    return { id, type, title, scope: this.scopeHint, toolbarsAllowed: true, toolbarEnabled: type !== 'main', origin: null, settings: this.windowDefaults(type), x: 40, y: 80, width: 360, height: 420, minimized: null, minimizedAtX: 0, minimizedAtY: 0, closable: true, z: 0, mode: 'tree', ...o };
  }
  private topZ(s: WindowState) { return Math.max(0, ...s.windows.map((w) => w.z)) + 1; }

  /* ---------- groups & tabs ---------- */

  /** Opens tabs in a new group inside `windowId` (main by default). If the window has a layout, the new group is added as a horizontal split. */
  openGroup(tabs: TabSpec[], windowId = this.mainWindowId): string {
    const gid = this.nextId('group');
    this.set((s) => {
      const cur = s.layouts[windowId];
      const layout: Pane = cur ? { kind: 'split', vertical: false, children: [cur, { kind: 'leaf', groupId: gid }], weights: [1, 1] } : { kind: 'leaf', groupId: gid };
      return { ...s, groups: { ...s.groups, [gid]: { id: gid, tabs, active: 0, windowId } }, layouts: { ...s.layouts, [windowId]: layout } };
    });
    return gid;
  }

  /** Opens the tabs in a brand-new floating window (what Compare does). */
  openFloating(tabs: TabSpec[], title: string, type: WindowType = 'floating', width = 380, height = 460, x?: number, y?: number, opts: Partial<Pick<WindowSpec, 'frame' | 'minWidth' | 'minHeight' | 'toolbarsAllowed'>> = {}): string {
    const wid = this.nextId('win');
    const count = this._state.windows.filter(isFloating).length;
    const at = placeNewWindow(this.placement, count, { width, height }, this.viewport, this.remembered.get(title) ?? null);
    this.set((s) => ({ ...s, windows: [...s.windows, this.spec(wid, type, title, { toolbarEnabled: type !== 'element', ...opts, x: x ?? at.x, y: y ?? at.y, width, height, z: this.topZ(s) })], focused: wid }));
    this.openGroup(tabs, wid);
    return wid;
  }

  activate(groupId: string, index: number) { this.set((s) => { const g = s.groups[groupId]; if (!g) return s; return { ...s, groups: { ...s.groups, [groupId]: { ...g, active: Math.max(0, Math.min(index, g.tabs.length - 1)) } } }; }); }

  closeTab(tabId: string) {
    this.set((s) => {
      const g = Object.values(s.groups).find((gr) => gr.tabs.some((t) => t.id === tabId)); if (!g) return s;
      const tabs = g.tabs.filter((t) => t.id !== tabId);
      return tabs.length === 0 ? this.removeGroup(s, g.id) : { ...s, groups: { ...s.groups, [g.id]: { ...g, tabs, active: Math.min(g.active, tabs.length - 1) } } };
    });
  }

  private removeGroup(s: WindowState, groupId: string, keepGroup = false): WindowState {
    const g = s.groups[groupId]; if (!g) return s;
    const cur = s.layouts[g.windowId];
    const layout = cur ? paneRemove(cur, groupId) : null;
    const groups = { ...s.groups }; if (!keepGroup) delete groups[groupId];
    const layouts = { ...s.layouts }; if (layout) layouts[g.windowId] = layout; else delete layouts[g.windowId];
    let out: WindowState = { ...s, groups, layouts };
    const w = out.windows.find((x) => x.id === g.windowId);
    if (!layout && w && isFloating(w)) out = { ...out, windows: out.windows.filter((x) => x.id !== w.id), focused: this.mainWindowId };
    return out;
  }

  /** Add a tab to an existing group at `index` (-1 = end) and make it active (a terminal's "+" button). */
  addTab(groupId: string, tab: TabSpec, index = -1) {
    this.set((s) => {
      const g = s.groups[groupId]; if (!g || g.tabs.some((t) => t.id === tab.id)) return s;
      const tabs = [...g.tabs]; tabs.splice(index < 0 ? tabs.length : Math.max(0, Math.min(index, tabs.length)), 0, tab);
      return { ...s, groups: { ...s.groups, [groupId]: { ...g, tabs, active: tabs.indexOf(tab) } } };
    });
  }

  /** Rename a tab wherever it is. */
  renameTab(tabId: string, title: string) {
    this.set((s) => {
      const g = Object.values(s.groups).find((gr) => gr.tabs.some((t) => t.id === tabId)); if (!g) return s;
      return { ...s, groups: { ...s.groups, [g.id]: { ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) } } };
    });
  }

  /** The group a tab is in (null when it's gone). */
  groupOf(tabId: string): string | null {
    return Object.values(this._state.groups).find((g) => g.tabs.some((t) => t.id === tabId))?.id ?? null;
  }

  /** Move a tab to another group (any window) at `index` (-1 = end). Empty source groups disappear; an emptied floating window closes. */
  moveTab(tabId: string, toGroup: string, index = -1) {
    this.set((s) => {
      const from = Object.values(s.groups).find((gr) => gr.tabs.some((t) => t.id === tabId)); if (!from) return s;
      const tab = from.tabs.find((t) => t.id === tabId)!;
      if (from.id === toGroup) {
        const list = from.tabs.filter((t) => t !== tab); list.splice(index < 0 ? list.length : Math.max(0, Math.min(index, list.length)), 0, tab);
        return { ...s, groups: { ...s.groups, [from.id]: { ...from, tabs: list, active: list.indexOf(tab) } } };
      }
      const target = s.groups[toGroup]; if (!target) return s;
      const remaining = from.tabs.filter((t) => t !== tab);
      const tList = [...target.tabs]; tList.splice(index < 0 ? tList.length : Math.max(0, Math.min(index, tList.length)), 0, tab);
      let out: WindowState = { ...s, groups: { ...s.groups, [toGroup]: { ...target, tabs: tList, active: tList.indexOf(tab) }, [from.id]: { ...from, tabs: remaining, active: Math.min(from.active, Math.max(0, remaining.length - 1)) } } };
      if (remaining.length === 0) out = this.removeGroup(out, from.id);
      return out;
    });
  }

  /** Drop at root coordinates: the group whose reported bounds contain the point receives the tab. */
  dropAt(tabId: string, x: number, y: number): boolean {
    for (const [gid, b] of this.groupBounds) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) { this.moveTab(tabId, gid); return true; }
    return false;
  }
  dragStart(tabId: string, fromGroup: string, x: number, y: number) { this.set((s) => ({ ...s, drag: { tabId, fromGroup, x, y } })); }
  dragMove(x: number, y: number) { this.set((s) => (s.drag ? { ...s, drag: { ...s.drag, x, y } } : s)); }
  dragEnd(): boolean { const d = this._state.drag; if (!d) return false; this.set((s) => ({ ...s, drag: null })); return this.dropAt(d.tabId, d.x, d.y); }

  /* ---------- split ---------- */

  /** Split a group: its tabs are divided evenly across the new groups (5 tabs split in two → 3 + 2); GRID uses rows × cols. */
  split(groupId: string, mode: SplitMode, rows = 2, cols = 2) {
    this.set((s) => {
      const g = s.groups[groupId]; if (!g) return s;
      const n = mode === 'four' ? 4 : mode === 'grid' ? Math.max(1, rows * cols) : 2;
      const parts = distribute(g.tabs, n);
      const ids = parts.map((_, i) => (i === 0 ? groupId : this.nextId('group')));
      const groups = { ...s.groups };
      parts.forEach((tabs, i) => { const id = ids[i] ?? groupId; groups[id] = { id, tabs, active: 0, windowId: g.windowId }; });
      const leaves: Pane[] = ids.map((id) => ({ kind: 'leaf', groupId: id }));
      const pane: Pane = mode === 'vertical' ? { kind: 'split', vertical: true, children: leaves, weights: ids.map(() => 1) }
        : mode === 'horizontal' ? { kind: 'split', vertical: false, children: leaves, weights: ids.map(() => 1) }
        : mode === 'four' ? { kind: 'grid', rows: 2, cols: 2, cells: leaves } : { kind: 'grid', rows, cols, cells: leaves };
      const cur = s.layouts[g.windowId];
      return { ...s, groups, layouts: { ...s.layouts, [g.windowId]: cur ? paneReplace(cur, groupId, pane) : pane } };
    });
  }

  /* ---------- undock / dock ---------- */

  /** Undock a tab group into a new floating window of type DOCK (toolbar forced on). */
  undock(groupId: string, title?: string): string | null {
    const g = this._state.groups[groupId]; if (!g) return null;
    const wid = this.nextId('win');
    this.set((s) => {
      let out = this.removeGroup(s, groupId, true);
      const at = placeNewWindow(this.placement, s.windows.filter(isFloating).length, { width: 360, height: 420 }, this.viewport, this.remembered.get(groupId) ?? null);
      const w = this.spec(wid, 'dock', title ?? activeTab(g)?.title ?? 'Tabs', { toolbarEnabled: true, origin: groupId, x: at.x + 8, y: at.y + 24, z: this.topZ(s) });
      out = { ...out, windows: [...out.windows, w], groups: { ...out.groups, [groupId]: { ...g, windowId: wid } }, layouts: { ...out.layouts, [wid]: { kind: 'leaf', groupId } }, focused: wid };
      return out;
    });
    return wid;
  }

  /** Dock every group of a floating window back into the main window (as horizontal splits). */
  redock(windowId: string) {
    this.set((s) => {
      const w = s.windows.find((x) => x.id === windowId); if (!w || !isFloating(w)) return s;
      const gids = s.layouts[windowId] ? paneGroups(s.layouts[windowId]) : [];
      const groups = { ...s.groups }; let layout: Pane | undefined = s.layouts[this.mainWindowId];
      for (const gid of gids) { const g = groups[gid]; if (!g) continue; groups[gid] = { ...g, windowId: this.mainWindowId }; layout = layout ? { kind: 'split', vertical: false, children: [layout, { kind: 'leaf', groupId: gid }], weights: [1, 1] } : { kind: 'leaf', groupId: gid }; }
      const layouts = { ...s.layouts }; delete layouts[windowId]; if (layout) layouts[this.mainWindowId] = layout;
      return { ...s, windows: s.windows.filter((x) => x.id !== windowId), groups, layouts, focused: this.mainWindowId };
    });
  }

  close(windowId: string) {
    this.set((s) => { const gids = new Set(s.layouts[windowId] ? paneGroups(s.layouts[windowId]) : []); const groups = { ...s.groups }; gids.forEach((g) => delete groups[g]); const layouts = { ...s.layouts }; delete layouts[windowId]; return { ...s, windows: s.windows.filter((x) => x.id !== windowId), groups, layouts, focused: this.mainWindowId }; });
  }
  focus(windowId: string) { this.set((s) => { const top = this.topZ(s); return { ...s, windows: s.windows.map((w) => (w.id === windowId ? { ...w, z: top } : w)), focused: windowId }; }); }
  move(windowId: string, dx: number, dy: number) { this.update(windowId, (w) => this.remember({ ...w, x: w.x + dx, y: w.y + dy })); }
  moveTo(windowId: string, x: number, y: number) { this.update(windowId, (w) => this.remember({ ...w, x, y })); }
  /** Called when a drag ends: applies the preview (zone / split), the no-overlap rule and the grid, then remembers where it is. */
  settle(windowId: string) {
    const prev = this._state.preview ?? null; this.splitArm = null;
    this.set((s) => {
      let windows = s.windows;
      const w = windows.find((x) => x.id === windowId); if (!w) return { ...s, preview: null };
      if (prev?.kind === 'zone') windows = windows.map((x) => (x.id === windowId ? { ...x, ...prev.rect, maximized: prev.zone === 'top' ? true : false, restore: prev.zone === 'top' ? rectOf(w) : null } : x));
      else if (prev?.kind === 'split' && prev.target && prev.targetRect) windows = windows.map((x) => (x.id === windowId ? { ...x, ...prev.rect, maximized: false, restore: null } : x.id === prev.target ? { ...x, ...prev.targetRect, maximized: false, restore: null } : x));
      else if (this.snapRules.noOverlap) {
        const others = windows.filter((x) => x.id !== windowId && isFloating(x) && !x.minimized).map(rectOf);
        windows = windows.map((x) => (x.id === windowId ? { ...x, ...resolveOverlap(rectOf(x), others) } : x));
      }
      windows = windows.map((x) => (x.id === windowId && !isMaximized(x) ? this.remember({ ...x, x: snapCoord(x.x, this.placement), y: snapCoord(x.y, this.placement) }) : x));
      return { ...s, windows, preview: null };
    });
  }

  /* ---------- snapping while dragging (s18) ---------- */

  snapRules: SnapRules = { ...DEFAULT_SNAP_RULES };
  setSnapRules(rules: Partial<SnapRules>) { this.snapRules = { ...DEFAULT_SNAP_RULES, ...rules }; }
  private splitArm: SplitArm | null = null;
  /** The other floating windows a drag can snap to or drop on (visible, not the one moving), with ids. */
  private dragTargets(windowId: string) { return this._state.windows.filter((x) => x.id !== windowId && isFloating(x) && !x.minimized).map((x) => ({ ...rectOf(x), z: x.z, id: x.id })); }
  /**
   * One step of a title-bar drag: `x`, `y` = where the window would be unsnapped (pointer minus grab offset), (px, py)
   * = the pointer, `now` = the clock for the split dwell. Pulls the rect onto screen and window edges, and previews a
   * half / quarter zone when the pointer is at a viewport edge, or a split when it has rested over another window.
   * Returns the preview (null = none). The window itself follows the snapped rect.
   */
  dragTo(windowId: string, x: number, y: number, px: number, py: number, now = Date.now()): DragPreview | null {
    const w = this._state.windows.find((v) => v.id === windowId); if (!w) return null;
    const rules = this.snapRules; const others = this.dragTargets(windowId);
    const snapped = snapRect({ x, y, width: w.width, height: w.height }, this.viewport, others, rules).rect;
    let preview: DragPreview | null = null;
    const zone = rules.zones && this.viewport ? snapZoneAt(px, py, this.viewport, rules.zoneMargin) : null;
    if (zone) { preview = { kind: 'zone', zone, rect: snapZoneRect(zone, this.workArea ?? maximizedRect(this.viewport!)) }; this.splitArm = null; }
    else if (rules.split) {
      const i = topmostAt(others, px, py); const target = i >= 0 ? others[i]! : null;
      this.splitArm = armSplit(this.splitArm, target?.id ?? null, now, rules.splitDwellMs);
      if (target && this.splitArm.armed) { const d = splitDrop(target, px, py); preview = { kind: 'split', rect: d.dropped, target: target.id, side: d.side, targetRect: d.target }; }
    }
    this.set((s) => ({ ...s, windows: s.windows.map((v) => (v.id === windowId ? { ...v, x: snapped.x, y: snapped.y } : v)), preview }));
    return preview;
  }
  /** Drop the dragged window straight into a zone (keyboard / menu: Win+Left, etc.). */
  snapTo(windowId: string, zone: SnapZone) {
    const area = this.workArea ?? maximizedRect(this.vp());
    this.update(windowId, (w) => (zone === 'top' ? maximizeWindow(w, this.vp(), this.workArea) : this.remember({ ...w, ...snapZoneRect(zone, area), maximized: false, restore: null })));
  }
  /** Split `targetId` with `windowId` dropped on it at (px, py): the dropped window takes the nearer half. */
  splitOnto(windowId: string, targetId: string, px: number, py: number): SplitDrop | null {
    const t = this._state.windows.find((v) => v.id === targetId); if (!t || windowId === targetId) return null;
    const d = splitDrop(rectOf(t), px, py);
    this.set((s) => ({ ...s, windows: s.windows.map((v) => (v.id === windowId ? this.remember({ ...v, ...d.dropped, maximized: false, restore: null }) : v.id === targetId ? { ...v, ...d.target, maximized: false, restore: null } : v)) }));
    return d;
  }
  resize(windowId: string, width: number, height: number) { this.update(windowId, (w) => { const l = limitsOf(w); return { ...w, width: Math.max(l.minWidth, snapCoord(width, this.placement)), height: Math.max(l.minHeight, snapCoord(height, this.placement)), maximized: false, restore: null }; }); }
  /** Resize from any of the 8 handles: `start` is the rect when the drag began, (dx, dy) the pointer travel since. Leaves maximized. */
  resizeFrom(windowId: string, edge: ResizeEdge, start: Rect, dx: number, dy: number) { this.update(windowId, (w) => ({ ...w, ...resizeRect(start, edge, dx, dy, limitsOf(w)), maximized: false, restore: null })); }
  /** Set a window's own size floor (null = back to WINDOW_MIN); the current size grows to meet it. */
  setMinSize(windowId: string, minWidth: number | null, minHeight: number | null) {
    this.update(windowId, (w) => { const n = { ...w, minWidth: minWidth ?? undefined, minHeight: minHeight ?? undefined }; const l = limitsOf(n); return { ...n, width: Math.max(l.minWidth, w.width), height: Math.max(l.minHeight, w.height) }; });
  }
  /** Who draws the title bar (frameless content gets the frame hooks). */
  setFrame(windowId: string, frame: WindowFrame) { this.update(windowId, (w) => ({ ...w, frame })); }

  /* ---------- maximize / restore ---------- */

  /** The area a maximized window fills; null = the whole viewport. The UI sets it when fixed chrome (a banner) should stay visible. */
  workArea: Rect | null = null;
  private vp() { return this.viewport ?? { width: 1280, height: 800 }; }
  maximize(windowId: string) { this.update(windowId, (w) => maximizeWindow(w, this.vp(), this.workArea)); this.focus(windowId); }
  /** Back from maximized to the remembered rect. */
  unmaximize(windowId: string) { this.update(windowId, (w) => this.remember(restoreWindow(w))); }
  toggleMaximize(windowId: string) { const w = this._state.windows.find((x) => x.id === windowId); if (!w) return; if (isMaximized(w)) this.unmaximize(windowId); else this.maximize(windowId); }
  /** A title-bar drag that starts on a maximized window: restore it under the pointer first (Windows behaviour). Returns the restored rect. */
  dragRestore(windowId: string, pointerX: number, pointerY: number, grabOffsetY = 0): Rect | null {
    const w = this._state.windows.find((x) => x.id === windowId); if (!w || !isMaximized(w)) return null;
    const r = dragRestore(w, pointerX, pointerY, grabOffsetY);
    this.update(windowId, () => r);
    return rectOf(r);
  }
  private remember(w: WindowSpec): WindowSpec { this.remembered.set(this.rememberKey(w), { x: w.x, y: w.y }); return w; }
  setSettings(windowId: string, settings: WindowSettings) { this.update(windowId, (w) => ({ ...w, settings })); }
  setMode(windowId: string, mode: string) { this.update(windowId, (w) => ({ ...w, mode })); }
  setToolbar(windowId: string, enabled: boolean) { this.update(windowId, (w) => (!w.toolbarsAllowed ? w : { ...w, toolbarEnabled: enabled || forcesToolbar(w) })); }

  /* ---------- minimize ---------- */

  /** Can windows minimize at all under the current rules? (`minimize: none` hides the buttons.) */
  get canMinimize() { return this.placement.minimize !== 'none'; }
  minimize(windowId: string, target: MinimizeTarget, atX = 0, atY = 0) { const t = minimizeTargetFor(this.placement, target); if (!t) return; this.update(windowId, (w) => ({ ...w, minimized: t, minimizedAtX: atX, minimizedAtY: atY })); }
  restore(windowId: string) { this.update(windowId, (w) => ({ ...w, minimized: null })); this.focus(windowId); }
  /** "Minimize to title bar at screen location which cycles through all corners": each call moves the window's corner on. */
  minimizeToNextCorner(windowId: string) { if (!this.canMinimize) return; this.update(windowId, (w) => ({ ...w, minimized: 'corner-titlebar', settings: { ...w.settings, corner: w.minimized === 'corner-titlebar' ? nextCorner(w.settings.corner) : w.settings.corner } })); }
  minimizedAt(corner: Corner) { return this._state.windows.filter((w) => w.minimized === 'corner-titlebar' && w.settings.corner === corner); }

  private update(windowId: string, f: (w: WindowSpec) => WindowSpec) { this.set((s) => ({ ...s, windows: s.windows.map((w) => (w.id === windowId ? f(w) : w)) })); }

  /* ---------- menus ---------- */

  /** Context-menu items for the `tab-group` target (payload = group id) with the Split submenu. */
  groupMenu(): MenuEntry[] {
    return [
      { id: 'undock', label: 'Undock to floating window', icon: 'external', action: 'windows.undock:{payload}' },
      { id: 'split', label: 'Split', icon: 'grid', items: [
        { id: 'split-v', label: 'Vertical', icon: 'layout', action: 'windows.split:{payload}:vertical' },
        { id: 'split-h', label: 'Horizontal', icon: 'layout', action: 'windows.split:{payload}:horizontal' },
        { id: 'split-4', label: 'Four-way', icon: 'grid', action: 'windows.split:{payload}:four' },
        { id: 'split-grid', label: 'Custom grid…', icon: 'grid', action: 'dialog:split-grid:{payload}' },
      ] },
      { id: 's1', separator: true },
      { id: 'close-group', label: 'Close group', icon: 'x', action: 'windows.closeGroup:{payload}' },
    ];
  }
  /** Context-menu items for the `window-title` target (payload = window id). */
  windowMenu(): MenuEntry[] {
    return [
      { id: 'settings', label: 'Window settings…', icon: 'settings', action: 'dialog:window-settings:{payload}' },
      { id: 'redock', label: 'Redock', icon: 'download', action: 'windows.redock:{payload}' },
      { id: 'maximize', label: 'Maximize / restore', icon: 'maximize', action: 'windows.maximize:{payload}' },
      { id: 'snap', label: 'Snap', icon: 'layout', items: [
        { id: 'snap-left', label: 'Left half', icon: 'layout', action: 'windows.snap:{payload}:left' },
        { id: 'snap-right', label: 'Right half', icon: 'layout', action: 'windows.snap:{payload}:right' },
        { id: 'snap-tl', label: 'Top-left quarter', icon: 'grid', action: 'windows.snap:{payload}:top-left' },
        { id: 'snap-tr', label: 'Top-right quarter', icon: 'grid', action: 'windows.snap:{payload}:top-right' },
        { id: 'snap-bl', label: 'Bottom-left quarter', icon: 'grid', action: 'windows.snap:{payload}:bottom-left' },
        { id: 'snap-br', label: 'Bottom-right quarter', icon: 'grid', action: 'windows.snap:{payload}:bottom-right' },
      ] },
      { id: 'min-corner', label: 'Minimize to title bar (cycle corners)', icon: 'minus', action: 'windows.minimizeCorner:{payload}' },
      { id: 'min-toolbar', label: 'Minimize to floating toolbar at cursor', icon: 'minus', action: 'windows.minimizeToolbar:{payload}' },
      { id: 's1', separator: true },
      { id: 'close', label: 'Close', icon: 'x', action: 'windows.close:{payload}' },
    ];
  }
  closeGroup(groupId: string) { this.set((s) => this.removeGroup(s, groupId)); }
}
