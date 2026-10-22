/**
 * Workspace state: which panes show where, in which workspace layout, plus the toolbars (two by default, any number
 * more, each docked to an edge or floating). Kept per viewer on this device (a convenience, not project data);
 * every change is one call here so menus, toolbars, context menus and the panes themselves all drive the same state.
 */
import { useSyncExternalStore } from 'react';

export type Area = 'left' | 'center' | 'right' | 'bottom' | 'float';
export type Dock = 'top' | 'bottom' | 'left' | 'right' | 'float';

export interface PaneDef { id: string; title: string; icon: string; group: string; description: string }
export const PANES: PaneDef[] = [
  { id: 'projects', title: 'Projects', icon: 'folder', group: 'Project', description: 'Every saved project. Pick one and the whole studio shows it.' },
  { id: 'index', title: 'Index', icon: 'list', group: 'Outline', description: 'Categorized outline with sub trees, filters, search and drag-and-drop.' },
  { id: 'grid', title: 'Status grid', icon: 'grid', group: 'Outline', description: 'Every piece by category: status, progress, clip length, estimate. Drag to arrange or to the trash.' },
  { id: 'inspector', title: 'Inspector', icon: 'sliders', group: 'Outline', description: 'Every field of the selected piece or section.' },
  { id: 'script', title: 'Script', icon: 'type', group: 'Writing', description: 'Narration and the cue track of the selected piece.' },
  { id: 'review', title: 'Review queue', icon: 'eye', group: 'Writing', description: 'Pieces that need review, failed or partial.' },
  { id: 'browser', title: 'Live browser', icon: 'monitor', group: 'Capture', description: 'Open any page, record the mouse and keys, replay them as the narrated cursor.' },
  { id: 'recordings', title: 'Recordings', icon: 'play', group: 'Capture', description: 'Every recording, attach to pieces, process with Claude.' },
  { id: 'events', title: 'Event track', icon: 'chart', group: 'Capture', description: 'The recorded events of the selected recording.' },
  { id: 'files', title: 'Files', icon: 'file', group: 'Capture', description: 'The project\'s files, plus a folder from this device.' },
  { id: 'preview', title: 'Preview', icon: 'eye', group: 'Video', description: 'Plays the compiled video: narrated voice, captions and cursor.' },
  { id: 'timeline', title: 'Timeline', icon: 'layout', group: 'Video', description: 'The compiled segments to scale; drag to swap pieces.' },
  { id: 'captions', title: 'Captions', icon: 'type', group: 'Video', description: 'Every caption line with its time.' },
  { id: 'export', title: 'Export', icon: 'download', group: 'Video', description: 'Timeline, captions, script, shot list, EDL, Claude brief.' },
  { id: 'dashboard', title: 'Dashboard', icon: 'chart', group: 'Project', description: 'Progress, length against target, status counts.' },
  { id: 'settings', title: 'Project settings', icon: 'settings', group: 'Project', description: 'Desired length, piece length, voice, transitions, output.' },
  { id: 'trash', title: 'Trash', icon: 'trash', group: 'Project', description: 'Deleted pieces and sections, restorable.' },
  { id: 'log', title: 'Log', icon: 'terminal', group: 'Project', description: 'What the studio and the compiler did.' },
];
export const paneDef = (id: string) => PANES.find((p) => p.id === id);

export interface PanePlace { area: Area; order: number; hidden?: boolean }
export interface WorkLayout {
  id: string;
  label: string;
  icon: string;
  description: string;
  panes: Record<string, PanePlace>;
  sizes: { left: number; right: number; bottom: number };
}
const L = (id: string, label: string, icon: string, description: string, areas: Partial<Record<Area, string[]>>, sizes = { left: 300, right: 320, bottom: 280 }): WorkLayout => {
  const panes: Record<string, PanePlace> = {};
  for (const pd of PANES) panes[pd.id] = { area: 'center', order: 99, hidden: true };
  for (const [area, ids] of Object.entries(areas)) ids!.forEach((id, i) => { panes[id] = { area: area as Area, order: i }; });
  return { id, label, icon, description, panes, sizes };
};
export const LAYOUTS: WorkLayout[] = [
  L('ide', 'IDE', 'layout', 'Everything: outline left, stage center, inspector right, grid and timeline below.', { left: ['projects', 'index', 'files'], center: ['browser', 'preview', 'script'], right: ['inspector', 'dashboard', 'review', 'settings'], bottom: ['grid', 'timeline', 'captions', 'events', 'log'] }),
  L('grid', 'Grid', 'grid', 'The status grid in front, outline and inspector beside it.', { left: ['projects', 'index'], center: ['grid'], right: ['inspector', 'dashboard'], bottom: ['timeline', 'log'] }, { left: 260, right: 320, bottom: 200 }),
  L('record', 'Record', 'monitor', 'The live browser large, with the event track and recordings beside it.', { left: ['index'], center: ['browser'], right: ['recordings', 'events'], bottom: ['script', 'log'] }, { left: 240, right: 300, bottom: 220 }),
  L('write', 'Write', 'type', 'The script editor in front, review queue and inspector beside it.', { left: ['index'], center: ['script'], right: ['inspector', 'review'], bottom: ['grid'] }),
  L('review', 'Review', 'eye', 'Play the compiled video against the captions and the review queue.', { left: ['review', 'index'], center: ['preview'], right: ['inspector'], bottom: ['timeline', 'captions'] }),
  L('compile', 'Compile', 'package', 'The timeline in front, export and dashboard beside it, log below.', { left: ['index'], center: ['timeline'], right: ['export', 'dashboard', 'settings'], bottom: ['log', 'captions'] }),
  L('focus', 'Focus', 'minimize', 'One pane at a time, nothing else.', { center: ['grid', 'script', 'browser', 'preview', 'timeline'] }),
];

/* ---------- toolbars ---------- */

export interface ToolbarDef {
  id: string;
  name: string;
  dock: Dock;
  /** floating position (px from the workspace's top-left) */
  x: number;
  y: number;
  /** action specs; '|' is a separator */
  items: string[];
  labels: boolean;
  visible: boolean;
  /** order among toolbars on the same edge */
  order: number;
}
export const DEFAULT_TOOLBARS: ToolbarDef[] = [
  { id: 'tb-main', name: 'Main', dock: 'top', x: 40, y: 60, labels: false, visible: true, order: 0, items: ['ws.project.new', 'ws.project.save', 'ws.undo', 'ws.redo', '|', 'ws.piece.add', 'ws.section.add', 'ws.piece.duplicate', 'ws.item.delete', '|', 'ws.compile', 'ws.compile.full', 'ws.preview.play', 'ws.preview.stop', '|', 'ws.record.toggle', 'ws.browser.open', '|', 'ws.export.dialog', 'ws.toolbars.customize'] },
  { id: 'tb-pieces', name: 'Pieces', dock: 'top', x: 40, y: 120, labels: true, visible: true, order: 1, items: ['ws.status:built', 'ws.status:partial', 'ws.status:failed', 'ws.status:skipped', 'ws.status:review', 'ws.status:planned', '|', 'ws.index.expand', 'ws.index.collapse', '|', 'ws.piece.prev', 'ws.piece.next'] },
];

export interface UiState {
  layout: string;
  /** user changes on top of each layout preset */
  custom: Record<string, Partial<WorkLayout>>;
  /** front tab per area */
  front: Partial<Record<Area, string>>;
  floats: Record<string, { x: number; y: number; w: number; h: number; z: number }>;
  toolbars: ToolbarDef[];
  /** grid column visibility + order + sort */
  grid: { hidden: string[]; order: string[]; sort: { col: string; dir: 1 | -1 } | null; expanded: string[]; compact: boolean };
  /** index filters */
  index: { q: string; statuses: string[]; kinds: string[]; only: 'all' | 'recorded' | 'unrecorded' | 'noNarration' | 'overTarget' };
  /** maximised area */
  zoom: Area | null;
}

const KEY = 'ws:ui';
const fresh = (): UiState => ({ layout: 'ide', custom: {}, front: {}, floats: {}, toolbars: structuredClone(DEFAULT_TOOLBARS), grid: { hidden: ['url', 'notes', 'updated', 'tags'], order: [], sort: null, expanded: [], compact: false }, index: { q: '', statuses: [], kinds: [], only: 'all' }, zoom: null });
function load(): UiState {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<UiState> | null; if (r) { const f = fresh(); return { ...f, ...r, grid: { ...f.grid, ...r.grid }, index: { ...f.index, ...r.index } }; } } catch { /* fresh */ }
  return fresh();
}

class Ui {
  s: UiState = load();
  private ls = new Set<() => void>();
  get = () => this.s;
  sub = (l: () => void) => { this.ls.add(l); return () => { this.ls.delete(l); }; };
  set(fn: (s: UiState) => UiState) {
    this.s = fn(this.s);
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* per-viewer convenience only */ }
    this.ls.forEach((l) => l());
  }

  layout(): WorkLayout {
    const base = LAYOUTS.find((l) => l.id === this.s.layout) ?? LAYOUTS[0]!;
    const c = this.s.custom[base.id];
    return { ...base, panes: { ...base.panes, ...(c?.panes ?? {}) }, sizes: { ...base.sizes, ...(c?.sizes ?? {}) } };
  }
  setLayout(id: string) { this.set((s) => ({ ...s, layout: id, zoom: null })); }
  resetLayout() { this.set((s) => { const custom = { ...s.custom }; delete custom[s.layout]; return { ...s, custom }; }); }
  private patchPanes(fn: (p: Record<string, PanePlace>) => Record<string, PanePlace>) {
    const lay = this.layout();
    this.set((s) => ({ ...s, custom: { ...s.custom, [lay.id]: { ...s.custom[lay.id], panes: fn(lay.panes), sizes: lay.sizes } } }));
  }
  paneShown(id: string) { return !this.layout().panes[id]?.hidden; }
  togglePane(id: string, on?: boolean) {
    const show = on ?? !this.paneShown(id);
    this.patchPanes((p) => ({ ...p, [id]: { ...(p[id] ?? { area: 'center', order: 99 }), hidden: !show } }));
    if (show) this.front(id);
  }
  movePane(id: string, area: Area) {
    this.patchPanes((p) => ({ ...p, [id]: { area, order: 99, hidden: false } }));
    if (area === 'float' && !this.s.floats[id]) this.set((s) => ({ ...s, floats: { ...s.floats, [id]: { x: 80 + Object.keys(s.floats).length * 24, y: 80, w: 420, h: 320, z: Date.now() } } }));
    this.front(id);
  }
  front(id: string) { const a = this.layout().panes[id]?.area; if (!a) return; this.set((s) => ({ ...s, front: { ...s.front, [a]: id }, floats: s.floats[id] ? { ...s.floats, [id]: { ...s.floats[id]!, z: Date.now() } } : s.floats })); }
  setSize(which: 'left' | 'right' | 'bottom', px: number) {
    const lay = this.layout();
    this.set((s) => ({ ...s, custom: { ...s.custom, [lay.id]: { ...s.custom[lay.id], panes: lay.panes, sizes: { ...lay.sizes, [which]: Math.round(px) } } } }));
  }
  setFloat(id: string, r: Partial<UiState['floats'][string]>) { this.set((s) => ({ ...s, floats: { ...s.floats, [id]: { ...(s.floats[id] ?? { x: 80, y: 80, w: 420, h: 320, z: 0 }), ...r } } })); }
  zoom(a: Area | null) { this.set((s) => ({ ...s, zoom: s.zoom === a ? null : a })); }

  /* toolbars */
  toolbar(id: string) { return this.s.toolbars.find((t) => t.id === id); }
  addToolbar(name = `Toolbar ${this.s.toolbars.length + 1}`, dock: Dock = 'top', items: string[] = []): string {
    const id = `tb-${Date.now().toString(36)}`;
    this.set((s) => ({ ...s, toolbars: [...s.toolbars, { id, name, dock, x: 120, y: 120, items, labels: false, visible: true, order: s.toolbars.length }] }));
    return id;
  }
  patchToolbar(id: string, patch: Partial<ToolbarDef>) { this.set((s) => ({ ...s, toolbars: s.toolbars.map((t) => (t.id === id ? { ...t, ...patch } : t)) })); }
  removeToolbar(id: string) { this.set((s) => ({ ...s, toolbars: s.toolbars.filter((t) => t.id !== id) })); }
  resetToolbars() { this.set((s) => ({ ...s, toolbars: structuredClone(DEFAULT_TOOLBARS) })); }

  /* grid */
  patchGrid(patch: Partial<UiState['grid']>) { this.set((s) => ({ ...s, grid: { ...s.grid, ...patch } })); }
  toggleColumn(col: string, on?: boolean) {
    const hidden = this.s.grid.hidden; const show = on ?? hidden.includes(col);
    this.patchGrid({ hidden: show ? hidden.filter((c) => c !== col) : [...hidden, col] });
  }
  toggleExpanded(id: string) { const e = this.s.grid.expanded; this.patchGrid({ expanded: e.includes(id) ? e.filter((x) => x !== id) : [...e, id] }); }
  patchIndex(patch: Partial<UiState['index']>) { this.set((s) => ({ ...s, index: { ...s.index, ...patch } })); }
}
export const ui = new Ui();
export function useUi<T>(sel: (s: UiState) => T): T { return useSyncExternalStore(ui.sub, () => sel(ui.s), () => sel(ui.s)); }
