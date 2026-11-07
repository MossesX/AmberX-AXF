/**
 * Notes browser: Brett's saved notes (the hub's /projects/_shared/_claude/notes). Left: folders and notes, search,
 * sort; right: the rendered note, with an edit switch that saves only when nobody else changed the note (if_version).
 * New note, new folder, rename, move between folders and delete (confirmed; the hub keeps the history).
 * Small on purpose: no window or dock engine, framework controls only, theme tokens only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, IconButton, Icon, Markdown, Note, Segmented, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './notes-browser.css';

const FOLDER = 'notes-browser';
const api = pluginApi(FOLDER, 'The Notes plugin');

interface NoteInfo { path: string; folder: string; name: string; title: string; size: number; version: string; updatedAt: string; updatedBy: string; snippet?: string }
interface NoteDoc extends NoteInfo { content: string }
interface Listing { root: string; available: boolean; folders: string[]; notes: NoteInfo[] }
type Sort = 'date' | 'name';
type Ask = null | { kind: 'note' | 'folder' | 'rename'; value: string; folder: string };

const enc = encodeURIComponent;
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
const slugName = (s: string) => {
  const base = s.trim().replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 110);
  return !base ? '' : /\.(md|txt)$/i.test(base) ? base : `${base}.md`;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function NotesView() {
  const [list, setList] = useState<Listing | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('date');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<NoteDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async (query = q) => {
    try { setList(await api.call<Listing>(`notes?q=${enc(query)}`)); setError(''); } catch (e) { setError(errText(e)); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(q), q ? 250 : 0); return () => clearTimeout(t); }, [q, load]);

  const openNote = async (path: string) => {
    if (editing && open && draft !== open.content && !window.confirm(`Leave “${open.title}” without saving your changes?`)) return;
    try { const d = await api.call<NoteDoc>(`note?path=${enc(path)}`); setOpen(d); setDraft(d.content); setEditing(false); setConflict(false); setError(''); } catch (e) { setError(errText(e)); }
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); setError(''); } catch (e) { const m = errText(e); setError(m); if (/changed since you opened it/.test(m)) setConflict(true); } finally { setBusy(false); }
  };

  const save = () => run(async () => {
    if (!open) return;
    const d = await api.put<NoteInfo>('note', { path: open.path, content: draft, if_version: open.version });
    setOpen({ ...open, ...d, content: draft }); setEditing(false); setConflict(false); await load();
  });

  const submitAsk = () => run(async () => {
    if (!ask) return;
    if (ask.kind === 'folder') {
      const name = ask.value.trim().replace(/[^A-Za-z0-9 _-]+/g, '-');
      await api.post('folder', { name }); setAsk(null); await load(); return;
    }
    const name = slugName(ask.value);
    if (!name) throw new Error('Give it a name.');
    const path = ask.folder ? `${ask.folder}/${name}` : name;
    if (ask.kind === 'note') {
      const title = ask.value.trim().replace(/\.(md|txt)$/i, '');
      await api.put('note', { path, content: `# ${title}\n\n`, if_version: '' });
      setAsk(null); await load(); await openNote(path); setEditing(true); return;
    }
    if (open) { const d = await api.post<NoteInfo>('move', { from: open.path, to: path, if_version: open.version }); setAsk(null); await load(); await openNote(d.path); }
  });

  const moveTo = (folder: string) => run(async () => {
    if (!open || folder === open.folder) return;
    const d = await api.post<NoteInfo>('move', { from: open.path, to: folder ? `${folder}/${open.name}` : open.name, if_version: open.version });
    await load(); await openNote(d.path);
  });

  const remove = () => {
    if (!open || !window.confirm(`Delete “${open.title}” (${open.path})? The hub keeps its history, but it leaves the notes.`)) return;
    void run(async () => { await api.del(`note?path=${enc(open.path)}&if_version=${enc(open.version)}`); setOpen(null); setEditing(false); await load(); });
  };

  const groups = useMemo(() => {
    const notes = [...(list?.notes ?? [])].sort((a, b) => (sort === 'date' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title)));
    const by = new Map<string, NoteInfo[]>([['', []], ...(list?.folders ?? []).map((f) => [f, []] as [string, NoteInfo[]])]);
    for (const n of notes) by.set(n.folder, [...(by.get(n.folder) ?? []), n]);
    return [...by.entries()].filter(([f, ns]) => f || ns.length).filter(([, ns]) => !q || ns.length);
  }, [list, sort, q]);

  const folderOptions = [{ value: '', label: 'Top level' }, ...(list?.folders ?? []).map((f) => ({ value: f, label: f }))];

  return (
    <div className="fx-stack fx-stack--lg axp-notes-browser">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Claude files · notes</p><h1>Notes</h1><p className="fx-muted">Every note saved for Brett in one place: read, search, edit, rename and move them.</p></div>
        <div className="axp-notes-browser__acts">
          <Button icon="plus" disabled={busy || !list?.available} onClick={() => setAsk({ kind: 'note', value: '', folder: open?.folder ?? 'misc' })}>New note</Button>
          <Button tone="ghost" icon="folder" disabled={busy || !list?.available} onClick={() => setAsk({ kind: 'folder', value: '', folder: '' })}>New folder</Button>
          <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
        </div>
      </header>

      {list && !list.available && <Note tone="warning">The hub's shared Claude files aren't mounted on this console ({list.root}).</Note>}
      {error && <Note tone={conflict ? 'warning' : 'danger'}>{error}{conflict && open && <> <Button size="sm" icon="refresh" onClick={() => void openNote(open.path)}>Reload the note</Button></>}</Note>}

      {ask && (
        <div className="axp-notes-browser__ask">
          <TextField label={ask.kind === 'folder' ? 'Folder name' : ask.kind === 'rename' ? 'New name' : 'Note title'} value={ask.value} autoFocus onChange={(v) => setAsk({ ...ask, value: v })} placeholder={ask.kind === 'folder' ? 'e.g. recipes' : 'e.g. VPS install notes'} />
          {ask.kind !== 'folder' && <SelectField label="Folder" value={ask.folder} options={folderOptions} onChange={(v) => setAsk({ ...ask, folder: v })} />}
          <div className="axp-notes-browser__acts">
            <Button tone="primary" icon="check" disabled={busy || !ask.value.trim()} onClick={() => void submitAsk()}>{ask.kind === 'rename' ? 'Rename' : 'Create'}</Button>
            <Button tone="ghost" icon="x" onClick={() => setAsk(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="axp-notes-browser__cols">
        <aside className="axp-notes-browser__side">
          <TextField label="Search notes" type="search" value={q} onChange={setQ} placeholder="Words in a title or the text" />
          <Segmented label="Sort notes" size="sm" value={sort} onChange={setSort} options={[{ value: 'date', label: 'Newest', icon: 'clock' }, { value: 'name', label: 'Name', icon: 'list' }]} />
          <nav className="axp-notes-browser__tree" aria-label="Notes">
            {!list && <p className="fx-muted">Loading…</p>}
            {list?.available && !groups.length && <p className="fx-muted">{q ? 'No note matches.' : 'No notes yet.'}</p>}
            {groups.map(([folder, notes]) => (
              <div key={folder || '.'} className="axp-notes-browser__group">
                {folder && (
                  <button type="button" className="fx-nav__item axp-notes-browser__folder" aria-expanded={!closed[folder]} onClick={() => setClosed({ ...closed, [folder]: !closed[folder] })}>
                    <Icon name={closed[folder] ? 'chevron-right' : 'chevron-down'} size={12} /><Icon name="folder" size={14} /><span className="axp-notes-browser__label">{folder}</span><span className="fx-small fx-muted">{notes.length}</span>
                  </button>
                )}
                {!closed[folder] && notes.map((n) => (
                  <button key={n.path} type="button" title={n.path} className={`fx-nav__item axp-notes-browser__note${folder ? ' is-nested' : ''}${open?.path === n.path ? ' is-active' : ''}`} onClick={() => void openNote(n.path)}>
                    <Icon name="file" size={13} />
                    <span className="axp-notes-browser__label"><span className="axp-notes-browser__sub">{n.title}</span><span className="fx-small fx-muted axp-notes-browser__sub">{n.snippet ?? day(n.updatedAt)}</span></span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <section className="axp-notes-browser__main" aria-live="polite">
          {!open && <p className="fx-muted">Pick a note on the left.</p>}
          {open && (
            <>
              <div className="axp-notes-browser__bar" role="toolbar" aria-label="Note">
                <div className="axp-notes-browser__label">
                  <strong>{open.title}</strong>
                  <span className="fx-small fx-muted axp-notes-browser__sub">{open.path} · {when(open.updatedAt)}{open.updatedBy ? ` · ${open.updatedBy}` : ''}</span>
                </div>
                <div className="axp-notes-browser__acts">
                  <Switch label="Edit" checked={editing} onChange={(v) => { if (!v && draft !== open.content && !window.confirm('Drop your changes?')) return; setEditing(v); if (!v) setDraft(open.content); }} />
                  {editing && <Button tone="primary" icon="save" disabled={busy || draft === open.content} onClick={() => void save()}>Save</Button>}
                  <IconButton icon="edit" label="Rename" disabled={busy || editing} onClick={() => setAsk({ kind: 'rename', value: open.name, folder: open.folder })} />
                  <SelectField label="Move to" value={open.folder} options={folderOptions} onChange={(v) => void moveTo(v)} />
                  <IconButton icon="trash" label="Delete" disabled={busy || editing} onClick={remove} />
                </div>
              </div>
              {editing
                ? <TextField label="Note text (Markdown)" mono rows={24} value={draft} onChange={setDraft} />
                : <div className="axp-notes-browser__doc"><Markdown text={open.content.replace(/<!--[\s\S]*?-->\n?/g, '')} /></div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingsPanel() {
  return <p className="fx-muted axp-notes-browser__lead">Notes are kept in the hub's shared Claude files, <code>/projects/_shared/_claude/notes</code>, so every project and Claude session sees them (axHub memory: project <code>shared</code>, area <code>claude</code>). Deleting or replacing a note keeps its old text in the hub's history.</p>;
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.notes-browser',
  label: 'Notes',
  version: '0.1.0',
  appMenu,
  views: { notes: { title: 'Notes', icon: 'file', render: () => <NotesView /> } },
  nav: { label: 'Plugins', items: [{ id: 'notes', label: 'Notes', icon: 'file', view: 'notes' }] },
  settingsTabs: [{ id: 'notes-browser', label: 'Notes', icon: 'file', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'notes-browser.where', section: 'general', tab: 'notes-browser', title: 'Where notes live', icon: 'folder', order: 10, render: () => <SettingsPanel /> },
    { id: 'notes-browser.lifecycle', section: 'plugin', tab: 'notes-browser', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
