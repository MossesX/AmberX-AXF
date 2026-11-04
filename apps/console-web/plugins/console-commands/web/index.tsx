/**
 * Console commands (web part). Every open console tab announces itself to the console server with its catalog (its own
 * search index: screens, settings tabs and sub-tabs, dialogs, actions — plugins' too), keeps a stream open, and runs the
 * console-command@1 messages it gets through its own runtime, then acks what it did. Brett's open console goes where a
 * Claude session says, and nothing else on the page changes.
 *
 * Since build apps-control-surface (Nov 4 2026) the client itself is the framework's control-surface library
 * (framework/libs/control-surface, the same one AmberX, axHub web, Molly and the app template run): this plugin starts it
 * with the console's transport (the plugin mount, so the console token or hub session signs it) and its own settings
 * keys, and keeps the Settings → Plugins → Console commands page: on / off for this console, a toast per command, waking
 * through AmberX, how long a command waits, the browser AmberX opens, the open clients of every app, waiting and last
 * commands.
 *
 * Console wake (Nov 3 2026): a command that found no open console waits on the server and arrives when this tab says
 * hello; a tab opened by AmberX carries `?axf-cmd=<id>` and asks for that one first.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Note, SelectField, Switch, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './console-commands.css';
import type { ConsoleHere } from '@console/axf/core/engines/console-commands.mjs';
import { CONSOLE_APP, clientId, startControlSurface } from '@console/axf/libs/control-surface/client';

const FOLDER = 'console-commands';
const ID = 'ai.amberx.axf.console.console-commands';
const KEYS = { on: 'console-commands.enabled', toast: 'console-commands.toast' } as const;

const post = (path: string, body: unknown, keepalive = false) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive });

/** Mounted once on the page (slot app.frame.cover), draws nothing: runs the control-surface client with the console's transport. */
function ConsoleCommandsClient() {
  const rt = useRuntime();
  const [on, setOn] = useState(() => rt.settings.get(KEYS.on) !== false);
  useEffect(() => rt.settings.subscribe(() => setOn(rt.settings.get(KEYS.on) !== false)), [rt]);
  useEffect(() => {
    if (!on || typeof window === 'undefined') return;
    // Inside a host (Molly) the library reports `molly/axf-console`; the broker reads both the old `console-web` and this id as the console.
    return startControlSurface(rt, { app: CONSOLE_APP, keys: KEYS, transport: { fetch: (path, init) => pluginFetch(FOLDER, path, init) } });
  }, [rt, on]);
  return null;
}

interface ClientRow { id: string; app?: string; front?: boolean; device: string; user: string; lastUsed: number; live: boolean; here: ConsoleHere; items: number }
interface RecentRow { at: string; by: string; target: string; path: string; action: string; ok: boolean; message: string; how?: string; app?: string; delivered: { client: string; ok: boolean; message: string }[] }
interface QueueRow { id: string; state: string; at: string; expiresAt: string; path: string; action: string; by: string; app?: string; label?: string; wake: { sent: boolean; message: string } | null }
interface AppRow { id: string; label: string; url: string; online: number; screens: number; settings: number; dialogs: number; actions: number; here: ConsoleHere }
interface WakeSettings { wake: boolean; ttlS: number; browser: 'chrome' | 'default' }

const TTL_CHOICES = [30, 60, 120, 300, 600, 900].map((s) => ({ value: String(s), label: s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}` }));

/** Settings → Plugins → Console commands: what happens when no console is open (kept on the console server). */
function WakePanel() {
  const [cfg, setCfg] = useState<WakeSettings | null>(null);
  const [owner, setOwner] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    pluginFetch(FOLDER, 'settings').then((r) => r.json()).then((j: { settings: WakeSettings; owner: boolean }) => { setCfg(j.settings); setOwner(j.owner); }, () => setErr('The Console commands server part is not answering.'));
  }, []);
  const save = (change: Partial<WakeSettings>) => post('settings', change).then((r) => r.json()).then((j: { settings?: WakeSettings; detail?: string }) => {
    if (j.settings) { setCfg(j.settings); setErr(''); } else setErr(j.detail ?? 'Not saved.');
  }, () => setErr('Not saved: the server part is not answering.'));
  if (!cfg) return err ? <Note tone="warning">{err}</Note> : <p className="axf-cc__muted">Loading…</p>;
  return (
    <div className="fx-stack">
      {err && <Note tone="warning">{err}</Note>}
      <Switch label="Wake the app through AmberX when it's closed" checked={cfg.wake} disabled={!owner} onChange={(on) => void save({ wake: on })}
        hint="A command that finds no open console (or no open copy of the app it is for) waits here; after a few seconds AmberX on your phone opens that app so it runs. Needs the AmberX app with console wake." />
      <SelectField label="How long a command waits for the app" value={String(cfg.ttlS)} options={TTL_CHOICES}
        hint="After this it's dropped and never runs late." onChange={(v) => void save({ ttlS: Number(v) })} />
      <SelectField label="Browser AmberX opens" value={cfg.browser} options={[{ value: 'chrome', label: 'Chrome (default browser when Chrome is missing)' }, { value: 'default', label: 'The phone\'s default browser' }]}
        onChange={(v) => void save({ browser: v as WakeSettings['browser'] })} />
      {!owner && <Note tone="info">Only the console's owner changes these.</Note>}
    </div>
  );
}

/** Settings → Plugins → Console commands: every app on the surface, the open clients and the last commands. */
function ConsolesPanel() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [err, setErr] = useState('');
  const load = () => Promise.all([
    pluginFetch(FOLDER, 'apps').then((r) => r.json()).then((j: { items?: AppRow[] }) => setApps(j.items ?? []), () => setApps([])),
    pluginFetch(FOLDER, 'queue').then((r) => r.json()).then((j: { items?: QueueRow[] }) => setQueue(j.items ?? [])),
    pluginFetch(FOLDER, 'clients').then((r) => r.json()).then((j: { items?: ClientRow[] }) => setClients(j.items ?? [])),
    pluginFetch(FOLDER, 'recent').then((r) => r.json()).then((j: { items?: RecentRow[] }) => setRecent(j.items ?? [])),
  ]).then(() => setErr(''), () => setErr('The Console commands server part is not answering.'));
  useEffect(() => { void load(); }, []);
  const me = clientId();
  return (
    <div className="fx-stack">
      {err && <Note tone="warning">{err}</Note>}
      <Container title="Apps on the surface" icon="grid">
        {!apps.length ? <p className="axf-cc__muted">No apps reported yet (the server part lists framework/schemas/apps.json once it answers).</p> : (
          <ul className="axf-cc__list" data-help="cc-apps">
            {apps.map((a) => (
              <li key={a.id} className="axf-cc__row">
                <span className="axf-cc__id">{a.label} <span className="axf-cc__muted">({a.id})</span></span>
                <span>{a.online ? `${a.online} open · ${a.here?.screenLabel ?? a.here?.screen ?? ''}` : 'closed'}</span>
                <span className="axf-cc__muted">{a.screens} screens · {a.settings} settings · {a.dialogs} dialogs · {a.actions} actions</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Container title="Open clients" icon="monitor">
        {clients === null ? <p className="axf-cc__muted">Loading…</p> : !clients.length ? <p className="axf-cc__muted">No app is open right now.</p> : (
          <ul className="axf-cc__list">
            {clients.map((c) => (
              <li key={c.id} className="axf-cc__row">
                <span className="axf-cc__id">{c.id}{c.id === me ? ' (this one)' : ''}</span>
                <span>{c.app && c.app !== 'console-web' && c.app !== CONSOLE_APP ? `${c.app} · ` : ''}{c.device || 'browser'} · {c.here?.screenLabel ?? c.here?.screen ?? '—'}{c.front === false ? ' · hidden' : ''}</span>
                <span className="axf-cc__muted">{c.live ? 'open' : 'gone quiet'} · {c.lastUsed ? new Date(c.lastUsed).toLocaleTimeString() : 'not used yet'} · {c.items} items</span>
              </li>
            ))}
          </ul>
        )}
        <Button icon="refresh" onClick={() => void load()} data-help="cc-refresh">Refresh</Button>
      </Container>
      <Container title="Waiting commands" icon="clock">
        {!queue.length ? <p className="axf-cc__muted">Nothing is waiting. A command that finds no open copy of its app waits here until one opens.</p> : (
          <ul className="axf-cc__list">
            {queue.map((q) => (
              <li key={q.id} className="axf-cc__row">
                <span className="axf-cc__id">{q.state} · {q.action} {q.path}{q.label ? ` · ${q.label}` : ''}</span>
                <span className="axf-cc__muted">{q.by} · {new Date(q.at).toLocaleTimeString()} · {q.state === 'queued' ? `until ${new Date(q.expiresAt).toLocaleTimeString()}` : ''}{q.wake ? ` · ${q.wake.message}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Container title="Last commands" icon="list">
        {!recent.length ? <p className="axf-cc__muted">None yet. Ask Amber to open a screen, or run <code>axf console open plan studio</code> / <code>axf app amberx open to-dos</code>.</p> : (
          <ul className="axf-cc__list">
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="axf-cc__row">
                <span className="axf-cc__id">{r.ok ? '✓' : '✗'} {r.action} {r.path}{r.app && r.app !== CONSOLE_APP ? ` · ${r.app}` : ''}</span>
                <span className="axf-cc__muted">{r.by} · {new Date(r.at).toLocaleTimeString()}{r.how ? ` · ${r.how}` : ''} · {r.ok ? r.delivered.map((d) => `${d.client}: ${d.message}`).join(' · ') || 'sent' : r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Note tone="info">
        Claude sessions call <code>console_open</code>, <code>console_settings</code>, <code>console_dialog</code>, <code>console_action</code>, <code>console_back</code>, <code>console_where</code>, <code>console_list</code> and <code>console_clients</code> for this console, and <code>apps_list</code>, <code>app_show</code>, <code>app_open</code>, <code>app_list</code>, <code>app_where</code>, <code>app_action</code> for every app (the console's MCP, also through axHub). REST: <code>POST /api/console/open</code> with <code>{'{"screen": "plan studio"}'}</code>, <code>POST /api/console/app/open</code> with <code>{'{"app": "amberx", "screen": "to-dos"}'}</code>. CLI: <code>axf console open plan studio</code>, <code>axf app amberx open to-dos</code>, <code>axf apps</code>.
      </Note>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Console commands',
  version: '0.3.0',
  builtWith: { model: 'fable', builtAt: '2026-11-04', replaces: 'opus' } as AxfWebLibrary['builtWith'],
  appMenu,
  slots: { 'app.frame.cover': [{ id: 'console-commands.client', order: 99, render: () => <ConsoleCommandsClient /> }] },
  settingsTabs: [{ id: FOLDER, label: 'Console commands', icon: 'radio', order: 92, parent: 'plugins', description: 'Let Claude sessions open screens, dialogs and settings in this console and every app' }],
  settings: [{
    id: 'console-commands.prefs', label: 'Console commands', icon: 'radio', tab: FOLDER, order: 10,
    description: 'When Brett tells Amber to load a screen, his open console goes there. Opening only navigates; an action that changes data keeps its own permission.',
    settings: [
      { key: KEYS.on, label: 'Let Claude sessions move this console', kind: 'toggle', default: true, scope: 'device', description: 'Off: this console stops listening; commands go to your other open consoles.' },
      { key: KEYS.toast, label: 'Show a note for each command', kind: 'toggle', default: true, scope: 'device', description: 'A short toast saying who opened what.' },
    ],
  }],
  settingsPanels: [
    { id: 'console-commands.wake', tab: FOLDER, title: 'When no app is open', icon: 'smartphone', order: 15, render: () => <WakePanel /> },
    { id: 'console-commands.consoles', tab: FOLDER, title: 'Apps, open clients and last commands', icon: 'monitor', order: 20, render: () => <ConsolesPanel /> },
    { id: 'console-commands.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
