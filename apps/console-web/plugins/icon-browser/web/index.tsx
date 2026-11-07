/**
 * Icon Browser console plugin (ai.amberx.axf.console.icon-browser): the icon library (framework/icon-library: 7
 * open-licensed sets as icon-pack assets, plus the packs you make) as a tree, grid or list in nav → Plugins → Icon
 * browser, a pack composer and tab groups for selected icons (panes.tsx), and the Icon Manager (manager.tsx): every
 * UI's icon map. The library is served by this plugin's server part (never bundled).
 * Actions: icon-browser.open, icon-browser.manager, icon-browser.open-group.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { IconBrowser } from './Browser';
import { IconManager } from './manager';
import { COMPOSER_TAB_KIND, ComposerPane, IconActions, LIBRARY_TAB_KIND, floatPane, iconTabRenderers, openIconGroup } from './panes';
import { SettingsPanel } from './SettingsPanel';
import { loadConfig, saveConfig } from './api';
import { DEFAULT_CONFIG, FOLDER, ICON_TAB_KIND, ID, MANAGER_VIEW, VIEW, type Config, type IconRecord } from './model';
import './icon-browser.css';
import { appMenu } from './menu';

/** The config is one object for the whole plugin (server-side); the page keeps a copy and saves patches. */
export function useConfig(): [Config, (patch: Partial<Config>) => void] {
  const rt = useRuntime();
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  useEffect(() => { let live = true; loadConfig().then((c) => live && setConfig(c), () => {}); return () => { live = false; }; }, []);
  const patch = useCallback((p: Partial<Config>) => { setConfig((c) => ({ ...c, ...p })); void saveConfig(p).then(setConfig, () => rt.toast('Could not save the Icon browser settings.', 'danger', 'Icon browser')); }, [rt]);
  return [config, patch];
}

function BrowserPage() {
  const rt = useRuntime();
  const [config, patch] = useConfig();
  const [selection, setSelection] = useState<IconRecord[]>([]);
  const [active, setActive] = useState<IconRecord | null>(null);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Design &amp; branding</p><h1>Icon browser</h1><p className="fx-muted" title="Every icon the framework ships and every pack you add: browse, search, compose packs, open icons in tab groups.">Browse the icon library, compose packs, open icons in tab groups.</p></div>
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="external" onClick={() => floatPane(rt, LIBRARY_TAB_KIND)}>Float the library</Button>
          <Button size="sm" icon={config.openNewGroup === 'floating' ? 'external' : 'layout'} onClick={() => openIconGroup(rt, selection, config.openNewGroup)}>{selection.length ? `Open ${selection.length} in a new tab group` : 'Open new tab group'}</Button>
          <Button size="sm" icon="layers" onClick={() => rt.navigate(MANAGER_VIEW)}>Icon manager</Button>
        </div>
      </header>
      <IconBrowser
        config={config} onConfig={patch} selection={selection} onSelection={setSelection} active={config.panes.details ? active : null} onActive={setActive}
        actions={(icons) => <IconActions icons={icons} config={config} />}
        side={config.panes.composer ? <ComposerPane config={config} /> : null}
      />
      <p className="fx-small fx-muted">Drag icons onto the composer, a tab group or the Icon Manager. Click selects, Ctrl / Cmd adds, Shift selects a range; in the tree a double-click selects a whole set or category and a drag takes it all.</p>
    </div>
  );
}

function ManagerPage() {
  const [config, patch] = useConfig();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Icon manager</h1><p className="fx-muted" title="Every UI and plugin has an icon map: pick a pack per app, screen or plugin, pin single icons, randomize or generate a cohesive set.">Every UI's icon map: packs per app, screen or plugin, single icons pinned, Randomize and Generate.</p></div></header>
      <IconManager config={config} onConfig={patch} />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Icon browser',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('icon-browser.open', () => rt.navigate(VIEW), { label: 'Open the icon browser' });
    rt.actions.register('icon-browser.manager', () => rt.navigate(MANAGER_VIEW), { label: 'Open the icon manager' });
    rt.actions.register('icon-browser.open-group', ([where = 'docked', ...refs]) => openIconGroup(rt, refs.filter(Boolean).map((ref) => ({ ref: ref.replace(/^pack\/([a-z0-9-]+)\//, 'pack:$1/') })), where === 'floating' ? 'floating' : 'docked'), { label: 'Open icons in a new tab group (docked | floating, pack/<id>/<glyph>…)', params: true });
    rt.actions.register('icon-browser.float', () => floatPane(rt, LIBRARY_TAB_KIND), { label: 'Float the icon library' });
    rt.actions.register('icon-browser.float-composer', () => floatPane(rt, COMPOSER_TAB_KIND), { label: 'Float the pack composer' });
  },
  views: {
    [VIEW]: { title: 'Icon browser', icon: 'grid', keywords: ['icon', 'icons', 'glyph', 'pack', 'icon pack', 'lucide', 'tabler', 'feather', 'heroicons', 'phosphor', 'bootstrap'], render: () => <BrowserPage /> },
    [MANAGER_VIEW]: { title: 'Icon manager', icon: 'layers', keywords: ['icon map', 'icons', 'randomize', 'icon pack', 'slots'], render: () => <ManagerPage /> },
  },
  tabs: iconTabRenderers(ICON_TAB_KIND),
  nav: { label: 'Plugins', items: [{ id: 'icon-browser', label: 'Icon browser', icon: 'grid', view: 'icon-browser' }, { id: 'icon-manager', label: 'Icon manager', icon: 'layers', view: 'icon-manager' }] }, // = VIEW, MANAGER_VIEW (one line, literal, so scripts/menu-reach.mts sees them)
  settingsTabs: [{ id: FOLDER, label: 'Icon browser', icon: 'grid', order: 36, parent: 'plugins' }],
  settingsPanels: [
    { id: 'icon-browser.settings', tab: FOLDER, title: 'Icon browser', icon: 'grid', order: 10, render: () => <SettingsPanel /> },
    { id: 'icon-browser.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
