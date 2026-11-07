/**
 * Notes: Brett's notes in one place, from two sources (data.ts): the AmberX app's notes (amberx.items, through
 * control@1) and the hub's shared Claude files (/projects/_shared/_claude/notes, Markdown in folders).
 *
 * Two views (build notes-views, Brett Nov 4 2026; views.tsx): Classic (the notes on the left, the open note on the
 * right) and Grid (sortable rows that expand to the note). Every note body renders as collapsible sections
 * (framework FoldSections). The view and source are remembered per device and switch from the page's toolbar asset
 * (`notes-views`), View → Notes view, the page's right-click menu, or the actions `notes-browser.view:<classic|grid|
 * toggle>` and `notes-browser.source:<amberx|claude>` (voice, console MCP `console_action`, control@1
 * `console.actions`). Claude files keep their extras: new note / folder, rename, conflict-safe saves.
 * Small on purpose: no window or dock engine, framework controls only, theme tokens only.
 */
import { useCallback, useEffect, useState } from 'react';
import { AssetToolbar, Button, IconButton, Note, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, KEYS, SOURCES, VIEWS, api, errText, loadRows, moveRow, pinRow, removeRow, saveText, sourceCounter, useSetting, viewCounter, type Loaded, type Row, type SourceId, type ViewId } from './data';
import { ClassicView, GridView, type Acts, type Fold } from './views';
import toolbarAsset from './notes-views.toolbar.json';
import './notes-browser.css';

type Sort = 'date' | 'name';
type Ask = null | { kind: 'note' | 'folder' | 'rename'; value: string; folder: string; row?: Row };

const slugName = (s: string) => {
  const base = s.trim().replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 110);
  return !base ? '' : /\.(md|txt)$/i.test(base) ? base : `${base}.md`;
};

function NotesView() {
  const rt = useRuntime();
  const view = useSetting<ViewId>(KEYS.view, 'classic');
  const source = useSetting<SourceId>(KEYS.source, 'amberx');
  const caps = useSetting<boolean>(KEYS.caps, true) !== false;
  const collapsed = useSetting<boolean>(KEYS.collapsed, false) === true;
  const [data, setData] = useState<Loaded | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('date');
  const [openKey, setOpenKey] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    try { setData(await loadRows(source, q)); setError(''); } catch (e) { setError(errText(e)); }
  }, [source, q]);
  useEffect(() => { setData(null); setOpenKey(''); }, [source]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    try { await fn(); setError(''); setConflict(false); return true; } catch (e) { const m = errText(e); setError(m); if (/changed since you opened it/.test(m)) setConflict(true); return false; } finally { setBusy(false); }
  };

  const acts: Acts = {
    busy, places: data?.places ?? [],
    save: (r, text) => run(async () => { await saveText(r, text); await load(); }),
    move: (r, to) => { if (to !== r.listId) void run(async () => { const k = await moveRow(r, to); await load(); if (openKey === r.key) setOpenKey(k); }); },
    pin: (r) => void run(async () => { await pinRow(r, !r.pinned); await load(); }),
    remove: (r) => {
      const where = r.source === 'claude' ? ` (${r.ref})? The hub keeps its history, but it leaves the notes.` : ' from AmberX? Every device loses it.';
      if (!window.confirm(`Delete “${r.title}”${where}`)) return;
      void run(async () => { await removeRow(r); if (openKey === r.key) setOpenKey(''); await load(); });
    },
    ...(source === 'claude' ? { rename: (r: Row) => setAsk({ kind: 'rename', value: r.ref.split('/').pop() ?? '', folder: r.listId, row: r }) } : {}),
    ...(view === 'grid' ? { open: (r: Row) => { setOpenKey(r.key); rt.settings.set(KEYS.view, 'classic'); } } : {}),
  };
  const fold: Fold = { caps, collapsed, q };

  const submitAsk = () => run(async () => {
    if (!ask) return;
    if (ask.kind === 'folder') { await api.post('folder', { name: ask.value.trim().replace(/[^A-Za-z0-9 _-]+/g, '-') }); setAsk(null); await load(); return; }
    const name = slugName(ask.value);
    if (!name) throw new Error('Give it a name.');
    const path = ask.folder ? `${ask.folder}/${name}` : name;
    if (ask.kind === 'note') {
      const title = ask.value.trim().replace(/\.(md|txt)$/i, '');
      await api.put('note', { path, content: `# ${title}\n\n`, if_version: '' });
      setAsk(null); await load(); setOpenKey(`claude:${path}`); return;
    }
    if (ask.row) { const d = await api.post<{ path: string }>('move', { from: ask.row.ref, to: path, if_version: ask.row.version }); setAsk(null); await load(); setOpenKey(`claude:${d.path}`); }
  });

  const claude = source === 'claude';
  const available = !!data?.available;
  const search = <TextField label="Search notes" type="search" value={q} onChange={setQ} placeholder="Words in a title or the text" />;
  return (
    <div className="fx-stack fx-stack--lg axp-notes-browser" data-fx-ctx-target="notes-browser">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{claude ? 'Claude files · notes' : 'AmberX · notes'}</p><h1>Notes</h1><p className="fx-muted">Every note saved for Brett in one place: read, search, edit and move them, in Classic or Grid view.</p></div>
        <div className="axp-notes-browser__acts">
          {claude && <Button icon="plus" disabled={busy || !available} onClick={() => setAsk({ kind: 'note', value: '', folder: 'misc' })}>New note</Button>}
          {claude && <Button tone="ghost" icon="folder" disabled={busy || !available} onClick={() => setAsk({ kind: 'folder', value: '', folder: '' })}>New folder</Button>}
          <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
        </div>
      </header>

      <AssetToolbar id={toolbarAsset.id} label="Notes view" />

      {data && !data.available && <Note tone="warning">{data.why}</Note>}
      {error && <Note tone={conflict ? 'warning' : 'danger'}>{error}{conflict && <> <Button size="sm" icon="refresh" onClick={() => void load()}>Reload the notes</Button></>}</Note>}

      {ask && (
        <div className="axp-notes-browser__ask">
          <TextField label={ask.kind === 'folder' ? 'Folder name' : ask.kind === 'rename' ? 'New name' : 'Note title'} value={ask.value} autoFocus onChange={(v) => setAsk({ ...ask, value: v })} placeholder={ask.kind === 'folder' ? 'e.g. recipes' : 'e.g. VPS install notes'} />
          {ask.kind !== 'folder' && <SelectField label="Folder" value={ask.folder} options={data?.places ?? []} onChange={(v) => setAsk({ ...ask, folder: v })} />}
          <div className="axp-notes-browser__acts">
            <Button tone="primary" icon="check" disabled={busy || !ask.value.trim()} onClick={() => void submitAsk()}>{ask.kind === 'rename' ? 'Rename' : 'Create'}</Button>
            <Button tone="ghost" icon="x" onClick={() => setAsk(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {view === 'grid'
        ? <><div className="axp-notes-browser__search">{search}</div><GridView rows={data?.rows ?? []} acts={acts} fold={fold} loading={!data} /></>
        : <ClassicView rows={data?.rows ?? []} openKey={openKey} setOpenKey={setOpenKey} acts={acts} fold={fold} sort={sort} loading={!data} available={available}
            side={<>{search}<Segmented label="Sort notes" size="sm" value={sort} onChange={setSort} options={[{ value: 'date', label: 'Newest', icon: 'clock' }, { value: 'name', label: 'Name', icon: 'list' }]} /></>} />}
    </div>
  );
}

function SettingsPanel() {
  return <p className="fx-muted axp-notes-browser__lead">Two sources: <strong>AmberX</strong> is the AmberX app's notes (the hub's <code>amberx-notes</code> tables, through Token control's <code>control@1</code>); <strong>Claude files</strong> are the hub's shared Claude notes, <code>/projects/_shared/_claude/notes</code> (axHub memory: project <code>shared</code>, area <code>claude</code>). Deleting or replacing a Claude note keeps its old text in the hub's history.</p>;
}

const pick = <T extends string>(arg: string | undefined, all: readonly T[], cur: T): T => {
  if (arg === 'toggle' || !arg) return all[(all.indexOf(cur) + 1) % all.length] ?? cur;
  return (all as readonly string[]).includes(arg) ? arg as T : cur;
};

/** Keep the toolbar and menu check marks (counter:… bindings) on the active view and source. */
function markActive(rt: AxfRuntime) {
  const v = String(rt.settings.get(KEYS.view) || 'classic');
  const s = String(rt.settings.get(KEYS.source) || 'amberx');
  for (const x of VIEWS) rt.setBadge(viewCounter(x.id), x.id === v ? 1 : 0);
  for (const x of SOURCES) rt.setBadge(sourceCounter(x.id), x.id === s ? 1 : 0);
}

const viewChoice = (id: string) => ({ id: `notes-browser.view.${id}`, label: `${VIEWS.find((v) => v.id === id)!.label} view`, icon: VIEWS.find((v) => v.id === id)!.icon, action: `notes-browser.view:${id}`, checked: `counter:${viewCounter(id)}` });

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.notes-browser',
  label: 'Notes',
  version: '0.2.0',
  appMenu,
  views: { notes: { title: 'Notes', icon: 'file', render: () => <NotesView /> } },
  nav: { label: 'Plugins', items: [{ id: 'notes', label: 'Notes', icon: 'file', view: 'notes' }] },
  contextMenu: [{ id: 'notes-browser.page', target: 'notes-browser', items: [
    ...VIEWS.map((v) => viewChoice(v.id)),
    { id: 'notes-browser.s1', separator: true },
    ...SOURCES.map((s) => ({ id: `notes-browser.source.${s.id}`, label: s.label, icon: s.icon, action: `notes-browser.source:${s.id}`, checked: `counter:${sourceCounter(s.id)}` })),
  ] }],
  settings: [{
    id: 'notes-browser.views', label: 'Views', icon: 'list', tab: FOLDER, order: 5,
    settings: [
      { key: KEYS.view, label: 'View', kind: 'choice', default: 'classic', scope: 'device', options: VIEWS.map((v) => ({ value: v.id, label: v.label })), description: 'Classic: the notes on the left, the open note on the right. Grid: sortable rows that expand to the note. Remembered on this device.' },
      { key: KEYS.source, label: 'Notes from', kind: 'choice', default: 'amberx', scope: 'device', options: SOURCES.map((s) => ({ value: s.id, label: s.label })), description: 'AmberX notes or the hub\'s shared Claude files.' },
      { key: KEYS.caps, label: 'ALL-CAPS lines are section headers', kind: 'toggle', default: true, description: 'A line in capitals that opens a paragraph (like “JUST MERGED (Nov 4)”) folds like a Markdown heading.' },
      { key: KEYS.collapsed, label: 'Start with sections collapsed', kind: 'toggle', default: false, description: 'Sections you opened or closed yourself keep that on this device.' },
    ],
  }],
  settingsTabs: [{ id: 'notes-browser', label: 'Notes', icon: 'file', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'notes-browser.where', tab: 'notes-browser', title: 'Where notes live', icon: 'folder', order: 10, render: () => <SettingsPanel /> },
    { id: 'notes-browser.lifecycle', tab: 'notes-browser', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    rt.registry.register(toolbarAsset, 'app', 'ai.amberx.axf.console.notes-browser');
    rt.actions.register('notes-browser.view', ([v]) => {
      rt.settings.set(KEYS.view, pick<ViewId>(v, VIEWS.map((x) => x.id), String(rt.settings.get(KEYS.view) || 'classic') as ViewId));
      rt.navigate('notes');
    }, { label: 'Notes view (classic | grid | toggle)' });
    rt.actions.register('notes-browser.source', ([s]) => {
      rt.settings.set(KEYS.source, pick<SourceId>(s, SOURCES.map((x) => x.id), String(rt.settings.get(KEYS.source) || 'amberx') as SourceId));
      rt.navigate('notes');
    }, { label: 'Notes from (amberx | claude | toggle)' });
    markActive(rt);
    rt.settings.onChange(KEYS.view, () => markActive(rt));
    rt.settings.onChange(KEYS.source, () => markActive(rt));
  },
};
