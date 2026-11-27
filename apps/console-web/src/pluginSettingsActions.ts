/**
 * The console action behind every plugin settings gear (build every-plugin-screen-gets-a-settings-gear), kept apart from
 * PluginSettingsGear.tsx so the gear (imported by pluginLoader) never imports the plugin list (which imports pluginLoader).
 */
import type { AxfRuntime } from './axf/core';
import { bundledPlugins, type BundledPlugin } from './plugins';

/** A plugin by folder, manifest id, its last id segment or its name (case-insensitive), as voice and the CLI say it. */
export function findPlugin(ref: string): BundledPlugin | undefined {
  const r = (ref ?? '').trim().replace(/^plugin:/, '').toLowerCase();
  if (!r) return undefined;
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return bundledPlugins.find((p) => p.folder === r || p.manifest.id.toLowerCase() === r || p.manifest.id.split('.').pop() === r)
    ?? bundledPlugins.find((p) => plain(p.manifest.name) === plain(r) || plain(p.folder) === plain(r));
}

/** The Settings → Plugins sub-tab id of a plugin: its first own tab, else the default tab (folder), else none. */
export function settingsTabOf(p: BundledPlugin): string | undefined {
  return p.library?.settingsTabs?.[0]?.id ?? (p.manifest.settingsTab?.default === true ? p.folder : undefined);
}

/**
 * Console action `plugin.settings.open:<plugin>` (folder, id or name): opens Settings → Plugins → that plugin's sub-tab,
 * the same as pressing its gear. Reached by console.actions / console_action (MCP), `axf console plugin-settings <id>`,
 * REST POST /api/console-control/plugins/<id>/settings/open and AmberX ("open <plugin> settings").
 */
export function registerPluginSettingsActions(rt: AxfRuntime): () => void {
  // the ⋯ menu on a plugin screen (gear placement `menu`): its Settings item
  rt.contextExtras.set('plugin-host', (_t, folder) => (folder ? [{ id: 'plugin-host.settings', label: 'Settings', icon: 'settings', action: `plugin.settings.open:${folder}` }] : []));
  return rt.actions.register('plugin.settings.open', ([ref = '']) => {
    const p = findPlugin(ref);
    if (!p) { rt.toast(`No plugin called “${ref}”.`, 'warning', 'Plugins'); rt.dispatch('settings.open:plugins'); return; }
    const tab = settingsTabOf(p);
    rt.dispatch(tab ? `settings.open:${tab}` : 'settings.open:plugins');
  }, { label: 'Open a plugin’s settings', params: true });
}
