import { useEffect, useState } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { Button, Chip } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/*
 * Claude connection: the server part checks the Claude Code connection (subscription or API key) and the active account's
 * email; Patches reads it on every load and paints its banner badge. Here: the result + Check again, under
 * Settings → Plugins → Claude connection.
 */
const ID = 'ai.amberx.axf.console.claude-connection';
const FOLDER = 'claude-connection';

interface Status { at: number; ok: boolean; mode: string; email: string; account: string; model: string; ms: number; error: string }

async function check(refresh: boolean): Promise<Status> {
  const r = await pluginFetch(FOLDER, `status${refresh ? '?refresh=true' : ''}`);
  const j = (await r.json().catch(() => ({}))) as Status & { detail?: string };
  if (!r.ok) throw new Error(j.detail || `request failed (${r.status})`);
  return j;
}

function StatusPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (refresh: boolean) => { setBusy(true); setErr(''); check(refresh).then(setS, (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  useEffect(() => run(false), []);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">One tiny message through the AI assistant's default Claude provider. Patches shows the result at the top left of its banner on every load.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => run(true)}>{busy ? 'Checking…' : 'Check again'}</Button>
        {s && <Chip tone={s.ok ? 'success' : 'danger'}>{s.ok ? (s.mode === 'subscription' ? 'subscription' : 'API key') : 'no connection'}</Chip>}
        {s && <span className="fx-small">{s.ok ? s.account : `No Claude connection · ${s.error || 'check keys'}`}</span>}
        {err && <span className="fx-small fx-muted">{err}</span>}
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude connection',
  version: '0.1.0',
  appMenu,
  settingsTabs: [{ id: 'claude-connection', label: 'Claude connection', icon: 'claude', parent: 'plugins', order: 47, description: 'The Claude Code connection Patches shows on its banner.' }],
  settingsPanels: [
    { id: 'claude-connection.status', tab: 'claude-connection', title: 'Claude Code connection', icon: 'claude', order: 10, render: () => <StatusPanel /> },
    { id: 'claude-connection.lifecycle', tab: 'claude-connection', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
