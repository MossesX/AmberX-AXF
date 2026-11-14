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
import { appMenu } from './menu';
import { K, configFrom } from './settings';

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
  slots: { 'app.frame.cover': [{ id: 'picker-dialog.swap', order: 1, render: () => <PickerSwapSwitch /> }] },
  settingsTabs: [{ id: 'picker-dialog', label: 'Picker dialog', icon: 'list', order: 60, parent: 'plugins', description: 'Drop-downs open a themed picker dialog (a bottom sheet on phones) instead of the browser list.' }],
};
