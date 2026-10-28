/**
 * Web: the integrated web component. Open pages inside AmberX in tabs (kept alive while you switch), bookmark them as
 * notes, and clip a page or a pasted passage into any list. Pages that refuse to be framed (most big sites send
 * X-Frame-Options) get "Open outside" instead; the clip still works from the address.
 *
 * Actions: `web.open`, `web.open:<url>` (a typed address or https URL), `web.clip` (clip the current tab).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Container, Icon, IconButton, Note, SelectField, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { DataGrid, type GridColumn } from '../../../axf/libs/datagrid';
import type { Item } from '../../notes/web/core';
import { addItem, addList, flatTree, type Store } from '../../notes/web/core';
import { mutate, useNotes } from '../../notes/web/store';
import { MAX_TABS, WEB_LIST, clipToItem, hostOf, toUrl } from './core';
import './web.css';

const ID = 'ai.amberx.amberx.web';
const K = { home: 'amberx.web.home', tabs: 'amberx.web.tabs' } as const;

type Tab = { id: string; url: string; title: string };
type State = { tabs: Tab[]; active: string; clip: Tab | null };
let state: State = { tabs: [], active: '', clip: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useWeb = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
let seq = 0;

function remember(rt: AxfRuntime) { rt.settings.set(K.tabs, JSON.stringify(state.tabs.map((t) => t.url))); }

export function openUrl(rt: AxfRuntime, typed: string) {
  const url = toUrl(typed);
  if (!url) { rt.toast("That address can't be opened here.", 'warning', 'Web'); return; }
  const tab: Tab = { id: `w${++seq}`, url, title: hostOf(url) };
  set({ tabs: [...state.tabs, tab].slice(-MAX_TABS), active: tab.id });
  remember(rt);
  rt.navigate('web');
}

/** The Web list (made on first use, under the top level). */
function webList(s: Store): string {
  const hit = Object.values(s.lists).find((l) => l.id === WEB_LIST || (l.parent === null && l.name === 'Web'));
  if (hit) return hit.id;
  return addList(s, 'Web', null).id;
}

function Page({ tab, shown }: { tab: Tab; shown: boolean }) {
  return (
    <iframe
      className="axp-web-frame"
      hidden={!shown}
      title={tab.title}
      src={tab.url}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}

function ClipCard({ tab }: { tab: Tab }) {
  const rt = useRuntime();
  const { own } = useNotes();
  const tree = flatTree(own).filter((t) => !t.list.id.startsWith('vn-') && t.list.system !== 'voice-notes');
  const [title, setTitle] = useState(tab.title);
  const [text, setText] = useState('');
  const [list, setList] = useState('');
  const paste = async () => { try { setText(await navigator.clipboard.readText()); } catch { rt.toast('The clipboard can’t be read here: paste into the box.', 'warning', 'Web'); } };
  const save = () => {
    mutate((s) => addItem(s, { ...clipToItem({ url: tab.url, title, text }), list: list || webList(s) }));
    rt.toast('Clipped.', 'success', 'Web');
    set({ clip: null });
  };
  return (
    <Container title="Clip to a note" icon="edit">
      <div className="fx-stack axp-web-clip">
        <TextField label="Title" value={title} onChange={setTitle} />
        <TextField label="What to keep" value={text} onChange={setText} rows={4} placeholder="Paste a passage, or write why it matters." />
        <SelectField label="List" value={list} onChange={setList} empty="Web (default)" options={tree.map((t) => ({ value: t.list.id, label: `${'  '.repeat(t.depth)}${t.path}` }))} />
        <div className="axp-web-row">
          <Button size="sm" icon="paste" onClick={() => void paste()}>Paste</Button>
          <span className="axp-web-grow" />
          <Button size="sm" tone="quiet" onClick={() => set({ clip: null })}>Cancel</Button>
          <Button size="sm" tone="primary" icon="save" onClick={save}>Save</Button>
        </div>
      </div>
    </Container>
  );
}

/** Empty state (design language §11): an icon, one sentence, one action. */
function Empty({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="fx-empty axp-web-empty">
      <Icon name={icon} size={24} />
      <p className="fx-muted">{text}</p>
      {action}
    </div>
  );
}

const BOOKMARK_COLUMNS: GridColumn<Item>[] = [
  { id: 'title', label: 'Page', width: 'minmax(calc(var(--fx-space) * 16), 3fr)', fixed: true, render: (b) => <span className="axp-web-clipline">{b.title}</span> },
  { id: 'site', label: 'Site', width: 'minmax(calc(var(--fx-space) * 10), 2fr)', render: (b) => <span className="fx-muted axp-web-clipline">{hostOf(b.url)}</span> },
];

function WebView() {
  const rt = useRuntime();
  const w = useWeb();
  const { own } = useNotes();
  const [typed, setTyped] = useState('');
  const active = w.tabs.find((t) => t.id === w.active) ?? w.tabs[w.tabs.length - 1];
  const bookmarks = Object.values(own.items).filter((i) => i.url && i.source === 'web').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const close = (id: string) => { const tabs = w.tabs.filter((t) => t.id !== id); set({ tabs, active: tabs[tabs.length - 1]?.id ?? '' }); remember(rt); };
  const bookmark = (t: Tab) => { mutate((s) => addItem(s, { ...clipToItem({ url: t.url, title: t.title }), list: webList(s) })); rt.toast('Bookmarked in Web.', 'success', 'Web'); };
  const home = String(rt.settings.get(K.home) ?? '').trim();
  return (
    <div className="fx-stack fx-stack--lg axp-web">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Web</p>
          <h1>{active ? active.title : 'Browse the web'}</h1>
          <p className="fx-muted">Open pages here in tabs, then bookmark them or clip them into a note.</p>
        </div>
        {active && (
          <div className="axp-web-row">
            <IconButton icon="star" label="Bookmark" onClick={() => bookmark(active)} />
            <IconButton icon="edit" label="Clip to a note" onClick={() => set({ clip: active })} />
            <IconButton icon="external" label="Open outside" onClick={() => window.open(active.url, '_blank', 'noopener')} />
          </div>
        )}
      </header>
      <form className="axp-web-bar" onSubmit={(e) => { e.preventDefault(); openUrl(rt, typed); setTyped(''); }}>
        <TextField label="Address or search" type="search" value={typed} onChange={setTyped} placeholder="example.com or a few words" className="axp-web-grow" />
        <Button tone="primary" icon="search" type="submit">Go</Button>
      </form>
      {w.tabs.length > 0 && (
        <div className="axp-web-tabs" role="tablist">
          {w.tabs.map((t) => (
            <span key={t.id} className="axp-web-tab">
              <button type="button" role="tab" className={`fx-tab ${t.id === active?.id ? 'is-active' : ''}`} aria-selected={t.id === active?.id} onClick={() => set({ active: t.id })}>{t.title}</button>
              <IconButton icon="x" label={`Close ${t.title}`} onClick={() => close(t.id)} />
            </span>
          ))}
        </div>
      )}
      {active && <p className="fx-muted fx-mono fx-small axp-web-url">{active.url}</p>}
      {w.clip && <ClipCard tab={w.clip} />}
      {w.tabs.length > 0 ? (
        <>
          <div className="axp-web-stage">{w.tabs.map((t) => <Page key={t.id} tab={t} shown={t.id === active?.id} />)}</div>
          <Note tone="info">A blank page means that site doesn't allow being shown inside other apps. Use Open outside; Bookmark and Clip still work.</Note>
        </>
      ) : (
        <>
          <Empty icon="monitor" text="No pages open yet: type an address or a search above."
            action={home
              ? <Button tone="primary" icon="external" onClick={() => openUrl(rt, home)}>Open {hostOf(toUrl(home) ?? home) || home}</Button>
              : <Button icon="sliders" onClick={() => rt.dispatch('settings.open:web')}>Set a start page</Button>} />
          {bookmarks.length > 0 && (
            <Container title="Bookmarks" icon="star">
              <DataGrid<Item>
                id="amberx-web-bookmarks"
                label="Bookmarks"
                groups={[{ id: 'bookmarks', title: `${bookmarks.length} saved in Web`, rows: bookmarks, groups: [], fixed: true }]}
                columns={BOOKMARK_COLUMNS}
                rowId={(b) => b.id}
                rowLabel={(b) => b.title}
                hidden={[]}
                onRowClick={(b) => openUrl(rt, b.url)}
              />
            </Container>
          )}
        </>
      )}
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Web',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  views: { web: { title: 'Web', icon: 'monitor', keywords: ['web', 'browser', 'page', 'bookmark', 'clip', 'link'], render: () => <WebView /> } },
  nav: { label: 'Web', items: [{ id: 'web', label: 'Web', icon: 'monitor', view: 'web' }] },
  settingsTabs: [{ id: 'web', label: 'Web', icon: 'monitor', order: 60, parent: 'plugins' }],
  settings: [{
    id: 'amberx.web', label: 'Web', icon: 'monitor', tab: 'web', settings: [
      { key: K.home, label: 'Open on start', kind: 'text', default: '', description: 'An address to open in a tab when AmberX starts (empty = none).' },
    ],
  }],
  contextMenu: [{ id: 'amberx.web', items: [{ id: 'web.open', label: 'Open the web', icon: 'monitor', action: 'nav:web' }] }],
  register(rt) {
    rt.actions.register('web.open', (args) => (args.length ? openUrl(rt, args.join(':')) : rt.navigate('web')), { label: 'Open the web' });
    rt.actions.register('web.clip', () => { const t = state.tabs.find((x) => x.id === state.active); if (t) set({ clip: t }); rt.navigate('web'); }, { label: 'Clip this page' });
    try {
      const saved = JSON.parse(String(rt.settings.get(K.tabs) ?? '[]'));
      const urls: string[] = Array.isArray(saved) ? saved.filter((u): u is string => typeof u === 'string') : [];
      const home = String(rt.settings.get(K.home) ?? '').trim();
      const tabs = [...urls, ...(home && !urls.length ? [home] : [])].map((u) => toUrl(u)).filter((u): u is string => !!u).slice(-MAX_TABS).map((url) => ({ id: `w${++seq}`, url, title: hostOf(url) }));
      if (tabs.length) set({ tabs, active: tabs[tabs.length - 1]!.id });
    } catch { /* nothing saved */ }
  },
};
