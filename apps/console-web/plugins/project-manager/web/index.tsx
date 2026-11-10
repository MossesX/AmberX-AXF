/*
 * Project Manager (project-manager@1). Every project is its own console instance (the console opened with
 * ?project=<id>) with its own builds, notes and data folders. Pieces:
 *   - the Project Manager page: create, open, rename, switch, remove projects; the settings below
 *   - Multi-project view (setting): a tab group above the application menu with each project's console running;
 *     layout "split" shows them side by side
 *   - Live preview: the app being built renders in a floating or docked window while you work
 *   - the project bar inside a project's own console instance (which project, which type)
 * Everything here is also on REST / MCP / CLI / voice through the plugin's routes (plugin-commands@1) and the actions
 * registered below; the UI polls the store so a change made through the API shows within a few seconds.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Chip, Container, IconButton, Note, SelectField, Switch, TabGroup, TextField, usePortalRoot, useIsPhone, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './project-manager.css';

const FOLDER = 'project-manager';
const VIEW = 'project-manager';
const SELF = 'console';
const POLL_MS = 5000;

type ProjectType = 'framework' | 'app';
interface Project {
  id: string; name: string; type: ProjectType; typeLabel: string; root: string; description: string; previewUrl: string;
  consoleUrl: string; dataDir: string; counts: { builds: number; notes: number; data: number }; active: boolean; open: boolean; builtIn?: boolean; rootExists: boolean;
}
interface Settings { multiView: boolean; layout: 'tabs' | 'split'; active: string; open: string[]; preview: { open: boolean; mode: 'float' | 'dock'; side: 'right' | 'bottom'; project: string } }
interface State { projects: Project[]; settings: Settings | null; error: string }

/* ---------- this page: which console instance it is ---------- */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
/** The project this console instance belongs to (?project=<id>); the Dev Console itself when absent. */
const HERE_PROJECT = params.get('project') || SELF;
/** Inside the multi-project view's frames: no tab group or preview of its own (no consoles inside consoles). */
const EMBEDDED = params.has('pm-embed');

/* ---------- one shared store, polled ---------- */
let state: State = { projects: [], settings: null, error: '' };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  try {
    const r = await pluginFetch(FOLDER, 'projects');
    const j = await r.json() as { ok?: boolean; projects?: Project[]; settings?: Settings; message?: string };
    state = j.ok ? { projects: j.projects ?? [], settings: j.settings ?? null, error: '' } : { ...state, error: j.message || `HTTP ${r.status}` };
  } catch {
    state = { ...state, error: 'The Project Manager server part is not answering.' };
  }
  emit();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  if (!timer) { void refresh(); timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const useStore = () => useSyncExternalStore(subscribe, () => state);

async function call(path: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; message?: string; [k: string]: unknown }> {
  try {
    const r = await pluginFetch(FOLDER, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    await refresh();
    return j;
  } catch {
    return { ok: false, message: 'The Project Manager server part is not answering.' };
  }
}

const absolute = (u: string) => (u.startsWith('/') ? `${window.location.origin}${u}` : u);
/** A project's console instance inside the multi-project view: its own console, without a tab group of its own. */
const frameUrl = (p: Project) => absolute(`${p.consoleUrl}${p.consoleUrl.includes('?') ? '&' : '?'}pm-embed=1`);
const previewOf = (p: Project | undefined) => (p ? p.previewUrl || (p.id === SELF ? '/' : '') : '');

export const actions = {
  toggleMulti: () => call('settings', { multiView: !state.settings?.multiView }, 'PUT'),
  togglePreview: () => call('preview', { open: !state.settings?.preview.open }),
  dockPreview: () => call('preview', { open: true, mode: 'dock' }),
  floatPreview: () => call('preview', { open: true, mode: 'float' }),
};

/* ---------- the page ---------- */
function CreateForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('app');
  const [description, setDescription] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setError('');
    const r = await call('projects', { name, type, description, previewUrl });
    setBusy(false);
    if (!r.ok) { setError(r.message || 'Could not create the project.'); return; }
    setName(''); setDescription(''); setPreviewUrl(''); onDone();
  };
  return (
    <Container title="New project" icon="plus" className="axp-project-manager__create">
      <div className="axp-project-manager__form">
        <TextField label="Name" value={name} onChange={setName} placeholder="Recipe box" />
        <SelectField label="Type" value={type} onChange={(v) => setType(v as ProjectType)}
          options={[{ value: 'app', label: 'New app: build a real app with every console tool' }, { value: 'framework', label: 'Framework / self development: the console or framework tools' }]} />
        <TextField label="Description" value={description} onChange={setDescription} />
        <TextField label="Preview URL" value={previewUrl} onChange={setPreviewUrl} mono placeholder="https://… or /path"
          hint={type === 'app' ? 'Where the app runs while you build it; the live preview window shows it.' : 'Optional: what the live preview shows (default: the console).'} />
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <div className="axp-project-manager__actions" role="toolbar" aria-label="New project">
        <Button tone="primary" icon="plus" busy={busy} disabled={!name.trim()} onClick={() => void go()}>Create project</Button>
      </div>
    </Container>
  );
}

function ProjectRow({ p, settings }: { p: Project; settings: Settings }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [url, setUrl] = useState(p.previewUrl);
  const [msg, setMsg] = useState('');
  const run = async (path: string, body: unknown) => { const r = await call(path, body); setMsg(r.ok ? '' : r.message || 'Failed.'); return r.ok; };
  const previewing = settings.preview.open && (settings.preview.project || settings.active) === p.id;
  return (
    <Container title={<span className="axp-project-manager__title">{p.name}{p.active && <Chip>Active</Chip>}</span>} icon={p.type === 'app' ? 'rocket' : 'hammer'}
      className="axp-project-manager__row" ctx="project-manager.project" ctxPayload={p.id}>
      <p className="axp-project-manager__meta"><Chip>{p.typeLabel}</Chip> <code>{p.root}</code> · builds {p.counts.builds} · notes {p.counts.notes} · data {p.counts.data}</p>
      {p.description && <p className="axp-project-manager__desc">{p.description}</p>}
      {renaming && (
        <div className="axp-project-manager__form">
          {!p.builtIn && <TextField label="Name" value={name} onChange={setName} />}
          <TextField label="Preview URL" value={url} onChange={setUrl} mono placeholder="https://… or /path" />
        </div>
      )}
      {msg && <Note tone="danger">{msg}</Note>}
      <div className="axp-project-manager__actions" role="toolbar" aria-label={`Project ${p.name}`}>
        <Button size="sm" tone={p.active ? 'quiet' : 'primary'} icon="check" disabled={p.active} onClick={() => void run('open', { id: p.id })}>Switch to</Button>
        <Button size="sm" tone="ghost" icon="external" onClick={() => window.open(absolute(p.consoleUrl), `axf-project-${p.id}`)}>Open its console</Button>
        <Button size="sm" tone="ghost" icon="eye" onClick={() => void call('preview', { open: !previewing, project: p.id })}>{previewing ? 'Close preview' : 'Live preview'}</Button>
        {renaming
          ? <Button size="sm" tone="primary" icon="save" onClick={() => void (async () => { if (await run('update', p.builtIn ? { id: p.id, previewUrl: url } : { id: p.id, name, previewUrl: url })) setRenaming(false); })()}>Save</Button>
          : <Button size="sm" tone="ghost" icon="edit" onClick={() => { setName(p.name); setUrl(p.previewUrl); setRenaming(true); }}>{p.builtIn ? 'Preview URL' : 'Rename'}</Button>}
        {!p.builtIn && <Button size="sm" tone="danger" icon="trash" confirm={`Remove ${p.name}? Its builds, notes and data folder stay unless you remove them through the API (data: true).`}
          onClick={() => void run('delete', { id: p.id })}>Remove</Button>}
      </div>
    </Container>
  );
}

function SettingsBox({ s }: { s: Settings }) {
  return (
    <Container title="Multi-project view & live preview" icon="layers" className="axp-project-manager__settings">
      <Switch label="Multi-project view" checked={s.multiView} onChange={(on) => void call('settings', { multiView: on }, 'PUT')}
        hint="The whole console shows a tab group with each project's console running." />
      <SelectField label="Layout" value={s.layout} onChange={(v) => void call('settings', { layout: v }, 'PUT')}
        options={[{ value: 'tabs', label: 'Tabs: one project at a time' }, { value: 'split', label: 'Side by side: every open project at once' }]} />
      <Switch label="Live preview window" checked={s.preview.open} onChange={(on) => void call('preview', { open: on })}
        hint="The app being built renders live while you work in the console." />
      <SelectField label="Preview window" value={s.preview.mode === 'dock' ? `dock-${s.preview.side}` : 'float'}
        onChange={(v) => void call('preview', v === 'float' ? { mode: 'float' } : { mode: 'dock', side: v.slice(5) })}
        options={[{ value: 'float', label: 'Floating' }, { value: 'dock-right', label: 'Docked right' }, { value: 'dock-bottom', label: 'Docked bottom' }]} />
    </Container>
  );
}

function ProjectManagerView() {
  const st = useStore();
  const [creating, setCreating] = useState(false);
  const s = st.settings;
  return (
    <div className="fx-stack fx-stack--lg axp-project-manager">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Console</p><h1>Project Manager</h1></div>
        <div className="axp-project-manager__actions" role="toolbar" aria-label="Project Manager">
          <Button tone="primary" icon="plus" onClick={() => setCreating((c) => !c)}>New project</Button>
          <Button tone="ghost" icon="layers" onClick={() => void actions.toggleMulti()}>{s?.multiView ? 'Multi-project view: on' : 'Multi-project view: off'}</Button>
          <Button tone="ghost" icon="eye" onClick={() => void actions.togglePreview()}>{s?.preview.open ? 'Close preview' : 'Live preview'}</Button>
          <IconButton icon="refresh" label="Refresh" onClick={() => void refresh()} />
        </div>
      </header>
      {HERE_PROJECT !== SELF && <Note tone="info">This console instance belongs to project <strong>{HERE_PROJECT}</strong>.</Note>}
      {st.error && <Note tone="danger">{st.error}</Note>}
      {creating && <CreateForm onDone={() => setCreating(false)} />}
      {s && <SettingsBox s={s} />}
      <div className="axp-project-manager__list">
        {s && st.projects.map((p) => <ProjectRow key={p.id} p={p} settings={s} />)}
      </div>
    </div>
  );
}

/* ---------- multi-project view: the tab group (app.frame.head) and the running consoles (app.frame.cover) ---------- */
let headBottom = 0;
const headSubs = new Set<() => void>();
const setHeadBottom = (v: number) => { if (v !== headBottom) { headBottom = v; headSubs.forEach((f) => f()); } };
const useHeadBottom = () => useSyncExternalStore((f) => { headSubs.add(f); return () => headSubs.delete(f); }, () => headBottom);

function MultiTabs() {
  const rt = useRuntime();
  const st = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const s = st.settings;
  const on = !!s?.multiView && !EMBEDDED;
  useEffect(() => {
    if (!on) { setHeadBottom(0); return; }
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeadBottom(Math.round(el.getBoundingClientRect().bottom));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [on]);
  if (!on || !s) return null;
  const open = st.projects.filter((p) => s.open.includes(p.id));
  return (
    <div ref={ref} className="axp-project-manager__multi-head">
      <TabGroup id="project-manager.projects" label="Projects" value={s.active} onChange={(id) => void call('open', { id })}
        onClose={(id) => void call('close', { id })}
        tabs={open.map((p) => ({ value: p.id, label: p.name, icon: p.type === 'app' ? 'rocket' : 'hammer', closable: !p.builtIn, title: `${p.typeLabel} · ${p.consoleUrl}` }))}
        extra={(
          <span className="axp-project-manager__actions" role="toolbar" aria-label="Multi-project view">
            <IconButton icon={s.layout === 'split' ? 'maximize' : 'layout'} label={s.layout === 'split' ? 'One project at a time' : 'Side by side'}
              onClick={() => void call('settings', { layout: s.layout === 'split' ? 'tabs' : 'split' }, 'PUT')} />
            <IconButton icon="eye" label="Live preview" onClick={() => void actions.togglePreview()} />
            <IconButton icon="folder" label="Project Manager" onClick={() => rt.navigate(VIEW)} />
            <IconButton icon="x" label="Turn the multi-project view off" onClick={() => void call('settings', { multiView: false }, 'PUT')} />
          </span>
        )} />
    </div>
  );
}

function MultiFrames() {
  const st = useStore();
  const top = useHeadBottom();
  const s = st.settings;
  if (!s?.multiView || EMBEDDED) return null;
  const open = st.projects.filter((p) => s.open.includes(p.id));
  const split = s.layout === 'split';
  // tabs: the Dev Console is this page itself, so nothing covers it; every other open project keeps its console running in a frame
  const shown = split ? open : open.filter((p) => p.id !== SELF);
  if (!shown.length) return null;
  const covering = split || s.active !== SELF;
  return (
    <div className={`axp-project-manager__frames ${split ? 'is-split' : 'is-tabs'}`} hidden={!covering} style={{ top }}>
      {shown.map((p) => (
        <section key={p.id} className="axp-project-manager__frame" hidden={!split && p.id !== s.active} aria-label={`${p.name} console`}>
          {split && <header className="axp-project-manager__frame-head"><strong>{p.name}</strong> <Chip>{p.typeLabel}</Chip></header>}
          <iframe className="axp-project-manager__iframe" src={frameUrl(p)} title={`${p.name}: its own console`} />
        </section>
      ))}
    </div>
  );
}

/* ---------- live preview: floating or docked ---------- */
function PreviewWindow() {
  const st = useStore();
  const root = usePortalRoot();
  const phone = useIsPhone();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [rev, setRev] = useState(0);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const s = st.settings;
  if (!s?.preview.open || EMBEDDED) return null;
  const p = st.projects.find((x) => x.id === (s.preview.project || s.active));
  const src = previewOf(p);
  const mode = phone ? 'sheet' : s.preview.mode === 'dock' ? `dock is-${s.preview.side}` : 'float';
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (s.preview.mode !== 'float' || phone || (e.target as HTMLElement).closest('button')) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => { if (drag.current) setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) }); };
  return createPortal(
    <div className={`axp-project-manager__preview is-${mode}`} role="dialog" aria-label={`Live preview: ${p?.name ?? 'no project'}`}
      style={s.preview.mode === 'float' && !phone && pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="axp-project-manager__preview-head" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }}>
        <span className="axp-project-manager__live" aria-hidden="true" />
        <strong className="axp-project-manager__preview-title">Live preview · {p?.name ?? 'no project'}</strong>
        <span className="axp-project-manager__actions" role="toolbar" aria-label="Live preview">
          <IconButton icon="refresh" label="Reload the preview" onClick={() => setRev((r) => r + 1)} />
          {s.preview.mode === 'float'
            ? <IconButton icon="restore" label="Dock it" onClick={() => void actions.dockPreview()} />
            : <IconButton icon="move" label="Float it" onClick={() => void actions.floatPreview()} />}
          {s.preview.mode === 'dock' && <IconButton icon={s.preview.side === 'right' ? 'chevron-down' : 'chevron-right'} label={s.preview.side === 'right' ? 'Dock at the bottom' : 'Dock on the right'}
            onClick={() => void call('preview', { side: s.preview.side === 'right' ? 'bottom' : 'right' })} />}
          {src && <IconButton icon="external" label="Open in a new tab" onClick={() => window.open(absolute(src), '_blank', 'noopener')} />}
          <IconButton icon="x" label="Close" onClick={() => void call('preview', { open: false })} />
        </span>
      </div>
      {src
        ? <iframe key={`${src}#${rev}`} className="axp-project-manager__iframe" src={absolute(src)} title={`Live preview of ${p?.name ?? 'the app'}`} />
        : <Note tone="info" className="axp-project-manager__preview-note">{p ? `${p.name} has no preview URL yet: set where the app runs (Project Manager → ${p.builtIn ? 'Preview URL' : 'Rename'}).` : 'Pick a project to preview.'}</Note>}
    </div>,
    root,
  );
}

/* ---------- inside a project's own console instance: which project this is ---------- */
function ProjectBar() {
  const st = useStore();
  if (HERE_PROJECT === SELF) return null;
  const p = st.projects.find((x) => x.id === HERE_PROJECT);
  return (
    <div className="axp-project-manager__bar" role="status">
      <strong>{p?.name ?? HERE_PROJECT}</strong> <Chip>{p?.typeLabel ?? 'Project'}</Chip>
      {p && <span className="axp-project-manager__meta"><code>{p.root}</code> · data {p.dataDir}</span>}
      {!p && st.settings && <span className="axp-project-manager__meta">No project "{HERE_PROJECT}" in the Project Manager.</span>}
    </div>
  );
}

function Cover() { return <><MultiFrames /><PreviewWindow /></>; }
function Head() { return <><MultiTabs /><ProjectBar /></>; }

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.project-manager',
  label: 'Project Manager',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('project-manager.multi', () => void actions.toggleMulti(), { label: 'Turn the multi-project view on or off' });
    rt.actions.register('project-manager.preview', () => void actions.togglePreview(), { label: 'Open or close the live preview window' });
    rt.actions.register('project-manager.preview-dock', () => void actions.dockPreview(), { label: 'Dock the live preview window' });
    rt.actions.register('project-manager.preview-float', () => void actions.floatPreview(), { label: 'Float the live preview window' });
  },
  views: { [VIEW]: { title: 'Project Manager', icon: 'folder', render: () => <ProjectManagerView /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Project Manager', icon: 'folder', view: VIEW }] },
  slots: {
    'app.frame.head': [{ id: 'project-manager.head', order: 10, render: () => <Head /> }],
    'app.frame.cover': [{ id: 'project-manager.cover', order: 60, render: () => <Cover /> }],
  },
  settingsTabs: [{ id: VIEW, label: 'Project Manager', icon: 'folder', order: 60, parent: 'plugins' }],
  settingsPanels: [
    { id: 'project-manager.settings', tab: VIEW, title: 'Multi-project view & live preview', icon: 'layers', order: 10, render: () => <SettingsPanel /> },
    { id: 'project-manager.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
};

function SettingsPanel() {
  const st = useStore();
  return st.settings ? <SettingsBox s={st.settings} /> : <Note tone="info">{st.error || 'Loading…'}</Note>;
}
