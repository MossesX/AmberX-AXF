/**
 * Themed controls (themed-controls@1, framework/spec/THEMED-CONTROLS.md; Brett, Nov 14 2026: "replace other browser
 * elements like the dropdowns with themed ones"). Swaps the controls and dialogs the browser draws itself for themed
 * ones drawn from tokens, one switch per family, under Settings → Plugins → Themed controls. Switched off or removed,
 * every element is the browser's own again.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { boot } from './boot';
import { FOLDER, FamiliesPanel, TAB, settingsGroups } from './settings';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.themed-controls',
  label: 'Themed controls',
  version: '0.1.0',
  appMenu,
  register(rt) { boot(rt); },
  settingsTabs: [{ id: TAB, label: 'Themed controls', icon: 'sliders', order: 60, parent: 'plugins', description: 'Swap the checkboxes, sliders, pickers, dialogs, tooltips and scrollbars the browser draws for themed ones; one switch per family.' }],
  settings: settingsGroups(),
  settingsPanels: [
    { id: 'themed-controls.families-info', tab: TAB, title: 'What each switch replaces', icon: 'info', order: 10, render: () => <FamiliesPanel /> },
    { id: 'themed-controls.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
