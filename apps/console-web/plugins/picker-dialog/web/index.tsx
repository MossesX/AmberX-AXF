/**
 * Picker dialog plugin (picker@1; build picker-dialog-plugin-replaces-all, Nov 14 2026). Brett: "I want a plugin that
 * replaces all drop down select boxes with a themable dialogue that matches the theme; skins have to touch them; they
 * must conform to the token system".
 *
 * The framework draws the picker (PickerField / PickerDialog, --fx-picker-* tokens) and owns the swap layer
 * (pickerSwap); this plugin only switches the swap on, from its settings, while it is installed and enabled. Its
 * switch lives in the always-mounted `app.frame.cover` slot: disable or uninstall the plugin and the slot unmounts,
 * the swap goes off and every drop-down is the original control again.
 */
import { useEffect } from 'react';
import { setPickerSwap, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { registerPickerActions } from './actions';
import { appMenu } from './menu';
import { APPS, DEFAULTS, FOLDER, K, configFrom } from './settings';

export const ID = 'ai.amberx.axf.console.picker-dialog';

/** Keeps the framework's picker swap in step with this plugin's settings; off when unmounted. */
function PickerSwapSwitch() {
  const rt = useRuntime();
  useEffect(() => {
    const apply = () => setPickerSwap(configFrom((k) => rt.settings.get(k), 'console-web'));
    apply();
    const offs = Object.values(K).map((k) => rt.settings.onChange(k, apply));
    return () => { for (const off of offs) off?.(); setPickerSwap({ enabled: false }); };
  }, [rt]);
  return null;
}

export const plugin: AxfWebLibrary = {
  id: ID, // must equal plugin.json "id"
  label: 'Picker dialog',
  version: '0.1.0',
  builtWith: { model: 'claude-opus-5-5', builtAt: '2026-11-14' },
  appMenu,
  register(rt) { registerPickerActions(rt); },
  slots: { 'app.frame.cover': [{ id: 'picker-dialog.swap', order: 1, render: () => <PickerSwapSwitch /> }] },
  // Settings → Plugins → Picker dialog (ids and keys are literals so the control inventory reads them). Every setting is a control@1 target (`setting:axf.picker.*`), so the console API,
  // MCP, the CLI and voice set the same values this tab shows; the app's settings level toolbar filters the groups.
  settingsTabs: [{ id: 'picker-dialog', label: 'Picker dialog', icon: 'list', order: 60, parent: 'plugins', description: 'Drop-downs open a themed picker dialog (a bottom sheet on phones) instead of the browser list.' }],
  settings: [
    { id: 'picker-dialog.main', label: 'Picker dialog', icon: 'list', tab: 'picker-dialog', order: 1, description: 'Turn it off and every drop-down is the original control again.', settings: [
      { key: 'axf.picker.enabled', label: 'Open drop-downs in the picker dialog', kind: 'toggle', default: DEFAULTS.enabled, description: 'On: every drop-down opens the themed picker. Off: the browser\'s own drop-downs, untouched.' },
      { key: 'axf.picker.searchThreshold', label: 'Show the search box from this many options', kind: 'number', default: DEFAULTS.searchThreshold, min: 0, max: 200, step: 1, description: '0 = always, 200 = practically never.' },
      { key: 'axf.picker.sheetOnPhone', label: 'Bottom sheet on phones', kind: 'toggle', default: DEFAULTS.sheetOnPhone, description: 'Off: phones get the same centred dialog as desktop.' },
    ] },
    { id: 'picker-dialog.scope', label: 'What it replaces', icon: 'sliders', tab: 'picker-dialog', order: 2, settings: [
      { key: 'axf.picker.swapSelectFields', label: 'Framework select fields', kind: 'toggle', default: DEFAULTS.swapSelectFields, description: 'SelectField controls render the picker field.' },
      { key: 'axf.picker.swapSelects', label: 'Every other drop-down on the page', kind: 'toggle', default: DEFAULTS.swapSelects, description: 'Plain select boxes get a picker trigger; the original stays hidden as the value the form sends.' },
      { key: 'axf.picker.excludeApps', label: 'Keep the original drop-downs in', kind: 'multi_choice', default: [], options: APPS, description: 'Apps listed here are left alone.' },
    ] },
  ],
  settingsPanels: [{ id: 'picker-dialog.lifecycle', tab: 'picker-dialog', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
