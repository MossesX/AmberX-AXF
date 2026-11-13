/**
 * Projects console plugin (ai.amberx.axf.console.projects).
 *
 * Separate workspaces (projects@1): each project has its own builds, notes, to-dos, tasks, lists and plans; a new one
 * starts empty; AmberX AXF holds everything from before projects. Projects are framework data
 * (framework/cli/projects.mjs, GET/POST /api/projects); this plugin is the face and the named commands:
 *
 *   - banner chip (framework `status` widget, own asset status/project) with the active project; tap = switcher
 *   - dialog `projects` (action `projects.open`): every project with its counts, Switch to, New project, rename,
 *     archive / unarchive, delete (archive and delete: type the project id to confirm; the data stays on disk)
 *   - Duplicate (a copy of a project: settings, rules, setup, list structure) and Save as boilerplate on every project;
 *     a Boilerplates tab: start a project from one, rename, update from a project, delete (type its id)
 *   - actions: projects.open, projects.new [name], projects.switch <id|name>, projects.duplicate [name],
 *     projects.save-boilerplate, projects.boilerplates (console_action, menus, search, voice)
 *   - app menu (Builds → Project…, New project…, Duplicate project…, Boilerplates…), right-click menu,
 *     Settings → Plugins → Projects
 *   - server routes = plugin commands (REST /api/plugins/project-switcher/…, MCP projects_<command>, CLI, AmberX voice)
 *
 * Switching saves the pick for every device and session, then reloads the console so every view reads the new data.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Note, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { getToken, post } from '@console/api';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { LoadingSkeleton } from '@console/emptyState';
import './projects.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.project-switcher';
const FOLDER = 'project-switcher';
const DIALOG = 'projects';
const ASSET_ID = 'project';
const COUNTER = 'project.known';
const SHOW_KEY = 'projects.show';
const RELOAD_KEY = 'projects.reload';
const API = `plugins/${FOLDER}`;
export const PROJECT_CHANGED = 'axf:project-changed';

interface Counts { builds: number; open: number }
interface Project { id: string; name: string; description?: string; profile: string; status: 'active' | 'archived'; base: boolean; active: boolean; createdAt?: string; archivedAt?: string; counts: Counts | null }
interface State { ok?: boolean; active: string; projects: Project[] }
type Items = 'structure' | 'all' | 'none';
interface Carry { items: Items; builds: boolean }
interface Boilerplate { id: string; name: string; description: string; from: { id: string; name: string }; owner: string; createdAt: string; updatedAt: string; carry: Carry; holds: string }
type Tab = 'projects' | 'boilerplates';
/** An open copy form on a project row: a duplicate, or a boilerplate save. */
interface CopyOpen { project: string; kind: 'duplicate' | 'boilerplate' }

/* ---------------- store ---------------- */

let st: { data: State | null; error: string; newOpen: boolean; newName: string; tab: Tab; copy: CopyOpen | null; boilerplates: Boilerplate[] | null; bpError: string } = { data: null, error: '', newOpen: false, newName: '', tab: 'projects', copy: null, boilerplates: null, bpError: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useProjects = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
let runtime: AxfRuntime | null = null;

export async function loadProjects(): Promise<void> {
  try {
    const t = getToken();
    const r = await fetch(`/api/${API}/`, { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token to see projects.' : `The console answered ${r.status}.`);
    set({ data: (await r.json()) as State, error: '' });
  } catch (e) {
    set({ error: (e as Error).message });
  }
  if (runtime) paint(runtime);
}

async function getJson<T>(path: string): Promise<T> {
  const t = getToken();
  const r = await fetch(`/api/${API}/${path}`, { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token first.' : `The console answered ${r.status}.`);
  return (await r.json()) as T;
}

export async function loadBoilerplates(): Promise<void> {
  try { set({ boilerplates: (await getJson<{ boilerplates: Boilerplate[] }>('boilerplates')).boilerplates ?? [], bpError: '' }); } catch (e) { set({ bpError: (e as Error).message }); }
}

const current = (): Project | null => st.data?.projects.find((p) => p.active) ?? null;
const find = (key: string): Project | null => {
  const k = key.trim().toLowerCase();
  return st.data?.projects.find((p) => p.id === k || p.name.toLowerCase() === k) ?? null;
};

/** Repaint the banner chip (a framework status widget) and attach it, or take it off when hidden. */
function paint(rt: AxfRuntime) {
  const p = current();
  const text = p ? `Project: ${p.name}` : 'Project: …';
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Project', version: '0.1.0', author: 'Projects plugin',
    description: 'The project the console works on (its builds, notes, to-dos and plans). Tap to switch or start a new one.', tags: ['projects', 'status'],
    data: { counter: COUNTER, onLabel: text, offLabel: text, onTone: p && !p.base ? 'accent' : 'muted', offTone: 'muted', dot: true, link: 'projects.open' },
  }, 'app', ID);
  rt.setBadge(COUNTER, p ? 1 : 0);
  if (rt.settings.get(SHOW_KEY) !== false) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 19, origin: ID, widget: { label: 'Project', size: 'compact', priority: 7, aliases: ['project', 'workspace'] } });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

async function change(rt: AxfRuntime, cmd: string, body: Record<string, unknown>, done: string): Promise<boolean> {
  const r = await post(`${API}/${cmd}`, body);
  if (!r.ok) { rt.toast(String(r.error ?? 'Could not change projects.'), 'danger', 'Projects'); return false; }
  await loadProjects();
  rt.toast(done, 'success', 'Projects');
  return true;
}

/** Tell every view the project changed and (by default) reload so every page reads its data. */
function switched(rt: AxfRuntime, id: string) {
  for (const ev of [PROJECT_CHANGED, 'axf:profile-changed', 'axf:pending-changed', 'axf:plan-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id } }));
  if (rt.settings.get(RELOAD_KEY) !== false) setTimeout(() => globalThis.location?.reload(), 700);
}

async function switchTo(rt: AxfRuntime, p: Project) {
  if (await change(rt, 'switch', { project: p.id }, `Now working on ${p.name}.`)) switched(rt, p.id);
}

/** Duplicate a project: a new project starting from it. */
async function duplicateProject(rt: AxfRuntime, p: Project, name: string, carry: Carry, select = true): Promise<boolean> {
  const ok = await change(rt, 'duplicate', { project: p.id, name, ...carry, select }, `${name || `${p.name} copy`} made from ${p.name}${select ? ' and now active' : ''}.`);
  if (ok && select) switched(rt, current()?.id ?? '');
  return ok;
}

/** A boilerplate change (save, update, rename, delete, use); refreshes the list. */
async function boilerplateChange(rt: AxfRuntime, cmd: string, body: Record<string, unknown>, done: string): Promise<boolean> {
  const r = await post(`${API}/boilerplates/${cmd}`, body);
  if (!r.ok) { rt.toast(String(r.error ?? 'Could not change the boilerplates.'), 'danger', 'Boilerplates'); return false; }
  await Promise.all([loadBoilerplates(), cmd === 'use' ? loadProjects() : Promise.resolve()]);
  rt.toast(done, 'success', 'Boilerplates');
  return true;
}

async function createProject(rt: AxfRuntime, name: string, description = '', select = true): Promise<boolean> {
  const ok = await change(rt, 'new', { name, description, select }, select ? `${name} created, empty, and now active.` : `${name} created, empty.`);
  if (ok && select) switched(rt, current()?.id ?? '');
  return ok;
}

/* ---------------- switcher ---------------- */

function ProjectRow({ p }: { p: Project }) {
  const rt = useRuntime();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description ?? '');
  const [confirm, setConfirm] = useState('');
  const s = useProjects();
  const copying = s.copy?.project === p.id ? s.copy.kind : null;
  const archived = p.status === 'archived';
  return (
    <li className={`axp-projects__row ${p.active ? 'is-active' : ''} ${archived ? 'is-archived' : ''}`} data-project={p.id}>
      <div className="axp-projects__head">
        <span className="axp-projects__name"><Icon name="layers" size={14} /> {p.name}</span>
        {p.base && <Chip>main</Chip>}
        {p.active && <Chip tone="accent">active</Chip>}
        {archived && <Chip tone="warning">archived</Chip>}
      </div>
      {p.description && <p className="fx-small fx-muted axp-projects__desc">{p.description}</p>}
      <p className="fx-small axp-projects__counts">{p.counts ? `${p.counts.open} open · ${p.counts.builds} builds` : 'builds: –'} · id <span className="fx-mono">{p.id}</span></p>
      {edit ? (
        <div className="fx-stack">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="check" disabled={!name.trim()} onClick={() => void change(rt, 'rename', { project: p.id, name, description: desc }, 'Saved.').then((ok) => ok && setEdit(false))}>Save</Button>
            <Button tone="ghost" onClick={() => setEdit(false)}>Cancel</Button>
          </div>
          {!p.base && (
            <div className="fx-stack">
              <TextField label={`To archive or delete, type ${p.id}`} value={confirm} onChange={setConfirm} mono hint="Archive takes it off the switcher; delete takes it off the list. Either way its builds, notes, to-dos and plans stay on disk." />
              <div className="fx-row fx-row--wrap">
                {!archived && <Button tone="neutral" icon="box" disabled={confirm !== p.id} onClick={() => void change(rt, 'archive', { project: p.id, confirm }, `${p.name} archived.`).then((ok) => ok && p.active && switched(rt, ''))}>Archive</Button>}
                <Button tone="danger" icon="trash" disabled={confirm !== p.id} onClick={() => void change(rt, 'delete', { project: p.id, confirm }, `${p.name} deleted from the list; its data stays.`).then((ok) => ok && p.active && switched(rt, ''))}>Delete</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="fx-row fx-row--wrap">
          {archived
            ? <Button tone="neutral" icon="refresh" onClick={() => void change(rt, 'unarchive', { project: p.id }, `${p.name} is back on the list.`)}>Unarchive</Button>
            : <Button tone={p.active ? 'neutral' : 'primary'} icon="check" disabled={p.active} onClick={() => void switchTo(rt, p)}>{p.active ? 'Active' : 'Switch to'}</Button>}
          <Button tone="ghost" icon="edit" onClick={() => setEdit(true)}>Edit</Button>
          {!archived && <Button tone="ghost" icon="copy" onClick={() => set({ copy: { project: p.id, kind: 'duplicate' } })}>Duplicate</Button>}
          <Button tone="ghost" icon="package" onClick={() => set({ copy: { project: p.id, kind: 'boilerplate' } })}>Save as boilerplate</Button>
        </div>
      )}
      {copying && <CopyForm p={p} kind={copying} />}
    </li>
  );
}

const ITEM_CHOICES: { value: Items; label: string }[] = [
  { value: 'structure', label: 'Structure only: lists, folders and categories, no items' },
  { value: 'all', label: 'Everything: with their items' },
  { value: 'none', label: 'Leave them out' },
];

/** What a copy carries over: lists, to-dos, notes and plans (structure by default) and the builds history (off). */
function CarryFields({ carry, onChange }: { carry: Carry; onChange: (c: Carry) => void }) {
  return (
    <>
      <SelectField label="Lists, to-dos, notes and plans" value={carry.items} options={ITEM_CHOICES} onChange={(v) => onChange({ ...carry, items: v as Items })} />
      <Switch label="Bring the builds history" hint="A read-only list of its past builds. The builds themselves stay with the original." checked={carry.builds} onChange={(builds) => onChange({ ...carry, builds })} />
    </>
  );
}

/** Duplicate a project, or save it as a boilerplate: settings, rules, skin, Claude accounts and plugin setup always come along. */
function CopyForm({ p, kind }: { p: Project; kind: CopyOpen['kind'] }) {
  const rt = useRuntime();
  const dup = kind === 'duplicate';
  const [name, setName] = useState(dup ? `${p.name} copy` : p.name);
  const [desc, setDesc] = useState(p.description ?? '');
  const [carry, setCarry] = useState<Carry>({ items: 'structure', builds: false });
  const [select, setSelect] = useState(true);
  const [busy, setBusy] = useState(false);
  const close = () => set({ copy: null });
  const go = async () => {
    setBusy(true);
    const ok = dup
      ? await duplicateProject(rt, p, name.trim(), carry, select)
      : await boilerplateChange(rt, 'save', { project: p.id, name: name.trim(), description: desc, ...carry }, `${name.trim()} saved as a boilerplate.`);
    setBusy(false);
    if (ok) { close(); if (!dup) set({ tab: 'boilerplates' }); }
  };
  return (
    <div className="fx-stack axp-projects__new" role="group" aria-label={dup ? `Duplicate ${p.name}` : `Save ${p.name} as a boilerplate`}>
      <p className="fx-small axp-projects__desc"><strong>{dup ? `Duplicate ${p.name}` : `Save ${p.name} as a boilerplate`}</strong></p>
      <p className="fx-small fx-muted axp-projects__desc">Its settings, build rules, skin, Claude accounts, plugin setup, manifest, rules and instructions come along{dup ? ' under the new name' : ''}.</p>
      <TextField label={dup ? 'New project name' : 'Boilerplate name'} value={name} onChange={setName} autoFocus />
      {!dup && <TextField label="Description" value={desc} onChange={setDesc} rows={2} />}
      <CarryFields carry={carry} onChange={setCarry} />
      {dup && <Switch label="Switch to it right away" checked={select} onChange={setSelect} />}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon={dup ? 'copy' : 'package'} disabled={busy || !name.trim()} onClick={() => void go()}>{busy ? 'Working…' : dup ? 'Duplicate' : 'Save boilerplate'}</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

function BoilerplateRow({ b }: { b: Boilerplate }) {
  const rt = useRuntime();
  const s = useProjects();
  const [mode, setMode] = useState<'' | 'use' | 'edit'>('');
  const [name, setName] = useState(b.name);
  const [desc, setDesc] = useState(b.description);
  const [newName, setNewName] = useState(b.name);
  const [from, setFrom] = useState(b.from.id || current()?.id || '');
  const [confirm, setConfirm] = useState('');
  const projects = (s.data?.projects ?? []).filter((p) => p.status !== 'archived');
  const fromName = projects.find((p) => p.id === from)?.name ?? from;
  return (
    <li className="axp-projects__row" data-boilerplate={b.id}>
      <div className="axp-projects__head">
        <span className="axp-projects__name"><Icon name="package" size={14} /> {b.name}</span>
        {b.from.name && <Chip>from {b.from.name}</Chip>}
      </div>
      {b.description && <p className="fx-small fx-muted axp-projects__desc">{b.description}</p>}
      <p className="fx-small axp-projects__counts">{b.holds} · id <span className="fx-mono">{b.id}</span>{b.owner ? ` · saved by ${b.owner}` : ''}</p>
      {mode === 'use' && (
        <div className="fx-stack">
          <TextField label="New project name" value={newName} onChange={setNewName} autoFocus />
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="rocket" disabled={!newName.trim()} onClick={() => void boilerplateChange(rt, 'use', { boilerplate: b.id, name: newName.trim() }, `${newName.trim()} made from ${b.name} and now active.`).then((ok) => ok && switched(rt, current()?.id ?? ''))}>Create project</Button>
            <Button tone="ghost" onClick={() => setMode('')}>Cancel</Button>
          </div>
          <p className="fx-small fx-muted axp-projects__desc">For a new repo too, use the New project wizard and pick this boilerplate under Start from.</p>
        </div>
      )}
      {mode === 'edit' && (
        <div className="fx-stack">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="check" disabled={!name.trim()} onClick={() => void boilerplateChange(rt, 'rename', { boilerplate: b.id, name, description: desc }, 'Saved.').then((ok) => ok && setMode(''))}>Save</Button>
            <Button tone="ghost" onClick={() => setMode('')}>Cancel</Button>
          </div>
          <SelectField label="Update it from a project" value={from} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setFrom} hint="Takes the project's settings, rules, setup and lists again, as it carried them before." />
          <div className="fx-row fx-row--wrap">
            <Button tone="neutral" icon="refresh" disabled={!from} onClick={() => void boilerplateChange(rt, 'update', { boilerplate: b.id, project: from }, `${b.name} updated from ${fromName}.`)}>Update from {fromName || 'project'}</Button>
          </div>
          <TextField label={`To delete it, type ${b.id}`} value={confirm} onChange={setConfirm} mono hint="Projects made from it keep everything. Brett can veto a delete." />
          <div className="fx-row fx-row--wrap">
            <Button tone="danger" icon="trash" disabled={confirm !== b.id} onClick={() => void boilerplateChange(rt, 'delete', { boilerplate: b.id, confirm }, `${b.name} deleted.`)}>Delete</Button>
          </div>
        </div>
      )}
      {!mode && (
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="rocket" onClick={() => setMode('use')}>New project from it</Button>
          <Button tone="ghost" icon="edit" onClick={() => setMode('edit')}>Edit</Button>
        </div>
      )}
    </li>
  );
}

function Boilerplates() {
  const s = useProjects();
  useEffect(() => { void loadBoilerplates(); }, []);
  if (!s.boilerplates) return s.bpError ? <Note tone="warning">{s.bpError}</Note> : <LoadingSkeleton />;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted axp-projects__desc">Projects kept as reusable templates, shared across projects. Save one with Save as boilerplate on any project.</p>
      {s.bpError && <Note tone="warning">{s.bpError}</Note>}
      {s.boilerplates.length
        ? <ul className="axp-projects__list">{s.boilerplates.map((b) => <BoilerplateRow key={b.id} b={b} />)}</ul>
        : <Note tone="info">No boilerplates yet.</Note>}
    </div>
  );
}

function NewProject() {
  const rt = useRuntime();
  const s = useProjects();
  const [desc, setDesc] = useState('');
  const [select, setSelect] = useState(true);
  if (!s.newOpen) return <Button tone="neutral" icon="plus" onClick={() => set({ newOpen: true })}>New project</Button>;
  const name = s.newName;
  const create = async () => {
    if (await createProject(rt, name.trim(), desc, select)) { set({ newOpen: false, newName: '' }); setDesc(''); }
  };
  return (
    <div className="fx-stack axp-projects__new">
      <TextField label="Name" value={name} onChange={(v) => set({ newName: v })} placeholder="e.g. Garden planner" autoFocus />
      <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
      <p className="fx-small fx-muted axp-projects__desc">It starts empty: no builds, notes, to-dos or plans.</p>
      <Switch label="Switch to it right away" checked={select} onChange={setSelect} />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="plus" disabled={!name.trim()} onClick={() => void create()}>Create</Button>
        <Button tone="ghost" onClick={() => set({ newOpen: false })}>Cancel</Button>
      </div>
    </div>
  );
}

function Switcher() {
  const s = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { void loadProjects(); }, []);
  if (!s.data) return <div className="axp-projects">{s.error ? <Note tone="warning">{s.error}</Note> : <LoadingSkeleton />}</div>;
  const archived = s.data.projects.filter((p) => p.status === 'archived');
  const list = s.data.projects.filter((p) => showArchived || p.status !== 'archived');
  return (
    <div className="fx-stack axp-projects">
      <TabGroup id="projects.tabs" label="Projects" value={s.tab} onChange={(tab) => set({ tab })} tabs={[{ value: 'projects', label: 'Projects', icon: 'layers' }, { value: 'boilerplates', label: 'Boilerplates', icon: 'package' }]} />
      {s.tab === 'boilerplates' ? <Boilerplates /> : (
        <>
          <p className="fx-small fx-muted axp-projects__desc">
            Each project has its own builds, notes, to-dos, tasks, lists and plans. The active project is saved for every device and session.
          </p>
          {s.error && <Note tone="warning">{s.error}</Note>}
          <ul className="axp-projects__list">{list.map((p) => <ProjectRow key={p.id} p={p} />)}</ul>
          {archived.length > 0 && <Switch label={`Show archived (${archived.length})`} checked={showArchived} onChange={setShowArchived} />}
          <NewProject />
        </>
      )}
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [show, setShow] = useState(rt.settings.get(SHOW_KEY) !== false);
  const [reload, setReload] = useState(rt.settings.get(RELOAD_KEY) !== false);
  useProjects();
  const p = current();
  const flip = useCallback((key: string, on: boolean, setter: (v: boolean) => void) => { rt.settings.set(key, on); setter(on); paint(rt); }, [rt]);
  return (
    <div className="fx-stack">
      <p className="axp-projects__desc">Active project: <strong>{p?.name ?? '…'}</strong></p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="layers" onClick={() => rt.openDialog(DIALOG)}>Switch or manage projects</Button>
        <Button tone="neutral" icon="plus" onClick={() => rt.dispatch('projects.new')}>New project</Button>
        <Button tone="neutral" icon="copy" onClick={() => rt.dispatch('projects.duplicate')}>Duplicate this project</Button>
        <Button tone="neutral" icon="package" onClick={() => rt.dispatch('projects.boilerplates')}>Boilerplates</Button>
      </div>
      <Switch label="Show the project on the banner" checked={show} onChange={(on) => flip(SHOW_KEY, on, setShow)} />
      <Switch label="Reload the console after switching" hint="Every page then reads the new project's data." checked={reload} onChange={(on) => flip(RELOAD_KEY, on, setReload)} />
      <p className="fx-small fx-muted axp-projects__desc">
        CLI: <span className="fx-mono">node framework/cli/projects.mjs [new "&lt;name&gt;" | select &lt;id&gt; | duplicate [&lt;id&gt;] | archive &lt;id&gt; --confirm &lt;id&gt; | delete &lt;id&gt; --confirm &lt;id&gt;]</span>,
        boilerplates: <span className="fx-mono">node framework/cli/project-templates.mjs boilerplate save|update|rename|delete|use</span>.
        API: <span className="fx-mono">/api/projects</span>, <span className="fx-mono">/api/plugins/project-switcher/…</span>; MCP: <span className="fx-mono">project_duplicate</span>, <span className="fx-mono">project_boilerplate_list</span>, <span className="fx-mono">project-switcher_new</span>, <span className="fx-mono">project-switcher_switch</span> and the rest.
        A session can work on another project without changing the pick: <span className="fx-mono">AXF_BUILD_PROFILE=&lt;its profile&gt;</span>.
      </p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Projects',
  version: '0.1.0',
  appMenu,
  register(rt) {
    runtime = rt;
    rt.actions.register('projects.open', () => rt.openDialog(DIALOG), { label: 'Projects' });
    // projects.new [name]: with a name it creates the project (empty, made active); without one it opens the form.
    rt.actions.register('projects.new', (args?: string[]) => {
      const name = (args ?? []).join(' ').trim();
      if (name) { void createProject(rt, name); return; }
      set({ newOpen: true, newName: '' });
      rt.openDialog(DIALOG);
    }, { label: 'New project' });
    // projects.switch <id|name>: switch straight away; without an argument it opens the switcher.
    rt.actions.register('projects.switch', (args?: string[]) => {
      const key = (args ?? []).join(' ').trim();
      const p = key ? find(key) : null;
      if (p) { void switchTo(rt, p); return; }
      if (key) rt.toast(`No project "${key}".`, 'warning', 'Projects');
      rt.openDialog(DIALOG);
    }, { label: 'Switch project' });
    // projects.duplicate [name]: the duplicate form for the active project (with a name: duplicate it straight away,
    // structure only, and switch to the copy)
    rt.actions.register('projects.duplicate', (args?: string[]) => {
      const name = (args ?? []).join(' ').trim();
      const p = current();
      if (name && p) { void duplicateProject(rt, p, name, { items: 'structure', builds: false }); return; }
      set({ tab: 'projects', copy: p ? { project: p.id, kind: 'duplicate' } : null });
      rt.openDialog(DIALOG);
    }, { label: 'Duplicate project' });
    rt.actions.register('projects.save-boilerplate', () => {
      const p = current();
      set({ tab: 'projects', copy: p ? { project: p.id, kind: 'boilerplate' } : null });
      rt.openDialog(DIALOG);
    }, { label: 'Save project as boilerplate' });
    rt.actions.register('projects.boilerplates', () => { set({ tab: 'boilerplates' }); rt.openDialog(DIALOG); }, { label: 'Project boilerplates' });
    paint(rt);
    void loadProjects();
  },
  dialogs: {
    [DIALOG]: { title: 'Projects', icon: 'layers', render: () => <Switcher /> },
  },
  contextMenu: [
    { id: 'projects.default', target: 'default', order: 91, items: [{ id: 'projects', label: 'Project…', icon: 'layers', action: 'projects.open' }, { id: 'projects.duplicate', label: 'Duplicate project…', icon: 'copy', action: 'projects.duplicate' }] },
  ],
  settingsTabs: [{ id: 'projects', label: 'Projects', icon: 'layers', order: 6, parent: 'plugins' }],
  settingsPanels: [
    { id: 'projects.main', tab: 'projects', title: 'Projects', icon: 'layers', order: 5, render: () => <SettingsPanel /> },
    { id: 'projects.lifecycle', tab: 'projects', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
