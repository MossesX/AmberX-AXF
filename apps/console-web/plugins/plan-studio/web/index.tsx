/**
 * Plan Studio console plugin (ai.amberx.axf.console.plan-studio): every plan (plan@1) in one place, entered by hand,
 * filed in categories, viewed every way; a Catalog of every plugin / app / library with its features; plain-English
 * AI edits; voice planning in AmberX (the plugin targets amberx-droid too: AmberX loads it unchanged and forwards its
 * server calls to the console). Quick capture from the banner (+ Plan), Builds ▸ New plan…, the search and right-click.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { Button, useRuntime } from '@console/axf/react';
import { appMenu } from './menu';
import { CaptureDialog } from './capture';
import { focusPlan, PlanStudioPage } from './ui';
import { FOLDER, KEYS, VIEW } from './api';
import { SECTIONS } from './editor';
import { foldAll, readDock, setLayout, writeDock } from './layout';
import * as lc from './layout-core.mjs';

const ID = 'ai.amberx.axf.console.plan-studio';
const DIALOG = 'plan-studio.capture';
const BANNER_ASSET = 'plan-studio-capture';

function OpenStudioButton() {
  const rt = useRuntime();
  return <Button icon="layout" onClick={() => rt.navigate(VIEW)} title="Every plan, and every plugin and app with its features">Plan Studio</Button>;
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Plan Studio',
  version: '0.1.0',
  appMenu,
  provides: ['plans@1'],
  builtWith: { model: 'opus', builtAt: '2026-10-30' },
  register(rt) {
    rt.actions.register('plan-studio.open', () => rt.navigate(VIEW), { label: 'Open Plan Studio' });
    // Deep links down to the item: `plan-studio.focus:<plan id>[/<item ref>]` or words ("the plan about X, the step that
    // mentions Y"); console.screens act open plan-studio with input.focus runs it (REST, MCP console_open / console_show, CLI, voice).
    rt.actions.register('plan-studio.focus', ([enc = '']) => { rt.navigate(VIEW); focusPlan(decodeURIComponent(enc)); }, { label: 'Open a plan, down to one step or item', params: true, effect: 'navigate' });
    // Page layouts (nav menu, tabs, IDE panes) and the IDE dock, the same through REST, MCP, the CLI and voice:
    // `plan-studio.layout:<id or words>[:<dock-layout asset>]`, `plan-studio.dock:<op>:<args…>`, collapse / expand all.
    const secIds = SECTIONS.map((x) => x.id);
    rt.actions.register('plan-studio.layout', ([q = '', preset = '']) => {
      const id = setLayout(rt, decodeURIComponent(q), secIds, preset ? decodeURIComponent(preset) : undefined);
      rt.navigate(VIEW); rt.toast(`Plan Studio layout: ${lc.resolveLayout(id)?.label ?? id}`, 'success', 'Plan Studio');
    }, { label: 'Plan Studio: switch page layout (nav menu, tabs, IDE panes)', params: true });
    rt.actions.register('plan-studio.dock', ([op = '', a = '', b = '', c = '']) => {
      const d = readDock(rt, secIds);
      const next = op === 'move' ? lc.moveTab(d, a, b, c === '' ? undefined : Number(c), secIds)
        : op === 'split' ? lc.splitWith(d, a, b, c as lc.DockSide, secIds)
        : op === 'close-pane' ? lc.closePane(d, a, secIds)
        : op === 'close' ? lc.closeTab(d, a, secIds)
        : op === 'reopen' ? lc.reopen(d, a, secIds)
        : op === 'show' ? lc.activate(d, a, secIds)
        : op === 'reorder' ? lc.reorder(d, a, b.split(','), secIds)
        : op === 'reset' ? null
        : undefined;
      if (next === undefined) throw new Error('Dock ops: move:<section>:<pane>[:<index>], split:<section>:<pane>:<left|right|top|bottom>, close-pane:<pane>, close:<section>, reopen:<section>, show:<section>, reorder:<pane>:<a,b,c>, reset.');
      if (next === null) rt.settings.set(KEYS.dock, null as never); else writeDock(rt, next);
      if (lc.resolveLayout(rt.settings.get(KEYS.pageLayout) as string)?.kind !== 'dock') rt.settings.set(KEYS.pageLayout, 'ide');
    }, { label: 'Plan Studio: move, split, close or reopen IDE panes and tabs', params: true });
    rt.actions.register('plan-studio.collapse-all', () => foldAll(rt, 'collapsed'), { label: 'Plan Studio: collapse all (every plan, section and step)' });
    rt.actions.register('plan-studio.expand-all', () => foldAll(rt, 'expanded'), { label: 'Plan Studio: expand all (every plan, section and step)' });
    rt.actions.register('plan-studio.capture', () => rt.openDialog(DIALOG), { label: 'New plan (quick capture)' });
    // the banner "+ Plan": the framework's action-button widget (opens quick capture; Settings → Plugins → Plan Studio hides it)
    const paint = () => {
      const on = rt.settings.get(KEYS.banner) !== false;
      rt.registry.register({
        $axf: 'asset@1', type: 'action-button', id: BANNER_ASSET, name: 'New plan', version: '0.1.0', author: 'Plan Studio plugin',
        description: 'Quick capture: a new plan in two taps.', tags: ['plans'],
        data: { icon: 'plus', label: 'Plan', action: 'plan-studio.capture', show: 'both', tone: 'neutral', tooltip: 'New plan (Plan Studio)' },
      } as never, 'app', ID);
      if (on) rt.attachToBanner({ type: 'action-button', id: BANNER_ASSET, at: 'right', order: 31, origin: ID, widget: { label: 'Plan', icon: 'map', size: 'compact', priority: 3, aliases: ['plan studio'] } });
      else rt.detachFromBanner(`action-button:${BANNER_ASSET}`);
    };
    rt.settings.onChange(KEYS.banner, paint);
    paint();
  },
  contextMenu: [{ id: 'plan-studio.ctx', target: 'default', order: 40, items: [{ id: 'plan-studio.ctx.new', label: 'New plan…', icon: 'plus', action: 'plan-studio.capture' }, { id: 'plan-studio.ctx.open', label: 'Plan Studio', icon: 'layout', action: 'nav:plan-studio' }] }],
  slots: { 'builds.toolbar': [{ id: 'plan-studio', order: 12, render: () => <OpenStudioButton /> }] },
  dialogs: { [DIALOG]: { title: 'New plan', icon: 'plus', render: (props, close) => <CaptureDialog close={close} text={typeof props.text === 'string' ? props.text : ''} /> } },
  views: { [VIEW]: { title: 'Plan Studio', icon: 'layout', keywords: ['plan', 'plans', 'planning', 'roadmap', 'catalog', 'features', 'ideas', 'parked', 'later', 'backlog', 'what to build'], render: () => <PlanStudioPage /> } },
  nav: { label: 'Builds', items: [{ id: 'plan-studio', label: 'Plan Studio', icon: 'layout', view: 'plan-studio' }] },
  settingsTabs: [{ id: FOLDER, label: 'Plan Studio', icon: 'layout', parent: 'plugins', order: 42, description: 'Plans, the Catalog, the plan AI and voice.' }],
  settings: [{
    id: 'plan-studio.prefs', label: 'Plan Studio', icon: 'layout', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.pageLayout, label: 'Page layout (plan sections)', kind: 'choice', default: lc.DEFAULT_LAYOUT, options: lc.layouts().map((l) => ({ value: l.id, label: l.label })) },
      { key: KEYS.layout, label: 'Plans open as', kind: 'choice', default: 'grid', options: [{ value: 'tree', label: 'Tree' }, { value: 'grid', label: 'Grid' }, { value: 'groups', label: 'Sub-grids' }, { value: 'board', label: 'Board' }, { value: 'roadmap', label: 'Roadmap' }, { value: 'reader', label: 'Reader' }] },
      { key: KEYS.sort, label: 'Default order', kind: 'choice', default: 'priority', options: [{ value: 'priority', label: 'Priority' }, { value: 'updated', label: 'Last changed' }, { value: 'target', label: 'Target date' }, { value: 'title', label: 'Title' }] },
      { key: KEYS.group, label: 'Sub-grids group by', kind: 'choice', default: 'category', options: [{ value: 'category', label: 'Category' }, { value: 'status', label: 'Status' }, { value: 'project', label: 'Project' }, { value: 'tag', label: 'Tag' }, { value: 'priority', label: 'Priority' }] },
      { key: KEYS.autosave, label: 'Autosave saved plans while editing', kind: 'toggle', default: true },
      { key: KEYS.autoApply, label: 'Apply small AI edits straight away (with Undo)', kind: 'toggle', default: false },
      { key: KEYS.banner, label: 'Show “+ Plan” on the banner', kind: 'toggle', default: true },
      { key: KEYS.voiceOut, label: 'Spoken replies', kind: 'choice', default: 'auto', options: [{ value: 'auto', label: 'Agent voice when installed, else the device' }, { value: 'device', label: 'The device voice' }] },
      { key: KEYS.voiceLang, label: 'Voice language', kind: 'choice', default: 'en-US', options: [{ value: 'en-US', label: 'English (US)' }, { value: 'en-GB', label: 'English (UK)' }, { value: 'en-CA', label: 'English (Canada)' }] },
    ],
  }],
  settingsPanels: [{ id: 'plan-studio.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
