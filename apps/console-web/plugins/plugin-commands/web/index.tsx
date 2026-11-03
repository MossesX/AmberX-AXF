/**
 * Plugin commands (web part): the page that lists every plugin's commands and reads (made automatically from each
 * plugin's routes, actions, data folder and plugin.json; core/engines/plugin-commands.mjs) with the REST route, the MCP
 * tool and the CLI line for each, and runs a read or a command right there. Settings → Plugins → Plugin commands holds
 * the two MCP switches and the last commands run.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, Segmented, Switch, TextField, type AxfWebLibrary } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { commandToolName, pluginCommandCli, type PluginCommandEntry, type PluginCommand } from '@console/axf/core/engines/plugin-commands.mjs';
import { appMenu } from './menu';
import './plugin-commands.css';

const FOLDER = 'plugin-commands';
const ID = 'ai.amberx.axf.console.plugin-commands';
type Kind = 'all' | 'read' | 'command';

const getJson = <T,>(path: string) => pluginFetch(FOLDER, path).then((r) => r.json() as Promise<T>);

function restLine(p: PluginCommandEntry, c: PluginCommand): string {
  const m = c.kind === 'read' ? 'GET' : c.effect === 'destructive' ? 'DELETE' : 'POST';
  return `${m} /api/control/${p.folder}/${c.id}`;
}

/** One command: what it is, its three ways in, and a Run button (input as JSON). */
function CommandRow({ p, c }: { p: PluginCommandEntry; c: PluginCommand }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('{}');
  const [out, setOut] = useState('');
  const [confirm, setConfirm] = useState('');
  const run = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(input || '{}'); } catch { setOut('Input is not JSON.'); return; }
    const body = { op: 'act', target: c.kind === 'read' ? 'plugins.reads' : 'plugins.commands', path: `${p.folder}/${c.id}`, action: c.kind === 'read' ? 'read' : 'run', input: parsed, by: 'console', ...(confirm ? { confirm } : {}) };
    const r = await pluginFetch(FOLDER, 'try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ ok: false, message: String(e) }));
    setConfirm(r?.code === 'confirmation_required' ? String(r.confirm ?? '') : '');
    setOut(JSON.stringify(r, null, 2));
  };
  const cli = pluginCommandCli({ plugins: [{ ...p, commands: [c] }] }).commands[0]?.usage ?? '';
  return (
    <li className="axf-pc__row">
      <div className="axf-pc__head">
        <code className="axf-pc__id">{c.id}</code>
        <span>{c.title}</span>
        <Chip>{c.effect === 'read' ? 'read' : c.effect === 'destructive' ? 'deletes' : c.effect === 'navigate' ? 'opens' : 'changes'}</Chip>
        {c.confirm && <Chip>confirm</Chip>}
        <Button size="sm" icon={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(!open)} data-help="pc-details">{open ? 'Less' : 'Try'}</Button>
      </div>
      {open && (
        <div className="fx-stack axf-pc__body">
          {c.description && <p className="axf-pc__muted">{c.description}</p>}
          <ul className="axf-pc__ways">
            <li><span className="axf-pc__muted">REST</span> <code>{restLine(p, c)}</code></li>
            <li><span className="axf-pc__muted">MCP</span> <code>{commandToolName(p.folder, c.id)}</code></li>
            <li><span className="axf-pc__muted">CLI</span> <code>{cli}</code></li>
          </ul>
          <TextField label="Input (JSON)" value={input} onChange={setInput} mono rows={3} />
          <div className="axf-pc__actions">
            <Button icon="play" onClick={() => void run()} data-help="pc-run">{confirm ? 'Run again with the confirm token' : c.kind === 'read' ? 'Read' : 'Run'}</Button>
          </div>
          {out && <pre className="axf-pc__pre">{out}</pre>}
        </div>
      )}
    </li>
  );
}

function PluginCommandsView() {
  const [plugins, setPlugins] = useState<PluginCommandEntry[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [err, setErr] = useState('');
  const load = () => getJson<{ plugins: PluginCommandEntry[] }>('registry').then((r) => { setPlugins(r.plugins ?? []); setErr(''); }, () => setErr('The Plugin commands server part is not answering.'));
  useEffect(() => { void load(); }, []);
  const shown = useMemo(() => {
    const words = q.toLowerCase().trim();
    return (plugins ?? []).map((p) => ({ ...p, commands: p.commands.filter((c) => (kind === 'all' || c.kind === kind) && (!words || `${p.folder} ${p.name} ${c.id} ${c.title} ${c.description}`.toLowerCase().includes(words))) })).filter((p) => p.commands.length);
  }, [plugins, q, kind]);
  const total = (plugins ?? []).reduce((n, p) => n + p.commands.length, 0);
  return (
    <div className="fx-stack axf-pc">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin · control@1</p><h1>Plugin commands</h1><p className="fx-muted">Everything every plugin can do, as an API call, an MCP tool and a CLI line.</p></div></header>
      <Note tone="info">
        Made from what each plugin already has (its routes, its actions, its data folder and plugin.json). Claude reaches them through axHub as MCP tools named <code>&lt;plugin&gt;_&lt;command&gt;</code> (or <code>plugin_commands</code>, <code>plugin_read</code>, <code>plugin_run</code>), the REST API at <code>/api/control/&lt;plugin&gt;/&lt;command&gt;</code>, and the CLI <code>axf &lt;plugin&gt; &lt;command&gt;</code>. A new plugin shows up here by itself.
      </Note>
      {err && <Note tone="warning">{err}</Note>}
      <div className="axf-pc__bar">
        <TextField label="Find" value={q} onChange={setQ} placeholder="plugin, command or words" />
        <Segmented label="Show" value={kind} onChange={(v) => setKind(v as Kind)} options={[{ value: 'all', label: 'All' }, { value: 'read', label: 'Reads' }, { value: 'command', label: 'Commands' }]} />
        <Button icon="refresh" onClick={() => void load()} data-help="pc-refresh">Refresh</Button>
      </div>
      <p className="axf-pc__muted">{plugins === null ? 'Loading…' : `${(plugins ?? []).length} plugins · ${total} commands and reads`}</p>
      {shown.map((p) => (
        <Container key={`${p.app}:${p.folder}`} title={`${p.name}${p.app === 'console-web' ? '' : ` (${p.app})`}`} icon="package">
          {p.app !== 'console-web' && <p className="axf-pc__muted">Runs in {p.app}: listed here, run there.</p>}
          {p.enabled === false && <p className="axf-pc__muted">Turned off: its commands come back when it is turned on.</p>}
          <ul className="axf-pc__list">{p.commands.map((c) => <CommandRow key={c.id} p={p} c={c} />)}</ul>
          {p.skipped.length > 0 && <p className="axf-pc__muted">Not commands: {p.skipped.map((s) => `${s.route ?? s.action ?? s.id} (${s.why})`).join(' · ')}</p>}
        </Container>
      ))}
    </div>
  );
}

interface AuditRow { at: string; by: string; path: string; ok: boolean; status: number | null }

/** Settings → Plugins → Plugin commands: the MCP switches and the last commands run. */
function SettingsPanel() {
  const [s, setS] = useState<{ mcpTools: boolean; perPluginTools: boolean } | null>(null);
  const [live, setLive] = useState(0);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const load = () => Promise.all([
    getJson<{ mcpTools: boolean; perPluginTools: boolean }>('settings').then(setS),
    getJson<{ live: string[] }>('tools').then((t) => setLive(t.live?.length ?? 0)),
    getJson<{ items: AuditRow[] }>('audit').then((a) => setAudit(a.items ?? [])),
  ]).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const save = (patch: Partial<{ mcpTools: boolean; perPluginTools: boolean }>) => pluginFetch(FOLDER, 'settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(() => load());
  return (
    <div className="fx-stack">
      {s && (
        <Container title="MCP tools" icon="zap">
          <Switch label="Plugin tools on the console's MCP" checked={s.mcpTools} onChange={(v) => void save({ mcpTools: v })} />
          <Switch label="One tool per command (off: only plugin_commands, plugin_read and plugin_run)" checked={s.perPluginTools} onChange={(v) => void save({ perPluginTools: v })} />
          <p className="axf-pc__muted">{live} tools live now. They follow installs, removals and on / off switches by themselves.</p>
          <Button icon="refresh" onClick={() => void pluginFetch(FOLDER, 'sync', { method: 'POST' }).then(() => load())} data-help="pc-sync">Bring them in step now</Button>
        </Container>
      )}
      <Container title="Last commands" icon="list">
        {!audit.length ? <p className="axf-pc__muted">None yet.</p> : (
          <ul className="axf-pc__list">
            {audit.map((a, i) => <li key={`${a.at}-${i}`} className="axf-pc__row"><span className="axf-pc__id">{a.ok ? '✓' : '✗'} {a.path}</span><span className="axf-pc__muted">{a.by} · {new Date(a.at).toLocaleString()}</span></li>)}
          </ul>
        )}
      </Container>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Plugin commands',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  appMenu,
  register(rt) {
    rt.actions.register('plugin-commands.open', () => rt.navigate(FOLDER), { label: 'Open Plugin commands' });
  },
  views: { [FOLDER]: { title: 'Plugin commands', icon: 'terminal', keywords: ['commands', 'mcp', 'api', 'cli', 'plugins', 'tools', 'claude'], render: () => <PluginCommandsView /> } },
  nav: { label: 'Plugins', items: [{ id: FOLDER, label: 'Plugin commands', icon: 'terminal', view: FOLDER }] },
  settingsTabs: [{ id: FOLDER, label: 'Plugin commands', icon: 'terminal', order: 93, parent: 'plugins', description: 'Every plugin\'s commands on the REST API, MCP and the CLI' }],
  settingsPanels: [
    { id: 'plugin-commands.settings', tab: FOLDER, title: 'MCP tools and last commands', icon: 'terminal', order: 10, render: () => <SettingsPanel /> },
    { id: 'plugin-commands.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
