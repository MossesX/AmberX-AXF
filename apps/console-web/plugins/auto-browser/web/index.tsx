import { useEffect, useState } from 'react';
import { Button, Note, SelectField, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, get, put, type Config, type Device, type Status } from './api';
import { LiveView } from './LiveView';
import { appMenu } from './menu';
import './auto-browser.css';

function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const load = () => get<Status>('status').then((s) => { setStatus(s); setError(''); }, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  return { status, error, reload: load };
}

function BrowserView() {
  const { status, error, reload } = useStatus();
  const [workspace, setWorkspace] = useState('');
  useEffect(() => { if (status && !workspace) setWorkspace(status.config.workspace); }, [status, workspace]);
  return (
    <div className="fx-stack fx-stack--lg axp-auto-browser">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Automated Browser</h1></div></header>
      {error && <Note tone="danger">{error}</Note>}
      {status && !status.reachable && (
        <Note tone="warning">
          The browser host isn't answering ({status.error}). Start it on the VPS with <code>sh apps/console-web/plugins/auto-browser/deploy.sh</code>; the systems check's Auto fix runs the same.
          <div><Button size="sm" icon="refresh" onClick={() => void reload()}>Check again</Button></div>
        </Note>
      )}
      {status?.reachable && workspace && <LiveView key={workspace} workspace={workspace} device={status.config.device} homeUrl={status.config.homeUrl} />}
    </div>
  );
}

function BrowserSettings() {
  const { status, error, reload } = useStatus();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => { if (status) setCfg(status.config); }, [status]);
  if (!cfg) return <p className="fx-muted">{error || 'Loading…'}</p>;
  const save = async () => {
    try { setCfg(await put<Config>('config', cfg)); setSaved('Saved.'); void reload(); } catch (e) { setSaved((e as Error).message); }
  };
  const set = (k: keyof Config) => (v: string) => setCfg({ ...cfg, [k]: k === 'quality' ? Number(v) || 60 : v });
  return (
    <div className="fx-stack">
      {status?.reachable
        ? <Note tone="success">Browser host up: {status.health?.sessions}/{status.health?.max} browsers open, host process {status.health?.rssMb} MB.</Note>
        : <Note tone="warning">Browser host not reachable: {status?.error}. Run <code>sh apps/console-web/plugins/auto-browser/deploy.sh</code> on the VPS.</Note>}
      <TextField label="Browser host address" value={cfg.hostUrl} onChange={set('hostUrl')} mono disabled={cfg.hostUrlFromEnv}
        hint={cfg.hostUrlFromEnv ? 'Set by AXF_BROWSER_URL on the server.' : 'The axf-browser container on the console network.'} />
      <TextField label="Default workspace" value={cfg.workspace} onChange={set('workspace')} mono hint="Each workspace is its own Chrome profile: cookies and logins stay in it." />
      <SelectField label="Default device" value={cfg.device} onChange={(v) => setCfg({ ...cfg, device: v as Device })}
        options={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'phone', label: 'Phone' }]} />
      <TextField label="Home page" value={cfg.homeUrl} onChange={set('homeUrl')} mono />
      <SelectField label="Live picture quality" value={String(cfg.quality)} onChange={set('quality')}
        options={[{ value: '40', label: 'Low (fast on mobile data)' }, { value: '60', label: 'Normal' }, { value: '80', label: 'High' }]} />
      <div className="axp-auto-browser__acts"><Button tone="primary" icon="save" onClick={() => void save()}>Save</Button><span className="fx-muted">{saved}</span></div>
      <p className="fx-muted">Host token: {cfg.tokenSet ? 'set (kept on the server)' : 'not set'}.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.auto-browser',
  label: 'Automated Browser',
  version: '0.1.0',
  appMenu,
  views: { 'auto-browser': { title: 'Automated Browser', icon: 'monitor', render: () => <BrowserView /> } },
  nav: { label: 'Plugins', items: [{ id: 'auto-browser', label: 'Automated Browser', icon: 'monitor', view: 'auto-browser' }] },
  settingsTabs: [{ id: 'auto-browser', label: 'Automated Browser', icon: 'monitor', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'auto-browser.settings', tab: 'auto-browser', title: 'Browser', icon: 'monitor', order: 10, render: () => <BrowserSettings /> },
    { id: 'auto-browser.lifecycle', tab: 'auto-browser', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
