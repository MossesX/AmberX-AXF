/**
 * AmberX notes console plugin (ai.amberx.axf.console.amberx-notes; Nov 12 2026, Opus, build
 * move-amberx-web-app-into-the-console-amberx-andr s3).
 *
 * Apps → AmberX → Notes: the AmberX web app's Notes screen on the console. Every note is an amberx-notes@1 item in hub
 * project amberx-axf, read and written only through control@1 (this plugin's server relays the page's commands to the
 * control@1 capability), so what the page does is exactly what REST /api/control/amberx.items, the MCP tools amberx_*
 * and `axf note …` do. Deletes take control@1's two-step confirm. Settings live on the plugin's server (GET / PUT
 * /api/plugins/amberx-notes/settings), so they are reachable without the page.
 *
 * Deep link: console_open("amberx-notes", focus="<list id>" | "item:<id>" | "search:<words>" | "new").
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-notes.css';

const ID = 'ai.amberx.axf.console.amberx-notes';
const FOLDER = 'amberx-notes';
const VIEW = 'amberx-notes';
const FOCUS_EVENT = 'amberx-notes:focus';

interface Item { id: string; kind: string; title: string; text: string; list: string; listName: string; status: string; pinned?: boolean; starred?: boolean; tags?: string[]; updatedAt?: string; createdAt?: string }
interface List { id: string; name: string; path: string; items: number }
interface Settings { defaultList: string; pageSize: number; sort: 'updated' | 'created' | 'title'; showDone: boolean; preview: boolean }
interface Answer { ok: boolean; code?: string; message?: string; confirm?: string; items?: any[]; total?: number; item?: any; settings?: Settings; lists?: List[] }

async function call(path: string, init: RequestInit = {}): Promise<Answer> {
  const r = await pluginFetch(FOLDER, path, init);
  try { return (await r.json()) as Answer; } catch { return { ok: false, code: 'unexpected', message: `The console answered ${r.status}.` }; }
}
const send = (command: Record<string, unknown>) => call('control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: { reason: 'AmberX notes page', ...command } }) });
const putSettings = (patch: Partial<Settings>) => call('settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });

/** A deep-link focus: a list id, item:<id>, search:<words> or new. */
export function parseFocus(f: string): { list?: string; item?: string; q?: string; create?: boolean } {
  const s = decodeURIComponent(f || '').trim();
  if (!s) return {};
  if (s === 'new') return { create: true };
  if (s.startsWith('item:')) return { item: s.slice(5) };
  if (s.startsWith('search:')) return { q: s.slice(7) };
  return { list: s };
}

function sortItems(items: Item[], sort: Settings['sort']): Item[] {
  const by = sort === 'title' ? (a: Item, b: Item) => a.title.localeCompare(b.title) : sort === 'created' ? (a: Item, b: Item) => String(b.createdAt).localeCompare(String(a.createdAt)) : (a: Item, b: Item) => String(b.updatedAt).localeCompare(String(a.updatedAt));
  return [...items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by(a, b));
}

function Editor({ item, lists, defaultList, onSaved, onClose }: { item: Item | null; lists: List[]; defaultList: string; onSaved: (it: Item | null, msg: string) => void; onClose: () => void }) {
  const rt = useRuntime();
  const [title, setTitle] = useState(item?.title ?? '');
  const [text, setText] = useState(item?.text ?? '');
  const [list, setList] = useState(item?.list ?? defaultList);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(item?.title ?? ''); setText(item?.text ?? ''); setList(item?.list ?? defaultList); }, [item, defaultList]);
  const save = async () => {
    setBusy(true);
    const value = { kind: 'note', text, ...(title ? { title } : {}), ...(list ? { list } : {}) };
    const r = item ? await send({ op: 'set', target: 'amberx.items', path: item.id, value }) : await send({ op: 'add', target: 'amberx.items', value });
    setBusy(false);
    if (!r.ok) { rt.toast(r.message || 'Could not save.', 'danger', 'AmberX notes'); return; }
    onSaved(r.item as Item, item ? 'Saved.' : 'Note added.');
  };
  const remove = async () => {
    if (!item) return;
    setBusy(true);
    const first = await send({ op: 'remove', target: 'amberx.items', path: item.id });
    const r = !first.ok && first.code === 'confirmation_required' ? await send({ op: 'remove', target: 'amberx.items', path: item.id, confirm: first.confirm }) : first;
    setBusy(false);
    if (!r.ok) { rt.toast(r.message || 'Could not delete.', 'danger', 'AmberX notes'); return; }
    onSaved(null, 'Note deleted.');
  };
  return (
    <Container title={item ? 'Edit note' : 'New note'} icon="edit">
      <div className="axp-amberx-notes__editor" data-help="amberx-notes.editor">
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Made from the first line when empty" />
        <TextField label="Note" value={text} onChange={setText} rows={8} autoFocus={!item} />
        <SelectField label="List" value={list} onChange={setList} empty="Default list" options={lists.map((l) => ({ value: l.id, label: l.path }))} />
        <div className="axp-amberx-notes__row" role="toolbar" aria-label="Note actions">
          <Button tone="primary" icon="check" busy={busy} disabled={!text.trim() && !title.trim()} onClick={() => void save()}>Save</Button>
          {item && <Button icon={item.pinned ? 'pin-off' : 'pin'} disabled={busy} onClick={() => void send({ op: 'act', target: 'amberx.items', path: item.id, action: 'pin', input: { on: !item.pinned } }).then((r) => r.ok && onSaved(r.item as Item, item.pinned ? 'Unpinned.' : 'Pinned.'))}>{item.pinned ? 'Unpin' : 'Pin'}</Button>}
          {item && <Button tone="danger" icon="trash" disabled={busy} confirm={`Delete "${item.title || 'this note'}"? It can't be brought back.`} onClick={() => void remove()}>Delete</Button>}
          <Button tone="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Container>
  );
}

export function NotesPage() {
  const rt = useRuntime();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [list, setList] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<Item | null | 'new'>(null);
  const [err, setErr] = useState('');

  const loadState = useCallback(async () => {
    const r = await call('state');
    if (!r.ok) { setErr(r.message || 'Could not read the notes.'); return; }
    setSettings(r.settings ?? null); setLists(r.lists ?? []); setErr('');
  }, []);
  const loadItems = useCallback(async () => {
    if (!settings) return;
    const select: Record<string, unknown> = { kind: 'note', limit: settings.pageSize, ...(list ? { list, deep: true } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(settings.showDone ? {} : { status: 'not-done' }) };
    const r = await send({ op: 'list', target: 'amberx.items', select });
    if (!r.ok) { setErr(r.message || 'Could not read the notes.'); return; }
    setItems(sortItems((r.items ?? []) as Item[], settings.sort)); setTotal(r.total ?? 0); setErr('');
  }, [settings, list, q]);

  useEffect(() => { void loadState(); }, [loadState]);
  useEffect(() => { const t = setTimeout(() => void loadItems(), 200); return () => clearTimeout(t); }, [loadItems]);

  // deep link: amberx-notes.focus:<list|item:id|search:words|new>
  useEffect(() => {
    const on = (e: Event) => {
      const f = parseFocus(String((e as CustomEvent).detail ?? ''));
      if (f.create) setOpen('new');
      if (f.list !== undefined) setList(f.list);
      if (f.q !== undefined) setQ(f.q);
      if (f.item) void send({ op: 'get', target: 'amberx.items', path: f.item }).then((r) => (r.ok ? setOpen(r.item as Item) : rt.toast(r.message || `No note ${f.item}.`, 'warning', 'AmberX notes')));
    };
    window.addEventListener(FOCUS_EVENT, on);
    const pending = (window as { __amberxNotesFocus?: string }).__amberxNotesFocus;
    if (pending) { (window as { __amberxNotesFocus?: string }).__amberxNotesFocus = undefined; on(new CustomEvent(FOCUS_EVENT, { detail: pending })); }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [rt]);

  const listOptions = useMemo(() => lists.map((l) => ({ value: l.id, label: `${l.path} (${l.items})` })), [lists]);
  const saved = (it: Item | null, msg: string) => { rt.toast(msg, 'success', 'AmberX notes'); setOpen(it); void loadItems(); void loadState(); };

  return (
    <div className="axp-amberx-notes" data-help="view:amberx-notes">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX</p>
          <h1>Notes</h1>
          <p className="fx-muted">{settings ? `${total} note${total === 1 ? '' : 's'}${list ? ` in ${lists.find((l) => l.id === list)?.name ?? list}` : ''}` : 'Reading…'}. The same notes AmberX shows on every device.</p>
        </div>
        <div className="axp-amberx-notes__row" role="toolbar" aria-label="Notes">
          <Button tone="primary" icon="plus" onClick={() => setOpen('new')}>New note</Button>
          <Button icon="refresh" onClick={() => { void loadState(); void loadItems(); }}>Refresh</Button>
        </div>
      </header>
      {err && <Note tone="warning">{err}</Note>}
      <div className="axp-amberx-notes__filters">
        <TextField label="Search" type="search" value={q} onChange={setQ} placeholder="Words in the title, text or tags" />
        <SelectField label="List" value={list} onChange={setList} empty="Every list" options={listOptions} />
      </div>
      <div className="axp-amberx-notes__body">
        <div className="axp-amberx-notes__list" data-help="amberx-notes.list">
          {settings && !items.length && <Note tone="info">{q ? 'No note matches.' : 'No notes here yet.'}</Note>}
          {items.map((it) => (
            <Button key={it.id} tone={open !== 'new' && open?.id === it.id ? 'primary' : 'quiet'} className="axp-amberx-notes__item" data-item={it.id} onClick={() => setOpen(it)}>
              <span className="axp-amberx-notes__title">{it.title || '(untitled)'}</span>
              {settings?.preview && it.text && <span className="fx-muted axp-amberx-notes__preview">{it.text.slice(0, 140)}</span>}
              <span className="axp-amberx-notes__meta">{it.pinned && <Chip tone="accent">Pinned</Chip>}{it.listName && <Chip>{it.listName}</Chip>}{it.status === 'done' && <Chip tone="success">Done</Chip>}</span>
            </Button>
          ))}
          {total > items.length && <p className="fx-muted">{total - items.length} more: narrow the search or raise "Notes per page" in settings.</p>}
        </div>
        {open && <Editor item={open === 'new' ? null : open} lists={lists} defaultList={settings?.defaultList ?? ''} onSaved={saved} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  useEffect(() => { void call('state').then((r) => { if (r.ok) { setS(r.settings ?? null); setLists(r.lists ?? []); } }); }, []);
  const set = async (patch: Partial<Settings>) => {
    const r = await putSettings(patch);
    if (!r.ok) { rt.toast(r.message || 'Not saved.', 'danger', 'AmberX notes'); return; }
    setS(r.settings ?? null);
  };
  if (!s) return <p className="fx-muted">Reading…</p>;
  return (
    <div className="axp-amberx-notes__editor">
      <SelectField label="New notes go to" value={s.defaultList} onChange={(v) => void set({ defaultList: v })} options={lists.map((l) => ({ value: l.id, label: l.path }))} />
      <SelectField label="Notes per page" value={String(s.pageSize)} onChange={(v) => void set({ pageSize: Number(v) })} options={[25, 50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))} />
      <SelectField label="Sort by" value={s.sort} onChange={(v) => void set({ sort: v as Settings['sort'] })} options={[{ value: 'updated', label: 'Last changed' }, { value: 'created', label: 'Created' }, { value: 'title', label: 'Title' }]} />
      <Switch label="Show done notes" checked={s.showDone} onChange={(v) => void set({ showDone: v })} />
      <Switch label="Show a preview line" checked={s.preview} onChange={(v) => void set({ preview: v })} />
    </div>
  );
}

type VoiceRegistry = { register: (module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; owner?: string }[]) => () => void };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AmberX notes',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  views: { [VIEW]: { title: 'AmberX notes', icon: 'file-text', keywords: ['amberx', 'notes', 'note', 'search notes', 'lists'], render: () => <NotesPage /> } },
  nav: { label: 'Apps', items: [{ id: VIEW, label: 'Notes', icon: 'file-text', view: VIEW }] },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'AmberX notes', icon: 'file-text', order: 94, parent: 'plugins', description: 'Default list, page size, sort, done notes, preview; install and uninstall' }],
  settingsPanels: [
    { id: 'amberx-notes.settings', tab: FOLDER, title: 'Notes page', icon: 'file-text', order: 10, render: () => <SettingsPanel /> },
    { id: 'amberx-notes.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    const focus = (f: string) => {
      (window as { __amberxNotesFocus?: string }).__amberxNotesFocus = f;
      rt.navigate(VIEW);
      setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: f })), 0);
    };
    rt.actions.register('amberx-notes.open', () => rt.navigate(VIEW), { label: 'AmberX notes' });
    rt.actions.register('amberx-notes.focus', ([arg]) => focus(arg ?? ''), { label: 'AmberX notes: open a list, a note (item:<id>), a search (search:<words>) or a new note (new)', params: true, effect: 'navigate' });
    rt.actions.register('amberx-notes.new', () => focus('new'), { label: 'New AmberX note', effect: 'navigate' });
    (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice?.register(ID, [
      { id: 'amberx-notes.open', phrases: ['open notes', 'show notes', 'my notes'], action: 'amberx-notes.open', reply: 'Here are your notes.', owner: 'Notes' },
      { id: 'amberx-notes.new', phrases: ['new note', 'write a note', 'take a note'], action: 'amberx-notes.new', reply: 'New note.', owner: 'Notes' },
      { id: 'amberx-notes.inbox', phrases: ['open my inbox', 'read my inbox', 'notes in inbox'], action: 'amberx-notes.focus:inbox', owner: 'Notes' },
    ]);
  },
};
