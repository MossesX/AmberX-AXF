import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, OPEN_ACTION, VIEW, requestOpen } from './api';
import { CheckerPanel } from './CheckerPanel';
import { CheckerSettings } from './CheckerSettings';
import { appMenu } from './menu';
import './skin-editor.css';

/*
 * Skin editor (web part): the skin checker (skin-check@1). Nav → Plugins → Skin editor; Settings → Plugins → Skin
 * editor holds the threshold settings. Deep link: console_show / console_open target skin-editor/checker, the action
 * `skin-editor.checker:<skin>:<issueId>`, or `?skin=&issue=` in the address. Everything else the panel does is a REST
 * call to the plugin's routes, which MCP (skin_editor_*), `axf skin` and AmberX voice reach the same way.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Skin editor',
  version: '0.1.0',
  appMenu,
  dependsOn: [],
  register(rt) {
    rt.actions.register('skin-editor.open', () => rt.navigate(VIEW), { label: 'Open the skin checker' });
    // issue ids contain ':', so everything after the skin is the issue id
    rt.actions.register(OPEN_ACTION, (args) => { requestOpen(args[0] ?? '', args.slice(1).join(':')); rt.navigate(VIEW); }, { label: 'Skin checker: open a skin (and an issue)' });
  },
  views: {
    [VIEW]: {
      title: 'Skin editor',
      icon: 'shield',
      keywords: ['skin', 'checker', 'check', 'lint', 'professional', 'spacing', 'typography', 'fonts', 'palette', 'contrast', 'wcag', 'radius', 'score', 'skin-editor/checker'],
      render: () => (
        <div className="fx-stack fx-stack--lg">
          <header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Skin checker</h1><p className="fx-muted" title="Flags spacing off the token scale, more than two typefaces or off-scale type sizes, palette sprawl and near-duplicate colours, WCAG contrast failures, and inconsistent radius, borders and shadows. One click fixes most of them.">Score a skin and fix what breaks a professional look.</p></div></header>
          <CheckerPanel />
        </div>
      ),
    },
  },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Skin editor', icon: 'shield', view: VIEW }] },
  settingsTabs: [{ id: 'skin-editor', label: 'Skin editor', icon: 'shield', parent: 'plugins', order: 46, description: 'The skin checker\'s thresholds: minimum score, typefaces, palette size, contrast ratios, radii and more.' }],
  settingsPanels: [
    { id: 'skin-editor.thresholds', tab: 'skin-editor', title: 'Checker thresholds', icon: 'sliders', order: 10, render: () => <CheckerSettings /> },
    { id: 'skin-editor.lifecycle', tab: 'skin-editor', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
