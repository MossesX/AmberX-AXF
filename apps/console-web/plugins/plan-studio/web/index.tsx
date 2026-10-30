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
import { PlanStudioPage } from './ui';
import { FOLDER, KEYS, VIEW } from './api';

const ID = 'ai.amberx.axf.console.plan-studio';
const DIALOG = 'plan-studio.capture';
const STATUS_ASSET = 'plan-studio-capture';

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
    rt.actions.register('plan-studio.capture', () => rt.openDialog(DIALOG), { label: 'New plan (quick capture)' });
    // the banner "+ Plan" (a status badge that opens quick capture; Settings → Plugins → Plan Studio hides it)
    const paint = () => {
      const on = rt.settings.get(KEYS.banner) !== false;
      rt.registry.register({
        $axf: 'asset@1', type: 'status', id: STATUS_ASSET, name: 'New plan', version: '0.1.0', author: 'Plan Studio plugin',
        description: 'Quick capture: a new plan in two taps.', tags: ['plans'],
        data: { counter: 'plan-studio.capture', onLabel: '+ Plan', offLabel: '+ Plan', onTone: 'accent', offTone: 'accent', dot: false, link: 'plan-studio.capture' },
      } as never, 'app', ID);
      rt.setBadge('plan-studio.capture', 1);
      if (on) rt.attachToBanner({ type: 'status', id: STATUS_ASSET, at: 'right', order: 30, origin: ID });
      else rt.detachFromBanner(`status:${STATUS_ASSET}`);
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
