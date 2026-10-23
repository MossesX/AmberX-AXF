/**
 * Every studio command, registered as an AXF action so the application menu, both toolbars (and any toolbar you add),
 * context menus, keyboard shortcuts and search all run the same code. A command spec is `<id>[:<arg>…]`, e.g.
 * `ws.status:built` or `ws.pane:grid`. `catalog()` lists every spec a toolbar can hold, categorized, for the
 * toolbar customizer: studio commands, panes, layouts, grid columns, framework actions, views, settings and asset swaps.
 */
import type { AxfRuntime } from '../axf/core';
import { ASSET_TYPES, assetTypeSpecs, attachable } from '../axf/core';
import { STATUSES, addPiece, addSection, duplicatePiece, duplicateSection, findSection, newPiece, newSection, orderedPieces, parentOf, sectionOfPiece, trashItem, updatePiece, walkSections, type PieceStatus } from './model';
import { studio } from './store';
import { LAYOUTS, PANES, ui, type Area, type Dock } from './ui';
import { COLUMNS } from './columns';
import { toClaudeBrief, toEdl, toScript, toShotList, toSrt, toVtt } from './compiler';

export interface Command { id: string; label: string; icon: string; category: string; shortcut?: string; run: (args: string[]) => void; describe?: string }

/** controllers panes register while mounted (recorder, player, index search box) */
export const controllers: { recorder?: { toggle(): void; start(): void; stop(): void; mark(): void }; player?: { play(): void; stop(): void }; indexSearch?: () => void } = {};

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'walkthrough';

export const EXPORTS: { id: string; label: string; ext: string; type: string; make: () => string | null }[] = [
  { id: 'project', label: 'Project (walkthrough-project@1 JSON)', ext: 'walkthrough.json', type: 'application/json', make: () => { const p = studio().get().project; return p ? JSON.stringify(p, null, 1) : null; } },
  { id: 'timeline', label: 'Compiled timeline (JSON)', ext: 'timeline.json', type: 'application/json', make: () => { const c = studio().compileNow(); return c ? JSON.stringify(c, null, 1) : null; } },
  { id: 'srt', label: 'Captions (SRT)', ext: 'srt', type: 'text/plain', make: () => { const c = studio().compileNow(); return c ? toSrt(c) : null; } },
  { id: 'vtt', label: 'Captions (WebVTT)', ext: 'vtt', type: 'text/vtt', make: () => { const c = studio().compileNow(); return c ? toVtt(c) : null; } },
  { id: 'script', label: 'Narration script (Markdown)', ext: 'script.md', type: 'text/markdown', make: () => { const s = studio(); const c = s.compileNow(); return c && s.get().project ? toScript(c, s.get().project!) : null; } },
  { id: 'shots', label: 'Shot list (CSV)', ext: 'shots.csv', type: 'text/csv', make: () => { const c = studio().compileNow(); return c ? toShotList(c) : null; } },
  { id: 'edl', label: 'Edit decision list (EDL)', ext: 'edl', type: 'text/plain', make: () => { const s = studio(); const c = s.compileNow(); return c ? toEdl(c, s.get().project?.settings.fps) : null; } },
  { id: 'brief', label: 'Claude production brief', ext: 'brief.txt', type: 'text/plain', make: () => { const s = studio(); const c = s.compileNow(); return c && s.get().project ? toClaudeBrief(c, s.get().project!) : null; } },
];
export function exportNow(id: string) {
  const e = EXPORTS.find((x) => x.id === id); const p = studio().get().project;
  if (!e || !p) return;
  const text = e.make(); if (text == null) return;
  download(`${slug(p.name)}.${e.ext}`, text, e.type);
  studio().log(`Exported ${e.label}.`, 'ok');
}

function selectedSectionId(): string {
  const st = studio().get(); const p = st.project!;
  if (st.selection.section) return st.selection.section;
  if (st.selection.piece) return sectionOfPiece(p.root, st.selection.piece)?.id ?? 'root';
  return p.root.children[0]?.id ?? 'root';
}
function stepPiece(dir: 1 | -1) {
  const st = studio().get(); const p = st.project; if (!p) return;
  const list = orderedPieces(p); if (!list.length) return;
  const i = list.findIndex((x) => x.id === st.selection.piece);
  const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))]!;
  studio().select({ piece: next.id, section: null });
}
function setStatus(s: PieceStatus) {
  const st = studio().get(); const ids = st.selection.multi.length ? st.selection.multi : st.selection.piece ? [st.selection.piece] : [];
  if (!ids.length) return;
  studio().edit(`Status ${s}`, (p) => ids.reduce((q, id) => updatePiece(q, id, { status: s }), p));
}
function setAllCollapsed(on: boolean) {
  studio().edit(on ? 'Collapse all' : 'Expand all', (p) => { const q = structuredClone(p); walkSections(q.root, (s) => { if (s.id !== 'root') s.collapsed = on; }); return q; });
}
function moveSelected(dir: 1 | -1) {
  const st = studio().get(); const p = st.project; if (!p) return;
  studio().edit('Move', (q0) => {
    const q = structuredClone(q0);
    if (st.selection.piece) { const sec = sectionOfPiece(q.root, st.selection.piece); if (!sec) return q0; const i = sec.pieces.indexOf(st.selection.piece); const j = i + dir; if (j < 0 || j >= sec.pieces.length) return q0; [sec.pieces[i], sec.pieces[j]] = [sec.pieces[j]!, sec.pieces[i]!]; return q; }
    if (st.selection.section) { const par = parentOf(q.root, st.selection.section); if (!par) return q0; const i = par.children.findIndex((c) => c.id === st.selection.section); const j = i + dir; if (j < 0 || j >= par.children.length) return q0; [par.children[i], par.children[j]] = [par.children[j]!, par.children[i]!]; return q; }
    return q0;
  });
}

export function commands(rt: AxfRuntime): Command[] {
  const s = studio;
  const need = () => !!s().get().project;
  const withPane = (pane: string, then: () => void) => { if (!ui.paneShown(pane)) ui.togglePane(pane, true); else ui.front(pane); setTimeout(then, 60); };
  return [
    // Project
    { id: 'ws.project.new', label: 'New project', icon: 'plus', category: 'Project', shortcut: 'Alt+N', run: () => rt.openDialog('ws.new-project') },
    { id: 'ws.project.seed', label: 'New from the framework walkthrough', icon: 'sparkles', category: 'Project', run: () => void s().create('AmberX AXF — the complete walkthrough', 'seed') },
    { id: 'ws.project.duplicate', label: 'Duplicate project', icon: 'copy', category: 'Project', run: ([id]) => void s().duplicate(id) },
    { id: 'ws.project.open', label: 'Open project', icon: 'folder', category: 'Project', run: ([id]) => id && void s().open(id) },
    { id: 'ws.project.save', label: 'Save now', icon: 'save', category: 'Project', shortcut: 'Ctrl+S', run: () => void s().flush().then(() => rt.toast('Saved.', 'success')) },
    { id: 'ws.project.rename', label: 'Rename project…', icon: 'edit', category: 'Project', run: ([id]) => rt.openDialog('ws.rename-project', { id: id ?? s().get().project?.id }) },
    { id: 'ws.project.delete', label: 'Delete project…', icon: 'trash', category: 'Project', run: ([id]) => rt.openDialog('ws.delete-project', { id: id ?? s().get().project?.id }) },
    { id: 'ws.project.import', label: 'Import project…', icon: 'upload', category: 'Project', run: () => rt.openDialog('ws.import') },
    { id: 'ws.project.compileOne', label: 'Compile project', icon: 'package', category: 'Project', run: ([id]) => { const go = () => { s().compileNow(); ui.togglePane('timeline', true); }; if (id && id !== s().get().project?.id) void s().open(id).then(go); else go(); } },
    { id: 'ws.project.exportOne', label: 'Export project', icon: 'download', category: 'Project', run: ([id]) => { if (id && id !== s().get().project?.id) void s().open(id).then(() => exportNow('project')); else exportNow('project'); } },
    { id: 'ws.project.settings', label: 'Project settings', icon: 'settings', category: 'Project', run: () => ui.togglePane('settings', true) },
    { id: 'ws.hub.toggle', label: 'Keep projects on axHub', icon: 'cloud', category: 'Project', run: () => s().setHub(!s().get().hub.on) },
    // Edit
    { id: 'ws.undo', label: 'Undo', icon: 'undo', category: 'Edit', shortcut: 'Ctrl+Z', run: () => s().undoEdit() },
    { id: 'ws.redo', label: 'Redo', icon: 'redo', category: 'Edit', shortcut: 'Ctrl+Y', run: () => s().redoEdit() },
    { id: 'ws.piece.add', label: 'Add piece', icon: 'plus', category: 'Edit', shortcut: 'Alt+P', run: () => { if (!need()) return; const pc = newPiece({ title: 'New piece' }); const sec = selectedSectionId(); s().edit('Add piece', (p) => addPiece(p, sec, pc)); s().select({ piece: pc.id, section: null }); } },
    { id: 'ws.section.add', label: 'Add section', icon: 'folder', category: 'Edit', run: () => { if (!need()) return; const sec = newSection('New section'); const st = s().get(); const par = st.selection.section ? parentOf(st.project!.root, st.selection.section)?.id ?? 'root' : 'root'; s().edit('Add section', (p) => addSection(p, par, sec)); s().select({ section: sec.id, piece: null }); } },
    { id: 'ws.subsection.add', label: 'Add sub-section', icon: 'layers', category: 'Edit', run: () => { if (!need()) return; const sec = newSection('New sub-section'); const par = selectedSectionId(); s().edit('Add sub-section', (p) => addSection(p, par, sec)); s().select({ section: sec.id, piece: null }); } },
    { id: 'ws.piece.duplicate', label: 'Duplicate', icon: 'copy', category: 'Edit', shortcut: 'Ctrl+D', run: () => { const it = s().selectedItem(); if (!it) return; s().edit('Duplicate', (p) => (it.kind === 'piece' ? duplicatePiece(p, it.id) : duplicateSection(p, it.id))); } },
    { id: 'ws.item.delete', label: 'Delete to trash', icon: 'trash', category: 'Edit', shortcut: 'Delete', run: ([kind, id]) => { const it = kind && id ? { kind: kind as 'piece' | 'section', id } : s().selectedItem(); if (!it) return; s().edit('Delete', (p) => trashItem(p, it)); s().select({ piece: null, section: null }); rt.toast('Moved to the trash. Undo or the Trash pane brings it back.', 'info', 'Deleted'); } },
    { id: 'ws.status', label: 'Set status', icon: 'check', category: 'Edit', run: ([st]) => STATUSES.some((x) => x.id === st) && setStatus(st as PieceStatus) },
    { id: 'ws.piece.select', label: 'Select piece', icon: 'arrow-right', category: 'Edit', run: ([id]) => id && s().select({ piece: id, section: null }) },
    { id: 'ws.piece.prev', label: 'Previous piece', icon: 'chevron-up', category: 'Edit', shortcut: 'Alt+Up', run: () => stepPiece(-1) },
    { id: 'ws.piece.next', label: 'Next piece', icon: 'chevron-down', category: 'Edit', shortcut: 'Alt+Down', run: () => stepPiece(1) },
    { id: 'ws.item.up', label: 'Move up', icon: 'chevron-up', category: 'Edit', run: () => moveSelected(-1) },
    { id: 'ws.item.down', label: 'Move down', icon: 'chevron-down', category: 'Edit', run: () => moveSelected(1) },
    // targeted (context menus pass the id)
    { id: 'ws.piece.status', label: 'Set this piece\'s status', icon: 'check', category: 'Edit', run: ([id, st]) => id && st && s().edit(`Status ${st}`, (p) => updatePiece(p, id, { status: st as PieceStatus })) },
    { id: 'ws.piece.script', label: 'Edit script', icon: 'type', category: 'Edit', run: ([id]) => { if (id) s().select({ piece: id, section: null }); ui.togglePane('script', true); } },
    { id: 'ws.piece.browser', label: 'Open its page in the live browser', icon: 'monitor', category: 'Capture', run: ([id]) => { if (id) s().select({ piece: id, section: null }); ui.togglePane('browser', true); } },
    { id: 'ws.piece.record', label: 'Record this piece', icon: 'play', category: 'Capture', run: ([id]) => { if (id) s().select({ piece: id, section: null }); withPane('browser', () => controllers.recorder?.start()); } },
    { id: 'ws.item.dup', label: 'Duplicate this', icon: 'copy', category: 'Edit', run: ([kind, id]) => id && s().edit('Duplicate', (p) => (kind === 'piece' ? duplicatePiece(p, id) : duplicateSection(p, id))) },
    { id: 'ws.section.addPiece', label: 'Add a piece here', icon: 'plus', category: 'Edit', run: ([id]) => { if (!id || !need()) return; const pc = newPiece({ title: 'New piece' }); s().edit('Add piece', (p) => addPiece(p, id, pc)); s().select({ piece: pc.id, section: null }); } },
    { id: 'ws.section.addSub', label: 'Add a sub-section here', icon: 'layers', category: 'Edit', run: ([id]) => { if (!id || !need()) return; const sec = newSection('New sub-section'); s().edit('Add sub-section', (p) => addSection(p, id, sec)); s().select({ section: sec.id, piece: null }); } },
    { id: 'ws.section.fold', label: 'Expand / collapse', icon: 'chevron-down', category: 'Index', run: ([id]) => { const p = s().get().project; const sec = id && p ? findSection(p.root, id) : null; if (sec) s().edit('Fold', (q) => { const c = structuredClone(q); const t = findSection(c.root, id!); if (t) t.collapsed = !t.collapsed; return c; }); } },
    // Index
    { id: 'ws.index.expand', label: 'Expand all', icon: 'chevron-down', category: 'Index', run: () => setAllCollapsed(false) },
    { id: 'ws.index.collapse', label: 'Collapse all', icon: 'chevron-right', category: 'Index', run: () => setAllCollapsed(true) },
    { id: 'ws.index.search', label: 'Search the index', icon: 'search', category: 'Index', shortcut: 'Alt+F', run: () => withPane('index', () => controllers.indexSearch?.()) },
    { id: 'ws.index.clear', label: 'Clear filters', icon: 'x', category: 'Index', run: () => ui.patchIndex({ q: '', statuses: [], kinds: [], only: 'all' }) },
    { id: 'ws.filter.status', label: 'Filter by status', icon: 'eye', category: 'Index', run: ([st]) => { const cur = ui.s.index.statuses; if (st) ui.patchIndex({ statuses: cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st] }); } },
    // Grid
    { id: 'ws.grid.col', label: 'Show / hide column', icon: 'list', category: 'Grid', run: ([c]) => c && ui.toggleColumn(c) },
    { id: 'ws.grid.allColumns', label: 'Show every column', icon: 'eye', category: 'Grid', run: () => ui.patchGrid({ hidden: [] }) },
    { id: 'ws.grid.columns', label: 'Choose columns…', icon: 'sliders', category: 'Grid', run: () => rt.openDialog('ws.columns') },
    { id: 'ws.grid.compact', label: 'Compact rows', icon: 'minimize', category: 'Grid', run: () => ui.patchGrid({ compact: !ui.s.grid.compact }) },
    { id: 'ws.grid.expandRows', label: 'Expand every row', icon: 'chevron-down', category: 'Grid', run: () => { const p = s().get().project; if (p) ui.patchGrid({ expanded: Object.keys(p.pieces) }); } },
    { id: 'ws.grid.collapseRows', label: 'Collapse every row', icon: 'chevron-right', category: 'Grid', run: () => ui.patchGrid({ expanded: [] }) },
    { id: 'ws.grid.sort', label: 'Sort by', icon: 'list', category: 'Grid', run: ([c]) => { const cur = ui.s.grid.sort; ui.patchGrid({ sort: !c ? null : cur?.col === c ? (cur.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 } }); } },
    // View
    { id: 'ws.pane', label: 'Show / hide pane', icon: 'layout', category: 'View', run: ([id]) => id && ui.togglePane(id) },
    { id: 'ws.pane.move', label: 'Move pane', icon: 'arrow-right', category: 'View', run: ([id, area]) => id && area && ui.movePane(id, area as Area) },
    { id: 'ws.layout', label: 'Workspace layout', icon: 'layout', category: 'View', run: ([id]) => id && ui.setLayout(id) },
    { id: 'ws.layout.reset', label: 'Reset this layout', icon: 'refresh', category: 'View', run: () => ui.resetLayout() },
    { id: 'ws.zoom', label: 'Maximise area', icon: 'monitor', category: 'View', run: ([a]) => ui.zoom((a as Area) || null) },
    // Toolbars
    { id: 'ws.toolbars.customize', label: 'Customize toolbars…', icon: 'sliders', category: 'Toolbars', run: ([id]) => rt.openDialog('ws.toolbars', { id }) },
    { id: 'ws.toolbar.add', label: 'Add a toolbar', icon: 'plus', category: 'Toolbars', run: ([dock]) => { const id = ui.addToolbar(undefined, (dock as Dock) || 'top'); rt.openDialog('ws.toolbars', { id }); } },
    { id: 'ws.toolbar.toggle', label: 'Show / hide toolbar', icon: 'eye', category: 'Toolbars', run: ([id]) => { const t = id && ui.toolbar(id); if (t) ui.patchToolbar(t.id, { visible: !t.visible }); } },
    { id: 'ws.toolbar.dock', label: 'Dock / float toolbar', icon: 'layout', category: 'Toolbars', run: ([id, d]) => id && d && ui.patchToolbar(id, { dock: d as Dock }) },
    { id: 'ws.toolbar.labels', label: 'Toolbar labels', icon: 'type', category: 'Toolbars', run: ([id]) => { const t = id && ui.toolbar(id); if (t) ui.patchToolbar(t.id, { labels: !t.labels }); } },
    { id: 'ws.toolbar.remove', label: 'Remove toolbar', icon: 'trash', category: 'Toolbars', run: ([id]) => id && ui.removeToolbar(id) },
    { id: 'ws.toolbars.reset', label: 'Back to the two default toolbars', icon: 'refresh', category: 'Toolbars', run: () => ui.resetToolbars() },
    // Capture
    { id: 'ws.browser.open', label: 'Live browser', icon: 'monitor', category: 'Capture', run: () => ui.togglePane('browser', true) },
    { id: 'ws.record.toggle', label: 'Record / stop', icon: 'play', category: 'Capture', shortcut: 'Alt+R', run: () => withPane('browser', () => controllers.recorder?.toggle()) },
    { id: 'ws.record.mark', label: 'Drop a marker', icon: 'star', category: 'Capture', shortcut: 'Alt+M', run: () => controllers.recorder?.mark() },
    { id: 'ws.recording.process', label: 'Process with Claude…', icon: 'sparkles', category: 'Capture', run: ([id]) => rt.openDialog('ws.process', { id }) },
    // Video
    { id: 'ws.compile', label: 'Compile', icon: 'package', category: 'Video', shortcut: 'Alt+B', run: () => s().compileNow() },
    { id: 'ws.compile.full', label: 'Recompile everything', icon: 'refresh', category: 'Video', run: () => s().compileNow(true) },
    { id: 'ws.preview.play', label: 'Play preview', icon: 'play', category: 'Video', shortcut: 'Alt+Space', run: () => withPane('preview', () => controllers.player?.play()) },
    { id: 'ws.preview.stop', label: 'Stop preview', icon: 'pause', category: 'Video', run: () => controllers.player?.stop() },
    { id: 'ws.export.dialog', label: 'Export…', icon: 'download', category: 'Video', run: () => rt.openDialog('ws.export') },
    { id: 'ws.export', label: 'Export as', icon: 'download', category: 'Video', run: ([f]) => f && exportNow(f) },
    // Help
    { id: 'ws.help.about', label: 'About Walkthrough Studio', icon: 'info', category: 'Help', run: () => rt.openDialog('ws.about') },
    { id: 'ws.help.guide', label: 'How the studio works', icon: 'help', category: 'Help', run: () => rt.openDialog('ws.guide') },
  ];
}

let registered: Command[] = [];
export function registerCommands(rt: AxfRuntime) {
  registered = commands(rt);
  for (const c of registered) rt.actions.register(c.id, (args) => c.run(args), { label: c.label, params: true } as never);
  // framework standard actions this app answers
  rt.actions.register('help.about', () => rt.openDialog('ws.about'), { label: 'About' });
  rt.actions.register('file.new', () => rt.openDialog('ws.new-project'), { label: 'New project' });
  rt.actions.register('file.save', () => void studio().flush(), { label: 'Save' });
  rt.actions.register('edit.undo', () => studio().undoEdit(), { label: 'Undo' });
  rt.actions.register('edit.redo', () => studio().redoEdit(), { label: 'Redo' });
}

/* ---------- describing a spec (toolbars, customizer, menus) ---------- */

/** = lib-workspace's SpecInfo, plus the category */
export interface SpecInfo { spec: string; label: string; icon: string; category: string; path: string[]; checked?: boolean; disabled?: boolean; shortcut?: string; active?: { icon: string; label: string } }

export function describe(rt: AxfRuntime, spec: string): SpecInfo {
  const [id = '', ...args] = spec.split(':');
  const c = registered.find((x) => x.id === id);
  const a0 = args[0] ?? '';
  if (c) {
    let label = c.label, icon = c.icon, checked: boolean | undefined;
    if (id === 'ws.status') { const st = STATUSES.find((x) => x.id === a0); label = st?.label ?? a0; icon = st?.icon ?? icon; }
    if (id === 'ws.pane') { const pd = PANES.find((p) => p.id === a0); label = pd?.title ?? a0; icon = pd?.icon ?? icon; checked = ui.paneShown(a0); }
    if (id === 'ws.layout') { const l = LAYOUTS.find((x) => x.id === a0); label = `${l?.label ?? a0} layout`; icon = l?.icon ?? icon; checked = ui.s.layout === a0; }
    if (id === 'ws.grid.col') { label = COLUMNS.find((x) => x.id === a0)?.label ?? a0; checked = !ui.s.grid.hidden.includes(a0); }
    if (id === 'ws.export') label = EXPORTS.find((x) => x.id === a0)?.label ?? a0;
    if (id === 'ws.toolbar.toggle') { const t = ui.toolbar(a0); label = t?.name ?? a0; checked = !!t?.visible; }
    if (id === 'ws.filter.status') { label = `Only ${STATUSES.find((x) => x.id === a0)?.label ?? a0}`; checked = ui.s.index.statuses.includes(a0); }
    if (id === 'ws.record.toggle') checked = !!studio().get().recording;
    if (id === 'ws.grid.compact') checked = ui.s.grid.compact;
    if (id === 'ws.hub.toggle') checked = studio().get().hub.on;
    const st = studio().get();
    const disabled = (id === 'ws.undo' && !st.undo) || (id === 'ws.redo' && !st.redo);
    const active = id === 'ws.record.toggle' && st.recording ? { icon: 'pause', label: 'Stop' } : undefined;
    return { spec, label, icon, category: c.category, path: ['Studio', c.category], checked, disabled, shortcut: c.shortcut, active };
  }
  if (id === 'nav') return { spec, label: `Go to ${a0}`, icon: 'arrow-right', category: 'Views', path: ['Framework', 'Views'] };
  if (id === 'swap') return { spec, label: `${assetTypeSpecs[a0 as keyof typeof assetTypeSpecs]?.label ?? a0}: ${args[1] ?? ''}`, icon: 'palette', category: 'Look', path: ['Framework', 'Look', assetTypeSpecs[a0 as keyof typeof assetTypeSpecs]?.label ?? a0] };
  if (id === 'settings.open') return { spec, label: `Settings: ${a0}`, icon: 'settings', category: 'Settings', path: ['Framework', 'Settings'] };
  const fa = rt.actions.list().find((x) => x.id === id);
  return { spec, label: fa?.meta.label ?? spec, icon: 'zap', category: 'Actions', path: ['Framework', 'Actions'] };
}

/** every spec a toolbar can hold, categorized (studio commands, panes, layouts, columns, framework actions, views, settings, swaps) */
export function catalog(rt: AxfRuntime): SpecInfo[] {
  const out: SpecInfo[] = [];
  const push = (spec: string, path?: string[]) => { const d = describe(rt, spec); out.push(path ? { ...d, path } : d); };
  const PARAM = new Set(['ws.status', 'ws.pane', 'ws.pane.move', 'ws.layout', 'ws.grid.col', 'ws.grid.sort', 'ws.export', 'ws.zoom', 'ws.toolbar.toggle', 'ws.toolbar.dock', 'ws.toolbar.labels', 'ws.toolbar.remove', 'ws.project.open', 'ws.piece.select', 'ws.filter.status', 'ws.project.compileOne', 'ws.project.exportOne', 'ws.piece.status', 'ws.piece.script', 'ws.piece.browser', 'ws.piece.record', 'ws.item.dup', 'ws.section.addPiece', 'ws.section.addSub', 'ws.section.fold']);
  for (const c of registered) if (!PARAM.has(c.id)) push(c.id);
  for (const st of STATUSES) { push(`ws.status:${st.id}`, ['Studio', 'Edit', 'Set status']); push(`ws.filter.status:${st.id}`, ['Studio', 'Index', 'Filter']); }
  for (const pd of PANES) { push(`ws.pane:${pd.id}`, ['Studio', 'Panes', pd.group ?? 'Panes']); push(`ws.pane.move:${pd.id}:float`, ['Studio', 'Panes', 'Float']); }
  for (const l of LAYOUTS) push(`ws.layout:${l.id}`, ['Studio', 'Layouts']);
  for (const a of ['left', 'center', 'right', 'bottom'] as const) push(`ws.zoom:${a}`, ['Studio', 'View', 'Maximise']);
  for (const col of COLUMNS.filter((x) => !x.fixed)) push(`ws.grid.col:${col.id}`, ['Studio', 'Grid', 'Columns']);
  for (const col of COLUMNS.filter((x) => x.sortable)) push(`ws.grid.sort:${col.id}`, ['Studio', 'Grid', 'Sort']);
  for (const e of EXPORTS) push(`ws.export:${e.id}`, ['Studio', 'Video', 'Export']);
  for (const t of ui.s.toolbars) push(`ws.toolbar.toggle:${t.id}`, ['Studio', 'Toolbars', 'Show']);
  for (const a of rt.actions.list()) if (!a.id.startsWith('ws.') && !a.meta.stub && !(a.meta as { params?: boolean }).params) push(a.id, ['Framework', 'Actions']);
  for (const v of ['home', 'settings', 'assets', 'components', 'account']) push(`nav:${v}`, ['Framework', 'Views']);
  for (const tab of ['appearance', 'account', 'connections', 'plugins', 'about']) push(`settings.open:${tab}`, ['Framework', 'Settings']);
  for (const type of ASSET_TYPES) {
    const list = rt.registry.list(type);
    if (list.length < 2 || attachable(type)) continue;
    push(`swap:${type}:next`, ['Framework', 'Look', assetTypeSpecs[type].label]);
    for (const a of list) push(`swap:${type}:${a.id}`, ['Framework', 'Look', assetTypeSpecs[type].label]);
  }
  return out;
}
