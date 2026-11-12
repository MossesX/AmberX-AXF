/**
 * Web: the integrated web component. Open pages inside AmberX in tabs (kept alive while you switch), bookmark them as
 * notes, and clip a page or a pasted passage into any list. Pages that refuse to be framed (most big sites send
 * X-Frame-Options) get "Open outside" instead; the clip still works from the address.
 *
 * Actions: `web.open`, `web.open:<url>` (a typed address or https URL), `web.clip` (clip the current tab).
 *
 * Go to any website (Nov 12 2026, Brett: "tell you to go to any website and open the web browser with the recorder"):
 * the voice sentence "go to <site>" (`parseGoTo` in core.ts: any http(s) host, never javascript:/file:/intent:…) opens
 * it in the phone's browser in front, and "… and record it" / "record <site>" starts the Audio Output Recorder first.
 * Every open is logged (Web → Opened, setting `amberx.web.log`); a recorded one is also a note in the Web list (synced to
 * axHub) with the URL and time, next to the recording's timestamped parts. Actions: `web.go:<url>`,
 * `web.go-record:<url>`, `web.go-log-clear`.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Container, Icon, IconButton, Note, SelectField, Switch, TabGroup, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { DataGrid, type GridColumn } from '../../../axf/libs/datagrid';
import type { Item } from '../../notes/web/core';
import { addItem, addList, flatTree, type Store } from '../../notes/web/core';
import { mutate, useNotes } from '../../notes/web/store';
import { MAX_TABS, WEB_LIST, clipToItem, hostOf, logOpen, parseGoTo, safeUrl, toUrl, type GoLogEntry } from './core';
import { isNative } from '../../../native';
import './web.css';

const ID = 'ai.amberx.amberx.web';
const K = { home: 'amberx.web.home', tabs: 'amberx.web.tabs', log: 'amberx.web.log', voice: 'amberx.web.voice', recorder: 'amberx.web.recordAction' } as const;
/** The recorder's start action (Audio Output Recorder): reached by action id, never by its folder. */
const RECORD_START = 'output-recorder.start';

type Tab = { id: string; url: string; title: string };
type State = { tabs: Tab[]; active: string; clip: Tab | null };
let state: State = { tabs: [], active: '', clip: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useWeb = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
let seq = 0;

function remember(rt: AxfRuntime) { rt.settings.set(K.tabs, JSON.stringify(state.tabs.map((t) => t.url))); }

function goLog(rt: AxfRuntime): GoLogEntry[] {
  try { const l = JSON.parse(String(rt.settings.get(K.log) ?? '[]')); return Array.isArray(l) ? (l as GoLogEntry[]) : []; } catch { return []; }
}

/** Resolves once AmberX is on screen again (the recorder's consent screen covered it), or after `ms`. */
function backInFront(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(); return; }
    const t0 = setTimeout(() => {
      if (document.visibilityState === 'visible') { finish(); return; }
      document.addEventListener('visibilitychange', onVis);
    }, 600);
    const cap = setTimeout(() => finish(), ms);
    function onVis() { if (document.visibilityState === 'visible') finish(); }
    function finish() { clearTimeout(t0); clearTimeout(cap); document.removeEventListener('visibilitychange', onVis); resolve(); }
  });
}

/**
 * Opens a page in the phone's browser, in front (on Android the shell hands any host but AmberX's own to the browser;
 * in a desktop browser it is a new tab). `record` starts the Audio Output Recorder first and opens the page once
 * Android's consent screen is answered. Every open is logged; a recorded one also becomes a Web note on axHub.
 */
export async function goTo(rt: AxfRuntime, raw: string, opts: { record?: boolean; via?: GoLogEntry['via'] } = {}): Promise<{ did: string; ok: boolean }> {
  const typed = String(raw ?? '').trim();
  const url = /^https?:\/\//i.test(typed) ? safeUrl(typed) : toUrl(typed);
  if (!url) { rt.toast("Only web pages (http or https) can be opened.", 'warning', 'Web'); return { did: `Refused "${typed.slice(0, 80)}": not a web page.`, ok: false }; }
  const host = hostOf(url);
  let record = opts.record === true;
  if (record) {
    const start = String(rt.settings.get(K.recorder) ?? RECORD_START).trim() || RECORD_START;
    if (!rt.actions.get(start.split(':')[0]!)) {
      rt.toast('The recorder plugin is not installed: opening without recording.', 'warning', 'Web');
      record = false;
    } else {
      rt.dispatch(start);
      const at = new Date();
      mutate((s) => addItem(s, { ...clipToItem({ url, title: `Recorded: ${host} · ${at.toLocaleString()}`, text: `Opened with the recorder at ${at.toISOString()}.`, tags: ['recording'] }), list: webList(s) }));
    }
  }
  const entry: GoLogEntry = { at: new Date().toISOString(), url, host, record, via: opts.via ?? 'action', where: 'phone' };
  rt.settings.set(K.log, JSON.stringify(logOpen(goLog(rt), entry)));
  rt.terminal.log('web', `open ${url}${record ? ' (recording)' : ''} via ${entry.via}`);
  if (record) await backInFront(30_000);
  rt.toast(`Opening ${host}${record ? ' with the recorder on' : ''}.`, 'success', 'Web');
  // Android shell: a page load of a host that isn't AmberX's own goes to the phone's browser (Capacitor's navigation
  // rule), in front; a scripted window.open with no tap behind it (a voice command) would be dropped. Browser: a new tab.
  if (isNative()) window.location.assign(url);
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  return { did: `Opened ${url}${record ? ' with the recorder' : ''}.`, ok: true };
}

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

const OPENED_COLUMNS: GridColumn<GoLogEntry>[] = [
  { id: 'site', label: 'Site', width: 'minmax(calc(var(--fx-space) * 12), 3fr)', fixed: true, render: (e) => <span className="axp-web-clipline">{e.host}{e.record ? ' · recorded' : ''}</span> },
  { id: 'at', label: 'When', width: 'minmax(calc(var(--fx-space) * 10), 2fr)', render: (e) => <span className="fx-muted axp-web-clipline">{new Date(e.at).toLocaleString()} · {e.via}</span> },
];

function WebView() {
  const rt = useRuntime();
  const w = useWeb();
  const { own } = useNotes();
  const [typed, setTyped] = useState('');
  const [rec, setRec] = useState(false);
  const log = goLog(rt);
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
        <Button icon="external" disabled={!typed.trim()} onClick={() => { void goTo(rt, typed, { record: rec, via: 'typed' }); setTyped(''); }}>Open in browser</Button>
      </form>
      <Switch label="Record while it is open" hint="Open in browser starts the Audio Output Recorder first. Say “go to example.com and record it”." checked={rec} onChange={setRec} />
      {w.tabs.length > 0 && (
        <TabGroup id="web.tabs" label="Web tabs" className="axp-web-tabs" value={active?.id ?? ''} onChange={(id) => set({ active: id })} onClose={close} tabs={w.tabs.map((t) => ({ value: t.id, label: t.title }))} />
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
          {log.length > 0 && (
            <Container title="Opened" icon="clock">
              <DataGrid<GoLogEntry>
                id="amberx-web-opened"
                label="Pages opened in the browser"
                groups={[{ id: 'opened', title: `${log.length} opened`, rows: log.slice(0, 30), groups: [], fixed: true }]}
                columns={OPENED_COLUMNS}
                rowId={(e) => `${e.at}-${e.url}`}
                rowLabel={(e) => e.url}
                hidden={[]}
                onRowClick={(e) => void goTo(rt, e.url, { via: 'typed' })}
              />
              <div className="axp-web-row">
                <span className="axp-web-grow" />
                <Button size="sm" tone="quiet" icon="trash" confirm="Clear the list of opened pages?" onClick={() => rt.dispatch('web.go-log-clear')}>Clear</Button>
              </div>
            </Container>
          )}
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
  nav: { label: 'Work', items: [{ id: 'web', label: 'Web', icon: 'monitor', view: 'web' }] },
  settingsTabs: [{ id: 'web', label: 'Web', icon: 'monitor', order: 60, parent: 'plugins' }],
  settings: [{
    id: 'amberx.web', label: 'Web', icon: 'monitor', tab: 'web', settings: [
      { key: K.home, label: 'Open on start', kind: 'text', default: '', description: 'An address to open in a tab when AmberX starts (empty = none).' },
      { key: K.voice, label: '“Go to <website>” by voice', kind: 'toggle', default: true, description: 'Say “go to example.com” to open any website in the phone’s browser; add “and record it” to start the recorder first.' },
      { key: K.recorder, label: 'Recorder start action', kind: 'text', default: RECORD_START, description: 'The action that starts recording for “… and record it” (default: the Audio Output Recorder).' },
    ],
  }],
  contextMenu: [{ id: 'amberx.web', items: [{ id: 'web.open', label: 'Open the web', icon: 'monitor', action: 'nav:web' }] }],
  register(rt) {
    rt.actions.register('web.open', (args) => (args.length ? openUrl(rt, args.join(':')) : rt.navigate('web')), { label: 'Open the web' });
    rt.actions.register('web.go', (args) => void goTo(rt, args.join(':'), { via: 'action' }), { label: 'Open a website in the phone browser' });
    rt.actions.register('web.go-record', (args) => void goTo(rt, args.join(':'), { record: true, via: 'action' }), { label: 'Open a website with the recorder on' });
    rt.actions.register('web.go-log-clear', () => rt.settings.set(K.log, '[]'), { label: 'Clear the opened pages list' });
    const voice = (globalThis as { amberxVoice?: { route?: (module: string, fn: (rt: AxfRuntime, heard: string) => Promise<{ did: string; ok: boolean } | null>) => () => void } }).amberxVoice;
    voice?.route?.(ID, async (r, heard) => {
      if (r.settings.get(K.voice) === false) return null;
      const g = parseGoTo(heard);
      return g ? goTo(r, g.url, { record: g.record, via: 'voice' }) : null;
    });
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
