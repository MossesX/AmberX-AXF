/**
 * AmberX tasks console plugin (ai.amberx.axf.console.amberx-tasks; Nov 12 2026, Opus, build
 * move-amberx-web-app-into-the-console-amberx-andr s4).
 *
 * Apps → AmberX → To-dos: the AmberX web app's Tasks screen on the console. Tabs Today · Upcoming · To-dos · All · Done;
 * add, tick off, move up / down (reorder) and delete (two-step confirm). Every to-do and task is an amberx-notes@1 item
 * read and written through control@1 by this plugin's server, so REST /api/plugins/amberx-tasks, the MCP tools
 * amberx-tasks_* (and amberx_* / control_*) and `axf amberx-tasks …` / `axf todo …` do exactly what the page does.
 *
 * Deep link: console_open("amberx-tasks", focus="today" | "upcoming" | "todo" | "all" | "done" | "item:<id>" | "new").
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Container, IconButton, Note, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-tasks.css';

const ID = 'ai.amberx.axf.console.amberx-tasks';
const FOLDER = 'amberx-tasks';
const VIEW = 'amberx-tasks';
const FOCUS_EVENT = 'amberx-tasks:focus';
const TABS = ['today', 'upcoming', 'todo', 'all', 'done'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { today: 'Today', upcoming: 'Upcoming', todo: 'To-dos', all: 'All', done: 'Done' };

interface Item { id: string; kind: string; title: string; text: string; list: string; listName: string; status: string; due?: string; priority?: number; pinned?: boolean }
interface List { id: string; name: string; path: string; items: number }
interface Settings { defaultTab: Tab; defaultList: string; defaultKind: 'todo' | 'task'; pageSize: number; overdueInToday: boolean }
interface Answer { ok: boolean; code?: string; message?: string; confirm?: string; items?: any[]; total?: number; item?: any; settings?: Settings; lists?: List[]; counts?: Record<string, number> }

async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Answer> {
  const r = await pluginFetch(FOLDER, path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { return (await r.json()) as Answer; } catch { return { ok: false, code: 'unexpected', message: `The console answered ${r.status}.` }; }
}

/** A deep-link focus: a tab, item:<id> or new. */
export function parseFocus(f: string): { tab?: Tab; item?: string; create?: boolean } {
  const s = decodeURIComponent(f || '').trim();
  if (s === 'new') return { create: true };
  if (s.startsWith('item:')) return { item: s.slice(5) };
  return (TABS as readonly string[]).includes(s) ? { tab: s as Tab } : {};
}

/** The ids after moving `id` one place up (-1) or down (+1). */
export function moved(ids: string[], id: string, by: -1 | 1): string[] {
  const i = ids.indexOf(id); const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  out[i] = ids[j] as string;
  out[j] = id;
  return out;
}

export function TasksPage() {
  const rt = useRuntime();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab | ''>('');
  const [list, setList] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [focusId, setFocusId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadState = useCallback(async () => {
    const r = await call('state');
    if (!r.ok) { setErr(r.message || 'Could not read the to-dos.'); return; }
    setSettings(r.settings ?? null); setLists(r.lists ?? []); setCounts(r.counts ?? {}); setErr('');
    setTab((t) => t || r.settings?.defaultTab || 'today');
  }, []);
  const loadItems = useCallback(async () => {
    if (!tab) return;
    const r = await call(`items?tab=${tab}${list ? `&list=${encodeURIComponent(list)}` : ''}`);
    if (!r.ok) { setErr(r.message || 'Could not read the to-dos.'); return; }
    setItems((r.items ?? []) as Item[]); setTotal(r.total ?? 0); setErr('');
  }, [tab, list]);
  const refresh = useCallback(() => { void loadState(); void loadItems(); }, [loadState, loadItems]);

  useEffect(() => { void loadState(); }, [loadState]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => {
    const on = (e: Event) => {
      const f = parseFocus(String((e as CustomEvent).detail ?? ''));
      if (f.tab) setTab(f.tab);
      if (f.item) { setTab('all'); setFocusId(f.item); }
      if (f.create) document.querySelector<HTMLInputElement>('.axp-amberx-tasks__add input')?.focus();
    };
    window.addEventListener(FOCUS_EVENT, on);
    const w = window as { __amberxTasksFocus?: string };
    if (w.__amberxTasksFocus) { const f = w.__amberxTasksFocus; w.__amberxTasksFocus = undefined; on(new CustomEvent(FOCUS_EVENT, { detail: f })); }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  useEffect(() => { if (focusId) document.querySelector(`[data-item="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' }); }, [focusId, items]);

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    const r = await call(path, body);
    setBusy(false);
    if (!r.ok) { rt.toast(r.message || 'That did not work.', 'danger', 'AmberX to-dos'); return false; }
    if (ok) rt.toast(ok, 'success', 'AmberX to-dos');
    refresh();
    return true;
  };
  const add = async () => {
    if (!text.trim()) return;
    if (await run('add', { text, ...(due ? { due } : {}), ...(list ? { list } : {}) }, 'Added.')) { setText(''); setDue(''); }
  };
  const remove = async (it: Item) => {
    const first = await call('remove', { id: it.id });
    if (!first.ok && first.code === 'confirmation_required') await run('remove', { id: it.id, confirm: first.confirm }, 'Deleted.');
    else if (!first.ok) rt.toast(first.message || 'Could not delete.', 'danger', 'AmberX to-dos');
  };
  const move = (id: string, by: -1 | 1) => {
    const ids = moved(items.map((i) => i.id), id, by);
    setItems(ids.map((x) => items.find((i) => i.id === x)!));
    void run('reorder', { ids }, '');
  };

  return (
    <div className="axp-amberx-tasks" data-help="view:amberx-tasks">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX</p>
          <h1>To-dos</h1>
          <p className="fx-muted">{settings ? `${counts.all ?? 0} open${counts.overdue ? ` · ${counts.overdue} overdue` : ''}` : 'Reading…'}. The same to-dos and tasks AmberX shows on every device.</p>
        </div>
        <div className="axp-amberx-tasks__row" role="toolbar" aria-label="To-dos">
          <SelectField label="List" value={list} onChange={setList} empty="Every list" options={lists.map((l) => ({ value: l.id, label: l.path }))} />
          <Button icon="refresh" onClick={refresh}>Refresh</Button>
        </div>
      </header>
      {err && <Note tone="warning">{err}</Note>}
      <TabGroup id="amberx-tasks.tabs" label="To-do views" value={(tab || 'today') as Tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], badge: counts[t] ?? 0 }))} />
      <div className="axp-amberx-tasks__add axp-amberx-tasks__row" data-help="amberx-tasks.add">
        <TextField label="New to-do" value={text} onChange={setText} placeholder="What needs doing" />
        <TextField label="Due" type="date" value={due} onChange={setDue} />
        <Button tone="primary" icon="plus" busy={busy} disabled={!text.trim()} onClick={() => void add()}>Add</Button>
      </div>
      <Container title={TAB_LABEL[(tab || 'today') as Tab]} icon="check-square">
        <div className="axp-amberx-tasks__list" data-help="amberx-tasks.list">
          {settings && !items.length && <Note tone="info">Nothing here.</Note>}
          {items.map((it, i) => (
            <div key={it.id} className={`axp-amberx-tasks__item${it.id === focusId ? ' is-focused' : ''}`} data-item={it.id}>
              <Checkbox label={it.title || it.text} checked={it.status === 'done'} onChange={(v) => void run('complete', { id: it.id, done: v }, v ? 'Done.' : 'Opened again.')} />
              <span className="axp-amberx-tasks__meta">
                {it.kind === 'task' && <Chip>Task</Chip>}
                {it.due && <Chip tone={it.status !== 'done' && it.due.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'danger' : undefined}>{it.due.slice(0, 10)}</Chip>}
                {it.listName && <Chip>{it.listName}</Chip>}
              </span>
              <span className="axp-amberx-tasks__actions" role="toolbar" aria-label="To-do actions">
                <IconButton icon="arrow-up" label="Move up" disabled={busy || i === 0} onClick={() => move(it.id, -1)} />
                <IconButton icon="arrow-down" label="Move down" disabled={busy || i === items.length - 1} onClick={() => move(it.id, 1)} />
                <Button tone="danger" icon="trash" aria-label="Delete" disabled={busy} confirm={`Delete "${it.title || it.text}"? It can't be brought back.`} onClick={() => void remove(it)}>Delete</Button>
              </span>
            </div>
          ))}
          {total > items.length && <p className="fx-muted">{total - items.length} more: pick a list, or raise "To-dos per page" in settings.</p>}
        </div>
      </Container>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  useEffect(() => { void call('state').then((r) => { if (r.ok) { setS(r.settings ?? null); setLists(r.lists ?? []); } }); }, []);
  const set = async (patch: Partial<Settings>) => {
    const r = await call('settings', patch, 'PUT');
    if (!r.ok) { rt.toast(r.message || 'Not saved.', 'danger', 'AmberX to-dos'); return; }
    setS(r.settings ?? null);
  };
  if (!s) return <p className="fx-muted">Reading…</p>;
  return (
    <div className="axp-amberx-tasks__settings">
      <SelectField label="Open on" value={s.defaultTab} onChange={(v) => void set({ defaultTab: v as Tab })} options={TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
      <SelectField label="New to-dos go to" value={s.defaultList} onChange={(v) => void set({ defaultList: v })} options={lists.map((l) => ({ value: l.id, label: l.path }))} />
      <SelectField label="New items are" value={s.defaultKind} onChange={(v) => void set({ defaultKind: v as Settings['defaultKind'] })} options={[{ value: 'todo', label: 'To-dos' }, { value: 'task', label: 'Tasks' }]} />
      <SelectField label="To-dos per page" value={String(s.pageSize)} onChange={(v) => void set({ pageSize: Number(v) })} options={[25, 50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))} />
      <Switch label="Show overdue under Today" checked={s.overdueInToday} onChange={(v) => void set({ overdueInToday: v })} />
    </div>
  );
}

type VoiceRegistry = { register: (module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; owner?: string }[]) => () => void };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AmberX to-dos',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  views: { [VIEW]: { title: 'AmberX to-dos', icon: 'check-square', keywords: ['amberx', 'todo', 'to-do', 'tasks', 'due', 'today', 'upcoming'], render: () => <TasksPage /> } },
  nav: { label: 'Apps', items: [{ id: VIEW, label: 'To-dos', icon: 'check-square', view: VIEW }] },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'AmberX to-dos', icon: 'check-square', order: 95, parent: 'plugins', description: 'Opening tab, default list and kind, page size, overdue; install and uninstall' }],
  settingsPanels: [
    { id: 'amberx-tasks.settings', tab: FOLDER, title: 'To-dos page', icon: 'check-square', order: 10, render: () => <SettingsPanel /> },
    { id: 'amberx-tasks.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    const focus = (f: string) => {
      (window as { __amberxTasksFocus?: string }).__amberxTasksFocus = f;
      rt.navigate(VIEW);
      setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: f })), 0);
    };
    rt.actions.register('amberx-tasks.open', () => rt.navigate(VIEW), { label: 'AmberX to-dos' });
    rt.actions.register('amberx-tasks.focus', ([arg]) => focus(arg ?? ''), { label: 'AmberX to-dos: open a tab (today, upcoming, todo, all, done), a to-do (item:<id>) or a new one (new)', params: true, effect: 'navigate' });
    (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice?.register(ID, [
      { id: 'amberx-tasks.today', phrases: ['whats due today', 'what is due today', 'todays todos'], action: 'amberx-tasks.focus:today', owner: 'To-dos' },
      { id: 'amberx-tasks.upcoming', phrases: ['whats coming up', 'upcoming todos'], action: 'amberx-tasks.focus:upcoming', owner: 'To-dos' },
      { id: 'amberx-tasks.todo', phrases: ['show todos', 'open todos', 'my todos', 'todo list'], action: 'amberx-tasks.focus:todo', owner: 'To-dos' },
      { id: 'amberx-tasks.new', phrases: ['new todo', 'add a todo'], action: 'amberx-tasks.focus:new', owner: 'To-dos' },
    ]);
  },
};
