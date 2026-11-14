/**
 * Themed controls (themed-controls@1, framework/spec/THEMED-CONTROLS.md; Brett, Nov 14 2026: "replace other browser
 * elements like the dropdowns with themed ones"). Swaps the controls and dialogs the browser draws itself for themed
 * ones drawn from tokens, one switch per family, under Settings → Plugins → Themed controls. Switched off or removed,
 * every element is the browser's own again.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { TC_KEYS } from '@console/axf/core/engines/themed-controls';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, FamiliesPanel, TAB, settingsGroups } from './settings';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.themed-controls',
  label: 'Themed controls',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('themed-controls.open', () => rt.dispatch(`settings.open:${TAB}`), { label: 'Themed controls settings' });
    rt.actions.register('themed-controls.toggle', () => rt.settings.set(TC_KEYS.on, rt.settings.get(TC_KEYS.on) === false), { label: 'Turn themed controls on or off' });
  },
  settingsTabs: [{ id: TAB, label: 'Themed controls', icon: 'sliders', order: 60, parent: 'plugins', description: 'Swap the checkboxes, sliders, pickers, dialogs, tooltips and scrollbars the browser draws for themed ones; one switch per family.' }],
  settings: settingsGroups(),
  settingsPanels: [
    { id: 'themed-controls.families-info', tab: TAB, title: 'What each switch replaces', icon: 'info', order: 10, render: () => <FamiliesPanel /> },
    { id: 'themed-controls.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
