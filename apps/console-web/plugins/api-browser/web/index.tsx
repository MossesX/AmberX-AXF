import { useEffect, useState } from 'react';
import { Note, SelectField, Switch } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ApiBrowser, askQuery, FOLDER, loadSettings, saveSettings, type Settings, type View } from './ui';
import tabs from '../assets/tab-group/api-browser-tabs.json';
import rail from '../assets/tab-group/api-browser-rail.json';
import chips from '../assets/tab-group/api-browser-chips.json';

/*
 * API Browser (build full-api-control, addendum Nov 7 2026, Brett: "A real, polished API Browser plugin in the console
 * listing EVERY API path … from one generated registry"). The page (ui.tsx) reads the registry from the server part
 * (framework/cli/api-registry.mjs); its view switcher is drawn on one of the plugin's three tab-group looks (assets/),
 * registered into the runtime here so they are real, swappable assets (UI Review choice set api-browser-look).
 */
export const LOOK_ASSETS = [tabs, rail, chips];
const LOOKS = [{ value: 'api-browser-tabs', label: 'Top tabs' }, { value: 'api-browser-rail', label: 'Side rail' }, { value: 'api-browser-chips', label: 'Chips' }];
const VIEWS: { value: View; label: string }[] = [{ value: 'grid', label: 'Grid' }, { value: 'tree', label: 'Tree' }, { value: 'cards', label: 'Cards' }, { value: 'coverage', label: 'Coverage' }];

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { loadSettings().then(setS, (e: Error) => setMsg(e.message)); }, []);
  const save = (p: Partial<Settings>) => saveSettings(p).then((x) => { setS(x); setMsg('Saved'); }, (e: Error) => setMsg(e.message));
  if (!s) return <Note tone="info">{msg || 'Reading the settings'}</Note>;
  return (
    <div className="fx-stack">
      <SelectField label="Opens on" value={s.defaultView} options={VIEWS} onChange={(v) => void save({ defaultView: v as View })} />
      <SelectField label="Look of the view switcher" value={s.look} options={LOOKS} onChange={(v) => void save({ look: v })} />
      <Switch label="Try it may run changes" hint="Off: Try it runs reads only. On: a change asks you once before it runs; a delete asks for its confirm token as well." checked={s.tryWrites} onChange={(v) => void save({ tryWrites: v })} />
      {msg && <span className="fx-small fx-muted">{msg}</span>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.api-browser',
  label: 'API Browser',
  version: '0.1.0',
  appMenu,
  register(rt) {
    for (const a of LOOK_ASSETS) if (!rt.registry.get('tab-group', a.id)) rt.registry.register(a, 'app', 'plugin:api-browser');
    rt.actions.register('api-browser.find', ([words = '']) => { askQuery(decodeURIComponent(words)); rt.navigate('api-browser'); }, { label: 'Find an API path in the API Browser', params: true, effect: 'navigate' });
  },
  views: { 'api-browser': { title: 'API Browser', icon: 'code', keywords: ['api', 'control', 'mcp', 'rest', 'cli', 'coverage', 'endpoints'], render: () => <ApiBrowser /> } },
  nav: { label: 'Console', items: [{ id: 'api-browser', label: 'API Browser', icon: 'code', view: 'api-browser' }] },
  settingsTabs: [{ id: FOLDER, label: 'API Browser', icon: 'code', order: 93, parent: 'plugins', description: 'Every API path of the console: which view it opens on, the look of its view switcher, and whether Try it may run changes.' }],
  settingsPanels: [
    { id: 'api-browser.settings', tab: FOLDER, title: 'API Browser', icon: 'code', order: 10, render: () => <SettingsPanel /> },
    { id: 'api-browser.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
