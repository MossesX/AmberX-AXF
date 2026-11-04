/*
 * Dock engine (dock@1) — IDE-style pane trees on top of the window engine's Pane / TabGroup (windows.ts).
 *
 * Pure state + rules, shared by every host that docks tabs (MD Studio, xLayout's IDE mode, the Theme Editor):
 *   - a split tree (horizontal / vertical, nested, weighted) with a pane limit;
 *   - drop zones while a tab is dragged: any tab header (insert at a position), a pane's centre (join as a tab),
 *     a pane's edges (split that pane) and the host's outer edges (split the whole tree);
 *   - undock a pane to a floating window and re-dock it into a zone;
 *   - splitter resize with a weight floor;
 *   - serialize / restore (dock@1 snapshot: JSON only, checked on the way back in);
 *   - layout presets (dock-layout@1 assets): a tree of numbered panes, applied by distributing the open tabs over it,
 *     drawn as a preview thumbnail (rects, or an SVG that reads only theme tokens).
 *
 * The React host (framework/react/windows/DockHost.tsx) renders it; the Kotlin twin (DockEngine.kt) is deferred
 * (spec/PORTING.md) and replays spec/fixtures/dock.json.
 */
import { distribute, paneGroups, paneRemove, type Pane, type Rect, type TabGroup, type TabSpec } from './windows';

export const DOCK_CONTRACT = 'dock@1';

export type DockSide = 'left' | 'right' | 'top' | 'bottom';
/** Where a dragged tab is over a pane: its header (a position among the tabs), its centre (join), or an edge (split). */
export type DockZone = DockSide | 'centre' | 'header';
export const DOCK_SIDES: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];
export const DOCK_ZONES: readonly DockZone[] = ['header', 'centre', 'left', 'right', 'top', 'bottom'];
export const isDockSide = (z: unknown): z is DockSide => (DOCK_SIDES as readonly unknown[]).includes(z);
/** A top / bottom split stacks (vertical), a left / right split sits side by side. */
export const sideIsVertical = (s: DockSide) => s === 'top' || s === 'bottom';
/** The new pane goes before the existing one on the left / top. */
export const sideIsBefore = (s: DockSide) => s === 'left' || s === 'top';

/**
 * Rules every dock host honours. `paneLimit` = most leaves a tree may have (a drop that would exceed it joins the
 * target pane as a tab instead); `minWeight` = smallest share of a split one child may take; `headerBand` = px from a
 * pane's top that count as its header when the UI reports no header height; `edgeBand` = px inside the host's outer
 * edges that split the whole tree; `centreFraction` = the share of a pane's body (each axis) that is the centre zone;
 * `splitRatio` = the share a new pane takes of the pane it splits; `rootRatio` = the share it takes of the whole tree.
 */
export interface DockRules {
  paneLimit: number; minWeight: number; headerBand: number; edgeBand: number; centreFraction: number; splitRatio: number; rootRatio: number;
  /** a tab let go outside every dock pops out to a floating window (molly-multi-instance-tabs: any UI can be dragged out) */
  floatOut: boolean;
  /** a floating window held over a dock's zone docks its tabs there on release (and so comes back) */
  windowDocks: boolean;
}
export const DEFAULT_DOCK_RULES: DockRules = { paneLimit: 6, minWeight: 0.1, headerBand: 36, edgeBand: 16, centreFraction: 0.5, splitRatio: 0.5, rootRatio: 0.3, floatOut: true, windowDocks: true };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Rules with every field present, clamped to sane ranges (a partial object, or nothing, = the defaults). */
export function normalizeDockRules(raw: Partial<DockRules> | null | undefined): DockRules {
  const r = raw ?? {};
  const limit = Math.max(1, Math.min(64, Math.floor(num(r.paneLimit, DEFAULT_DOCK_RULES.paneLimit))));
  return {
    paneLimit: limit,
    minWeight: Math.min(0.45, Math.max(0.02, num(r.minWeight, DEFAULT_DOCK_RULES.minWeight))),
    headerBand: Math.max(0, Math.round(num(r.headerBand, DEFAULT_DOCK_RULES.headerBand))),
    edgeBand: Math.max(0, Math.round(num(r.edgeBand, DEFAULT_DOCK_RULES.edgeBand))),
    centreFraction: Math.min(0.9, Math.max(0.1, num(r.centreFraction, DEFAULT_DOCK_RULES.centreFraction))),
    splitRatio: Math.min(0.9, Math.max(0.1, num(r.splitRatio, DEFAULT_DOCK_RULES.splitRatio))),
    rootRatio: Math.min(0.9, Math.max(0.1, num(r.rootRatio, DEFAULT_DOCK_RULES.rootRatio))),
    floatOut: bool(r.floatOut, DEFAULT_DOCK_RULES.floatOut),
    windowDocks: bool(r.windowDocks, DEFAULT_DOCK_RULES.windowDocks),
  };
}

/* ---------- history (undo): the dock before each change ---------- */

/** How many layout changes a window remembers for undo. */
export const DOCK_HISTORY_MAX = 20;
/** `history` with `snap` added last: a snapshot equal to the last one is not added twice; the oldest go past `max`. Pure. */
export function pushHistory(history: readonly DockSnapshot[], snap: DockSnapshot, max = DOCK_HISTORY_MAX): DockSnapshot[] {
  const last = history[history.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return [...history];
  const out = [...history, snap];
  return out.length > Math.max(1, max) ? out.slice(out.length - Math.max(1, max)) : out;
}

/* ---------- tree shape ---------- */

/** Path to a node: the child / cell index at each level from the root ([] = the root). */
export type PanePath = number[];

export const countPanes = (tree: Pane | null | undefined): number => (tree ? paneGroups(tree).length : 0);

/** The node at `path`, or null when the path leaves the tree. */
export function paneAt(tree: Pane, path: PanePath): Pane | null {
  let cur: Pane = tree;
  for (const i of path) {
    const kids = cur.kind === 'split' ? cur.children : cur.kind === 'grid' ? cur.cells : null;
    const next = kids?.[i];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** The tree with the node at `path` replaced (an unreachable path = the tree unchanged). */
export function paneSet(tree: Pane, path: PanePath, node: Pane): Pane {
  if (path.length === 0) return node;
  const [i, ...rest] = path as [number, ...number[]];
  if (tree.kind === 'split') { const c = tree.children[i]; return c ? { ...tree, children: tree.children.map((k, j) => (j === i ? paneSet(c, rest, node) : k)) } : tree; }
  if (tree.kind === 'grid') { const c = tree.cells[i]; return c ? { ...tree, cells: tree.cells.map((k, j) => (j === i ? paneSet(c, rest, node) : k)) } : tree; }
  return tree;
}

/** The path of a group's leaf, or null. */
export function pathOf(tree: Pane, groupId: string, prefix: PanePath = []): PanePath | null {
  if (tree.kind === 'leaf') return tree.groupId === groupId ? prefix : null;
  const kids = tree.kind === 'split' ? tree.children : tree.cells;
  for (let i = 0; i < kids.length; i++) { const p = pathOf(kids[i]!, groupId, [...prefix, i]); if (p) return p; }
  return null;
}

/**
 * Weights as shares of 1 with a floor: every child gets at least `min`; when the floor can't be met for all (too many
 * children) they share equally. Non-finite / negative weights count as 1.
 */
export function clampWeights(weights: readonly number[], n: number, min = DEFAULT_DOCK_RULES.minWeight): number[] {
  if (n <= 0) return [];
  const w = Array.from({ length: n }, (_, i) => { const v = weights[i]; return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1; });
  if (n * min >= 1) return w.map(() => round(1 / n));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  // already shares of 1 above the floor: unchanged (so normalizing twice is the same as once)
  if (Math.abs(total - 1) < 1e-6 && w.every((v) => v >= min - 1e-9)) return w.map(round);
  let shares = w.map((v) => v / total);
  // lift the small ones to the floor and take the difference from the others, in proportion, until none is under
  for (let pass = 0; pass < n; pass++) {
    const under = shares.map((s, i) => (s < min ? i : -1)).filter((i) => i >= 0);
    if (!under.length) break;
    const need = under.reduce((a, i) => a + (min - shares[i]!), 0);
    const donors = shares.map((s, i) => (s > min ? i : -1)).filter((i) => i >= 0);
    const pool = donors.reduce((a, i) => a + (shares[i]! - min), 0) || 1;
    shares = shares.map((s, i) => (under.includes(i) ? min : donors.includes(i) ? s - need * ((s - min) / pool) : s));
  }
  return shares.map(round);
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * A tidy tree: splits with one child collapse, a split inside a split of the same orientation is flattened (its
 * children take its share), weights are shares of 1 above the floor, a grid keeps its cells (a grid cell may hold a
 * split). Null stays null.
 */
export function normalizeTree(tree: Pane | null | undefined, min = DEFAULT_DOCK_RULES.minWeight): Pane | null {
  if (!tree) return null;
  if (tree.kind === 'leaf') return tree;
  if (tree.kind === 'grid') {
    const cells = tree.cells.map((c) => normalizeTree(c, min)).filter((c): c is Pane => !!c);
    if (cells.length === 0) return null;
    if (cells.length === 1) return cells[0]!;
    return cells.length === tree.cells.length ? { ...tree, cells } : { kind: 'split', vertical: false, children: cells, weights: clampWeights([], cells.length, min) };
  }
  const children: Pane[] = []; const weights: number[] = [];
  const shares = clampWeights(tree.weights, tree.children.length, min);
  tree.children.forEach((c, i) => {
    const n = normalizeTree(c, min);
    if (!n) return;
    if (n.kind === 'split' && n.vertical === tree.vertical) { n.children.forEach((k, j) => { children.push(k); weights.push(shares[i]! * (n.weights[j] ?? 1 / n.children.length)); }); }
    else { children.push(n); weights.push(shares[i]!); }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return { kind: 'split', vertical: tree.vertical, children, weights: clampWeights(weights, children.length, min) };
}

/* ---------- edits ---------- */

/**
 * Split the pane of `groupId` on `side`, the new leaf `newGroupId` taking `ratio` of it. When the pane already sits in a
 * split of that orientation the new leaf joins that split beside it (no nesting), else the leaf becomes a two-way
 * split. Unknown group = the tree unchanged.
 */
export function splitPane(tree: Pane, groupId: string, side: DockSide, newGroupId: string, ratio = DEFAULT_DOCK_RULES.splitRatio, min = DEFAULT_DOCK_RULES.minWeight): Pane {
  const r = Math.min(0.9, Math.max(0.1, ratio));
  const vertical = sideIsVertical(side), before = sideIsBefore(side);
  const leaf: Pane = { kind: 'leaf', groupId: newGroupId };
  const pair = (old: Pane): Pane => ({ kind: 'split', vertical, children: before ? [leaf, old] : [old, leaf], weights: before ? [r, 1 - r] : [1 - r, r] });
  const walk = (p: Pane): Pane => {
    if (p.kind === 'leaf') return p.groupId === groupId ? pair(p) : p;
    if (p.kind === 'grid') return { ...p, cells: p.cells.map(walk) };
    const i = p.children.findIndex((c) => c.kind === 'leaf' && c.groupId === groupId);
    if (i >= 0 && p.vertical === vertical) {
      const shares = clampWeights(p.weights, p.children.length, min);
      const w = shares[i]!;
      const children = [...p.children]; const weights = [...shares];
      weights[i] = w * (1 - r);
      children.splice(before ? i : i + 1, 0, leaf); weights.splice(before ? i : i + 1, 0, w * r);
      return { ...p, children, weights: clampWeights(weights, children.length, min) };
    }
    return { ...p, children: p.children.map(walk) };
  };
  return pathOf(tree, groupId) ? normalizeTree(walk(tree), min)! : tree;
}

/** Split the whole tree on `side`: the new leaf takes `ratio` of the host (a root split of that orientation gains a child). */
export function splitRoot(tree: Pane | null, side: DockSide, newGroupId: string, ratio = DEFAULT_DOCK_RULES.rootRatio, min = DEFAULT_DOCK_RULES.minWeight): Pane {
  const leaf: Pane = { kind: 'leaf', groupId: newGroupId };
  if (!tree) return leaf;
  const r = Math.min(0.9, Math.max(0.1, ratio));
  const vertical = sideIsVertical(side), before = sideIsBefore(side);
  if (tree.kind === 'split' && tree.vertical === vertical) {
    const shares = clampWeights(tree.weights, tree.children.length, min).map((s) => s * (1 - r));
    return normalizeTree({ ...tree, children: before ? [leaf, ...tree.children] : [...tree.children, leaf], weights: before ? [r, ...shares] : [...shares, r] }, min)!;
  }
  return { kind: 'split', vertical, children: before ? [leaf, tree] : [tree, leaf], weights: before ? [r, 1 - r] : [1 - r, r] };
}

/** The tree without a group's leaf, tidied (null when it was the last). */
export function removePane(tree: Pane | null, groupId: string, min = DEFAULT_DOCK_RULES.minWeight): Pane | null {
  return tree ? normalizeTree(paneRemove(tree, groupId), min) : null;
}

/**
 * Drag the divider after child `index` of the split at `path` by `delta` (a share of the split's whole size, positive
 * = towards the end). Both neighbours keep the floor; other children never move. Not a split, or no such divider = unchanged.
 */
export function resizeSplit(tree: Pane, path: PanePath, index: number, delta: number, min = DEFAULT_DOCK_RULES.minWeight): Pane {
  const node = paneAt(tree, path);
  if (!node || node.kind !== 'split' || index < 0 || index >= node.children.length - 1 || !Number.isFinite(delta)) return tree;
  const w = clampWeights(node.weights, node.children.length, min);
  const a = w[index]!, b = w[index + 1]!;
  const d = Math.max(min - a, Math.min(b - min, delta));
  w[index] = round(a + d); w[index + 1] = round(b - d);
  return paneSet(tree, path, { ...node, weights: w });
}

/* ---------- drop zones ---------- */

export interface GroupBox { groupId: string; rect: Rect; /** header height in px (absent = rules.headerBand) */ header?: number }

/** Where a dragged tab would land: a pane (`groupId`) in a zone, or the whole tree (`root`) on a side. */
export type DockDrop =
  | { target: 'group'; groupId: string; zone: 'header'; index: number }
  | { target: 'group'; groupId: string; zone: 'centre' }
  | { target: 'group'; groupId: string; zone: DockSide }
  | { target: 'root'; zone: DockSide };

/** The zone of a pane a point is in: header band, centre box, or the nearest edge; null outside the pane. */
export function dockZoneAt(box: GroupBox, px: number, py: number, rules: Pick<DockRules, 'headerBand' | 'centreFraction'> = DEFAULT_DOCK_RULES): DockZone | null {
  const r = box.rect;
  if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) return null;
  const header = Math.max(0, Math.min(r.height, box.header ?? rules.headerBand));
  if (py <= r.y + header) return 'header';
  const bodyY = r.y + header, bodyH = Math.max(1, r.height - header);
  const nx = r.width > 0 ? clamp01((px - r.x) / r.width) : 0.5, ny = clamp01((py - bodyY) / bodyH);
  const half = rules.centreFraction / 2;
  if (Math.abs(nx - 0.5) <= half && Math.abs(ny - 0.5) <= half) return 'centre';
  const dx = Math.min(nx, 1 - nx), dy = Math.min(ny, 1 - ny);
  return dx <= dy ? (nx < 0.5 ? 'left' : 'right') : (ny < 0.5 ? 'top' : 'bottom');
}

/** The tab index a point in a header band means: `tabRights` = each tab's right edge (root x) in order; past the last = the end. */
export function headerIndexAt(px: number, tabRights: readonly number[], tabLefts?: readonly number[]): number {
  for (let i = 0; i < tabRights.length; i++) {
    const l = tabLefts?.[i] ?? (i === 0 ? -Infinity : tabRights[i - 1]!);
    const mid = (l === -Infinity ? tabRights[i]! - 1 : (l + tabRights[i]!) / 2);
    if (px < mid) return i;
  }
  return tabRights.length;
}

/**
 * What a point over the host means for a dragged tab: a pane's header band = that strip at the index from `tabRights`
 * (it wins over the edge band); inside the outer `edgeBand` of the host = split the whole tree on that side; else the
 * topmost pane under the point and its zone; null = nothing.
 */
export function dockDropAt(host: Rect, boxes: readonly GroupBox[], px: number, py: number, rules: DockRules = DEFAULT_DOCK_RULES, tabRights?: (groupId: string) => readonly number[] | undefined): DockDrop | null {
  if (px < host.x || px > host.x + host.width || py < host.y || py > host.y + host.height) return null;
  // a pane's tab strip wins over the host's edge band (drag-to-tab, Nov 4 2026): the strip of a pane along the top or
  // left edge lies inside the band, and a tab let go on a strip goes into that strip, at that place
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (dockZoneAt(b, px, py, rules) === 'header') return { target: 'group', groupId: b.groupId, zone: 'header', index: headerIndexAt(px, tabRights?.(b.groupId) ?? []) };
  }
  const e = rules.edgeBand;
  if (e > 0 && boxes.length > 0) {
    const dl = px - host.x, dr = host.x + host.width - px, dt = py - host.y, db = host.y + host.height - py;
    const m = Math.min(dl, dr, dt, db);
    if (m <= e) return { target: 'root', zone: m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'top' : 'bottom' };
  }
  // the last box drawn is on top (hosts report in render order)
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    const zone = dockZoneAt(b, px, py, rules);
    if (!zone) continue;
    if (zone === 'header') return { target: 'group', groupId: b.groupId, zone, index: headerIndexAt(px, tabRights?.(b.groupId) ?? []) };
    if (zone === 'centre') return { target: 'group', groupId: b.groupId, zone };
    return { target: 'group', groupId: b.groupId, zone };
  }
  return null;
}

/** The rect a host highlights for a drop: the pane (join), its header band, the half it would give up, or the host's band. */
export function dockDropRect(drop: DockDrop, host: Rect, box: GroupBox | null, rules: DockRules = DEFAULT_DOCK_RULES): Rect {
  const half = (r: Rect, side: DockSide, ratio: number): Rect => {
    const w = Math.round(r.width * ratio), h = Math.round(r.height * ratio);
    switch (side) {
      case 'left': return { x: r.x, y: r.y, width: w, height: r.height };
      case 'right': return { x: r.x + r.width - w, y: r.y, width: w, height: r.height };
      case 'top': return { x: r.x, y: r.y, width: r.width, height: h };
      default: return { x: r.x, y: r.y + r.height - h, width: r.width, height: h };
    }
  };
  if (drop.target === 'root') return half(host, drop.zone, rules.rootRatio);
  const r = box?.rect ?? host;
  if (drop.zone === 'centre') return { ...r };
  if (drop.zone === 'header') return { x: r.x, y: r.y, width: r.width, height: Math.max(0, Math.min(r.height, box?.header ?? rules.headerBand)) };
  return half(r, drop.zone, rules.splitRatio);
}

/** The preview a host draws while a tab drag is over it. */
export interface DockDropPreview { windowId: string; drop: DockDrop; rect: Rect; /** the drop would exceed the pane limit, so it joins as a tab */ limited: boolean; /** the dock is empty: the tab becomes its first pane */ fill?: boolean }

/* ---------- applying a drop ---------- */

export interface DockState { tree: Pane | null; groups: Record<string, TabGroup> }

const findGroupWithTab = (groups: Record<string, TabGroup>, tabId: string) => Object.values(groups).find((g) => g.tabs.some((t) => t.id === tabId));

/** Would a split drop exceed the limit? (A drop that only moves a tab between existing panes never does.) */
export function dropIsLimited(state: DockState, tabId: string, drop: DockDrop, rules: Pick<DockRules, 'paneLimit'> = DEFAULT_DOCK_RULES): boolean {
  if (drop.zone === 'centre' || drop.zone === 'header') return false;
  const from = findGroupWithTab(state.groups, tabId);
  const panes = countPanes(state.tree) - (from && from.tabs.length === 1 && state.tree && pathOf(state.tree, from.id) ? 1 : 0);
  return panes + 1 > rules.paneLimit;
}

/**
 * Apply a drop: the tab leaves its group (an emptied group's leaf goes), then joins the target (header: at the index;
 * centre: at the end) or opens a new pane `newGroupId` on the side (of the pane or of the whole tree). Over the pane
 * limit a side drop joins the target pane (or the first pane for a root drop) as a tab. Unchanged when the tab, the
 * target or the move makes no sense (a one-tab pane dropped onto its own side).
 */
export function applyDockDrop(state: DockState, tabId: string, drop: DockDrop, newGroupId: string, windowId: string, rules: DockRules = DEFAULT_DOCK_RULES): DockState {
  const from = findGroupWithTab(state.groups, tabId);
  if (!from) return state;
  const tab = from.tabs.find((t) => t.id === tabId)!;
  const targetGroup = drop.target === 'group' ? state.groups[drop.groupId] : undefined;
  if (drop.target === 'group' && !targetGroup) return state;
  if (drop.target === 'group' && drop.groupId === from.id && from.tabs.length === 1 && drop.zone !== 'header') return state;
  const limited = dropIsLimited(state, tabId, drop, rules);
  // 1. take the tab out
  let groups: Record<string, TabGroup> = { ...state.groups };
  let tree = state.tree;
  const remaining = from.tabs.filter((t) => t.id !== tabId);
  if (remaining.length === 0 && !(drop.target === 'group' && drop.groupId === from.id)) {
    delete groups[from.id];
    tree = removePane(tree, from.id, rules.minWeight);
  } else {
    groups[from.id] = { ...from, tabs: remaining, active: Math.max(0, Math.min(from.active, remaining.length - 1)) };
  }
  const join = (gid: string, index: number) => {
    const g = groups[gid] ?? from;
    const tabs = [...g.tabs]; const at = Math.max(0, Math.min(index < 0 ? tabs.length : index, tabs.length)); tabs.splice(at, 0, tab);
    groups[gid] = { ...g, tabs, active: at, windowId: g.windowId };
    if (!tree || !pathOf(tree, gid)) tree = tree ? splitRoot(tree, 'right', gid, rules.rootRatio, rules.minWeight) : { kind: 'leaf', groupId: gid };
  };
  // 2. put it where it goes
  if (drop.target === 'group' && drop.zone === 'header') join(drop.groupId, drop.groupId === from.id && drop.index > from.tabs.indexOf(tab) ? drop.index - 1 : drop.index);
  else if (drop.target === 'group' && drop.zone === 'centre') join(drop.groupId, -1);
  else if (limited) join(drop.target === 'group' ? drop.groupId : (tree ? paneGroups(tree)[0]! : from.id), -1);
  else {
    groups[newGroupId] = { id: newGroupId, tabs: [tab], active: 0, windowId };
    tree = drop.target === 'group' ? splitPane(tree ?? { kind: 'leaf', groupId: drop.groupId }, drop.groupId, drop.zone, newGroupId, rules.splitRatio, rules.minWeight) : splitRoot(tree, drop.zone, newGroupId, rules.rootRatio, rules.minWeight);
  }
  return { tree, groups };
}

/** The id of the stand-in group a new tab is dropped from (never in a tree, never kept). */
export const FRESH_GROUP = '__fresh';

/**
 * Drop a tab that isn't open anywhere yet (drag-to-tab, Nov 4 2026: a nav item dragged into a dock) with the same
 * zones and the same rules as `applyDockDrop`: header = at the index, centre = at the end, a side = a new pane
 * `newGroupId` (joins as a tab past the pane limit). The tab stands in a group of its own that is not in the tree, so
 * nothing else moves. Unchanged when the target is gone or a tab with that id is already open.
 */
export function applyDockDropNew(state: DockState, tab: TabSpec, drop: DockDrop, newGroupId: string, windowId: string, rules: DockRules = DEFAULT_DOCK_RULES): DockState {
  if (findGroupWithTab(state.groups, tab.id)) return state;
  const staged: DockState = { tree: state.tree, groups: { ...state.groups, [FRESH_GROUP]: { id: FRESH_GROUP, tabs: [tab], active: 0, windowId } } };
  const after = applyDockDrop(staged, tab.id, drop, newGroupId, windowId, rules);
  if (after === staged) return state;
  const groups = { ...after.groups }; delete groups[FRESH_GROUP];
  return { tree: after.tree, groups };
}

/**
 * Keep a tree within the pane limit: extra panes (last in reading order first) hand their tabs to the pane before them
 * and their leaves go. Groups not in the tree are left alone.
 */
export function enforcePaneLimit(state: DockState, rules: Pick<DockRules, 'paneLimit' | 'minWeight'> = DEFAULT_DOCK_RULES): DockState {
  let tree = state.tree; const groups = { ...state.groups };
  while (tree && countPanes(tree) > rules.paneLimit) {
    const order = paneGroups(tree);
    const last = order[order.length - 1]!, into = order[order.length - 2]!;
    const g = groups[last], t = groups[into];
    if (t && g) groups[into] = { ...t, tabs: [...t.tabs, ...g.tabs.filter((x) => !t.tabs.some((y) => y.id === x.id))] };
    delete groups[last];
    tree = removePane(tree, last, rules.minWeight);
  }
  return { tree, groups };
}

/* ---------- serialize / restore ---------- */

export interface DockSnapshotGroup { tabs: TabSpec[]; active: number }
export interface DockSnapshot { $axf: typeof DOCK_CONTRACT; tree: Pane | null; groups: Record<string, DockSnapshotGroup> }

/** A JSON-safe picture of one window's dock: the tree and each group's tabs (ids, kinds, payloads, titles). */
export function serializeDock(state: DockState, tree: Pane | null = state.tree): DockSnapshot {
  const ids = tree ? paneGroups(tree) : [];
  const groups: Record<string, DockSnapshotGroup> = {};
  for (const id of ids) { const g = state.groups[id]; if (g) groups[id] = { tabs: g.tabs.map(cleanTab), active: g.active }; }
  return { $axf: DOCK_CONTRACT, tree: tree ? stripTree(tree) : null, groups };
}
const cleanTab = (t: TabSpec): TabSpec => { const o: TabSpec = { id: t.id, title: t.title, kind: t.kind }; if (t.payload !== undefined) o.payload = t.payload; if (t.icon) o.icon = t.icon; if (t.closable === false) o.closable = false; if (typeof t.instance === 'number' && Number.isInteger(t.instance) && t.instance >= 2) o.instance = t.instance; return o; };
const stripTree = (p: Pane): Pane => p.kind === 'leaf' ? { kind: 'leaf', groupId: p.groupId } : p.kind === 'split' ? { kind: 'split', vertical: p.vertical, children: p.children.map(stripTree), weights: [...p.weights] } : { kind: 'grid', rows: p.rows, cols: p.cols, cells: p.cells.map(stripTree) };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** A tab as stored, checked (id + kind required, bad fields dropped), or null. */
export function parseTab(raw: unknown): TabSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 120), kind = str(o.kind, 64);
  if (!id || !ID.test(id) || !kind || !ID.test(kind)) return null;
  const t: TabSpec = { id, title: str(o.title, 200) || id, kind };
  const payload = str(o.payload, 4000); if (payload !== undefined) t.payload = payload;
  const icon = str(o.icon, 40); if (icon && /^[a-z0-9][a-z0-9-]{0,39}$/.test(icon)) t.icon = icon;
  if (o.closable === false) t.closable = false;
  // which copy of the same thing (multi-instance tabs): 2.. kept, 1 / junk dropped (= the first)
  if (typeof o.instance === 'number' && Number.isInteger(o.instance) && o.instance >= 2 && o.instance <= 999) t.instance = o.instance;
  return t;
}

/** A tree as stored, checked: leaves must name a known group (`known`), bad nodes are dropped; null when nothing is left. */
export function parseTree(raw: unknown, known: (groupId: string) => boolean, depth = 0): Pane | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 12) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'leaf') return typeof o.groupId === 'string' && known(o.groupId) ? { kind: 'leaf', groupId: o.groupId } : null;
  if (o.kind === 'split' && Array.isArray(o.children)) {
    const kids: Pane[] = []; const weights: number[] = [];
    o.children.slice(0, 32).forEach((c, i) => { const k = parseTree(c, known, depth + 1); if (k) { kids.push(k); weights.push(num(Array.isArray(o.weights) ? o.weights[i] : undefined, 1)); } });
    return kids.length ? { kind: 'split', vertical: o.vertical === true, children: kids, weights } : null;
  }
  if (o.kind === 'grid' && Array.isArray(o.cells)) {
    const cells = o.cells.slice(0, 36).map((c) => parseTree(c, known, depth + 1)).filter((c): c is Pane => !!c);
    const rows = Math.max(1, Math.min(6, Math.floor(num(o.rows, 1)))), cols = Math.max(1, Math.min(6, Math.floor(num(o.cols, 1))));
    if (!cells.length) return null;
    return cells.length === rows * cols ? { kind: 'grid', rows, cols, cells } : { kind: 'split', vertical: false, children: cells, weights: cells.map(() => 1) };
  }
  return null;
}

/**
 * A snapshot back into a dock state for `windowId`: groups with no valid tabs go, tab ids are unique across the dock
 * (a repeat keeps its first place), leaves of unknown groups go, groups not in the tree are appended as root splits,
 * weights are tidied, the pane limit is enforced. Null when there is nothing to restore (or it isn't a dock@1).
 */
export function restoreDock(raw: unknown, windowId: string, rules: DockRules = DEFAULT_DOCK_RULES): DockState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.$axf !== DOCK_CONTRACT || !o.groups || typeof o.groups !== 'object' || Array.isArray(o.groups)) return null;
  const groups: Record<string, TabGroup> = {};
  const seen = new Set<string>();
  for (const [id, g] of Object.entries(o.groups as Record<string, unknown>)) {
    if (!ID.test(id) || !g || typeof g !== 'object' || Array.isArray(g)) continue;
    const gg = g as Record<string, unknown>;
    const tabs = (Array.isArray(gg.tabs) ? gg.tabs : []).map(parseTab).filter((t): t is TabSpec => !!t && !seen.has(t.id));
    tabs.forEach((t) => seen.add(t.id));
    if (!tabs.length) continue;
    groups[id] = { id, tabs, active: Math.max(0, Math.min(tabs.length - 1, Math.floor(num(gg.active, 0)))), windowId };
  }
  if (!Object.keys(groups).length) return null;
  let tree = normalizeTree(parseTree(o.tree, (gid) => !!groups[gid]), rules.minWeight);
  const placed = new Set(tree ? paneGroups(tree) : []);
  for (const id of Object.keys(groups)) if (!placed.has(id)) { tree = splitRoot(tree, 'right', id, rules.rootRatio, rules.minWeight); placed.add(id); }
  return enforcePaneLimit({ tree, groups }, rules);
}

/* ---------- layout presets (dock-layout@1 assets) ---------- */

/** A preset tree: leaves are pane numbers (1-based, each once), splits are weighted like the live tree. */
export type PresetPane = { kind: 'leaf'; pane: number } | { kind: 'split'; vertical: boolean; children: PresetPane[]; weights: number[] };
export interface DockLayoutData {
  /** how many panes the preset has (= the leaves of `tree`) */
  panes: number;
  tree: PresetPane;
  /** short use hint for pickers (`Editor with a terminal below`) */
  hint?: string;
  /** the pane a new tab opens in when none is picked (1-based; default 1) */
  main?: number;
}
export const DOCK_LAYOUT_MAX_PANES = 12;

const presetLeaves = (p: PresetPane): number[] => (p.kind === 'leaf' ? [p.pane] : p.children.flatMap(presetLeaves));

/** A preset tree as written, checked: pane numbers 1..n each once, 1..12 panes, splits need 2+ children; null when it isn't one. */
export function parsePresetTree(raw: unknown, depth = 0): PresetPane | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 8) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'leaf') { const n = num(o.pane, 0); return Number.isInteger(n) && n >= 1 && n <= DOCK_LAYOUT_MAX_PANES ? { kind: 'leaf', pane: n } : null; }
  if (o.kind === 'split' && Array.isArray(o.children)) {
    const kids = o.children.slice(0, DOCK_LAYOUT_MAX_PANES).map((c) => parsePresetTree(c, depth + 1)).filter((c): c is PresetPane => !!c);
    if (kids.length < 2) return kids[0] ?? null;
    return { kind: 'split', vertical: o.vertical === true, children: kids, weights: clampWeights(Array.isArray(o.weights) ? o.weights.map((w) => num(w, 1)) : [], kids.length) };
  }
  return null;
}

/** A dock-layout asset's data with every field present and the tree checked (nothing valid = one pane). */
export function normalizeDockLayout(raw: unknown): DockLayoutData {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  let tree = parsePresetTree(o.tree) ?? { kind: 'leaf', pane: 1 };
  const leaves = presetLeaves(tree);
  const ok = leaves.length <= DOCK_LAYOUT_MAX_PANES && new Set(leaves).size === leaves.length && leaves.every((n) => n >= 1 && n <= leaves.length);
  if (!ok) tree = { kind: 'leaf', pane: 1 };
  const panes = presetLeaves(tree).length;
  const out: DockLayoutData = { panes, tree };
  const hint = str(o.hint, 120)?.trim(); if (hint) out.hint = hint;
  const main = num(o.main, 1); out.main = Number.isInteger(main) && main >= 1 && main <= panes ? main : 1;
  return out;
}

/** What's wrong with a dock-layout asset's data (empty = fine): `panes` must equal the leaves, pane numbers 1..n once each, ≤ 12. */
export function dockLayoutErrors(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['data must be an object'];
  const o = raw as Record<string, unknown>;
  const tree = parsePresetTree(o.tree);
  if (!tree) errors.push('data.tree must be a preset tree (leaf { pane } or split { vertical, children, weights })');
  else {
    const leaves = presetLeaves(tree);
    if (leaves.length > DOCK_LAYOUT_MAX_PANES) errors.push(`data.tree has ${leaves.length} panes; at most ${DOCK_LAYOUT_MAX_PANES}`);
    if (new Set(leaves).size !== leaves.length) errors.push('data.tree numbers a pane twice');
    if (leaves.some((n) => n < 1 || n > leaves.length)) errors.push(`data.tree pane numbers must be 1..${leaves.length}`);
    if (typeof o.panes !== 'number' || o.panes !== leaves.length) errors.push(`data.panes must be ${leaves.length} (the leaves of data.tree)`);
    if (o.main !== undefined && (!Number.isInteger(o.main) || (o.main as number) < 1 || (o.main as number) > leaves.length)) errors.push(`data.main must be 1..${leaves.length}`);
  }
  if (o.hint !== undefined && typeof o.hint !== 'string') errors.push('data.hint must be a string');
  return errors;
}

/** The live tree a preset makes: pane n → `groupIds[n - 1]` (missing ids are made `${prefix}${n}`). */
export function presetTree(data: DockLayoutData, groupIds: readonly string[] = [], prefix = 'pane-'): Pane {
  const id = (n: number) => groupIds[n - 1] ?? `${prefix}${n}`;
  const walk = (p: PresetPane): Pane => (p.kind === 'leaf' ? { kind: 'leaf', groupId: id(p.pane) } : { kind: 'split', vertical: p.vertical, children: p.children.map(walk), weights: [...p.weights] });
  return walk(data.tree);
}

/** The rects of a preset's panes inside `w` × `h` (reading order of pane numbers), `gap` px between them: the preview thumbnail. */
export function presetRects(data: DockLayoutData, w = 96, h = 64, gap = 2): { pane: number; rect: Rect }[] {
  const out: { pane: number; rect: Rect }[] = [];
  const walk = (p: PresetPane, r: Rect) => {
    if (p.kind === 'leaf') { out.push({ pane: p.pane, rect: { x: round2(r.x), y: round2(r.y), width: round2(r.width), height: round2(r.height) } }); return; }
    const n = p.children.length, shares = clampWeights(p.weights, n);
    const size = (p.vertical ? r.height : r.width) - gap * (n - 1);
    let at = p.vertical ? r.y : r.x;
    p.children.forEach((c, i) => {
      const len = size * shares[i]!;
      walk(c, p.vertical ? { x: r.x, y: at, width: r.width, height: len } : { x: at, y: r.y, width: len, height: r.height });
      at += len + gap;
    });
  };
  walk(data.tree, { x: 0, y: 0, width: w, height: h });
  return out.sort((a, b) => a.pane - b.pane);
}
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * An SVG thumbnail of a preset. Colours come from the theme only: panes are `var(--fx-surface2)` with a `var(--fx-border)`
 * stroke, the main pane `var(--fx-accent)` at `var(--fx-opacity-tint)`; sizes are the viewBox's (the host scales it).
 */
export function presetSvg(data: DockLayoutData, w = 96, h = 64): string {
  const rects = presetRects(data, w, h, 2);
  const body = rects.map(({ pane, rect }) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="2" fill="${pane === (data.main ?? 1) ? 'var(--fx-accent)' : 'var(--fx-surface2)'}" fill-opacity="${pane === (data.main ?? 1) ? 'var(--fx-opacity-tint)' : '1'}" stroke="var(--fx-border)" stroke-width="1"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${data.panes} pane layout">${body}</svg>`;
}

/**
 * Apply a preset to a dock: every open tab (reading order) is spread evenly over the preset's panes (more panes than
 * tabs: the extra panes are left out, since an empty pane has nothing to show), `mkId(n)` names the new groups (the
 * existing group ids are reused first so renderers keep their state). A preset over the limit uses the first `paneLimit` panes.
 */
export function applyPreset(state: DockState, data: DockLayoutData, windowId: string, mkId: (n: number) => string, rules: Pick<DockRules, 'paneLimit' | 'minWeight'> = DEFAULT_DOCK_RULES): DockState {
  const order = state.tree ? paneGroups(state.tree) : Object.keys(state.groups);
  const tabs = order.flatMap((gid) => state.groups[gid]?.tabs ?? []);
  const others = Object.values(state.groups).filter((g) => !order.includes(g.id));
  if (!tabs.length) return state;
  const panes = Math.max(1, Math.min(data.panes, rules.paneLimit, tabs.length));
  const parts = distribute(tabs, panes);
  const ids = parts.map((_, i) => order[i] ?? mkId(i + 1));
  const groups: Record<string, TabGroup> = Object.fromEntries(others.map((g) => [g.id, g]));
  parts.forEach((part, i) => { groups[ids[i]!] = { id: ids[i]!, tabs: part, active: 0, windowId }; });
  // a preset with more panes than we fill: keep only the leaves we have, tidied
  let tree: Pane | null = presetTree(data, ids);
  for (const gid of paneGroups(tree)) if (!groups[gid]) tree = removePane(tree, gid, rules.minWeight);
  return { tree: normalizeTree(tree, rules.minWeight), groups };
}
