/*
 * Settings placement (settings-placement@1): keeps every plugin's settings placement on the console server, so a pick
 * follows Brett between browsers and Claude / the API / the CLI can change it (server/__init__.py). The framework draws
 * the placements, the picker and the global page (framework/react/settingsHost.tsx, libs/settings); this web part only
 * syncs: it pulls on load, on focus and every minute while the page is visible, and pushes a pick changed here.
 */
import { useEffect, useState } from 'react';
import { settingsPlacement as SP, type AxfRuntime } from '@console/axf/core';
import { Button, Note, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

const FOLDER = 'settings-placement';
const ID = 'ai.amberx.axf.console.settings-placement';
const api = pluginApi(FOLDER, 'The Settings placement plugin');
type Pick = SP.SettingsPlacementPick;
interface Store { rev: number; updatedAt: string; default: Pick | null; owners: Record<string, Pick> }

/** What the server and this browser last agreed on, per settings key (so a pull never echoes back as a push). */
const synced = new Map<string, string>();
let rev = -1;
let status: { at: number; error?: string; rev: number } = { at: 0, rev: -1 };
const statusListeners = new Set<() => void>();
const setStatus = (s: typeof status) => { status = s; statusListeners.forEach((f) => f()); };

const keyOf = (owner: string | null) => (owner ? SP.settingsPlacementKey(owner) : SP.SETTINGS_PLACEMENT_DEFAULT_KEY);
const enc = (x: unknown) => (x == null || x === '' ? '' : SP.encodePick(SP.normalizePick(x)));
const ownersOf = (rt: AxfRuntime) => rt.libraries.filter((l) => (l.ui?.settingsTabs.length ?? 0) > 0).map((l) => l.id);

async function pull(rt: AxfRuntime) {
  try {
    const s = await api.call<Store>('placements');
    const first = rev < 0;
    if (s.rev !== rev) {
      const remote = new Map<string, string>([[keyOf(null), enc(s.default)], ...Object.entries(s.owners).map(([o, p]) => [keyOf(o), enc(p)] as [string, string])]);
      for (const key of new Set([...remote.keys(), ...ownersOf(rt).map(keyOf)])) {
        const r = remote.get(key) ?? '';
        const local = enc(rt.settings.get(key));
        if (r) { synced.set(key, r); if (local !== r) rt.settings.set(key, r); }
        else if (first && local) void push(key, local); // a pick made before the server had one: send it up
        else if (!first && synced.get(key) && local === synced.get(key)) { synced.set(key, ''); rt.settings.set(key, null); } // forgotten on the server
        else synced.set(key, local);
      }
      rev = s.rev;
    }
    setStatus({ at: Date.now(), rev });
  } catch (e) { setStatus({ at: Date.now(), rev, error: (e as Error).message }); }
}

async function push(key: string, value: string) {
  synced.set(key, value);
  const owner = key === SP.SETTINGS_PLACEMENT_DEFAULT_KEY ? null : key.slice(SP.settingsPlacementKey('').length);
  const body = value ? JSON.parse(value) : { placement: 'default' };
  try {
    const r = await api.put<{ rev: number }>(owner ? `placements/${encodeURIComponent(owner)}` : 'default', body);
    rev = r.rev;
    setStatus({ at: Date.now(), rev });
  } catch (e) { synced.delete(key); setStatus({ at: Date.now(), rev, error: (e as Error).message }); }
}

/** Push every pick that changed here since the last sync. */
function pushChanged(rt: AxfRuntime) {
  if (rev < 0) return; // not pulled yet: the first pull decides
  for (const key of [keyOf(null), ...ownersOf(rt).map(keyOf)]) {
    const v = enc(rt.settings.get(key));
    if ((synced.get(key) ?? '') !== v) void push(key, v);
  }
}

function SyncPanel() {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); statusListeners.add(f); return () => { statusListeners.delete(f); }; }, []);
  return (
    <div className="fx-stack">
      {status.error
        ? <Note tone="warning">Not synced with the console server: {status.error} Picks still work in this browser.</Note>
        : <p className="fx-muted">{status.at ? `Synced with the console server (revision ${status.rev}, ${new Date(status.at).toLocaleTimeString()}). Claude, the API and the CLI see the same picks: axf settings-placement list.` : 'Syncing with the console server…'}</p>}
      <div className="fx-row fx-row--wrap"><Button icon="refresh" size="sm" onClick={() => void pull(rt)}>Sync now</Button></div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Settings placement',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('settings-placement.sync', () => void pull(rt), { label: 'Sync settings placements with the console server' });
    void pull(rt);
    rt.settings.subscribe(() => pushChanged(rt));
    const again = () => { if (document.visibilityState === 'visible') void pull(rt); };
    addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    setInterval(again, 60_000);
  },
  settingsPanels: [
    { id: 'settings-placement.sync', tab: 'settings-placement', title: 'Sync', icon: 'refresh', order: 80, render: () => <SyncPanel /> },
    { id: 'settings-placement.lifecycle', tab: 'settings-placement', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
