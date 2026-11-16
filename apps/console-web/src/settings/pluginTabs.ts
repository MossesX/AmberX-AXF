/**
 * One Settings → Plugins sub-tab for every console plugin (plugin-settings@1, core/plugin-settings.mjs).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface."
 *
 * Every bundled plugin gets its sub-tab, whether or not its web part declares one, and whether it is on or off:
 *   - the tab id is plugin.json `settings.tab` (normalizeSettings: its first `settings-tab:` else its folder name);
 *   - the tab always opens with the default sections (enable / info / logs) as its first panel, drawn by the renderer
 *     the Plugin Manager registers (setDefaultSectionsRenderer); while it is off or removed, a bare enable switch;
 *   - a plugin that has its own tab keeps it: its groups and panels follow the default sections in the same tab;
 *   - a plugin without one gets a tab made from its manifest (name, icon `package`);
 *   - a switched-off plugin keeps its tab with the default sections only, so it can be switched back on there.
 *
 * The default panels belong to the module `DEFAULTS_MODULE`, not to the plugin, so `settings.removeModule(<plugin>)`
 * (a plugin switched off) removes its own options and keeps the switch.
 */
import type { SettingsPanel, SettingsTab } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { normalizeSettings, settingsAddress, TAB_ID, type PluginSettingsBlock as PluginSettings } from '@console/axf/core/plugin-settings.mjs';
import { createElement, useEffect, useState, type ReactNode } from 'react';
import { Note, Switch } from '@console/axf/react';
import { post } from '../api';
import { fetchPluginStatus, PLUGINS_CHANGED, type BundledPlugin } from '../plugins';

/** Draws the default sections of one plugin's tab. The Plugin Manager provides it (its DefaultPluginSettingsTab). */
export type DefaultSectionsRenderer = (props: { folder: string; sections: readonly string[] }) => ReactNode;
let renderer: DefaultSectionsRenderer | null = null;
/** The Plugin Manager registers its renderer on install and clears it (null) when it goes away. */
export function setDefaultSectionsRenderer(r: DefaultSectionsRenderer | null): void { renderer = r; }

/** Without the Plugin Manager: just the switch (the console's own enabled route), so a plugin can always be turned on. */
function BareSwitch({ folder, name }: { folder: string; name: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const load = () => { void fetchPluginStatus().then((s) => setOn(s?.find((x) => x.folder === folder)?.enabled ?? null)); };
  useEffect(load, [folder]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = async (v: boolean) => { const r = await post(`plugins/${folder}/enabled`, { enabled: v }); if (r.ok) { setOn(v); globalThis.dispatchEvent(new Event(PLUGINS_CHANGED)); } };
  return createElement('div', { className: 'fx-stack' },
    createElement(Switch, { label: `${name} is on`, checked: on === true, disabled: on === null, onChange: (v: boolean) => void flip(v) }),
    createElement(Note, { tone: 'info', children: 'Info and logs come from the Plugin Manager, which is off.' }));
}

export const DEFAULTS_MODULE = 'ai.amberx.axf.console.plugin-settings';
/** Plugin sub-tabs sort after the console's own Plugins sub-tabs (All plugins, Plugin Manager…). */
const TAB_ORDER = 50;

/** The plugin's normalized settings block (every field filled). */
export function pluginSettingsOf(p: BundledPlugin): PluginSettings {
  return normalizeSettings(p.manifest, { folder: p.folder });
}

/** The plugin's sub-tab id, or '' when neither the manifest nor the folder gives a valid one. */
export function pluginTabId(p: BundledPlugin): string {
  const t = pluginSettingsOf(p).tab;
  return TAB_ID.test(t) ? t : '';
}

/** The tab a plugin gets when its web part doesn't contribute one. */
export function defaultTabFor(p: BundledPlugin, tab = pluginTabId(p)): SettingsTab {
  return { id: tab, label: p.manifest.name, icon: 'package', order: TAB_ORDER, parent: 'plugins', plugin: p.manifest.id, description: p.manifest.description };
}

/** The default sections panel (enable, info, logs) at the top of the plugin's sub-tab. */
export function defaultPanelFor(p: BundledPlugin, tab = pluginTabId(p)): SettingsPanel {
  const sections = pluginSettingsOf(p).sections.filter((s) => s === 'enable' || s === 'info' || s === 'logs');
  return {
    id: `plugin-settings.${p.folder}`, tab, title: p.manifest.name, icon: 'package', order: 0, module: DEFAULTS_MODULE,
    render: () => (renderer ? renderer({ folder: p.folder, sections }) : createElement(BareSwitch, { folder: p.folder, name: p.manifest.name })),
  };
}

/**
 * The plugin's own library with its sub-tab guaranteed: its own tabs re-parented under Plugins (the console rule) and,
 * when it declares none, the default one. The default sections are added by `pluginSettingsDefaults`, not here, so
 * they outlive the plugin being switched off.
 */
export function withPluginTab(p: BundledPlugin, lib: AxfWebLibrary): AxfWebLibrary {
  const tab = pluginTabId(p);
  const own = (lib.settingsTabs ?? []).map((t) => ({ ...t, parent: 'plugins' }));
  if (!tab || own.some((t) => t.id === tab)) return own.length ? { ...lib, settingsTabs: own } : lib;
  return { ...lib, settingsTabs: [...own, defaultTabFor(p, tab)] };
}

/**
 * The library that puts the default sections into every plugin's sub-tab, and the whole tab for plugins that are off
 * (their web part isn't installed, so nothing else registers it).
 */
export function pluginSettingsDefaults(all: readonly BundledPlugin[], installed: readonly BundledPlugin[]): AxfWebLibrary {
  const on = new Set(installed.map((p) => p.folder));
  const withTab = all.filter((p) => pluginTabId(p));
  return {
    id: DEFAULTS_MODULE,
    label: 'Plugin settings',
    version: '1.0.0',
    settingsTabs: withTab.filter((p) => !on.has(p.folder)).map((p) => defaultTabFor(p)),
    settingsPanels: withTab.map((p) => defaultPanelFor(p)),
  };
}

/** Where each plugin's sub-tab is (console-control address), for search, the API and the checks. */
export function pluginSettingsIndex(all: readonly BundledPlugin[]): { folder: string; id: string; name: string; tab: string; address: string; options: string[]; gear: boolean }[] {
  return all.map((p) => {
    const s = pluginSettingsOf(p);
    const tab = pluginTabId(p);
    return { folder: p.folder, id: p.manifest.id, name: p.manifest.name, tab, address: tab ? settingsAddress(tab) : '', options: s.options, gear: s.gear };
  });
}
