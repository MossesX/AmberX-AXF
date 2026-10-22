/**
 * Hooks the studio into the framework: context menus for every studio target, the application menu's live lists
 * (projects, toolbars), and the runtime counters menus, banners and widgets read (check marks for panes, layouts, grid
 * columns and filters; the banner's built progress, recording status and review count).
 */
import type { AxfRuntime, MenuEntry, MenuItem } from '../axf/core';
import { COLUMNS } from './columns';
import { STATUSES, autoProgress, totals } from './model';
import { studio } from './store';
import { LAYOUTS, PANES, ui } from './ui';

const mark = (on: boolean) => (on ? 'check' : 'minus');
const statusMenu = (id: string): MenuEntry[] => STATUSES.map((s) => ({ id: `st-${s.id}`, label: s.label, icon: s.icon, action: `ws.piece.status:${id}:${s.id}` }));
const paneMenu = (): MenuEntry[] => PANES.map((p) => ({ id: `pn-${p.id}`, label: p.title, icon: mark(ui.paneShown(p.id)), action: `ws.pane:${p.id}` }));
const layoutMenu = (): MenuEntry[] => LAYOUTS.map((l) => ({ id: `ly-${l.id}`, label: l.label, icon: mark(ui.s.layout === l.id), action: `ws.layout:${l.id}` }));
const toolbarMenu = (): MenuEntry[] => [
  ...ui.s.toolbars.map((t) => ({ id: `tb-${t.id}`, label: `${t.name} (${t.dock})`, icon: mark(t.visible), action: `ws.toolbar.toggle:${t.id}` })),
  { id: 'tb-sep', separator: true }, { id: 'tb-add', label: 'Add a toolbar', icon: 'plus', action: 'ws.toolbar.add' }, { id: 'tb-cust', label: 'Customize toolbars…', icon: 'sliders', action: 'ws.toolbars.customize' }, { id: 'tb-reset', label: 'Back to the two defaults', icon: 'refresh', action: 'ws.toolbars.reset' },
];

export function wireStudio(rt: AxfRuntime): () => void {
  const cx = rt.contextExtras;
  cx.set('ws-piece', (_t, id = '') => [
    { id: 'edit', label: 'Edit script', icon: 'type', action: `ws.piece.script:${id}` },
    { id: 'status', label: 'Status', icon: 'check', items: statusMenu(id) },
    { id: 'browser', label: 'Open its page', icon: 'monitor', action: `ws.piece.browser:${id}` },
    { id: 'record', label: 'Record this piece', icon: 'play', action: `ws.piece.record:${id}` },
    { id: 'expand', label: ui.s.grid.expanded.includes(id) ? 'Collapse row' : 'Expand row', icon: 'chevron-down', action: `ws.piece.select:${id}` },
    { id: 's1', separator: true },
    { id: 'dup', label: 'Duplicate', icon: 'copy', action: `ws.item.dup:piece:${id}` },
    { id: 'up', label: 'Move up', icon: 'chevron-up', action: 'ws.item.up' },
    { id: 'down', label: 'Move down', icon: 'chevron-down', action: 'ws.item.down' },
    { id: 'del', label: 'Delete to trash', icon: 'trash', action: `ws.item.delete:piece:${id}` },
  ]);
  cx.set('ws-section', (_t, id = '') => [
    { id: 'addp', label: 'Add a piece here', icon: 'plus', action: `ws.section.addPiece:${id}` },
    { id: 'adds', label: 'Add a sub-section here', icon: 'layers', action: `ws.section.addSub:${id}` },
    { id: 'fold', label: 'Expand / collapse', icon: 'chevron-down', action: `ws.section.fold:${id}` },
    { id: 's1', separator: true },
    { id: 'dup', label: 'Duplicate section', icon: 'copy', action: `ws.item.dup:section:${id}` },
    { id: 'del', label: 'Delete section to trash', icon: 'trash', action: `ws.item.delete:section:${id}` },
  ]);
  cx.set('ws-project', (_t, id = '') => [
    { id: 'open', label: 'Open', icon: 'folder', action: `ws.project.open:${id}` },
    { id: 'rename', label: 'Rename…', icon: 'edit', action: `ws.project.rename:${id}` },
    { id: 'dup', label: 'Duplicate', icon: 'copy', action: `ws.project.duplicate:${id}` },
    { id: 'compile', label: 'Compile', icon: 'package', action: `ws.project.compileOne:${id}` },
    { id: 'export', label: 'Export', icon: 'download', action: `ws.project.exportOne:${id}` },
    { id: 's1', separator: true },
    { id: 'new', label: 'New project…', icon: 'plus', action: 'ws.project.new' },
    { id: 'import', label: 'Import…', icon: 'upload', action: 'ws.project.import' },
    { id: 'del', label: 'Delete…', icon: 'trash', action: `ws.project.delete:${id}` },
  ]);
  cx.set('ws-grid-header', (_t, col = '') => [
    ...(col && COLUMNS.find((c) => c.id === col)?.sortable ? [{ id: 'sort', label: `Sort by ${COLUMNS.find((c) => c.id === col)!.label}`, icon: 'list', action: `ws.grid.sort:${col}` }, { id: 'unsort', label: 'Outline order', icon: 'list', action: 'ws.grid.sort' }, { id: 's0', separator: true }] : []),
    ...(col && !COLUMNS.find((c) => c.id === col)?.fixed ? [{ id: 'hide', label: `Hide ${COLUMNS.find((c) => c.id === col)!.label}`, icon: 'eye', action: `ws.grid.col:${col}` }] : []),
    { id: 'cols', label: 'Columns', icon: 'list', items: COLUMNS.filter((c) => !c.fixed).map((c) => ({ id: `c-${c.id}`, label: c.label, icon: mark(!ui.s.grid.hidden.includes(c.id)), action: `ws.grid.col:${c.id}` })) },
    { id: 'all', label: 'Show every column', icon: 'eye', action: 'ws.grid.allColumns' },
    { id: 'choose', label: 'Choose columns…', icon: 'sliders', action: 'ws.grid.columns' },
  ]);
  cx.set('ws-pane', (_t, id = '') => [
    { id: 'move', label: 'Move to', icon: 'arrow-right', items: (['left', 'center', 'right', 'bottom', 'float'] as const).map((a) => ({ id: `m-${a}`, label: a === 'float' ? 'Float' : a[0]!.toUpperCase() + a.slice(1), icon: a === 'float' ? 'layers' : 'layout', action: `ws.pane.move:${id}:${a}` })) },
    { id: 'hide', label: 'Hide this pane', icon: 'x', action: `ws.pane:${id}` },
    { id: 'zoom', label: 'Maximise its area', icon: 'monitor', action: `ws.zoom:${ui.layout().panes[id]?.area ?? 'center'}` },
    { id: 's1', separator: true },
    { id: 'panes', label: 'Panes', icon: 'layout', items: paneMenu() },
    { id: 'layouts', label: 'Workspace layout', icon: 'layout', items: layoutMenu() },
  ]);
  cx.set('ws-toolbar', (_t, id = '') => {
    const t = ui.toolbar(id);
    return [
      { id: 'cust', label: `Customize “${t?.name ?? ''}”…`, icon: 'sliders', action: `ws.toolbars.customize:${id}` },
      { id: 'labels', label: t?.labels ? 'Icons only' : 'Show labels', icon: 'type', action: `ws.toolbar.labels:${id}` },
      { id: 'dock', label: 'Dock', icon: 'layout', items: (['top', 'bottom', 'left', 'right', 'float'] as const).map((d) => ({ id: `d-${d}`, label: d === 'float' ? 'Float' : `Dock ${d}`, icon: mark(t?.dock === d), action: `ws.toolbar.dock:${id}:${d}` })) },
      { id: 'hide', label: 'Hide', icon: 'eye', action: `ws.toolbar.toggle:${id}` },
      { id: 'remove', label: 'Remove', icon: 'trash', action: `ws.toolbar.remove:${id}` },
      { id: 's1', separator: true },
      { id: 'all', label: 'Toolbars', icon: 'sliders', items: toolbarMenu() },
    ];
  });
  cx.set('ws-workspace', () => [
    { id: 'layouts', label: 'Workspace layout', icon: 'layout', items: layoutMenu() },
    { id: 'panes', label: 'Panes', icon: 'layout', items: paneMenu() },
    { id: 'toolbars', label: 'Toolbars', icon: 'sliders', items: toolbarMenu() },
    { id: 's1', separator: true },
    { id: 'compile', label: 'Compile', icon: 'package', action: 'ws.compile' },
    { id: 'play', label: 'Play preview', icon: 'play', action: 'ws.preview.play' },
  ]);
  cx.set('ws-recording', (_t, id = '') => [
    { id: 'process', label: 'Process with Claude…', icon: 'sparkles', action: `ws.recording.process:${id}` },
    { id: 'events', label: 'Event track', icon: 'chart', action: 'ws.pane:events' },
  ]);

  const projects = (): MenuItem[] => studio().get().projects.map((p) => ({ id: `op-${p.id}`, label: p.name, icon: p.id === studio().get().project?.id ? 'check' : 'folder', action: `ws.project.open:${p.id}` }));
  const offA = rt.registerAppMenuProvider('ws.projects', { items: projects, max: 30, moreAction: 'ws.pane:projects', moreLabel: 'Every project…', module: 'walkthrough-studio' });
  const offB = rt.registerAppMenuProvider('ws.toolbars', { items: () => toolbarMenu() as MenuItem[], module: 'walkthrough-studio' });

  // counters: check marks + the banner's widgets
  const sync = () => {
    for (const p of PANES) rt.setBadge(`ws.pane.${p.id}`, ui.paneShown(p.id) ? 1 : 0);
    for (const l of LAYOUTS) rt.setBadge(`ws.layout.${l.id}`, ui.s.layout === l.id ? 1 : 0);
    for (const c of COLUMNS) rt.setBadge(`ws.col.${c.id}`, ui.s.grid.hidden.includes(c.id) ? 0 : 1);
    for (const s of STATUSES) rt.setBadge(`ws.filter.${s.id}`, ui.s.index.statuses.includes(s.id) ? 1 : 0);
    rt.setBadge('ws.grid.compact', ui.s.grid.compact ? 1 : 0);
    const st = studio().get();
    rt.setBadge('ws.hub', st.hub.on ? 1 : 0);
    rt.setBadge('ws.recording', st.recording ? 1 : 0);
    const p = st.project;
    if (p) {
      rt.setBadge('ws.built', Math.round(totals(p).progress));
      rt.setBadge('ws.review', Object.values(p.pieces).filter((x) => x.status === 'review').length);
      rt.setBadge('ws.pieces', Object.keys(p.pieces).length);
      void autoProgress;
    }
  };
  sync();
  const offU = ui.sub(sync);
  const offS = studio().subscribe(sync);
  return () => { offA(); offB(); offU(); offS(); for (const k of ['ws-piece', 'ws-section', 'ws-project', 'ws-grid-header', 'ws-pane', 'ws-toolbar', 'ws-workspace', 'ws-recording']) cx.delete(k); };
}
