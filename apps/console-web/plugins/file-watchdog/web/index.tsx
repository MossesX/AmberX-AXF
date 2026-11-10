/**
 * File watchdog (file-watchdog): the page, Settings → Plugins → File watchdog, and the open action. The server
 * (server/engine.py) watches and runs everything; this page lists the watches and recent events, adds, edits,
 * switches, tests and removes watches, approves script / shell actions, and holds each watch's Enable AI switch.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './watchdog.css';

const FOLDER = 'file-watchdog';
const VIEW = 'file-watchdog';
const P = 'axp-file-watchdog';
const POLL_MS = 5000;
const api = pluginApi(FOLDER, 'The file watchdog');

type EventType = 'created' | 'modified' | 'deleted';
type ActionType = 'notify' | 'script' | 'shell' | 'console' | 'control';
interface Approval { hash: string; state: 'needed' | 'requested' | 'approved'; by: string; at: number }
interface Action {
  type: ActionType; enabled: boolean; title?: string; severity?: string; script?: string; args?: unknown;
  command?: unknown; action?: string; timeout?: number; approval?: Approval;
}
interface Ai { enabled: boolean; prompt: string; model: string; profile: string; maxTokens: number }
interface Watch {
  id: string; name: string; paths: string[]; events: EventType[]; recursive: boolean; ignore: string[]; debounceMs: number;
  enabled: boolean; actions: Action[]; ai: Ai; files: number; pending: number; fired: number;
}
interface Result { index: number; type: string; status: string; ok: boolean; message: string; ms: number; model?: string; usage?: { input: number; output: number } }
interface Ev { id: string; at: number; watch: string; name: string; event: string; path: string; rel: string; test?: boolean; results: Result[] }
interface State {
  engine: { running: boolean; mode: string; folders: number; lastPass: number };
  root: string; watches: Watch[]; recent: Ev[];
  counts: { watches: number; enabled: number; ai: number; needApproval: number };
  services: { console: boolean; control: boolean; llm: boolean };
}

const EVENTS: EventType[] = ['created', 'modified', 'deleted'];
const TYPES: { value: ActionType; label: string }[] = [
  { value: 'notify', label: 'Notify AmberX / console' },
  { value: 'script', label: 'Run a script' },
  { value: 'shell', label: 'Run a shell command' },
  { value: 'console', label: 'Console action' },
  { value: 'control', label: 'control@1 command' },
];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const when = (t: number) => new Date(t * 1000).toLocaleString();
const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

function describe(a: Action): string {
  if (a.type === 'notify') return a.title || 'notify: {name}: {event} {rel}';
  if (a.type === 'script') return `${a.script ?? ''} ${Array.isArray(a.args) ? a.args.join(' ') : ''}`.trim();
  if (a.type === 'shell') return String(a.command ?? '');
  if (a.type === 'console') return a.action ?? '';
  return JSON.stringify(a.command ?? {});
}

/** The add / edit form. Actions are edited as rows; the server checks every field and says what to fix. */
interface Draft { id?: string; name: string; paths: string; events: EventType[]; recursive: boolean; debounceMs: string; ignore: string; enabled: boolean; actions: DraftAction[]; ai: Ai }
interface DraftAction { type: ActionType; text: string; extra: string; severity: string }

function toDraft(w?: Watch): Draft {
  if (!w) return { name: '', paths: '', events: [...EVENTS], recursive: true, debounceMs: '500', ignore: '', enabled: true, actions: [{ type: 'notify', text: '', extra: '', severity: 'info' }], ai: { enabled: false, prompt: '', model: '', profile: '', maxTokens: 1200 } };
  return {
    id: w.id, name: w.name, paths: w.paths.join('\n'), events: w.events, recursive: w.recursive, debounceMs: String(w.debounceMs), ignore: w.ignore.join('\n'), enabled: w.enabled, ai: w.ai,
    actions: w.actions.map((a) => ({
      type: a.type, severity: a.severity ?? 'info',
      text: a.type === 'notify' ? a.title ?? '' : a.type === 'script' ? a.script ?? '' : a.type === 'console' ? a.action ?? '' : a.type === 'control' ? JSON.stringify(a.command ?? {}) : String(a.command ?? ''),
      extra: a.type === 'script' && Array.isArray(a.args) ? a.args.join('\n') : a.type === 'console' && a.args ? JSON.stringify(a.args) : '',
    })),
  };
}

function fromDraft(d: Draft): Record<string, unknown> {
  return {
    name: d.name, paths: lines(d.paths), events: d.events, recursive: d.recursive, debounceMs: Number(d.debounceMs) || 0, enabled: d.enabled,
    ignore: d.ignore.trim() ? lines(d.ignore) : undefined, ai: d.ai,
    actions: d.actions.map((a) => {
      if (a.type === 'notify') return { type: 'notify', title: a.text, severity: a.severity };
      if (a.type === 'script') return { type: 'script', script: a.text, args: lines(a.extra) };
      if (a.type === 'shell') return { type: 'shell', command: a.text };
      if (a.type === 'console') { let args: unknown; try { args = a.extra.trim() ? JSON.parse(a.extra) : undefined; } catch { args = a.extra; } return { type: 'console', action: a.text, args }; }
      return { type: 'control', command: a.text };
    }),
  };
}

const TEXT_LABEL: Record<ActionType, [string, string]> = {
  notify: ['Title', '{name}: {event} {rel}'],
  script: ['Script path', 'scripts/on-change.sh'],
  shell: ['Command', 'npm test -- {path}'],
  console: ['Action id', 'nav:builds'],
  control: ['control@1 command (JSON)', '{"op":"act","target":"…"}'],
};

function Editor({ start, onDone }: { start?: Watch; onDone: (saved: boolean) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(start));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setAction = (i: number, p: Partial<DraftAction>) => set({ actions: d.actions.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const save = () => {
    setBusy(true); setError('');
    const body = fromDraft(d);
    (d.id ? api.post('update', { id: d.id, ...body }) : api.post('add', body)).then(() => onDone(true), (e) => setError(say(e))).finally(() => setBusy(false));
  };
  return (
    <Container title={d.id ? `Edit ${d.name}` : 'New watch'} icon="eye">
      <div className={`${P}__form`}>
        {error && <Note tone="danger">{error}</Note>}
        <TextField label="Name" value={d.name} onChange={(v) => set({ name: v })} placeholder="Plans changed" />
        <TextField label="Paths, folders or globs (one per line)" value={d.paths} onChange={(v) => set({ paths: v })} rows={3} mono placeholder={'_claude/plans/**/*.md\n/opt/axf/deploy/.env'} hint="Relative to the repo root, or absolute on the VPS." />
        <div className={`${P}__line`} role="group" aria-label="Events">
          {EVENTS.map((e) => <Switch key={e} label={e} checked={d.events.includes(e)} onChange={(v) => set({ events: v ? [...d.events, e] : d.events.filter((x) => x !== e) })} />)}
        </div>
        <div className={`${P}__line`} role="group" aria-label="Watch settings">
          <Switch label="Recursive" checked={d.recursive} onChange={(v) => set({ recursive: v })} hint="Include sub-folders." />
          <Switch label="Enabled" checked={d.enabled} onChange={(v) => set({ enabled: v })} />
          <TextField className={`${P}__narrow`} label="Debounce (ms)" value={d.debounceMs} onChange={(v) => set({ debounceMs: v })} type="number" />
        </div>
        <TextField label="Ignore patterns (one per line, blank = defaults)" value={d.ignore} onChange={(v) => set({ ignore: v })} rows={2} mono placeholder={'.git/**\nnode_modules/**\n*.swp'} />
        <h3 className={`${P}__sub`}>Actions</h3>
        <p className={`${P}__muted`}>Every action gets the changed path and event: {'{path}'} {'{rel}'} {'{event}'} {'{name}'} in its text, WATCHDOG_PATH / WATCHDOG_EVENT in a script's environment. Scripts and shell commands run only after Brett approves them.</p>
        {d.actions.map((a, i) => (
          <div key={i} className={`${P}__action`}>
            <div className={`${P}__line`}>
              <SelectField className={`${P}__narrow`} label="Type" value={a.type} options={TYPES} onChange={(v) => setAction(i, { type: v as ActionType })} />
              {a.type === 'notify' && <SelectField className={`${P}__narrow`} label="Severity" value={a.severity} options={['info', 'warning', 'error'].map((s) => ({ value: s, label: s }))} onChange={(v) => setAction(i, { severity: v })} />}
              <Button size="sm" tone="ghost" icon="trash" title="Remove this action" onClick={() => set({ actions: d.actions.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
            <TextField label={TEXT_LABEL[a.type][0]} value={a.text} onChange={(v) => setAction(i, { text: v })} mono={a.type !== 'notify'} rows={a.type === 'control' ? 3 : undefined} placeholder={TEXT_LABEL[a.type][1]} />
            {a.type === 'script' && <TextField label="Arguments (one per line)" value={a.extra} onChange={(v) => setAction(i, { extra: v })} rows={2} mono placeholder="{path}" />}
            {a.type === 'console' && <TextField label="Args (JSON or text, optional)" value={a.extra} onChange={(v) => setAction(i, { extra: v })} mono />}
          </div>
        ))}
        <div className={`${P}__line`} role="toolbar" aria-label="Actions">
          <Button size="sm" icon="plus" onClick={() => set({ actions: [...d.actions, { type: 'shell', text: '', extra: '', severity: 'info' }] })}>Add action</Button>
        </div>
        <h3 className={`${P}__sub`}>AI (optional)</h3>
        <Switch label="Enable AI" checked={d.ai.enabled} onChange={(v) => set({ ai: { ...d.ai, enabled: v } })} hint="Off by default. When on, each change sends your prompt plus the path, event and diff to Claude; tokens are logged." />
        <TextField label="Prompt" value={d.ai.prompt} onChange={(v) => set({ ai: { ...d.ai, prompt: v } })} rows={3} placeholder="Summarise what changed in {rel} and flag anything risky." />
        <div className={`${P}__line`}>
          <TextField className={`${P}__narrow`} label="Model (optional)" value={d.ai.model} onChange={(v) => set({ ai: { ...d.ai, model: v } })} placeholder="the assistant's default" />
          <TextField className={`${P}__narrow`} label="Profile (optional)" value={d.ai.profile} onChange={(v) => set({ ai: { ...d.ai, profile: v } })} placeholder="default routing" />
        </div>
        <div className={`${P}__line`} role="toolbar" aria-label="Save watch">
          <Button tone="primary" icon="check" disabled={busy} onClick={save}>{d.id ? 'Save' : 'Add watch'}</Button>
          <Button tone="ghost" onClick={() => onDone(false)}>Cancel</Button>
        </div>
      </div>
    </Container>
  );
}

function EventRow({ e }: { e: Ev }) {
  return (
    <div className={`${P}__event`} data-fx-row>
      <div className={`${P}__line`}>
        <Chip>{e.event}</Chip>
        <b className={`${P}__path`}>{e.rel || e.path || e.name}</b>
        <span className={`${P}__muted`}>{e.name} · {when(e.at)}{e.test ? ' · test' : ''}</span>
      </div>
      {e.results.map((r, i) => (
        <div key={i} className={`${P}__result`}>
          <Chip>{r.type}: {r.status}</Chip>
          <span className={`${P}__out`}>{r.message}{r.usage ? ` (${r.model || 'model'}: ${r.usage.input} in / ${r.usage.output} out tokens)` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function WatchRow({ w, act, edit }: { w: Watch; act: (path: string, body: unknown) => void; edit: () => void }) {
  const [prompt, setPrompt] = useState(w.ai.prompt);
  useEffect(() => setPrompt(w.ai.prompt), [w.ai.prompt]);
  return (
    <div className={`${P}__watch`}>
      <div className={`${P}__line`}>
        <Switch label={w.name} checked={w.enabled} onChange={(v) => act('enable', { id: w.id, enabled: v })} hint={w.paths.join(', ')} />
        <Chip>{w.events.join(' · ')}</Chip>
        <Chip>{w.files} files</Chip>
        <Chip>fired {w.fired}</Chip>
        {w.pending > 0 && <Chip>{w.pending} waiting</Chip>}
      </div>
      <ul className={`${P}__actions`}>
        {w.actions.map((a, i) => (
          <li key={i} className={`${P}__line`}>
            <Chip>{a.type}</Chip>
            <code className={`${P}__out`}>{describe(a)}</code>
            {a.approval && a.approval.state !== 'approved' && <Button size="sm" tone="primary" icon="check" onClick={() => act('approve', { id: w.id, action: i })}>{a.approval.state === 'requested' ? 'Approve (asked)' : 'Approve'}</Button>}
            {a.approval?.state === 'approved' && <Button size="sm" tone="ghost" title={`Approved by ${a.approval.by}`} onClick={() => act('approve', { id: w.id, action: i, revoke: true })}>Revoke</Button>}
          </li>
        ))}
        {!w.actions.length && <li className={`${P}__muted`}>No actions: changes are only logged.</li>}
      </ul>
      <div className={`${P}__line`}>
        <Switch label="Enable AI" checked={w.ai.enabled} onChange={(v) => act('ai', { id: w.id, enabled: v })} />
        {w.ai.enabled && <TextField className={`${P}__grow`} label="AI prompt" value={prompt} onChange={setPrompt} placeholder="What should Claude do with the change?" />}
        {w.ai.enabled && prompt !== w.ai.prompt && <Button size="sm" icon="check" onClick={() => act('ai', { id: w.id, prompt })}>Save prompt</Button>}
      </div>
      <div className={`${P}__line`} role="toolbar" aria-label={`Watch ${w.name}`}>
        <Button size="sm" icon="play" onClick={() => act('test', { id: w.id })}>Test</Button>
        <Button size="sm" tone="ghost" icon="file" onClick={edit}>Edit</Button>
        <Button size="sm" tone="ghost" icon="trash" onClick={() => { if (confirm(`Remove the watch "${w.name}"?`)) act('remove', { id: w.id }); }}>Remove</Button>
      </div>
    </div>
  );
}

function Page() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Watch | 'new' | null>(null);
  const load = useCallback(() => api.call<State>('state').then((x) => { setS(x); setError(''); }, (e) => setError(say(e))), []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS); return () => clearInterval(t); }, [load]);
  const act = (path: string, body: unknown) => {
    const run = path === 'remove' ? api.del(`watch?id=${encodeURIComponent((body as { id: string }).id)}`) : api.post(path, body);
    void run.then(() => load(), (e) => setError(say(e)));
  };
  if (!s) return error ? <Note tone="danger">File watchdog unavailable: {error}</Note> : <p className={`${P}__muted`}>Loading…</p>;
  return (
    <div className="fx-stack fx-stack--lg" data-axf-plugin="ai.amberx.axf.console.file-watchdog">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>File watchdog</h1></div></header>
      {error && <Note tone="danger">{error}</Note>}
      {!s.engine.running && <Note tone="warning">The watch loop isn't running: restart the console API.</Note>}
      {s.counts.needApproval > 0 && <Note tone="info">{s.counts.needApproval} script or shell action(s) wait for your approval before they run.</Note>}
      <div className={`${P}__line`} role="toolbar" aria-label="File watchdog">
        <Button tone="primary" icon="plus" onClick={() => setEditing('new')}>New watch</Button>
        <Button tone="ghost" icon="refresh" onClick={() => void api.post('scan', {}).then(() => load())}>Check now</Button>
        <span className={`${P}__muted`}>{s.counts.enabled} of {s.counts.watches} on · {s.engine.mode} · {s.engine.folders} folders · root {s.root}</span>
      </div>
      {editing && <Editor key={editing === 'new' ? 'new' : editing.id} start={editing === 'new' ? undefined : editing} onDone={(saved) => { setEditing(null); if (saved) void load(); }} />}
      <Container title="Watches" icon="eye">
        {s.watches.length ? s.watches.map((w) => <WatchRow key={w.id} w={w} act={act} edit={() => setEditing(w)} />) : <p className={`${P}__muted`}>No watches yet. Add one here, or say "watch the plans folder" to AmberX.</p>}
      </Container>
      <Container title="Recent events" icon="bell">
        <div className={`${P}__line`} role="toolbar" aria-label="Event log">
          <Button size="sm" tone="ghost" icon="trash" onClick={() => { if (confirm('Clear the event log?')) act('events/clear', {}); }}>Clear log</Button>
        </div>
        {s.recent.length ? s.recent.map((e) => <EventRow key={e.id} e={e} />) : <p className={`${P}__muted`}>Nothing has changed yet.</p>}
      </Container>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.file-watchdog',
  label: 'File watchdog',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('file-watchdog.open', () => rt.dispatch(`nav:${VIEW}`), { label: 'File watchdog' });
  },
  views: { [VIEW]: { title: 'File watchdog', icon: 'eye', render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'File watchdog', icon: 'eye', view: VIEW }] },
  settingsTabs: [{ id: VIEW, label: 'File watchdog', icon: 'eye', order: 60, parent: 'plugins', description: 'Watch files and run scripts, shell or console commands when they change; optional AI.' }],
  settingsPanels: [
    { id: 'file-watchdog.page', tab: VIEW, title: 'Watches', icon: 'eye', order: 1, render: () => <Page /> },
    { id: 'file-watchdog.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
