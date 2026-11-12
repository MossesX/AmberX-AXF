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
 *   - actions: projects.open, projects.new [name], projects.switch <id|name> (console_action, menus, search, voice)
 *   - app menu (Builds → Project…, New project…), right-click menu, Settings → Plugins → Projects
 *   - server routes = plugin commands (REST /api/plugins/project-switcher/…, MCP projects_<command>, CLI, AmberX voice)
 *
 * Switching saves the pick for every device and session, then reloads the console so every view reads the new data.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Note, Switch, TextField, useRuntime } from '@console/axf/react';
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

/* ---------------- store ---------------- */

let st: { data: State | null; error: string; newOpen: boolean; newName: string } = { data: null, error: '', newOpen: false, newName: '' };
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
        </div>
      )}
    </li>
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
      <p className="fx-small fx-muted axp-projects__desc">
        Each project has its own builds, notes, to-dos, tasks, lists and plans. The active project is saved for every device and session.
      </p>
      {s.error && <Note tone="warning">{s.error}</Note>}
      <ul className="axp-projects__list">{list.map((p) => <ProjectRow key={p.id} p={p} />)}</ul>
      {archived.length > 0 && <Switch label={`Show archived (${archived.length})`} checked={showArchived} onChange={setShowArchived} />}
      <NewProject />
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
      </div>
      <Switch label="Show the project on the banner" checked={show} onChange={(on) => flip(SHOW_KEY, on, setShow)} />
      <Switch label="Reload the console after switching" hint="Every page then reads the new project's data." checked={reload} onChange={(on) => flip(RELOAD_KEY, on, setReload)} />
      <p className="fx-small fx-muted axp-projects__desc">
        CLI: <span className="fx-mono">node framework/cli/projects.mjs [new "&lt;name&gt;" | select &lt;id&gt; | archive &lt;id&gt; --confirm &lt;id&gt; | delete &lt;id&gt; --confirm &lt;id&gt;]</span>.
        API: <span className="fx-mono">/api/projects</span>, <span className="fx-mono">/api/plugins/project-switcher/…</span>; MCP: <span className="fx-mono">project-switcher_new</span>, <span className="fx-mono">project-switcher_switch</span> and the rest.
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
    paint(rt);
    void loadProjects();
  },
  dialogs: {
    [DIALOG]: { title: 'Projects', icon: 'layers', render: () => <Switcher /> },
  },
  contextMenu: [
    { id: 'projects.default', target: 'default', order: 91, items: [{ id: 'projects', label: 'Project…', icon: 'layers', action: 'projects.open' }] },
  ],
  settingsTabs: [{ id: 'projects', label: 'Projects', icon: 'layers', order: 6, parent: 'plugins' }],
  settingsPanels: [
    { id: 'projects.main', tab: 'projects', title: 'Projects', icon: 'layers', order: 5, render: () => <SettingsPanel /> },
    { id: 'projects.lifecycle', tab: 'projects', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
