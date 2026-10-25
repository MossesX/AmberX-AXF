/**
 * AI keys console plugin (ai.amberx.axf.console.ai-keys).
 *
 * A dialog that keeps several Anthropic keys — API keys (sk-ant-api…) and Claude subscription tokens (sk-ant-oat…,
 * from `claude setup-token`) — and picks the active one of each kind for the AI assistant. Every key is tested on the
 * server before it is saved; the browser only ever sees a name, the kind, the last 4 characters and the last test.
 *
 * Opened from the right-click / long-press menu, the application menu (Plugins › AI keys…), the action
 * `ai-keys.open`, search or Settings → Plugins → AI keys. All runtime contributions, so uninstalling removes them.
 */
import { useEffect, useState } from 'react';
import { Button, IconButton, Note, Section, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.ai-keys';
const FOLDER = 'ai-keys';
const DIALOG = 'ai-keys';
const api = pluginApi(FOLDER, 'AI keys');

interface Test { ok: boolean; at: number; ms: number; detail?: string; error?: string }
interface KeyRow { id: string; label: string; kind: 'anthropic' | 'claude-code'; kindLabel: string; hint: string; active: boolean; createdAt: number; lastTest: Test | null }
interface Listing { keys: KeyRow[]; active: Record<string, string>; kinds: { id: string; label: string }[] }

const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '');

function KeyItem({ k, busy, run }: { k: KeyRow; busy: boolean; run: (fn: () => Promise<Listing>) => void }) {
  const [name, setName] = useState<string | null>(null);
  const t = k.lastTest;
  return (
    <li className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--wrap">
        <span className="fx-chip">{k.active ? '● Active' : '○'}</span>
        {name === null ? <strong>{k.label}</strong> : <TextField label="Name" value={name} onChange={setName} />}
        <code className="fx-muted">{k.hint}</code>
      </div>
      <p className="fx-muted" style={{ margin: 0 }}>
        {t ? (t.ok ? `Works · tested ${when(t.at)}${t.detail ? ` · ${t.detail}` : ''}` : `Failed ${when(t.at)}: ${t.error}`) : 'Not tested yet'}
      </p>
      <div className="fx-row fx-row--wrap">
        {!k.active && <Button size="sm" tone="primary" icon="check" disabled={busy} onClick={() => run(() => api.post('active', { id: k.id }))}>Use this one</Button>}
        {k.active && <Button size="sm" icon="x" disabled={busy} onClick={() => run(() => api.post('active', { kind: k.kind, id: '' }))}>Stop using</Button>}
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => run(() => api.post(`keys/${k.id}/test`, {}))}>Test</Button>
        {name === null
          ? <IconButton icon="edit" label="Rename" disabled={busy} onClick={() => setName(k.label)} />
          : <Button size="sm" icon="save" disabled={busy || !name.trim()} onClick={() => { run(() => api.patch(`keys/${k.id}`, { label: name })); setName(null); }}>Save name</Button>}
        <IconButton icon="trash" label="Remove" disabled={busy} onClick={() => { if (window.confirm(`Remove ${k.label}?`)) run(() => api.del(`keys/${k.id}`)); }} />
      </div>
    </li>
  );
}

function KeysDialog() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');

  const run = (fn: () => Promise<Listing>) => {
    setBusy(true); setError('');
    fn().then((r) => setData(r), (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { run(() => api.call('keys')); }, []);

  const add = () => run(async () => { const r = await api.post<Listing>('keys', { label, key }); setKey(''); setLabel(''); return r; });

  return (
    <div className="fx-stack">
      <Note tone="info">The active key of each kind replaces the AI assistant's own key for that provider (Anthropic / Claude Code subscription). No active key = the assistant's own setting applies.</Note>
      {error && <Note tone="danger">{error}</Note>}
      {data?.kinds.map((kd) => {
        const rows = data.keys.filter((k) => k.kind === kd.id);
        return (
          <Section key={kd.id} title={kd.label} aside={<span className="fx-muted">{rows.length} stored</span>}>
            {rows.length === 0 ? <p className="fx-muted" style={{ margin: 0 }}>None yet.</p> : (
              <ul className="fx-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{rows.map((k) => <KeyItem key={k.id} k={k} busy={busy} run={run} />)}</ul>
            )}
          </Section>
        );
      })}
      <Section title="Add a key">
        <div className="fx-stack">
          <TextField label="Name" value={label} onChange={setLabel} placeholder="e.g. Brett's Max plan" />
          <TextField label="Key" type="password" mono value={key} onChange={setKey} placeholder="sk-ant-api… or sk-ant-oat…" hint="Tested before it's saved; a key that doesn't work is refused. Subscription tokens come from `claude setup-token`." />
          <div className="fx-row"><Button tone="primary" icon="plus" disabled={busy || !key.trim()} onClick={add}>{busy ? 'Working…' : 'Test and save'}</Button></div>
        </div>
      </Section>
    </div>
  );
}

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Store several Anthropic API keys and Claude subscription tokens, and pick which one the AI assistant uses.</p>
      <div className="fx-row"><Button tone="primary" icon="key" onClick={() => rt.openDialog(DIALOG)}>Open AI keys</Button></div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AI keys',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('ai-keys.open', () => rt.openDialog(DIALOG), { label: 'AI keys' });
  },
  dialogs: { [DIALOG]: { title: 'AI keys', icon: 'key', render: () => <KeysDialog /> } },
  contextMenu: [
    { id: 'ai-keys.default', target: 'default', order: 92, items: [{ id: 'ai-keys', label: 'AI keys…', icon: 'key', action: 'ai-keys.open' }] },
  ],
  settingsTabs: [{ id: 'ai-keys', label: 'AI keys', icon: 'key', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'ai-keys.open', tab: 'ai-keys', title: 'AI keys', icon: 'key', order: 5, render: () => <OpenPanel /> },
    { id: 'ai-keys.lifecycle', tab: 'ai-keys', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
