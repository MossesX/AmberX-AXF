/**
 * Plan Studio 2.0 console plugin (ai.amberx.axf.console.plan-studio-2): a brand-new planning tree beside the original
 * Plan Studio, which is left as it is. Starts empty, nothing synced in. Every row has the full context menu (target
 * `axp-plan-studio-2-item`); every menu item is an action, so it also runs from REST, MCP, the CLI and voice. Deep link:
 * `plan-studio-2.focus:<id or words>` (console_show / console_open plan-studio-2 with input.focus).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { useRuntime, Button } from '@console/axf/react';
import { appMenu } from './menu';
import { BuildDialog, ItemDialog, LinkDialog, MoveDialog, PlanStudio2Page } from './ui';
import { CTX_TARGET, DIALOGS, FOLDER, setCollapsed, ID, KEYS, VIEW, deleteItem, download, duplicateItem, editItem, exportText, indentItem, nudgeItem, outdentItem, reload, requestFocus, select, selectedId, treeState, undoDelete } from './api';
import * as tc from './tree-core.mjs';
import * as lc from './layout-core.mjs';
import { readDock, setLayout, showSection, writeDock } from './layout';
import './plan-studio-2.css';

function OpenButton() {
  const rt = useRuntime();
  return <Button icon="branch" onClick={() => rt.navigate(VIEW)} title="Plan Studio 2.0: the planning tree">Plan Studio 2.0</Button>;
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Plan Studio 2.0',
  version: '0.1.0',
  appMenu,
  provides: ['plan-tree@1'],
  builtWith: { model: 'fable', builtAt: '2026-11-16' },
  register(rt) {
    const T = 'Plan Studio 2.0';
    const say = (p: Promise<{ say?: string; ok: boolean; error?: string }>, kind: 'success' | 'info' = 'success') => p.then((r) => rt.toast(r.say ?? (r.ok ? 'Done.' : r.error ?? 'That did not work.'), r.ok ? kind : 'danger', T), (e: Error) => rt.toast(e.message, 'danger', T));
    /** The item an action is about: the context-menu payload, else the action's argument, else the selected row. */
    const target = (args: string[], ctx?: { payload?: string }): string | null => {
      const ref = (ctx?.payload ?? (args.length ? decodeURIComponent(args.join(':')) : '')).trim();
      const s = treeState();
      if (ref && s) return tc.resolve(s, ref)?.id ?? null;
      if (ref) return ref;
      return selectedId();
    };
    const need = (args: string[], ctx?: { payload?: string }): string | null => { const id = target(args, ctx); if (!id) rt.toast('Say which item (right-click a row, or give its name).', 'warning', T); return id; };

    rt.actions.register('plan-studio-2.open', () => rt.navigate(VIEW), { label: 'Open Plan Studio 2.0' });
    rt.actions.register('plan-studio-2.focus', (args) => { rt.navigate(VIEW); const ref = decodeURIComponent(args.join(':')); if (ref) requestFocus(ref); }, { label: 'Open Plan Studio 2.0 at one item (id or words)', params: true, effect: 'navigate' });
    rt.actions.register('plan-studio-2.new', (args) => { rt.navigate(VIEW); rt.openDialog(DIALOGS.item, { parent: null, kind: args[0] || 'plan' }); }, { label: 'New plan (Plan Studio 2.0)', params: true });
    rt.actions.register('plan-studio-2.new-inside', (args, ctx) => { const id = need(args, ctx); if (!id) return; const it = tc.byId(treeState()!, id); rt.openDialog(DIALOGS.item, { parent: id, kind: it ? tc.CHILD_KIND[it.kind] : 'step' }); }, { label: 'New item inside', searchable: false });
    rt.actions.register('plan-studio-2.rename', (args, ctx) => { const id = need(args, ctx); if (id) rt.openDialog(DIALOGS.item, { id }); }, { label: 'Rename / edit the item', searchable: false });
    rt.actions.register('plan-studio-2.toggle-done', (args, ctx) => { const id = need(args, ctx); const it = id ? tc.byId(treeState()!, id) : null; if (it) void say(editItem(it.id, { done: !it.done })); }, { label: 'Done / not done', searchable: false });
    rt.actions.register('plan-studio-2.duplicate', (args, ctx) => { const id = need(args, ctx); if (id) void say(duplicateItem(id)); }, { label: 'Duplicate the item', searchable: false });
    rt.actions.register('plan-studio-2.up', (args, ctx) => { const id = need(args, ctx); if (id) void say(nudgeItem(id, -1), 'info'); }, { label: 'Move the item up', searchable: false });
    rt.actions.register('plan-studio-2.down', (args, ctx) => { const id = need(args, ctx); if (id) void say(nudgeItem(id, 1), 'info'); }, { label: 'Move the item down', searchable: false });
    rt.actions.register('plan-studio-2.indent', (args, ctx) => { const id = need(args, ctx); if (id) void say(indentItem(id), 'info'); }, { label: 'Indent the item (into the one above)', searchable: false });
    rt.actions.register('plan-studio-2.outdent', (args, ctx) => { const id = need(args, ctx); if (id) void say(outdentItem(id), 'info'); }, { label: 'Outdent the item', searchable: false });
    rt.actions.register('plan-studio-2.move', (args, ctx) => { const id = need(args, ctx); if (id) rt.openDialog(DIALOGS.move, { id }); }, { label: 'Move the item to…', searchable: false });
    rt.actions.register('plan-studio-2.link', (args, ctx) => { const id = need(args, ctx); if (id) rt.openDialog(DIALOGS.link, { id }); }, { label: 'Link the item to a to-do, build, note or Shipped feature', searchable: false });
    rt.actions.register('plan-studio-2.export', (args, ctx) => { const id = target(args, ctx); void exportText(id, 'md').then((t) => download(`${id ? tc.slug(tc.byId(treeState()!, id)?.title ?? id) : 'plan-studio-2'}.md`, t), (e: Error) => rt.toast(e.message, 'danger', T)); }, { label: 'Export as Markdown (one item, or everything)', params: true });
    rt.actions.register('plan-studio-2.build', (args, ctx) => { const id = need(args, ctx); if (id) rt.openDialog(DIALOGS.build, { id }); }, { label: 'Send the item to the build orchestrator…', searchable: false });
    rt.actions.register('plan-studio-2.delete', (args, ctx) => { const id = need(args, ctx); if (id) void say(deleteItem(id), 'info'); }, { label: 'Delete the item (undo brings it back)', searchable: false });
    rt.actions.register('plan-studio-2.undo', () => void say(undoDelete()), { label: 'Undo the last delete in Plan Studio 2.0' });
    rt.actions.register('plan-studio-2.select', (args, ctx) => { const id = target(args, ctx); select(id); }, { label: 'Select an item', searchable: false });
    // Page layouts (nav menu, tab group, IDE dockable panes), the IDE dock and Collapse all / Expand all, the same through
    // REST (/api/console-control), MCP (console_control_*), the CLI (axf console) and voice:
    // `plan-studio-2.layout:<id or words>[:<dock-layout asset>]`, `plan-studio-2.dock:<op>:<args…>`, `plan-studio-2.section:<id>`.
    rt.actions.register('plan-studio-2.layout', ([q = '', preset = '']) => {
      const id = setLayout(rt, decodeURIComponent(q), preset ? decodeURIComponent(preset) : undefined);
      rt.navigate(VIEW); rt.toast(`Plan Studio 2.0 layout: ${lc.resolveLayout(id)?.label ?? id}`, 'success', T);
    }, { label: 'Plan Studio 2.0: switch page layout (nav menu, tabs, IDE panes)', params: true });
    rt.actions.register('plan-studio-2.dock', ([op = '', ...rest]) => {
      if (op === 'reset') writeDock(rt, null);
      else writeDock(rt, lc.runDockOp(readDock(rt), op, rest.map((x) => decodeURIComponent(x)), lc.SECTION_IDS));
      if (lc.resolveLayout(rt.settings.get(KEYS.pageLayout) as string)?.kind !== 'dock') rt.settings.set(KEYS.pageLayout, 'ide');
      rt.navigate(VIEW);
    }, { label: 'Plan Studio 2.0: move, split, close or reopen IDE panes and tabs', params: true });
    rt.actions.register('plan-studio-2.section', ([q = '']) => {
      const id = lc.resolveSection(decodeURIComponent(q));
      if (!id) throw new Error(`Sections: ${lc.SECTION_IDS.join(', ')}.`);
      rt.navigate(VIEW); showSection(rt, id);
    }, { label: 'Plan Studio 2.0: show a section (tree, editor, say, trash)', params: true, effect: 'navigate' });
    rt.actions.register('plan-studio-2.collapse-all', () => { setCollapsed(null, true); rt.toast('Collapsed everything.', 'info', T); }, { label: 'Plan Studio 2.0: collapse all' });
    rt.actions.register('plan-studio-2.expand-all', () => { setCollapsed(null, false); rt.toast('Expanded everything.', 'info', T); }, { label: 'Plan Studio 2.0: expand all' });
    rt.actions.register('plan-studio-2.reload', () => void reload(), { label: 'Reload Plan Studio 2.0' });
  },
  contextMenu: [
    {
      id: 'plan-studio-2.ctx.item', target: CTX_TARGET, order: 1, items: [
        { id: 'plan-studio-2.new-inside', label: 'New inside…', icon: 'plus', action: 'plan-studio-2.new-inside' },
        { id: 'plan-studio-2.rename', label: 'Rename / edit…', icon: 'edit', action: 'plan-studio-2.rename' },
        { id: 'plan-studio-2.toggle-done', label: 'Done / not done', icon: 'check', action: 'plan-studio-2.toggle-done' },
        { id: 'plan-studio-2.duplicate', label: 'Duplicate', icon: 'copy', action: 'plan-studio-2.duplicate' },
        { id: 'plan-studio-2.sep1', separator: true },
        { id: 'plan-studio-2.up', label: 'Move up', icon: 'chevron-up', action: 'plan-studio-2.up' },
        { id: 'plan-studio-2.down', label: 'Move down', icon: 'chevron-down', action: 'plan-studio-2.down' },
        { id: 'plan-studio-2.indent', label: 'Indent', icon: 'chevron-right', action: 'plan-studio-2.indent' },
        { id: 'plan-studio-2.outdent', label: 'Outdent', icon: 'chevron-left', action: 'plan-studio-2.outdent' },
        { id: 'plan-studio-2.move', label: 'Move to…', icon: 'move', action: 'plan-studio-2.move' },
        { id: 'plan-studio-2.sep2', separator: true },
        { id: 'plan-studio-2.link', label: 'Link to…', icon: 'external', action: 'plan-studio-2.link' },
        { id: 'plan-studio-2.export', label: 'Export as Markdown', icon: 'download', action: 'plan-studio-2.export' },
        { id: 'plan-studio-2.build', label: 'Send to build orchestrator…', icon: 'rocket', action: 'plan-studio-2.build' },
        { id: 'plan-studio-2.sep3', separator: true },
        { id: 'plan-studio-2.delete', label: 'Delete (undo on the toolbar)', icon: 'trash', action: 'plan-studio-2.delete' },
      ],
    },
    { id: 'plan-studio-2.ctx.default', target: 'default', order: 41, items: [{ id: 'plan-studio-2.ctx.open', label: 'Plan Studio 2.0', icon: 'branch', action: 'nav:plan-studio-2' }] },
  ],
  slots: { 'builds.toolbar': [{ id: 'plan-studio-2', order: 13, render: () => <OpenButton /> }] },
  dialogs: {
    [DIALOGS.item]: { title: 'Plan item', icon: 'edit', searchable: false, render: (props, close) => <ItemDialog props={props} close={close} /> },
    [DIALOGS.move]: { title: 'Move to', icon: 'move', searchable: false, render: (props, close) => <MoveDialog props={props} close={close} /> },
    [DIALOGS.link]: { title: 'Link to', icon: 'external', searchable: false, render: (props, close) => <LinkDialog props={props} close={close} /> },
    [DIALOGS.build]: { title: 'Send to the build orchestrator', icon: 'rocket', searchable: false, render: (props, close) => <BuildDialog props={props} close={close} /> },
  },
  views: { [VIEW]: { title: 'Plan Studio 2.0', icon: 'branch', keywords: ['plan', 'plans', 'planning', 'tree', 'steps', 'sections', 'notes', 'lists', 'outline', 'roadmap', 'plan studio 2'], render: () => <PlanStudio2Page /> } },
  nav: { label: 'Plan', items: [{ id: 'plan-studio-2', label: 'Plan Studio 2.0', icon: 'branch', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Plan Studio 2.0', icon: 'branch', parent: 'plugins', order: 43, description: 'The planning tree, its voice and defaults.' }],
  settings: [{
    id: 'plan-studio-2.prefs', label: 'Plan Studio 2.0', icon: 'branch', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.pageLayout, label: 'Page layout', kind: 'choice', default: lc.DEFAULT_LAYOUT, options: lc.layouts().map((l) => ({ value: l.id, label: l.label })) },
      { key: KEYS.showDone, label: 'Show done steps and list items', kind: 'toggle', default: true },
      { key: KEYS.defaultModel, label: 'Model for new steps', kind: 'choice', default: '', options: [{ value: '', label: 'Any' }, { value: 'Fable', label: 'Fable' }, { value: 'Opus', label: 'Opus' }, { value: 'Sonnet', label: 'Sonnet' }] },
      { key: KEYS.voiceOut, label: 'Spoken replies', kind: 'choice', default: 'auto', options: [{ value: 'auto', label: 'Agent voice when installed, else the device' }, { value: 'device', label: 'The device voice' }] },
      { key: KEYS.voiceLang, label: 'Voice language', kind: 'choice', default: 'en-US', options: [{ value: 'en-US', label: 'English (US)' }, { value: 'en-GB', label: 'English (UK)' }, { value: 'en-CA', label: 'English (Canada)' }] },
    ],
  }],
  settingsPanels: [{ id: 'plan-studio-2.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
