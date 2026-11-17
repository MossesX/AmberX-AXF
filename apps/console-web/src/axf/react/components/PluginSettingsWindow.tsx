/**
 * PluginSettingsWindow (plugin-settings@1, spec/PLUGIN-SETTINGS.md; Brett, Nov 17 2026: "Each plugin needs its own
 * settings interface, not the console's.").
 *
 * One plugin's settings interface on its own: the plugin's `settings/plugin-<id>` asset (or the default the engine
 * generates from the plugin's registered tabs and groups), its level toolbar, a tab row of only that plugin's tabs, and
 * only that plugin's keys. It never renders the app's Settings, never opens it at the Plugins tab, and never reads the
 * app's `settings` asset: inside the window `useSettingsUiOverride()` hands every settings body the plugin's interface.
 *
 * The frame lives here; the bodies (a tab's groups and panels, the level toolbar, the reset button) come from the
 * settings library through `setPluginSettingsRenderer`, the same split as Banner settings (setBannerOwnSettingsRenderer),
 * so framework/react never imports a library.
 *
 *   dialog   PLUGIN_SETTINGS_DIALOG (`axf.settings.plugin`, props { plugin, tab? }), opened by `settings.plugin:<id>`
 *   address  settings:plugin/<id> (console-control@1, data-axf-target on the root)
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { TabGroup } from './TabGroup';
import { resolveSettingsInterface, type ResolvedSettingsInterface } from '../../core/engines/plugin-settings';
import type { SettingsUi } from '../../core/engines/settingsui';
import type { AxfRuntime } from '../../core';
import { SETTINGS_PLUGIN_DIALOG } from '../../core/engines/settingsopen';

/** Dialog id of the window (props: `plugin` = plugin id, `tab` = one of its tab ids). */
export const PLUGIN_SETTINGS_DIALOG = SETTINGS_PLUGIN_DIALOG;
/** Action that opens it: `settings.plugin:<plugin id>[:<tab>]`. */
export const PLUGIN_SETTINGS_ACTION = 'settings.plugin';
/** console-control@1 address of one plugin's window. */
export const pluginSettingsTarget = (pluginId: string): string => `settings:plugin/${pluginId}`;

/** The interface settings bodies render through: the plugin's inside a PluginSettingsWindow, null = the app's own. */
const SettingsUiOverride = createContext<SettingsUi | null>(null);
export const SettingsUiProvider = SettingsUiOverride.Provider;
export const useSettingsUiOverride = (): SettingsUi | null => useContext(SettingsUiOverride);

/** What the settings library draws inside the window. */
export interface PluginSettingsRenderer {
  /** one tab's groups and panels */
  tab: (tabId: string) => ReactNode;
  /** the level toolbar (it reads the interface from useSettingsUiOverride) */
  levelBar: () => ReactNode;
  /** the Reset button for this plugin's scope (ResetConfirmDialog) */
  reset?: (pluginId: string) => ReactNode;
}
let renderer: PluginSettingsRenderer | null = null;
export function setPluginSettingsRenderer(r: PluginSettingsRenderer | null): void { renderer = r; }

/** The plugin a settings tab belongs to: its own `plugin`, else its parent's. */
export function pluginOfSettingsTab(rt: AxfRuntime, tabId: string | undefined): string | undefined {
  if (!tabId) return undefined;
  const t = rt.settings.getTab(tabId);
  return t?.plugin ?? (t?.parent ? rt.settings.getTab(t.parent)?.plugin : undefined);
}

/** Every tab and group the registry holds now (the engine keeps the plugin's). */
function registered(rt: AxfRuntime) {
  const tabs = rt.settings.listTabs();
  const seen = new Set<string>();
  const groups = tabs.flatMap((t) => rt.settings.groupsIn(t.id)).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  return { tabs, groups };
}

/** The plugin's resolved interface (plugin-settings@1): its own asset, else the generated default. Never the app's. */
export function resolvePluginSettings(rt: AxfRuntime, pluginId: string): ResolvedSettingsInterface {
  const { tabs, groups } = registered(rt);
  return resolveSettingsInterface({ kind: 'plugin', id: pluginId }, { assets: rt.registry.list('settings'), appPick: rt.assetOrNull('settings')?.id ?? null, tabs, groups });
}

/** The same, live (settings and assets). */
export function usePluginSettingsInterface(pluginId: string): ResolvedSettingsInterface {
  const rt = useRuntime();
  const st = useAxfState();
  const rev = useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
  return useMemo(() => resolvePluginSettings(rt, pluginId), [rt, pluginId, rev, st]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The plugin's display name: its library label, else the id. */
function pluginName(rt: AxfRuntime, pluginId: string): string {
  const tab = rt.settings.listTabs().find((t) => t.plugin === pluginId);
  return tab?.label ?? pluginId;
}

export interface PluginSettingsWindowProps {
  /** the plugin id (plugin.json `id`) */
  plugin: string;
  /** the tab to start on (one of the plugin's) */
  tab?: string;
}

/** One plugin's own settings interface. */
export function PluginSettingsWindow({ plugin, tab }: PluginSettingsWindowProps) {
  const rt = useRuntime();
  const resolved = usePluginSettingsInterface(plugin);
  const ui = resolved.ui;
  const ownTabs = useMemo(() => {
    const ids = new Set(ui.tabs.map((t) => t.id));
    const all = rt.settings.listTabs().filter((t) => t.plugin === plugin || ids.has(t.id));
    return all.filter((t) => !ui.hide.includes(t.id));
  }, [rt, plugin, ui]);
  const [pick, setPick] = useState(() => (tab && ownTabs.some((t) => t.id === tab) ? tab : ownTabs[0]?.id ?? ''));
  const current = ownTabs.find((t) => t.id === pick) ?? ownTabs[0];
  const name = pluginName(rt, plugin);
  return (
    <SettingsUiProvider value={ui}>
      <div className="fx-stack axf-settings axf-settings--dialog axf-settings--plugin" data-axf-target={pluginSettingsTarget(plugin)} data-axf-plugin-settings={plugin} data-axf-help-id="settings.plugin-window" data-axf-settings-source={resolved.source} data-axf-settings-interface={resolved.id}>
        <div className="axf-settings__dialoghead">
          <p className="fx-eyebrow"><Icon name={current?.icon ?? 'settings'} /> {name}</p>
          {renderer?.reset?.(plugin)}
        </div>
        {ui.levels && renderer?.levelBar()}
        {ownTabs.length > 1 && (
          <TabGroup id={`settings.plugin.${plugin}`} label={`${name} settings sections`} className="axf-settings__subtabs" size="sm" value={current?.id ?? ''} onChange={setPick}
            tabs={ownTabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))} />
        )}
        {current?.description && <p className="fx-muted axf-settings__desc">{current.description}</p>}
        {!current ? <p className="fx-muted">{name} has no settings.</p> : renderer ? renderer.tab(current.id) : <p className="fx-muted">The settings library is not installed.</p>}
      </div>
    </SettingsUiProvider>
  );
}
