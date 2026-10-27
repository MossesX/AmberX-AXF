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
}
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
export interface WindowState { windows: WindowSpec[]; groups: Record<string, TabGroup>; layouts: Record<string, Pane>; focused: string | null; drag: TabDrag | null }

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
  private spec(id: string, type: WindowType, title: string, o: Partial<WindowSpec> = {}): WindowSpec {
    return { id, type, title, toolbarsAllowed: true, toolbarEnabled: type !== 'main', origin: null, settings: this.windowDefaults(type), x: 40, y: 80, width: 360, height: 420, minimized: null, minimizedAtX: 0, minimizedAtY: 0, closable: true, z: 0, mode: 'tree', ...o };
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
  openFloating(tabs: TabSpec[], title: string, type: WindowType = 'floating', width = 380, height = 460, x?: number, y?: number): string {
    const wid = this.nextId('win');
    const count = this._state.windows.filter(isFloating).length;
    const at = placeNewWindow(this.placement, count, { width, height }, this.viewport, this.remembered.get(title) ?? null);
    this.set((s) => ({ ...s, windows: [...s.windows, this.spec(wid, type, title, { toolbarEnabled: type !== 'element', x: x ?? at.x, y: y ?? at.y, width, height, z: this.topZ(s) })], focused: wid }));
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
  /** Called when a drag ends: snaps the window to the grid under the behaviour theme's rules and remembers where it is. */
  settle(windowId: string) { this.update(windowId, (w) => this.remember({ ...w, x: snapCoord(w.x, this.placement), y: snapCoord(w.y, this.placement) })); }
  resize(windowId: string, width: number, height: number) { this.update(windowId, (w) => ({ ...w, width: Math.max(200, snapCoord(width, this.placement)), height: Math.max(160, snapCoord(height, this.placement)) })); }
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
      { id: 'min-corner', label: 'Minimize to title bar (cycle corners)', icon: 'minus', action: 'windows.minimizeCorner:{payload}' },
      { id: 'min-toolbar', label: 'Minimize to floating toolbar at cursor', icon: 'minus', action: 'windows.minimizeToolbar:{payload}' },
      { id: 's1', separator: true },
      { id: 'close', label: 'Close', icon: 'x', action: 'windows.close:{payload}' },
    ];
  }
  closeGroup(groupId: string) { this.set((s) => this.removeGroup(s, groupId)); }
}
