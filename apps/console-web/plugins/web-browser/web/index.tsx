/**
 * Web browser: any website in a pane inside the console (and Molly, which hosts the console). Brett (Nov 10 2026):
 * "tell you to go to any website and open the web browser with the recorder in AmberX, or in a plugin somewhere."
 *
 * The pane shows what the server part says is open (`GET state`, polled while the page is on screen), so an open from
 * REST, MCP, the CLI or a Claude session lands here too. Every open and close goes through the server, which keeps the
 * audit log. Sites that refuse to be framed (X-Frame-Options) get "Open in a new tab".
 *
 * Actions: `web-browser.open:<url>`, `web-browser.close`, `web-browser.show`. Deep link: `nav:web-browser`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, Icon, IconButton, Note, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './web-browser.css';

const FOLDER = 'web-browser';
const ID = 'ai.amberx.axf.console.web-browser';
const POLL_MS = 4000;

interface Entry { at: string; op?: string; url: string; host: string; record?: boolean; via?: string; by?: string }
interface BrowserState { current: Entry | null; recent: Entry[]; rev: number }

async function openOnServer(url: string, via: string, show = false): Promise<{ ok: boolean; message: string }> {
  const r = await pluginFetch(FOLDER, 'open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, via, show }) });
  if (r.ok) return { ok: true, message: '' };
  const j = (await r.json().catch(() => ({}))) as { detail?: string };
  return { ok: false, message: j.detail ?? `The page couldn't be opened (${r.status}).` };
}

async function closeOnServer(via: string): Promise<void> {
  await pluginFetch(FOLDER, 'close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ via }) });
}

/** Listeners that want a fresh state now (an action ran). */
const kicks = new Set<() => void>();
const kick = () => kicks.forEach((f) => f());

const RECENT_COLUMNS: GridColumn<Entry>[] = [
  { id: 'site', label: 'Site', width: 'minmax(calc(var(--fx-space) * 12), 3fr)', fixed: true, render: (e) => <span className="axp-web-browser__line">{e.host}{e.record ? ' · recorded' : ''}</span> },
  { id: 'at', label: 'Opened', width: 'minmax(calc(var(--fx-space) * 12), 2fr)', render: (e) => <span className="fx-muted axp-web-browser__line">{new Date(e.at).toLocaleString()} · {e.via ?? ''}</span> },
];

function WebBrowserView() {
  const [reloads, setReloads] = useState(0);
  const [s, setS] = useState<BrowserState>({ current: null, recent: [], rev: -1 });
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => pluginFetch(FOLDER, 'state').then((r) => r.json()).then((j: BrowserState) => setS((o) => (o.rev === j.rev ? o : j)), () => undefined), []);
  useEffect(() => {
    void load();
    kicks.add(load);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { clearInterval(t); kicks.delete(load); };
  }, [load]);
  const go = async (url: string) => {
    const r = await openOnServer(url, 'typed');
    setError(r.ok ? '' : r.message);
    if (r.ok) { setTyped(''); void load(); }
  };
  const cur = s.current;
  return (
    <div className="fx-stack fx-stack--lg axp-web-browser">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Web browser</p>
          <h1>{cur ? cur.host : 'Open any website'}</h1>
          <p className="fx-muted">Type an address, or ask Amber: “go to example.com”. Every page opened here is logged.</p>
        </div>
        {cur && (
          <div className="fx-row" role="toolbar" aria-label="Page">
            <IconButton icon="refresh" label="Reload" onClick={() => setReloads((n) => n + 1)} />
            <IconButton icon="external" label="Open in a new tab" onClick={() => window.open(cur.url, '_blank', 'noopener')} />
            <IconButton icon="x" label="Close the page" onClick={() => void closeOnServer('typed').then(load)} />
          </div>
        )}
      </header>
      <form className="axp-web-browser__bar" onSubmit={(e) => { e.preventDefault(); void go(typed); }}>
        <TextField label="Address" type="url" value={typed} onChange={setTyped} placeholder="example.com or https://…" className="axp-web-browser__grow" />
        <Button tone="primary" icon="arrow-right" type="submit" disabled={!typed.trim()}>Go</Button>
      </form>
      {error && <Note tone="warning">{error}</Note>}
      {cur ? (
        <>
          <p className="fx-muted fx-mono fx-small axp-web-browser__url">{cur.url}</p>
          <div className="axp-web-browser__stage">
            <iframe key={`${cur.url}-${cur.at}-${reloads}`} className="axp-web-browser__frame" title={cur.host} src={cur.url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
          </div>
          <Note tone="info">A blank page means that site doesn’t allow being shown inside other pages. Use Open in a new tab.</Note>
        </>
      ) : (
        <div className="fx-empty axp-web-browser__empty">
          <Icon name="monitor" size={24} />
          <p className="fx-muted">No page open: type an address above.</p>
        </div>
      )}
      {s.recent.length > 0 && (
        <Container title="Recently opened" icon="clock">
          <DataGrid<Entry>
            id="web-browser-recent"
            label="Recently opened"
            groups={[{ id: 'recent', title: `${s.recent.length} pages`, rows: s.recent, groups: [], fixed: true }]}
            columns={RECENT_COLUMNS}
            rowId={(e) => `${e.at}-${e.url}`}
            rowLabel={(e) => e.url}
            hidden={[]}
            onRowClick={(e) => void go(e.url)}
          />
        </Container>
      )}
      <p className="fx-muted fx-small">On the phone, AmberX opens pages in the phone’s browser and can record while they are open: say “go to example.com and record it”.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Web browser',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  provides: ['web-browser@1'],
  appMenu,
  views: { 'web-browser': { title: 'Web browser', icon: 'monitor', keywords: ['web', 'browser', 'website', 'url', 'page', 'go to', 'open site'], render: () => <WebBrowserView /> } },
  nav: { label: 'Plugins', items: [{ id: 'web-browser', label: 'Web browser', icon: 'monitor', view: 'web-browser' }] },
  settingsTabs: [{ id: 'web-browser', label: 'Web browser', icon: 'monitor', order: 92, parent: 'plugins' }],
  settingsPanels: [{ id: 'web-browser.lifecycle', tab: 'web-browser', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
  register(rt) {
    rt.actions.register('web-browser.open', (args) => {
      const url = args.join(':');
      void openOnServer(url, 'action').then((r) => {
        if (!r.ok) rt.toast(r.message, 'warning', 'Web browser');
        kick();
      });
      rt.navigate('web-browser');
    }, { label: 'Open a website in the browser pane' });
    rt.actions.register('web-browser.close', () => { void closeOnServer('action').then(kick); }, { label: 'Close the browser pane page' });
    rt.actions.register('web-browser.show', () => { rt.navigate('web-browser'); kick(); }, { label: 'Show the web browser' });
  },
};
