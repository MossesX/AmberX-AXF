/**
 * Claude accounts: the page, Settings → Plugins → Claude accounts, and the banner chip (tap = the switch dialog). It only
 * ever sees account names, roles, email + plan, and each account's limit, jobs and cost. Switch, Save, Sign in and Remove
 * ask the server, which sends one held axHub call; the change happens when Brett's approval clears it. A worker account
 * only runs headless jobs: the console stays on the active account.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Icon, Note, TextField, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './claude-accounts.css';

const ID = 'ai.amberx.axf.console.claude-accounts';
const FOLDER = 'claude-accounts';
const VIEW = 'claude-accounts';
const DIALOG = 'claude-accounts.switch';
const POLL_MS = 60000;
const ASSET_ID = 'claude-account';
const COUNTER = 'claude-accounts.active';
const NAME = /^[a-z0-9-]{1,32}$/;

type Op = 'use' | 'save' | 'signin' | 'remove';
type Role = 'interactive' | 'worker' | 'saved';
interface Run { session: string; name: string; agent?: string; model?: string; at: string; end: string; exit: number | null; costUsd: number }
interface Account {
  name: string; active: boolean; email: string; plan: string; type: string; role: Role;
  limited: { until: string; kind: string; reason: string } | null; running: string[]; runsToday: number; costToday: number; costWeek: number; recent: Run[];
}
interface Pending { op: Op; name: string; by: string }
interface View {
  ok: boolean; ready: boolean; why: string; accounts: Account[]; active: string; login: { email?: string; plan?: string };
  loginChanged: boolean; pending: Pending | null; note: string;
}

/* ---------------- data: one poll shared by the chip and the screens ---------------- */

let shared: View | null = null;
const listeners = new Set<(v: View | null) => void>();
function publish(v: View | null) { shared = v; for (const l of listeners) l(v); }

async function load(): Promise<void> {
  const r = await pluginFetch(FOLDER, 'accounts');
  const j = (await r.json()) as View & { detail?: string };
  if (!r.ok || !j.ok) throw new Error(j.detail || `HTTP ${r.status}`);
  publish(j);
}

async function ask(op: Op | 'role', name: string, role?: Role): Promise<string> {
  const r = await pluginFetch(FOLDER, op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; detail?: string };
  await load().catch(() => undefined);
  if (!r.ok || !j.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
  return j.message ?? '';
}

function useAccounts() {
  const [view, setView] = useState<View | null>(shared);
  const [error, setError] = useState('');
  const refresh = useCallback(() => load().then(() => setError(''), (e: Error) => setError(e.message)), []);
  useEffect(() => {
    listeners.add(setView);
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { listeners.delete(setView); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  return { view, error, refresh };
}

/* ---------------- the list and the save form ---------------- */

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const usd = (n: number) => `$${n.toFixed(2)}`;

function usageLine(a: Account): string {
  const jobs = a.running.length ? [`${a.running.length} running`] : [];
  return [...jobs, `${a.runsToday} run${a.runsToday === 1 ? '' : 's'} today`, `${usd(a.costToday)} today`, `${usd(a.costWeek)} this week`].join(' · ');
}

function Row({ a, view, onDone, manage }: { a: Account; view: View; onDone: (m: string, bad?: boolean) => void; manage: boolean }) {
  const [busy, setBusy] = useState(false);
  const waiting = view.pending?.name === a.name;
  const sub = [a.email, a.plan].filter(Boolean).join(' · ');
  const run = (p: Promise<string>) => { setBusy(true); p.then((m) => onDone(m), (e: Error) => onDone(e.message, true)).finally(() => setBusy(false)); };
  const isWorker = a.role === 'worker';
  const held = busy || !!view.pending;
  return (
    <div className="axp-ca-row" data-account={a.name}>
      <div className="axp-ca-row__who">
        <b>{a.name}</b>
        {sub && <p className="axp-ca-row__sub">{sub}</p>}
        {(isWorker || a.runsToday > 0 || a.costWeek > 0) && <p className="axp-ca-row__sub">{usageLine(a)}</p>}
      </div>
      <div className="axp-ca-row__actions">
      {a.active && <Chip tone="success"><Icon name="check" size={12} /> Active</Chip>}
      {isWorker && <Chip tone="accent">Worker</Chip>}
      {a.limited && <Chip tone="warning">Out until {when(a.limited.until)}</Chip>}
      {waiting && <Chip tone="warning">Waiting for approval</Chip>}
      {!a.active && !isWorker && <Button tone="primary" icon="refresh" busy={busy} disabled={held} onClick={() => run(ask('use', a.name))}>Switch</Button>}
      {manage && !a.active && a.type !== 'api-key' && <Button icon="user" busy={busy} disabled={busy} onClick={() => run(ask('role', a.name, isWorker ? 'saved' : 'worker'))}>{isWorker ? 'Stop worker' : 'Make worker'}</Button>}
      {manage && a.type !== 'api-key' && <Button icon="key" busy={busy} disabled={held} onClick={() => run(ask('signin', a.name))}>Sign in</Button>}
      {manage && !a.active && <Button tone="danger" icon="trash" busy={busy} disabled={held || a.running.length > 0} confirm={`Set ${a.name} aside? Its saved login moves out of the list. Nothing is deleted.`} onClick={() => run(ask('remove', a.name))}>Remove</Button>}
      </div>
    </div>
  );
}

function AccountList({ view, error, manage = false }: { view: View | null; error: string; manage?: boolean }) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const done = (text: string, bad = false) => setSaid({ text, bad });
  if (error) return <Note tone="danger">Claude accounts unavailable: {error}</Note>;
  if (!view) return <p className="axp-ca-help">Reading the accounts on the VPS…</p>;
  return (
    <div className="fx-stack">
      {!view.ready && <Note tone="warning">Can't read the VPS host: {view.why}</Note>}
      {view.loginChanged && <Note tone="warning">Claude on the VPS is signed in as {view.login.email}, which isn't {view.active}. Save this login under its own name before you switch, or the switch writes it over {view.active}.</Note>}
      {view.ready && !view.accounts.length && <p className="axp-ca-help">No accounts saved yet.</p>}
      <div>{view.accounts.map((a) => <Row key={a.name} a={a} view={view} onDone={done} manage={manage} />)}</div>
      {said && <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note>}
      <p className="axp-ca-help">{view.note}</p>
    </div>
  );
}

function SaveForm({ view }: { view: View | null }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const valid = NAME.test(name);
  const exists = !!view?.accounts.some((a) => a.name === name);
  const go = () => {
    setBusy(true); setSaid(null);
    ask('save', name).then((text) => { setSaid({ text, bad: false }); setName(''); }, (e: Error) => setSaid({ text: e.message, bad: true })).finally(() => setBusy(false));
  };
  return (
    <div className="fx-stack">
      <div className="axp-ca-save">
        <TextField label="Save current login as…" value={name} hint="Lower-case letters, digits and dashes, up to 32." disabled={busy} onChange={(v) => setName(v.trim().toLowerCase())} />
        <Button tone="primary" icon="save" busy={busy} disabled={busy || !valid || !!view?.pending} confirm={exists ? `Replace the saved login ${name}?` : undefined} onClick={go}>Save</Button>
      </div>
      {name && !valid && <Note tone="warning">That name won't do: lower-case letters, digits and dashes only.</Note>}
      {said && <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note>}
    </div>
  );
}

function AddHelp() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">To add an account: Terminal &gt; VPS host &gt; claude &gt; /login, then Save current login as… right away, before you switch.</p>
      <div><Button icon="terminal" onClick={() => rt.dispatch('terminal.claude')}>New Claude Code terminal</Button></div>
    </div>
  );
}

function Accounts({ manage = false }: { manage?: boolean }) {
  const { view, error } = useAccounts();
  return <AccountList view={view} error={error} manage={manage} />;
}

function AddWorker({ view }: { view: View | null }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const valid = NAME.test(name);
  const exists = !!view?.accounts.some((a) => a.name === name);
  const go = async () => {
    setBusy(true); setSaid(null);
    try {
      setSaid({ text: await ask('signin', name), bad: false });
      setName('');
    } catch (e) { setSaid({ text: (e as Error).message, bad: true }); }
    setBusy(false);
  };
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">The console stays on the active account. Workers only run headless jobs: each new job goes to the least busy one, and when one hits its limit the job moves to the next.</p>
      <p className="axp-ca-help">Sign in runs in that account's own folder, so the active login isn't touched. It opens in the Terminal once approved. Then tap Make worker on the new row.</p>
      <div className="axp-ca-save">
        <TextField label="New account name" value={name} hint="Lower-case letters, digits and dashes, up to 32." disabled={busy} onChange={(v) => setName(v.trim().toLowerCase())} />
        <Button tone="primary" icon="key" busy={busy} disabled={busy || !valid || exists || !!view?.pending} onClick={() => void go()}>Add and sign in</Button>
      </div>
      {name && exists && <Note tone="warning">{name} already exists: tap Sign in on its row.</Note>}
      {said && <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note>}
    </div>
  );
}

function WorkerRuns({ view }: { view: View | null }) {
  const runs = (view?.accounts ?? []).flatMap((a) => a.recent.map((r) => ({ ...r, account: a.name }))).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 10);
  if (!runs.length) return <p className="axp-ca-help">No headless runs recorded yet.</p>;
  return (
    <div>
      {runs.map((r) => (
        <div key={`${r.session}-${r.account}-${r.at}`} className="axp-ca-row">
          <div className="axp-ca-row__who">
            <b>{r.name}</b>
            <p className="axp-ca-row__sub">{[r.account, r.agent, when(r.at)].filter(Boolean).join(' · ')}</p>
          </div>
          <Chip tone={r.end ? (r.exit ? 'warning' : undefined) : 'accent'}>{r.end ? (r.exit ? `Exit ${r.exit}` : 'Finished') : 'Running'}</Chip>
          <span>{usd(r.costUsd)}</span>
        </div>
      ))}
    </div>
  );
}

function Workers() {
  const { view } = useAccounts();
  return <AddWorker view={view} />;
}

function Runs() {
  const { view } = useAccounts();
  return <WorkerRuns view={view} />;
}

function Save() {
  const { view } = useAccounts();
  return <div className="fx-stack"><SaveForm view={view} /><AddHelp /></div>;
}

function Page() {
  const { refresh } = useAccounts();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · Claude accounts</p>
          <h1>Claude accounts</h1>
          <p className="fx-muted">One account runs the console; workers only run headless jobs. Every switch, save, sign-in or removal waits for your approval.</p>
        </div>
        <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
      </header>
      <Container title="Accounts" icon="key"><Accounts manage /></Container>
      <Container title="Add a worker account" icon="user"><Workers /></Container>
      <Container title="Recent headless runs" icon="clock"><Runs /></Container>
      <Container title="Add an account" icon="plus"><Save /></Container>
    </div>
  );
}

/** The banner chip: a framework status widget naming the active account; tap = the switch dialog. */
function paint(rt: AxfRuntime, v: View | null) {
  if (!v?.active) { rt.setBadge(COUNTER, 0); rt.detachFromBanner(`status:${ASSET_ID}`); return; }
  const label = v.pending ? `Claude: ${v.active} · waiting` : `Claude: ${v.active}`;
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Claude account', version: '0.1.0', author: 'Claude accounts plugin',
    description: 'The active Claude account on the VPS. Tap to switch.', tags: ['claude', 'status'],
    data: { counter: COUNTER, onLabel: label, offLabel: label, onTone: v.pending ? 'warning' : 'accent', offTone: 'muted', dot: true, link: 'claude-accounts.switch' },
  }, 'app', ID);
  rt.setBadge(COUNTER, 1);
  rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 21, origin: ID });
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude accounts',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('claude-accounts.open', () => rt.dispatch(`settings.open:${VIEW}`), { label: 'Claude accounts settings' });
    rt.actions.register('claude-accounts.switch', () => rt.openDialog(DIALOG, {}), { label: 'Switch Claude account' });
    listeners.add((v) => paint(rt, v));
    const tick = () => { if (document.visibilityState === 'visible') void load().catch(() => undefined); };
    tick();
    setInterval(tick, POLL_MS);
  },
  views: { 'claude-accounts': { title: 'Claude accounts', icon: 'key', render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Claude accounts', icon: 'key', view: VIEW }] },
  dialogs: { [DIALOG]: { title: 'Switch Claude account', icon: 'key', searchable: false, render: () => <Accounts /> } },
  settingsTabs: [{ id: VIEW, label: 'Claude accounts', icon: 'key', order: 13, parent: 'plugins', description: 'One Claude account for the console, the rest headless workers: list, switch, sign in, usage per account.' }],
  settingsPanels: [
    { id: 'claude-accounts.list', tab: VIEW, title: 'Accounts', icon: 'key', order: 1, render: () => <Accounts manage /> },
    { id: 'claude-accounts.workers', tab: VIEW, title: 'Add a worker account', icon: 'user', order: 2, render: () => <Workers /> },
    { id: 'claude-accounts.runs', tab: VIEW, title: 'Recent headless runs', icon: 'clock', order: 3, render: () => <Runs /> },
    { id: 'claude-accounts.add', tab: VIEW, title: 'Add an account', icon: 'plus', order: 4, render: () => <Save /> },
    { id: 'claude-accounts.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
