/**
 * lib-hubsync — keep an app's whole setup on axHub so every app and every device matches (library@1
 * `ai.amberx.axf.hubsync`, web; Kotlin twin in Voice Vault's app code while Android framework work is on hold).
 *
 *   installLibraries(rt, [settingsLibrary, hubSyncLibrary, …])     // reads manifest libraries.hubsync, adds the settings
 *   const sync = startHubSync(rt, { look: 'follow', settings: true, data: ['notes'] })   // or drive it yourself
 *   sync.state(); sync.subscribe(fn); sync.refresh(); sync.data.table('notes'); sync.stop()
 *
 * What syncs (each switchable, Settings → Plugins → axHub sync):
 *   look      the shared appearance document every developer app reads (colour + style theme, layout, menus, spacing,
 *             hidden chrome): `required` waits for the hub like `developer.hub`, `follow` never blocks the app
 *   settings  this app's Settings screen values (lib-hubstore HubSettings.mirror), `shared/settings/apps/<app>.json`
 *   data      the app's tables (lib-hubstore HubData), all or picked ones, `shared/data-<app>/`
 * The connection itself (hub address, project, the switches) is the one thing kept on this device. The browser's own
 * hub session is used (no token here); redirects are refused; secrets are never mirrored.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Note, SelectField, Switch, TextField, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { AxfRuntime } from '../../core/runtime';
import { CONNECTION_KEY, DATA_MODES, HUBSYNC_LIBRARY_ID, LOOK_MODES, hubSyncErrors, resolveHubSync, signInUrl, type HubSyncConfig } from './core';
import { HubSync, hubSync, savedConnection, startHubSync } from './sync';
import './hubsync.css';

export * from './core';
export * from './sync';

/* ====================== settings interface ====================== */

const useSync = () => {
  const s = hubSync();
  const snap = useSyncExternalStore(s ? s.subscribe : () => () => undefined, () => s?.state() ?? null);
  return [s, snap] as const;
};

const tone = (st: string): 'success' | 'danger' | undefined => (st === 'ready' || st === 'own' ? 'success' : st === 'off' || st === 'idle' || st === 'connecting' || st === 'loading' ? undefined : 'danger');
const reasonOf = (s: object) => ('reason' in s ? String((s as { reason: string }).reason) : '');

function ConnectionPanel() {
  const rt = useRuntime();
  const [sync, snap] = useSync();
  const [hub, setHub] = useState(snap?.config.hub ?? '');
  const [project, setProject] = useState(snap?.config.project ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => { if (snap) { setHub(snap.config.hub); setProject(snap.config.project); } }, [snap?.config.hub, snap?.config.project]);
  if (!sync || !snap) return <Note tone="warning">axHub sync isn't running in this app.</Note>;
  const errors = hubSyncErrors({ hub, project });
  const save = () => { if (errors.length) return; persist(rt, sync, { hub, project }); setMsg(null); };
  return (
    <div className="axf-hubsync">
      <TextField label="axHub address" value={hub} onChange={setHub} mono placeholder="https://axhub.amberxai.com" hint="Where the look, settings and data live." />
      <TextField label="Hub project" value={project} onChange={setProject} mono hint="Folder on the hub. Every app using the same project shares one look." />
      {errors.map((e) => <Note key={e} tone="danger">{e}</Note>)}
      <div className="axf-hubsync__row">
        <Button onClick={save} disabled={!!errors.length || (hub === snap.config.hub && project === snap.config.project)}>Save and reconnect</Button>
        <Button tone="quiet" onClick={async () => setMsg(await sync.test())}>Test connection</Button>
        <Button tone="quiet" onClick={() => window.open(signInUrl(snap.config.hub), '_blank', 'noopener')}>Sign in to axHub</Button>
      </div>
      {msg && <Note tone={msg.ok ? 'success' : 'danger'}>{msg.message}</Note>}
    </div>
  );
}

function WhatPanel() {
  const rt = useRuntime();
  const [sync, snap] = useSync();
  const [tables, setTables] = useState((snap?.config.tables ?? []).join(', '));
  if (!sync || !snap) return null;
  const c = snap.config;
  const set = (p: Partial<HubSyncConfig>) => persist(rt, sync, p);
  const tableErr = c.data === 'some' ? hubSyncErrors({ data: 'some', tables }) : [];
  return (
    <div className="axf-hubsync">
      <SelectField label="Look (colours, style, layout, menus, spacing)" value={c.look} onChange={(v) => set({ look: v as HubSyncConfig['look'] })}
        options={LOOK_MODES.map((m) => ({ value: m.id, label: m.label }))} hint={LOOK_MODES.find((m) => m.id === c.look)?.hint} />
      <Switch label="Settings" checked={c.settings} onChange={(v) => set({ settings: v })} hint="Every value on this app's Settings screen, the same on every device (secrets never)." />
      <SelectField label="App data" value={c.data} onChange={(v) => set({ data: v as HubSyncConfig['data'] })}
        options={DATA_MODES.map((m) => ({ value: m.id, label: m.label }))} hint={DATA_MODES.find((m) => m.id === c.data)?.hint} />
      {c.data === 'some' && (
        <>
          <TextField label="Tables on axHub" value={tables} onChange={setTables} mono hint="Comma separated, e.g. notes, lists." />
          {tableErr.map((e) => <Note key={e} tone="danger">{e}</Note>)}
          <Button size="sm" disabled={!!tableErr.length} onClick={() => set({ tables: tables.split(',').map((t) => t.trim()) })}>Save tables</Button>
        </>
      )}
    </div>
  );
}

function StatusPanel() {
  const [sync, snap] = useSync();
  if (!sync || !snap) return null;
  const look = snap.look;
  const lookText = look.status === 'own' ? `This app's own hub source${look.hub ? ` (${look.hub})` : ''}` : look.status === 'ready' ? 'Matches axHub' : look.status === 'off' ? 'Off' : look.status === 'connecting' ? 'Connecting…' : reasonOf(look);
  const st = snap.settings;
  const setText = st.status === 'ready' ? `On axHub${sync.settings?.updatedAt() ? `, saved ${sync.settings.updatedAt()}` : ''}` : st.status === 'off' ? 'On this device' : st.status === 'idle' || st.status === 'loading' ? 'Loading…' : reasonOf(st);
  return (
    <div className="axf-hubsync">
      <Note tone="info">{snap.summary}.</Note>
      <div className="axf-hubsync__row"><Chip tone={tone(look.status)}>Look</Chip><span>{lookText}</span></div>
      <div className="axf-hubsync__row"><Chip tone={tone(st.status)}>Settings</Chip><span>{setText}</span></div>
      <div className="axf-hubsync__row"><Chip tone={snap.config.data === 'off' ? undefined : 'success'}>Data</Chip><span>{snap.config.data === 'off' ? 'On this device' : snap.config.data === 'all' ? 'Every table on axHub' : `On axHub: ${snap.config.tables.join(', ')}`}</span></div>
      <Button size="sm" tone="quiet" onClick={() => sync.refresh()}>Sync now</Button>
    </div>
  );
}

function persist(rt: AxfRuntime, sync: HubSync, change: Partial<HubSyncConfig>) {
  const next = resolveHubSync(sync.config, change);
  rt.settings.set(CONNECTION_KEY, JSON.stringify(next));
  sync.restart(next);
}

export const hubSyncLibrary: AxfWebLibrary = {
  id: HUBSYNC_LIBRARY_ID,
  label: 'axHub sync',
  version: '0.1.0',
  provides: ['axf.hubsync'],
  settingsTabs: [{ id: 'hubsync', label: 'axHub sync', icon: 'cloud', parent: 'plugins', order: 15, description: 'Keep this app\'s look, settings and data on axHub so every app and device matches.' }],
  settingsPanels: [
    { id: 'hubsync.status', tab: 'hubsync', title: 'Now', icon: 'activity', order: 5, render: () => <StatusPanel /> },
    { id: 'hubsync.connection', tab: 'hubsync', title: 'Connect to axHub', icon: 'cloud', order: 10, render: () => <ConnectionPanel /> },
    { id: 'hubsync.what', tab: 'hubsync', title: 'What syncs', icon: 'sliders', order: 20, render: () => <WhatPanel /> },
  ],
  register(rt) {
    const m = rt.manifest as { libraries?: Record<string, unknown> };
    const cfg = resolveHubSync(m.libraries?.hubsync, savedConnection(rt));
    try { startHubSync(rt, cfg); } catch (e) { rt.terminal.warn('hubsync', (e as Error).message); }
    const again = () => { if (document.visibilityState === 'visible') hubSync()?.refresh(); };
    if (typeof window !== 'undefined') { window.addEventListener('focus', again); document.addEventListener('visibilitychange', again); }
  },
};

export default hubSyncLibrary;
