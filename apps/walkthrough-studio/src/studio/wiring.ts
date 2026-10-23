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
import { registerWorkspaceMenus, toolbarMenu as wsToolbarMenu } from '../axf/libs/workspace';

const statusMenu = (id: string): MenuEntry[] => STATUSES.map((s) => ({ id: `st-${s.id}`, label: s.label, icon: s.icon, action: `ws.piece.status:${id}:${s.id}` }));

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
  cx.set('ws-recording', (_t, id = '') => [
    { id: 'process', label: 'Process with Claude…', icon: 'sparkles', action: `ws.recording.process:${id}` },
    { id: 'events', label: 'Event track', icon: 'chart', action: 'ws.pane:events' },
  ]);

  // panes, toolbars and the workspace itself: lib-workspace's menus (+ the studio's compile / play)
  const offWs = registerWorkspaceMenus(rt, ui.ws, { customize: 'ws.toolbars.customize', extra: () => [{ id: 's1', separator: true }, { id: 'compile', label: 'Compile', icon: 'package', action: 'ws.compile' }, { id: 'play', label: 'Play preview', icon: 'play', action: 'ws.preview.play' }] });

  const projects = (): MenuItem[] => studio().get().projects.map((p) => ({ id: `op-${p.id}`, label: p.name, icon: p.id === studio().get().project?.id ? 'check' : 'folder', action: `ws.project.open:${p.id}` }));
  const offA = rt.registerAppMenuProvider('ws.projects', { items: projects, max: 30, moreAction: 'ws.pane:projects', moreLabel: 'Every project…', module: 'walkthrough-studio' });
  const offB = rt.registerAppMenuProvider('ws.toolbars', { items: () => wsToolbarMenu(ui.ws, 'ws.toolbars.customize') as MenuItem[], module: 'walkthrough-studio' });

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
  return () => { offA(); offB(); offU(); offS(); offWs(); for (const k of ['ws-piece', 'ws-section', 'ws-project', 'ws-recording']) cx.delete(k); };
}
