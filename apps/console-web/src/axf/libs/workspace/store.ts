/**
 * The workspace model (lib-workspace): pane places per layout, front tabs, floating windows, maximised area and the
 * toolbars. Pure state + one small store per workspace; kept per viewer in localStorage (a convenience, never shared).
 */
import { useSyncExternalStore } from 'react';

export type Area = 'left' | 'center' | 'right' | 'bottom' | 'float';
export type Dock = 'top' | 'bottom' | 'left' | 'right' | 'float';
export const AREAS = ['left', 'center', 'right', 'bottom'] as const;
export const DOCKS: Dock[] = ['top', 'bottom', 'left', 'right', 'float'];

export interface PaneDef { id: string; title: string; icon: string; group?: string; description?: string }
export interface PanePlace { area: Area; order: number; hidden?: boolean }
export interface WorkLayout { id: string; label: string; icon: string; description?: string; panes: Record<string, PanePlace>; sizes: { left: number; right: number; bottom: number } }
export interface ToolbarDef { id: string; name: string; dock: Dock; x: number; y: number; items: string[]; labels: boolean; visible: boolean; order: number }
export interface FloatRect { x: number; y: number; w: number; h: number; z: number }

/** A layout from area → pane ids; every other pane starts hidden. */
export function defineLayout(panes: readonly PaneDef[], id: string, label: string, icon: string, description: string, areas: Partial<Record<Area, string[]>>, sizes = { left: 300, right: 320, bottom: 280 }): WorkLayout {
  const out: Record<string, PanePlace> = {};
  for (const p of panes) out[p.id] = { area: 'center', order: 99, hidden: true };
  for (const [area, ids] of Object.entries(areas)) ids!.forEach((pid, i) => { out[pid] = { area: area as Area, order: i }; });
  return { id, label, icon, description, panes: out, sizes };
}

export interface WorkspaceState {
  layout: string;
  custom: Record<string, Partial<Pick<WorkLayout, 'panes' | 'sizes'>>>;
  front: Partial<Record<Area, string>>;
  floats: Record<string, FloatRect>;
  toolbars: ToolbarDef[];
  zoom: Area | null;
}
export interface WorkspaceOptions { id: string; panes: PaneDef[]; layouts: WorkLayout[]; toolbars: ToolbarDef[]; storageKey?: string; defaultLayout?: string; maxToolbars?: number; labelsOnNew?: boolean }

export class Workspace {
  readonly id: string;
  readonly panes: PaneDef[];
  readonly layouts: WorkLayout[];
  readonly defaults: ToolbarDef[];
  maxToolbars: number;
  labelsOnNew: boolean;
  s: WorkspaceState;
  private ls = new Set<() => void>();
  private key: string;
  constructor(o: WorkspaceOptions) {
    this.id = o.id; this.panes = o.panes; this.layouts = o.layouts; this.defaults = o.toolbars;
    this.maxToolbars = o.maxToolbars ?? 0; this.labelsOnNew = !!o.labelsOnNew;
    this.key = o.storageKey ?? `axf-ws:${o.id}`;
    const fresh: WorkspaceState = { layout: o.defaultLayout && o.layouts.some((l) => l.id === o.defaultLayout) ? o.defaultLayout : o.layouts[0]?.id ?? '', custom: {}, front: {}, floats: {}, toolbars: structuredClone(o.toolbars), zoom: null };
    let saved: Partial<WorkspaceState> | null = null;
    try { saved = JSON.parse(localStorage.getItem(this.key) ?? 'null'); } catch { saved = null; }
    this.s = saved ? { ...fresh, ...saved, layout: o.layouts.some((l) => l.id === saved!.layout) ? saved.layout! : fresh.layout } : fresh;
  }
  get = () => this.s;
  sub = (l: () => void) => { this.ls.add(l); return () => { this.ls.delete(l); }; };
  private set(fn: (s: WorkspaceState) => WorkspaceState) {
    this.s = fn(this.s);
    try { localStorage.setItem(this.key, JSON.stringify(this.s)); } catch { /* per-viewer convenience only */ }
    this.ls.forEach((l) => l());
  }
  pane(id: string) { return this.panes.find((p) => p.id === id); }

  layout(): WorkLayout {
    const base = this.layouts.find((l) => l.id === this.s.layout) ?? this.layouts[0]!;
    const c = this.s.custom[base.id];
    return { ...base, panes: { ...base.panes, ...(c?.panes ?? {}) }, sizes: { ...base.sizes, ...(c?.sizes ?? {}) } };
  }
  setLayout(id: string) { if (this.layouts.some((l) => l.id === id)) this.set((s) => ({ ...s, layout: id, zoom: null })); }
  resetLayout() { this.set((s) => { const custom = { ...s.custom }; delete custom[s.layout]; return { ...s, custom }; }); }
  private patch(fn: (p: Record<string, PanePlace>) => Record<string, PanePlace>) {
    const lay = this.layout();
    this.set((s) => ({ ...s, custom: { ...s.custom, [lay.id]: { ...s.custom[lay.id], panes: fn(lay.panes), sizes: lay.sizes } } }));
  }
  /** visible pane ids in an area, in order */
  visible(a: Area): string[] { return Object.entries(this.layout().panes).filter(([id, p]) => !p.hidden && p.area === a && this.pane(id)).sort((x, y) => x[1].order - y[1].order).map(([id]) => id); }
  paneShown(id: string) { return !this.layout().panes[id]?.hidden; }
  togglePane(id: string, on?: boolean) {
    const show = on ?? !this.paneShown(id);
    this.patch((p) => ({ ...p, [id]: { ...(p[id] ?? { area: 'center', order: 99 }), hidden: !show } }));
    if (show) this.front(id);
  }
  movePane(id: string, area: Area) {
    this.patch((p) => ({ ...p, [id]: { area, order: 99, hidden: false } }));
    if (area === 'float' && !this.s.floats[id]) this.set((s) => ({ ...s, floats: { ...s.floats, [id]: { x: 80 + Object.keys(s.floats).length * 24, y: 80, w: 420, h: 320, z: Date.now() } } }));
    this.front(id);
  }
  front(id: string) { const a = this.layout().panes[id]?.area; if (!a) return; this.set((s) => ({ ...s, front: { ...s.front, [a]: id }, floats: s.floats[id] ? { ...s.floats, [id]: { ...s.floats[id]!, z: Date.now() } } : s.floats })); }
  setSize(which: 'left' | 'right' | 'bottom', px: number) {
    const lay = this.layout();
    this.set((s) => ({ ...s, custom: { ...s.custom, [lay.id]: { ...s.custom[lay.id], panes: lay.panes, sizes: { ...lay.sizes, [which]: Math.round(px) } } } }));
  }
  setFloat(id: string, r: Partial<FloatRect>) { this.set((s) => ({ ...s, floats: { ...s.floats, [id]: { ...(s.floats[id] ?? { x: 80, y: 80, w: 420, h: 320, z: 0 }), ...r } } })); }
  zoom(a: Area | null) { this.set((s) => ({ ...s, zoom: s.zoom === a ? null : a })); }

  toolbar(id: string) { return this.s.toolbars.find((t) => t.id === id); }
  canAddToolbar() { return !this.maxToolbars || this.s.toolbars.length < this.maxToolbars; }
  addToolbar(name = `Toolbar ${this.s.toolbars.length + 1}`, dock: Dock = 'top', items: string[] = []): string | null {
    if (!this.canAddToolbar()) return null;
    const id = `tb-${Date.now().toString(36)}`;
    this.set((s) => ({ ...s, toolbars: [...s.toolbars, { id, name, dock, x: 120, y: 120, items, labels: this.labelsOnNew, visible: true, order: s.toolbars.length }] }));
    return id;
  }
  patchToolbar(id: string, patch: Partial<ToolbarDef>) { this.set((s) => ({ ...s, toolbars: s.toolbars.map((t) => (t.id === id ? { ...t, ...patch } : t)) })); }
  removeToolbar(id: string) { this.set((s) => ({ ...s, toolbars: s.toolbars.filter((t) => t.id !== id) })); }
  resetToolbars() { this.set((s) => ({ ...s, toolbars: structuredClone(this.defaults) })); }
  /** move a toolbar item (or add a spec) to a toolbar at an index */
  placeItem(src: { toolbar: string; index: number } | { spec: string }, dst: string, at: number) {
    const t = this.toolbar(dst); if (!t) return;
    let items = [...t.items]; let spec: string;
    if ('spec' in src) spec = src.spec;
    else {
      const from = this.toolbar(src.toolbar); if (!from) return;
      spec = from.items[src.index]!;
      if (src.toolbar === dst) { items.splice(src.index, 1); if (src.index < at) at--; }
      else this.patchToolbar(from.id, { items: from.items.filter((_, k) => k !== src.index) });
    }
    items.splice(Math.max(0, Math.min(at, items.length)), 0, spec);
    this.patchToolbar(dst, { items });
  }
  removeItem(toolbar: string, index: number) { const t = this.toolbar(toolbar); if (t) this.patchToolbar(t.id, { items: t.items.filter((_, k) => k !== index) }); }
}

export function useWorkspace<T>(ws: Workspace, sel: (s: WorkspaceState) => T): T { return useSyncExternalStore(ws.sub, () => sel(ws.s), () => sel(ws.s)); }
