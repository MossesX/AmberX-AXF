/**
 * Build to-do sync — web part. A page (Builds → Build to-do lists): sync state, items Brett ticked in the to-do manager
 * waiting for his OK, builds whose name / category still need his OK, every mirrored build by place. A dialog
 * (`build-todo-sync.name`) that prompts for a build's short name and category: opened by the plugin itself when a new
 * build appears without a confirmed name (setting Auto-prompt), from the Builds menu, by `console_show`, or by any
 * session through the console-commands capability. Settings → Plugins → Build to-do sync: on/off and timings.
 *
 * Framework controls and theme tokens only; the rules are in web/core.ts (checked by test.mts) and the server part.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, Note, SelectField, Switch, TextField, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { followSse, sseJson } from '@console/axf/core/sse';
import { pluginApi, pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { CATEGORIES, MAX_NAME, askLine, cleanName, groupBuilds, parseFrame, promptCandidates, since, statusLine, type Ask, type NameRow, type Settings, type SyncState } from './core';
import { appMenu } from './menu';
import './build-todo-sync.css';

const FOLDER = 'build-todo-sync';
const DIALOG = 'build-todo-sync.name';
const VIEW = 'build-todo-sync';
const PROMPTED_KEY = 'axf.build-todo-sync.prompted';
const api = pluginApi(FOLDER, 'Build to-do sync');
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));

/* ---------------- a small store the page, dialog and settings share ---------------- */
interface Local { state: SyncState | null; names: NameRow[]; error: string; busy: boolean }
let local: Local = { state: null, names: [], error: '', busy: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<Local>) => { local = { ...local, ...patch }; for (const l of listeners) l(); };
const useLocal = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => local);

async function loadState(): Promise<void> {
  try { set({ state: await api.call<SyncState>('state'), error: '' }); } catch (e) { set({ error: (e as Error).message }); }
}
async function loadNames(): Promise<void> {
  try { const r = await api.call<{ builds: NameRow[] }>('names'); set({ names: r.builds }); } catch (e) { set({ error: (e as Error).message }); }
}
const prompted = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(PROMPTED_KEY) ?? '[]') as string[]); } catch { return new Set(); } };
const markPrompted = (id: string) => { const s = prompted(); s.add(id); localStorage.setItem(PROMPTED_KEY, JSON.stringify([...s].slice(-200))); };

/* ---------------- pieces ---------------- */

function StatusChip({ s }: { s: SyncState }) {
  const line = statusLine(s);
  return <Chip tone={line.tone}>{line.text}</Chip>;
}

/** Name + category for one build; `onDone` after a save. */
function NameForm({ row, onDone, compact }: { row: NameRow; onDone?: () => void; compact?: boolean }) {
  const rt = useRuntime();
  const [name, setName] = useState(row.displayName || row.suggested.displayName);
  const [category, setCategory] = useState(row.category || row.suggested.category);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const n = cleanName(name);
    if (!n) { rt.toast('A build needs a short name.', 'warning', 'Name a build'); return; }
    setSaving(true);
    try { await api.post('name', { id: row.id, displayName: n, category }); rt.toast(`"${n}" (${category}) saved.`, 'success', 'Build named'); await loadNames(); onDone?.(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Name a build'); }
    finally { setSaving(false); }
  };
  return (
    <div className="axp-build-todo-sync__form" data-axf-ctx-payload={row.id}>
      <TextField label={compact ? 'Short name' : `Short name for ${row.id}`} value={name} onChange={setName} placeholder={row.suggested.displayName} hint={`${MAX_NAME} characters at most · suggested: ${row.suggested.displayName}`} />
      <SelectField label="Category" value={category} options={CATEGORY_OPTIONS} onChange={setCategory} hint={`suggested: ${row.suggested.category} (${row.suggested.why})`} />
      <Button tone="primary" icon="check" busy={saving} disabled={saving} onClick={() => void save()}>Confirm name</Button>
    </div>
  );
}

function AskRow({ a }: { a: Ask }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const answer = async (decision: 'approve' | 'deny') => {
    setBusy(true);
    try { await api.post(`asks/${encodeURIComponent(a.id)}`, { decision }); rt.toast(decision === 'approve' ? 'Step changed in the orchestrator.' : 'Item put back.', 'success', 'To-do tick'); await loadState(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'To-do tick'); }
    finally { setBusy(false); }
  };
  return (
    <li className="axp-build-todo-sync__row">
      <Icon name="alert" size={16} />
      <span className="axp-build-todo-sync__grow">{askLine(a)} <span className="fx-muted fx-small">{since(a.at)}</span></span>
      <span className="axp-build-todo-sync__actions">
        <Button tone="primary" icon="check" disabled={busy} onClick={() => void answer('approve')}>Approve</Button>
        <Button icon="x" disabled={busy} onClick={() => void answer('deny')}>Deny</Button>
      </span>
    </li>
  );
}

function SyncPage() {
  const rt = useRuntime();
  const { state: s, names, error, busy } = useLocal();
  useEffect(() => { void loadState(); void loadNames(); }, []);
  const sync = async (dry = false) => {
    set({ busy: true });
    try { const r = await api.post<{ ok: boolean; ops: number; errors: string[]; drift: unknown[]; error?: string }>('sync', { dry, full: true }); rt.toast(r.ok ? `${dry ? 'Would change' : 'Changed'} ${r.ops} item(s); ${r.errors?.length ?? 0} error(s), ${r.drift?.length ?? 0} drift.` : r.error ?? 'failed', r.ok ? 'success' : 'danger', 'Build to-do sync'); await loadState(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Build to-do sync'); }
    finally { set({ busy: false }); }
  };
  const groups = groupBuilds(s?.builds ?? []);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>Build to-do lists</h1><p className="fx-muted">Every build is a list in the AmberX to-do manager (Builds › category › name); its items are the orchestrator's steps and tick off live.</p></div></header>
      {error && <Note tone="warning">{error}</Note>}
      <Container title="Sync" icon="refresh" actions={<span className="axp-build-todo-sync__actions"><Button icon="refresh" busy={busy} disabled={busy} onClick={() => void sync(false)}>Sync now</Button><Button icon="eye" disabled={busy} onClick={() => void sync(true)}>Dry run</Button></span>}>
        {s ? (
          <div className="axp-build-todo-sync__meta">
            <StatusChip s={s} />
            {s.lastSummary && <span>{s.lastSummary.builds} build(s) in {s.lastSummary.groups} group(s) · last run {s.lastReason || '—'}: {s.lastSummary.ops} change(s)</span>}
            {s.drift.length > 0 && <span>{s.drift.length} drift item(s)</span>}
            {!s.settings.on && <span>Off: switch it on in Settings → Plugins → Build to-do sync.</span>}
          </div>
        ) : <p className="fx-muted">Reading the sync state…</p>}
      </Container>
      <Container title="Needs your OK" icon="alert">
        {s && s.openAsks.length ? <ul className="axp-build-todo-sync__rows">{s.openAsks.map((a) => <AskRow key={a.id} a={a} />)}</ul>
          : <p className="fx-muted">Nothing waiting. Ticking an item in the to-do manager lands here before it changes a step.</p>}
      </Container>
      <Container title="Name these builds" icon="tag" actions={<Button icon="tag" onClick={() => rt.openDialog(DIALOG, {})}>Open the prompt</Button>}>
        {names.length ? <ul className="axp-build-todo-sync__rows">{names.map((n) => (
          <li key={n.id} className="axp-build-todo-sync__row">
            <div className="axp-build-todo-sync__grow">
              <div className="axp-build-todo-sync__ellipsis"><span className="axp-build-todo-sync__name">{n.title}</span> <span className="fx-mono fx-small fx-muted">{n.id}</span></div>
              <NameForm key={n.id} row={n} compact />
            </div>
          </li>
        ))}</ul> : <p className="fx-muted">Every open build has a confirmed name and category.</p>}
      </Container>
      <Container title="Mirrored builds" icon="list">
        {groups.length ? groups.map((g) => (
          <div key={g.place} className="axp-build-todo-sync__group">
            <h3>{g.place}</h3>
            <ul className="axp-build-todo-sync__rows">{g.builds.map((b) => (
              <li key={b.id} className="axp-build-todo-sync__row" data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={b.id}>
                <span className="axp-build-todo-sync__grow axp-build-todo-sync__ellipsis"><span className="axp-build-todo-sync__name">{b.displayName}</span> <span className="fx-muted fx-small">{b.title !== b.displayName ? b.title : ''}</span></span>
                <span className="axp-build-todo-sync__meta">
                  <span className="axp-build-todo-sync__bar" role="img" aria-label={`${b.done} of ${b.steps} steps done`}><span style={{ width: `${b.steps ? Math.round((b.done / b.steps) * 100) : 0}%` }} /></span>
                  <span>{b.done}/{b.steps}</span>
                  <Chip tone={b.status === 'failed' || b.status === 'blocked' ? 'danger' : b.status === 'waiting' ? 'warning' : b.status === 'complete' || b.status === 'built' ? 'success' : undefined}>{b.status}</Chip>
                  {b.nameReview && <Chip tone="warning">name to confirm</Chip>}
                </span>
              </li>
            ))}</ul>
          </div>
        )) : <p className="fx-muted">No build is mirrored yet. Sync now makes the lists.</p>}
      </Container>
    </div>
  );
}

/** The name prompt: the build asked for first, then every other one still to name. */
function NameDialog({ id }: { id: string }) {
  const rt = useRuntime();
  const { names } = useLocal();
  useEffect(() => { void loadNames(); }, []);
  const rows = [...names].sort((a, b) => Number(b.id === id) - Number(a.id === id));
  if (!rows.length) return <div className="axp-build-todo-sync__dialog"><Note tone="success">Every open build has a confirmed name and category.</Note><div><Button icon="x" onClick={() => rt.closeDialog()}>Close</Button></div></div>;
  const first = rows[0]!;
  return (
    <div className="axp-build-todo-sync__dialog">
      <p>This name is how you reference the build in the to-do manager, the Build manager and chat. Edit the suggestion or keep it.</p>
      <p className="axp-build-todo-sync__ellipsis"><span className="axp-build-todo-sync__name">{first.title}</span> <span className="fx-mono fx-small fx-muted">{first.id}</span></p>
      <NameForm key={first.id} row={first} onDone={() => { markPrompted(first.id); if (rows.length <= 1) rt.closeDialog(); }} />
      <div className="axp-build-todo-sync__actions">
        <Button icon="clock" onClick={() => { markPrompted(first.id); rt.closeDialog(); }}>Later</Button>
        {rows.length > 1 && <span className="fx-muted fx-small">{rows.length - 1} more build(s) still to name.</span>}
      </div>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api.call<{ settings: Settings }>('settings').then((r) => setS(r.settings)).catch((e: Error) => rt.toast(e.message, 'warning', 'Build to-do sync')); }, [rt]);
  if (!s) return <p className="fx-muted">Reading the settings…</p>;
  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    try { const r = await api.put<{ settings: Settings }>('settings', patch); setS(r.settings); await loadState(); } catch (e) { rt.toast((e as Error).message, 'danger', 'Build to-do sync'); } finally { setSaving(false); }
  };
  const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  return (
    <div className="fx-stack">
      <Switch label="Sync build to-do lists" checked={s.on} onChange={(v) => void save({ on: v })} hint="Off: builds keep running; the lists stop following them and a note on the Builds list says so." />
      <Switch label="Prompt me to name a new build" checked={s.autoPrompt} onChange={(v) => void save({ autoPrompt: v })} hint="The name dialog opens when a build appears without a confirmed name." />
      <TextField label="Keep finished builds in Done for (days)" value={String(s.completedDays)} onChange={(v) => setS({ ...s, completedDays: num(v, s.completedDays) })} type="number" hint="Completed builds stay as done lists this long, then leave the mirror." />
      <TextField label="Full reconcile every (minutes)" value={String(s.reconcileMinutes)} onChange={(v) => setS({ ...s, reconcileMinutes: num(v, s.reconcileMinutes) })} type="number" hint="Store events sync at once; this is the safety net that re-checks everything." />
      <TextField label="Check the store file every (seconds)" value={String(s.pollSeconds)} onChange={(v) => setS({ ...s, pollSeconds: num(v, s.pollSeconds) })} type="number" />
      <TextField label="Console link base" value={s.linkBase} onChange={(v) => setS({ ...s, linkBase: v })} placeholder="https://console.amberxai.com" hint="Items link back to the build here (https only)." />
      <div><Button tone="primary" icon="save" busy={saving} disabled={saving} onClick={() => void save({ completedDays: s.completedDays, reconcileMinutes: s.reconcileMinutes, pollSeconds: s.pollSeconds, linkBase: s.linkBase })}>Save timings</Button></div>
    </div>
  );
}

/* ---------------- the library ---------------- */

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-todo-sync',
  label: 'Build to-do sync',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('build-todo-sync.name', (args) => rt.openDialog(DIALOG, { id: typeof args?.[0] === 'string' ? args[0] : '' }), { label: 'Name a build for the to-do manager', keywords: ['build', 'name', 'category', 'todo'] } as never);
    rt.actions.register('build-todo-sync.sync', () => { void api.post('sync', { full: true }).then(() => { rt.toast('Build to-do lists synced.', 'success', 'Build to-do sync'); void loadState(); }, (e: Error) => rt.toast(e.message, 'danger', 'Build to-do sync')); }, { label: 'Sync the build to-do lists now', keywords: ['build', 'todo', 'sync'] } as never);
    // the server's stream: live state, fresh asks, names to confirm; the auto-prompt opens the dialog once per build
    const stop = followSse(
      (signal) => pluginFetch(FOLDER, `stream?client=${encodeURIComponent(`${Date.now().toString(36)}`)}`, { signal }),
      (f) => {
        const frame = parseFrame(sseJson(f));
        if (!frame) return;
        if (frame.type === 'hello' && frame.state) set({ state: frame.state as SyncState });
        if (frame.type === 'synced' || frame.type === 'state') void loadState();
        if (frame.type === 'ask' && (frame.ask as Ask | undefined)?.state === 'open') { rt.toast(askLine(frame.ask as Ask), 'info', 'To-do tick needs your OK'); void loadState(); }
        if (frame.type === 'names') void loadNames();
      },
    );
    window.addEventListener('beforeunload', () => stop());
    const prompt = async () => {
      await loadNames();
      const auto = local.state?.settings.autoPrompt ?? true;
      const [next] = promptCandidates(local.names, prompted(), { autoPrompt: auto });
      if (next) { markPrompted(next.id); rt.openDialog(DIALOG, { id: next.id }); }
    };
    setTimeout(() => void prompt(), 4000);
    setInterval(() => void prompt(), 60_000);
  },
  views: { [VIEW]: { title: 'Build to-do lists', icon: 'check-circle', render: () => <SyncPage /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Build to-dos', icon: 'check-circle', view: VIEW }] },
  dialogs: { [DIALOG]: { title: 'Name this build', icon: 'tag', render: (p) => <NameDialog id={typeof p.id === 'string' ? p.id : ''} /> } },
  settingsTabs: [{ id: FOLDER, label: 'Build to-do sync', icon: 'check-circle', order: 92, parent: 'plugins', description: 'Build names, categories and the to-do lists that follow the builds' }],
  settingsPanels: [
    { id: 'build-todo-sync.settings', tab: FOLDER, title: 'Build to-do sync', icon: 'check-circle', order: 10, render: () => <SettingsPanel /> },
    { id: 'build-todo-sync.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
