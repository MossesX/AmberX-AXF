/** What the manager can do to a plugin. Enable/disable use the console's own route, so they work for every plugin. */
import type { AxfRuntime } from '@console/axf/core';
import { post } from '@console/api';
import { PLUGINS_CHANGED } from '@console/plugins';
import type { PluginRow } from './model';

export async function setEnabled(rt: AxfRuntime, row: Pick<PluginRow, 'folder' | 'name'>, enabled: boolean): Promise<boolean> {
  if (row.folder === 'plugin-manager' && !enabled) {
    rt.toast('Switching off the Plugin Manager closes it. Turn it back on in Settings → Plugins → All plugins.', 'info', 'Plugin Manager');
  }
  const r = await post(`plugins/${row.folder}/enabled`, { enabled });
  if (!r.ok) {
    rt.toast(String(r.error ?? 'Could not change the plugin (is the console token set?).'), 'danger', 'Plugins');
    return false;
  }
  globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
  rt.toast(`${enabled ? 'Enabled' : 'Disabled'} ${row.name}.`, 'success', 'Plugins');
  return true;
}

/** The plugin's first view (its main UI), or its first dialog. Returns false when it has no UI to open. */
export function openUi(rt: AxfRuntime, row: PluginRow, id?: string): boolean {
  if (!row.enabled) { rt.toast(`${row.name} is off. Enable it to open its UI.`, 'warning', 'Plugin Manager'); return false; }
  const view = id ? row.ui.views.find((v) => v.id === id) : row.ui.views[0];
  if (view) { rt.navigate(view.id); return true; }
  const dialog = id ? row.ui.dialogs.find((d) => d.id === id) : row.ui.dialogs[0];
  if (dialog) { rt.openDialog(dialog.id); return true; }
  rt.toast(`${row.name} has no page or window of its own.`, 'info', 'Plugin Manager');
  return false;
}

export function openSettings(rt: AxfRuntime, row: PluginRow, tab?: string): boolean {
  const t = tab ?? row.ui.settingsTabs[0]?.id;
  if (!t) { rt.toast(`${row.name} has no settings.`, 'info', 'Plugin Manager'); return false; }
  if (!row.enabled) { rt.toast(`${row.name} is off, so its settings tab is hidden. Enable it first.`, 'warning', 'Plugin Manager'); return false; }
  rt.closeDialog();
  rt.dispatch(`settings.open:${t}`);
  return true;
}

export const hasUi = (row: PluginRow) => row.ui.views.length + row.ui.dialogs.length > 0;
export const hasSettings = (row: PluginRow) => row.ui.settingsTabs.length > 0;
