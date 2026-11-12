/**
 * AmberX lists console plugin (ai.amberx.axf.console.amberx-lists; Nov 12 2026, Opus, build
 * move-amberx-web-app-into-the-console-amberx-andr s5).
 *
 * Apps → AmberX → Lists: the AmberX web app's Lists screen on the console. The list tree with counts; pick a list to see
 * its items, add, edit, tick off and delete them; make, rename, move and delete lists (system lists are kept);
 * export a list as Markdown. Everything goes through this plugin's server to control@1 (amberx.lists, amberx.items), so
 * REST /api/plugins/amberx-lists, MCP amberx-lists_* (and control_*) and `axf amberx-lists …` / `axf list …` match it.
 *
 * Deep link: console_open("amberx-lists", focus="<list id>" | "new").
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Container, IconButton, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-lists.css';

const ID = 'ai.amberx.axf.console.amberx-lists';
const FOLDER = 'amberx-lists';
const VIEW = 'amberx-lists';
const FOCUS_EVENT = 'amberx-lists:focus';

interface List { id: string; name: string; path: string; parent: string | null; items: number; system?: string }
interface Item { id: string; kind: string; title: string; text: string; status: string }
interface Settings { itemKind: 'todo' | 'note'; showChecked: boolean; checkedLast: boolean; showEmpty: boolean }
interface Answer { ok: boolean; code?: string; message?: string; confirm?: string; items?: any[]; list?: List; lists?: List[]; settings?: Settings; markdown?: string; item?: any }

async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Answer> {
  const r = await pluginFetch(FOLDER, path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { return (await r.json()) as Answer; } catch { return { ok: false, code: 'unexpected', message: `The console answered ${r.status}.` }; }
}
/** The two-step delete: ask, then repeat with the confirm token. */
async function removeConfirmed(path: string, id: string): Promise<Answer> {
  const first = await call(path, { id });
  return !first.ok && first.code === 'confirmation_required' ? call(path, { id, confirm: first.confirm }) : first;
}
/** Indent depth of a list from its path ("Work / Ideas" = 1). */
export const depthOf = (l: { path: string }) => Math.max(0, l.path.split(' / ').length - 1);

export function ListsPage() {
  const rt = useRuntime();
  const [lists, setLists] = useState<List[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [newList, setNewList] = useState('');
  const [newItem, setNewItem] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadLists = useCallback(async () => {
    const r = await call('state');
    if (!r.ok) { setErr(r.message || 'Could not read the lists.'); return; }
    setLists(r.lists ?? []); setSettings(r.settings ?? null); setErr('');
  }, []);
  const loadItems = useCallback(async () => {
    if (!sel) { setItems([]); return; }
    const r = await call(`list?id=${encodeURIComponent(sel)}`);
    if (!r.ok) { setErr(r.message || 'Could not read the list.'); return; }
    setItems((r.items ?? []) as Item[]); setRename(r.list?.name ?? '');
  }, [sel]);
  const refresh = useCallback(() => { void loadLists(); void loadItems(); }, [loadLists, loadItems]);
  useEffect(() => { void loadLists(); }, [loadLists]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => {
    const on = (e: Event) => {
      const f = decodeURIComponent(String((e as CustomEvent).detail ?? '')).trim();
      if (f === 'new') document.querySelector<HTMLInputElement>('.axp-amberx-lists__new input')?.focus();
      else if (f) setSel(f);
    };
    window.addEventListener(FOCUS_EVENT, on);
    const w = window as { __amberxListsFocus?: string };
    if (w.__amberxListsFocus) { const f = w.__amberxListsFocus; w.__amberxListsFocus = undefined; on(new CustomEvent(FOCUS_EVENT, { detail: f })); }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);

  const run = async (p: Promise<Answer>, ok: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) { rt.toast(r.message || 'That did not work.', 'danger', 'AmberX lists'); return null; }
    if (ok) rt.toast(ok, 'success', 'AmberX lists');
    refresh();
    return r;
  };
  const current = lists.find((l) => l.id === sel);
  const exportMd = async () => {
    const r = await call(`export?id=${encodeURIComponent(sel)}`);
    if (!r.ok || !r.markdown) { rt.toast(r.message || 'Nothing to export.', 'danger', 'AmberX lists'); return; }
    await navigator.clipboard?.writeText(r.markdown).catch(() => undefined);
    rt.toast('Copied as Markdown.', 'success', 'AmberX lists');
  };

  return (
    <div className="axp-amberx-lists" data-help="view:amberx-lists">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX</p>
          <h1>Lists</h1>
          <p className="fx-muted">{lists.length} list{lists.length === 1 ? '' : 's'}. The same lists AmberX shows on every device.</p>
        </div>
        <div className="axp-amberx-lists__row" role="toolbar" aria-label="Lists">
          <Button icon="refresh" onClick={refresh}>Refresh</Button>
        </div>
      </header>
      {err && <Note tone="warning">{err}</Note>}
      <div className="axp-amberx-lists__body">
        <Container title="Every list" icon="list">
          <div className="axp-amberx-lists__tree" data-help="amberx-lists.tree">
            {lists.map((l) => (
              <Button key={l.id} tone={l.id === sel ? 'primary' : 'quiet'} className={`axp-amberx-lists__node axp-amberx-lists__depth-${Math.min(depthOf(l), 4)}`} data-list={l.id} onClick={() => setSel(l.id)}>
                <span className="axp-amberx-lists__grow">{l.name}</span>
                <Chip>{l.items}</Chip>
              </Button>
            ))}
            <div className="axp-amberx-lists__new axp-amberx-lists__row">
              <TextField label="New list" value={newList} onChange={setNewList} placeholder={current ? `Inside ${current.name} (or at the top)` : 'Name'} />
              <Button icon="plus" busy={busy} disabled={!newList.trim()} onClick={() => void run(call('lists/add', { name: newList, ...(current ? { parent: current.id } : {}) }), 'List made.').then((r) => { if (r) { setNewList(''); if (r.item?.id) setSel(r.item.id); } })}>Make</Button>
            </div>
          </div>
        </Container>
        {current && (
          <Container title={current.path} icon="list" actions={
            <span className="axp-amberx-lists__row" role="toolbar" aria-label="List actions">
              <Button size="sm" icon="copy" onClick={() => void exportMd()}>Export</Button>
              {!current.system && <Button size="sm" tone="danger" icon="trash" confirm={`Delete the list "${current.name}" and everything in it? It can't be brought back.`} onClick={() => void run(removeConfirmed('lists/remove', current.id), 'List deleted.').then((r) => r && setSel(''))}>Delete list</Button>}
            </span>
          }>
            <div className="axp-amberx-lists__items" data-help="amberx-lists.items">
              <div className="axp-amberx-lists__row">
                <TextField label="Name" value={rename} onChange={setRename} />
                <Button size="sm" disabled={busy || !rename.trim() || rename === current.name} onClick={() => void run(call('lists/rename', { id: current.id, name: rename }), 'Renamed.')}>Rename</Button>
                <SelectField label="Inside" value={current.parent ?? ''} onChange={(v) => void run(call('lists/move', { id: current.id, parent: v || null }), 'Moved.')} empty="Top level" options={lists.filter((l) => l.id !== current.id && !l.path.startsWith(`${current.path} / `)).map((l) => ({ value: l.id, label: l.path }))} disabled={!!current.system} />
              </div>
              {!items.length && <Note tone="info">This list is empty.</Note>}
              {items.map((it) => (
                <div key={it.id} className="axp-amberx-lists__item" data-item={it.id}>
                  {editing?.id === it.id ? (
                    <>
                      <TextField label="Item" value={editing.text} onChange={(v) => setEditing({ id: it.id, text: v })} autoFocus />
                      <Button size="sm" tone="primary" disabled={busy || !editing.text.trim()} onClick={() => void run(call('items/edit', { id: it.id, text: editing.text }), 'Saved.').then((r) => r && setEditing(null))}>Save</Button>
                      <Button size="sm" tone="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Checkbox label={it.title || it.text} checked={it.status === 'done'} onChange={(v) => void run(call('items/check', { id: it.id, done: v }), '')} />
                      <span className="axp-amberx-lists__actions" role="toolbar" aria-label="Item actions">
                        <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => setEditing({ id: it.id, text: it.text || it.title })} />
                        <IconButton icon="trash" label="Delete" disabled={busy} onClick={() => { if (window.confirm(`Delete "${it.title || it.text}"? It can't be brought back.`)) void run(removeConfirmed('items/remove', it.id), 'Deleted.'); }} />
                      </span>
                    </>
                  )}
                </div>
              ))}
              <div className="axp-amberx-lists__row">
                <TextField label="Add to this list" value={newItem} onChange={setNewItem} placeholder={settings?.itemKind === 'note' ? 'A note' : 'Something to tick off'} />
                <Button tone="primary" icon="plus" busy={busy} disabled={!newItem.trim()} onClick={() => void run(call('items/add', { list: current.id, text: newItem }), '').then((r) => r && setNewItem(''))}>Add</Button>
              </div>
            </div>
          </Container>
        )}
      </div>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { void call('settings').then((r) => r.ok && setS(r.settings ?? null)); }, []);
  const set = async (patch: Partial<Settings>) => {
    const r = await call('settings', patch, 'PUT');
    if (!r.ok) { rt.toast(r.message || 'Not saved.', 'danger', 'AmberX lists'); return; }
    setS(r.settings ?? null);
  };
  if (!s) return <p className="fx-muted">Reading…</p>;
  return (
    <div className="axp-amberx-lists__settings">
      <SelectField label="New list items are" value={s.itemKind} onChange={(v) => void set({ itemKind: v as Settings['itemKind'] })} options={[{ value: 'todo', label: 'To-dos (can be ticked)' }, { value: 'note', label: 'Notes' }]} />
      <Switch label="Show ticked items" checked={s.showChecked} onChange={(v) => void set({ showChecked: v })} />
      <Switch label="Ticked items last" checked={s.checkedLast} onChange={(v) => void set({ checkedLast: v })} />
      <Switch label="Show empty lists" checked={s.showEmpty} onChange={(v) => void set({ showEmpty: v })} />
    </div>
  );
}

type VoiceRegistry = { register: (module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; owner?: string }[]) => () => void };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AmberX lists',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  views: { [VIEW]: { title: 'AmberX lists', icon: 'list', keywords: ['amberx', 'lists', 'list', 'groceries', 'shopping', 'export'], render: () => <ListsPage /> } },
  nav: { label: 'Apps', items: [{ id: VIEW, label: 'Lists', icon: 'list', view: VIEW }] },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'AmberX lists', icon: 'list', order: 96, parent: 'plugins', description: 'New item kind, ticked items, empty lists; install and uninstall' }],
  settingsPanels: [
    { id: 'amberx-lists.settings', tab: FOLDER, title: 'Lists page', icon: 'list', order: 10, render: () => <SettingsPanel /> },
    { id: 'amberx-lists.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    const focus = (f: string) => {
      (window as { __amberxListsFocus?: string }).__amberxListsFocus = f;
      rt.navigate(VIEW);
      setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: f })), 0);
    };
    rt.actions.register('amberx-lists.open', () => rt.navigate(VIEW), { label: 'AmberX lists' });
    rt.actions.register('amberx-lists.focus', ([arg]) => focus(arg ?? ''), { label: 'AmberX lists: open a list (its id) or the new list field (new)', params: true, effect: 'navigate' });
    (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice?.register(ID, [
      { id: 'amberx-lists.open', phrases: ['open lists', 'show my lists', 'give me the list of lists'], action: 'amberx-lists.open', owner: 'Lists' },
      { id: 'amberx-lists.new', phrases: ['make a new list', 'new list'], action: 'amberx-lists.focus:new', owner: 'Lists' },
    ]);
  },
};
