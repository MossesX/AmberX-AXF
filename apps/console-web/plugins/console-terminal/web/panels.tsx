/* Settings → Plugins → Terminal: general options, VPS host (dedicated SSH key), Claude Code, Moshi, live sessions, log. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { CopyLink } from '@console/commandText';
import { call, getSettings, post, put, type SessionInfo, type Settings, type Status } from './api';
import { newTab } from './open';

const P = 'axp-terminal';

function useSettingsState() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { void call<Settings>('settings').then(setS, (e: Error) => setMsg(e.message)); }, []);
  const save = async (patch: Record<string, unknown>) => {
    setMsg('Saving…');
    try { const r = await put<Settings>('settings', patch); setS(r); void getSettings(true); setMsg('✓ Saved'); } catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  return { s, setS, msg, save };
}

export function GeneralPanel() {
  const rt = useRuntime();
  const { s, msg, save } = useSettingsState();
  const [d, setD] = useState<Partial<Settings>>({});
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const v = { ...s, ...d };
  const num = (k: 'fontSize' | 'idleMinutes' | 'moshKeepMinutes', label: string, min: number, max: number) => (
    <label className={`${P}__field`}><span>{label}</span><input className="fx-input" type="number" min={min} max={max} value={v[k]} onChange={(e) => setD({ ...d, [k]: Number(e.target.value) })} /></label>
  );
  const tick = (k: 'copyOnSelect' | 'pasteWarn' | 'mouseDefault' | 'moshDefault' | 'showHubRuns' | 'showHeadless', label: string) => (
    <label className={`${P}__opt`}><input type="checkbox" checked={v[k]} onChange={(e) => setD({ ...d, [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="terminal" onClick={() => newTab(rt, { kind: 'console' })}>Open a terminal</Button>
        <span className="fx-small fx-muted">Or right-click (long-press) anywhere → Open terminal. On a container or a folder it opens right there.</span>
      </div>
      <div className={`${P}__cols`}>
        {num('fontSize', 'Text size', 9, 28)}
        {num('idleMinutes', 'Close when idle (minutes)', 5, 1440)}
        {num('moshKeepMinutes', 'Mosh mode keeps a dropped session (minutes)', 1, 1440)}
        <label className={`${P}__field`}><span>Container shell user (empty = Container access default, root)</span><input className="fx-input" value={v.user} onChange={(e) => setD({ ...d, user: e.target.value })} placeholder="0" /></label>
      </div>
      {tick('copyOnSelect', 'Copy on select')}
      {tick('pasteWarn', 'Ask before pasting several lines')}
      {tick('mouseDefault', 'New tabs start in mouse mode')}
      {tick('moshDefault', 'New tabs start in Mosh mode')}
      {tick('showHeadless', 'Show headless Claude Code sessions here: whenever the console or axHub starts one on the VPS, it opens in a VPS tab attached to it and the terminal window comes to the front (needs the VPS host set up)')}
      {tick('showHubRuns', 'Open approved VPS commands here: once a command you approved on axHub has run, its command and output open in a read-only tab')}
      <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={!Object.keys(d).length} onClick={() => void save(d).then(() => setD({}))}>Save</Button><span className="fx-small">{msg}</span></div>
      <p className="fx-small fx-muted">Shortcuts: Ctrl+Shift+C / Ctrl+Shift+V copy and paste; Ctrl+C copies when text is selected, otherwise interrupts; Ctrl+Shift+F searches. The console’s tokens and keys are kept out of every shell’s environment.</p>
    </div>
  );
}

export function VpsPanel() {
  const { s, msg, save } = useSettingsState();
  const [d, setD] = useState<{ host?: string; port?: number; user?: string }>({});
  const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState('');
  useEffect(() => { if (s?.publicKey) setPub(s.publicKey); }, [s?.publicKey]);
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const v = { ...s.vps, ...d };
  const gen = async (replace: boolean) => { setBusy(true); try { setPub((await post<{ publicKey: string }>('ssh/keygen', { replace })).publicKey); } finally { setBusy(false); } };
  const install = pub ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${pub}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys` : '';
  return (
    <div className="fx-stack">
      <p className="fx-small"><span className={`${P}__badge is-host`}>HOST ROOT</span> The VPS tab is a root shell on the server itself, over SSH with a key made just for this (the private half never leaves the console).</p>
      <div className={`${P}__cols`}>
        <label className={`${P}__field`}><span>Host (the VPS address as seen from the console container)</span><input className="fx-input" value={v.host} onChange={(e) => setD({ ...d, host: e.target.value })} placeholder="e.g. 172.17.0.1 or your VPS IP" /></label>
        <label className={`${P}__field`}><span>Port</span><input className="fx-input" type="number" value={v.port} onChange={(e) => setD({ ...d, port: Number(e.target.value) })} /></label>
        <label className={`${P}__field`}><span>User</span><input className="fx-input" value={v.user} onChange={(e) => setD({ ...d, user: e.target.value })} /></label>
      </div>
      <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={!Object.keys(d).length} onClick={() => void save({ vps: v }).then(() => setD({}))}>Save</Button><span className="fx-small">{msg}</span></div>
      <div className="fx-stack">
        <strong>Key</strong>
        {pub ? (
          <>
            <code className={`${P}__pub`}>{pub}</code>
            <p className="fx-small">Add it on the VPS once (as {v.user || 'root'}): <CopyLink text={install} label="Copy the command" /></p>
            <div className="fx-row fx-row--wrap"><Button tone="ghost" icon="refresh" disabled={busy} onClick={() => void gen(true)}>Make a new key</Button></div>
          </>
        ) : <Button icon="lock" disabled={busy} onClick={() => void gen(false)}>{busy ? 'Making…' : 'Make the key'}</Button>}
      </div>
    </div>
  );
}

export function ClaudePanel() {
  const { s, msg, save } = useSettingsState();
  const [tok, setTok] = useState('');
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => { void call<Status>('status').then(setSt, () => undefined); }, []);
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  return (
    <div className="fx-stack">
      <p className="fx-small">The Claude Code tab is you driving the CLI in the console (its Edit, Write and Bash tools are on, unlike the assistant’s locked-down provider). {st ? (st.claude ? <Chip tone="success">CLI installed</Chip> : <Chip tone="warning">CLI not installed</Chip>) : null}</p>
      <label className={`${P}__field`}><span>Claude Code token (optional; else sign in with /login inside the tab) {s.claudeToken && <Chip tone="success">saved</Chip>}</span>
        <input className="fx-input fx-mono" type="password" autoComplete="off" value={tok} onChange={(e) => setTok(e.target.value)} placeholder={s.claudeToken ? '•••••••• (saved; type to replace)' : 'sk-ant-oat01-… from `claude setup-token`'} />
      </label>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" disabled={!tok.trim()} onClick={() => void save({ claudeToken: tok.trim() }).then(() => setTok(''))}>Save</Button>
        {s.claudeToken && <Button tone="ghost" icon="trash" onClick={() => void save({ claudeToken: '' })}>Remove</Button>}
        <span className="fx-small">{msg}</span>
      </div>
      <p className="fx-small fx-muted">Stored on the console server only (owner-only file), passed only to the Claude Code tab, never sent back to a browser.</p>
    </div>
  );
}

export function MoshiPanel() {
  const { s } = useSettingsState();
  const host = s?.vps.host || 'YOUR-VPS';
  const user = s?.vps.user || 'root';
  return (
    <div className="fx-stack">
      <p className="fx-small">In the console, <strong>Mosh mode</strong> (the <Icon name="zap" size={12} /> on a terminal tab) keeps the session on the server so it survives dropped signal, sleep and network switches, reconnects by itself, and echoes your typing right away. Browsers can’t speak real Mosh (UDP), so this copies its behaviour over the WebSocket.</p>
      <p className="fx-small">For the Moshi app (real Mosh to the VPS): <CopyLink text={`mosh ${user}@${host}`} label={`mosh ${user}@${host}`} /> · plain SSH: <CopyLink text={`ssh ${user}@${host}`} label={`ssh ${user}@${host}`} /></p>
      <p className="fx-small fx-muted">The VPS needs mosh-server and UDP 60000–61000 open (the systems check reports both).</p>
    </div>
  );
}

export function SessionsPanel() {
  const rt = useRuntime();
  const [items, setItems] = useState<SessionInfo[] | null>(null);
  const [log, setLog] = useState<{ at: number; op: string; kind: string; target: string; cwd?: string; seconds?: number; reason?: string; protected?: boolean }[]>([]);
  const load = () => {
    void call<{ items: SessionInfo[] }>('sessions').then((r) => setItems(r.items), () => setItems([]));
    void call<{ items: typeof log }>('log?limit=100').then((r) => setLog(r.items), () => undefined);
  };
  useEffect(load, []);
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap"><strong className="fx-grow">Open now</strong><Button tone="ghost" icon="refresh" onClick={load}>Refresh</Button></div>
      {items && !items.length && <p className="fx-small fx-muted">No terminals open.</p>}
      <ul className={`${P}__list`}>
        {(items ?? []).map((s) => (
          <li key={s.id}>
            <Icon name="terminal" size={13} /> <strong>{s.title}</strong> <span className="fx-muted fx-small">{s.kind} · {s.cwd} · {s.attached ? 'attached' : 'detached'}{s.mosh ? ' · Mosh' : ''}</span>
            {s.badge && <span className={`${P}__badge ${s.badge === 'HOST ROOT' ? 'is-host' : 'is-protected'}`}>{s.badge}</span>}
            <Button tone="ghost" icon="x" onClick={() => void call(`sessions/${s.id}`, { method: 'DELETE' }).then(load)}>Close</Button>
          </li>
        ))}
      </ul>
      <strong>Session log</strong>
      <ul className={`${P}__list`}>
        {log.map((e, i) => (
          <li key={`${e.at}-${i}`} className="fx-small">{new Date(e.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} · <strong>{e.op}</strong> {e.kind} {e.target}{e.cwd ? ` ${e.cwd}` : ''}{e.protected ? ' (protected)' : ''}{e.seconds !== undefined ? ` · ${e.seconds}s` : ''}{e.reason ? ` · ${e.reason}` : ''}</li>
        ))}
        {!log.length && <li className="fx-small fx-muted">Nothing logged yet.</li>}
      </ul>
      <Button tone="ghost" icon="terminal" onClick={() => newTab(rt, { kind: 'console' })}>Open a terminal</Button>
    </div>
  );
}
