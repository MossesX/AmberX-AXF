/**
 * The studio's workspace on lib-workspace (panes, layouts, two default toolbars + any number more, docked or floating),
 * plus the studio's own view state (grid columns, sort, expanded rows; index filters). Kept per viewer on this device.
 * `ui` keeps one call per change, so menus, toolbars, context menus and the panes all drive the same state.
 */
import { useSyncExternalStore } from 'react';
import { createWorkspace, defineLayout, type Area, type Dock, type PaneDef, type ToolbarDef, type Workspace, type WorkLayout } from '../axf/libs/workspace';

export type { Area, Dock, PaneDef, ToolbarDef, WorkLayout };
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


const L = (id: string, label: string, icon: string, description: string, areas: Partial<Record<Area, string[]>>, sizes?: { left: number; right: number; bottom: number }): WorkLayout => defineLayout(PANES, id, label, icon, description, areas, sizes);
export const LAYOUTS: WorkLayout[] = [
  L('ide', 'IDE', 'layout', 'Everything: outline left, stage center, inspector right, grid and timeline below.', { left: ['projects', 'index', 'files'], center: ['browser', 'preview', 'script'], right: ['inspector', 'dashboard', 'review', 'settings'], bottom: ['grid', 'timeline', 'captions', 'events', 'log'] }),
  L('grid', 'Grid', 'grid', 'The status grid in front, outline and inspector beside it.', { left: ['projects', 'index'], center: ['grid'], right: ['inspector', 'dashboard'], bottom: ['timeline', 'log'] }, { left: 260, right: 320, bottom: 200 }),
  L('record', 'Record', 'monitor', 'The live browser large, with the event track and recordings beside it.', { left: ['index'], center: ['browser'], right: ['recordings', 'events'], bottom: ['script', 'log'] }, { left: 240, right: 300, bottom: 220 }),
  L('write', 'Write', 'type', 'The script editor in front, review queue and inspector beside it.', { left: ['index'], center: ['script'], right: ['inspector', 'review'], bottom: ['grid'] }),
  L('review', 'Review', 'eye', 'Play the compiled video against the captions and the review queue.', { left: ['review', 'index'], center: ['preview'], right: ['inspector'], bottom: ['timeline', 'captions'] }),
  L('compile', 'Compile', 'package', 'The timeline in front, export and dashboard beside it, log below.', { left: ['index'], center: ['timeline'], right: ['export', 'dashboard', 'settings'], bottom: ['log', 'captions'] }),
  L('focus', 'Focus', 'minimize', 'One pane at a time, nothing else.', { center: ['grid', 'script', 'browser', 'preview', 'timeline'] }),
];

export const DEFAULT_TOOLBARS: ToolbarDef[] = [
  { id: 'tb-main', name: 'Main', dock: 'top', x: 40, y: 60, labels: false, visible: true, order: 0, items: ['ws.project.new', 'ws.project.save', 'ws.undo', 'ws.redo', '|', 'ws.piece.add', 'ws.section.add', 'ws.piece.duplicate', 'ws.item.delete', '|', 'ws.compile', 'ws.compile.full', 'ws.preview.play', 'ws.preview.stop', '|', 'ws.record.toggle', 'ws.browser.open', '|', 'ws.export.dialog', 'ws.toolbars.customize'] },
  { id: 'tb-pieces', name: 'Pieces', dock: 'top', x: 40, y: 120, labels: true, visible: true, order: 1, items: ['ws.status:built', 'ws.status:partial', 'ws.status:failed', 'ws.status:skipped', 'ws.status:review', 'ws.status:planned', '|', 'ws.index.expand', 'ws.index.collapse', '|', 'ws.piece.prev', 'ws.piece.next'] },
];


export interface ViewState {
  /** grid column visibility + sort + expanded rows */
  grid: { hidden: string[]; sort: { col: string; dir: 1 | -1 } | null; expanded: string[]; compact: boolean };
  /** index filters */
  index: { q: string; statuses: string[]; kinds: string[]; only: 'all' | 'recorded' | 'unrecorded' | 'noNarration' | 'overTarget' };
}
/** what panes read through useUi: the workspace's state + the studio's view state */
export type UiState = ReturnType<Workspace['get']> & ViewState;

const KEY = 'ws:view';
const freshView = (): ViewState => ({ grid: { hidden: ['url', 'notes', 'updated', 'tags'], sort: null, expanded: [], compact: false }, index: { q: '', statuses: [], kinds: [], only: 'all' } });
function loadView(): ViewState {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ViewState> | null; if (r) { const f = freshView(); return { grid: { ...f.grid, ...r.grid }, index: { ...f.index, ...r.index } }; } } catch { /* fresh */ }
  return freshView();
}

class Ui {
  private view: ViewState = loadView();
  private _ws: Workspace | null = null;
  private merged: UiState | null = null;
  private ls = new Set<() => void>();
  /** made on first use, after the libraries are installed (so the installed workspace config applies) */
  get ws(): Workspace {
    if (!this._ws) {
      this._ws = createWorkspace({ id: 'studio', panes: PANES, layouts: LAYOUTS, toolbars: DEFAULT_TOOLBARS, storageKey: 'ws:workspace', defaultLayout: 'ide' });
      this._ws.sub(() => { this.merged = null; this.ls.forEach((l) => l()); });
    }
    return this._ws;
  }
  get s(): UiState { return (this.merged ??= { ...this.ws.get(), ...this.view }); }
  get = () => this.s;
  sub = (l: () => void) => { this.ws; this.ls.add(l); return () => { this.ls.delete(l); }; };
  private setView(fn: (v: ViewState) => ViewState) {
    this.view = fn(this.view); this.merged = null;
    try { localStorage.setItem(KEY, JSON.stringify(this.view)); } catch { /* per-viewer convenience only */ }
    this.ls.forEach((l) => l());
  }

  // workspace (lib-workspace)
  layout() { return this.ws.layout(); }
  setLayout(id: string) { this.ws.setLayout(id); }
  resetLayout() { this.ws.resetLayout(); }
  paneShown(id: string) { return this.ws.paneShown(id); }
  togglePane(id: string, on?: boolean) { this.ws.togglePane(id, on); }
  movePane(id: string, area: Area) { this.ws.movePane(id, area); }
  front(id: string) { this.ws.front(id); }
  zoom(a: Area | null) { this.ws.zoom(a); }
  toolbar(id: string) { return this.ws.toolbar(id); }
  addToolbar(name?: string, dock: Dock = 'top', items: string[] = []) { return this.ws.addToolbar(name, dock, items); }
  patchToolbar(id: string, patch: Partial<ToolbarDef>) { this.ws.patchToolbar(id, patch); }
  removeToolbar(id: string) { this.ws.removeToolbar(id); }
  resetToolbars() { this.ws.resetToolbars(); }

  // the studio's view state
  patchGrid(patch: Partial<ViewState['grid']>) { this.setView((v) => ({ ...v, grid: { ...v.grid, ...patch } })); }
  toggleColumn(col: string, on?: boolean) {
    const hidden = this.view.grid.hidden; const show = on ?? hidden.includes(col);
    this.patchGrid({ hidden: show ? hidden.filter((c) => c !== col) : [...hidden, col] });
  }
  toggleExpanded(id: string) { const e = this.view.grid.expanded; this.patchGrid({ expanded: e.includes(id) ? e.filter((x) => x !== id) : [...e, id] }); }
  patchIndex(patch: Partial<ViewState['index']>) { this.setView((v) => ({ ...v, index: { ...v.index, ...patch } })); }
}
export const ui = new Ui();
export function useUi<T>(sel: (s: UiState) => T): T { return useSyncExternalStore(ui.sub, () => sel(ui.s), () => sel(ui.s)); }
