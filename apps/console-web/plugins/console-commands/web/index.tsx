/**
 * Console commands (web part). Every open console tab announces itself to the console server with its catalog (its own
 * search index: screens, settings tabs and sub-tabs, dialogs, actions — plugins' too), keeps a stream open, and runs the
 * console-command@1 messages it gets through its own runtime: screens through `rt.search.focus` (so a screen a host or a
 * placement owns opens where it should), settings through `settings.open:<tab>`, dialogs through `rt.openDialog`,
 * actions through `rt.dispatch` (which checks the action's own `requires` against the signed-in role). Then it acks
 * what it did. Brett's open console goes where a Claude session says, and nothing else on the page changes.
 *
 * Settings → Plugins → Console commands: on / off for this console, a toast per command, the open consoles, the last commands.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Note, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { followSse, sseJson } from '@console/axf/core/sse';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './console-commands.css';
import { consoleCatalogFrom, consoleMessageErrors, type ConsoleHere, type ConsoleMessage } from '@console/axf/core/engines/console-commands.mjs';

const FOLDER = 'console-commands';
const ID = 'ai.amberx.axf.console.console-commands';
const KEYS = { on: 'console-commands.enabled', toast: 'console-commands.toast' } as const;
const HEARTBEAT_MS = 30_000;

/** This tab's id (one per browser tab, kept across reloads of the tab). */
function clientId(): string {
  const k = 'axf.console-commands.client';
  try {
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `cc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem(k, n);
    return n;
  } catch { return `cc-${Math.random().toString(36).slice(2, 12)}`; }
}

const device = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop');
const post = (path: string, body: unknown, keepalive = false) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive });

/** Where this console is now. */
function hereOf(rt: AxfRuntime): ConsoleHere {
  const s = rt.getState();
  const here: ConsoleHere = { screen: s.view };
  const label = rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === s.view)?.label;
  if (label) here.screenLabel = label;
  if (s.dialog) here.dialog = s.dialog.id;
  if (s.view === 'settings') { const t = rt.settings.get('axf.settings.lastTab'); if (typeof t === 'string' && t) here.settings = t; }
  // main-tabs@1: the open tabs, for tabs_list / `axf console tabs`
  const tabs = rt.mainTabs?.list();
  if (tabs) here.tabs = tabs.map((t) => ({ ...t, view: t.view ?? '' }));
  return here;
}

/** What this console has: its search index's screens and dialogs, every settings tab (with its parent), every action. */
function catalogOf(rt: AxfRuntime) {
  const tabs = rt.settings.listTabs().map((t) => ({ kind: 'settings-tab', label: t.label, icon: t.icon, keywords: [t.description ?? '', t.parent ? `${t.parent} sub-tab` : ''], parent: t.parent, focus: { kind: 'setting', tab: t.id } }));
  const entries = [...rt.search.entries().filter((e) => e.kind === 'view' || e.kind === 'dialog'), ...tabs];
  return consoleCatalogFrom(entries, rt.actions.list(), { app: 'console-web', here: hereOf(rt) });
}

/** Run one message; → [ok, what happened]. */
function runMessage(rt: AxfRuntime, m: ConsoleMessage, history: string[]): [boolean, string] {
  const errors = consoleMessageErrors(m);
  if (errors.length) return [false, errors.join('; ')];
  switch (m.op) {
    case 'open':
      if (m.kind === 'screen') { rt.search.focus({ id: `view:${m.target}`, kind: 'view', label: m.label ?? m.target!, focus: { kind: 'view', view: m.target! } }); return [rt.getState().view === m.target || !!rt.getState().dialog, `opened ${m.label ?? m.target}`]; }
      if (m.kind === 'dialog') { rt.openDialog(m.target!, m.arg ? { arg: m.arg } : undefined); return [true, `opened ${m.label ?? m.target}`]; }
      rt.search.focus({ id: `settings-tab:${m.target}`, kind: 'setting', label: m.label ?? m.target!, focus: { kind: 'setting', tab: m.target!, ...(m.anchor ? { anchor: m.anchor } : {}) } });
      return [true, `opened ${m.label ?? m.target} settings`];
    case 'run': return rt.dispatch(m.spec!) ? [true, `ran ${m.label ?? m.spec}`] : [false, `${m.label ?? m.spec} didn't run here (no handler, or this role can't)`];
    case 'close': if (!rt.getState().dialog) return [true, 'no dialog was open']; rt.closeDialog(); return [true, 'closed the dialog'];
    case 'home': rt.navigate(rt.manifest.startView ?? 'home'); return [true, `went home (${rt.getState().view})`];
    case 'back': {
      if (rt.getState().dialog) { rt.closeDialog(); return [true, 'closed the dialog']; }
      history.pop(); // the screen we're on
      const prev = history.pop();
      if (!prev) return [false, 'no screen before this one'];
      rt.navigate(prev);
      return [true, `back to ${prev}`];
    }
    default: return [false, 'unknown op'];
  }
}

/** Mounted once on the page (slot app.frame.cover), draws nothing. */
function ConsoleCommandsClient() {
  const rt = useRuntime();
  const [on, setOn] = useState(() => rt.settings.get(KEYS.on) !== false);
  useEffect(() => rt.settings.subscribe(() => setOn(rt.settings.get(KEYS.on) !== false)), [rt]);
  useEffect(() => {
    if (!on || typeof window === 'undefined') return;
    const id = clientId();
    const history: string[] = [rt.getState().view];
    let catalogKey = '';
    const announce = (used = false) => {
      const catalog = catalogOf(rt);
      const key = `${catalog.items.length}:${catalog.items.map((i) => i.id).join(',').length}`;
      if (key === catalogKey && !used) return post('seen', { client: id, here: catalog.here }).catch(() => undefined);
      catalogKey = key;
      return post('hello', { client: id, app: 'console-web', title: document.title, device: device(), catalog, here: catalog.here, used }).catch(() => undefined);
    };
    void announce(document.hasFocus());
    let lastView = rt.getState().view;
    const offState = rt.subscribe(() => {
      const v = rt.getState().view;
      if (v !== lastView) { lastView = v; if (history[history.length - 1] !== v) history.push(v); if (history.length > 50) history.shift(); void post('seen', { client: id, here: hereOf(rt) }).catch(() => undefined); }
    });
    const used = () => { void post('seen', { client: id, here: hereOf(rt), used: true }).catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === 'visible') used(); };
    window.addEventListener('focus', used);
    document.addEventListener('visibilitychange', onVisible);
    const beat = setInterval(() => void announce(false), HEARTBEAT_MS);
    const bye = () => { void post('bye', { client: id }, true).catch(() => undefined); };
    window.addEventListener('pagehide', bye);
    const stop = followSse(
      (signal) => pluginFetch(FOLDER, `stream?client=${encodeURIComponent(id)}`, { signal }),
      (f) => {
        const m = sseJson<ConsoleMessage>(f);
        if (!m?.id) return;
        let res: [boolean, string];
        try { res = runMessage(rt, m, history); } catch (e) { res = [false, String((e as Error)?.message ?? e)]; }
        if (res[0] && rt.settings.get(KEYS.toast) !== false) rt.toast(`${m.by ? `${m.by}: ` : ''}${res[1]}`, 'info', 'Console command');
        void post('ack', { client: id, id: m.id, ok: res[0], message: res[1], here: hereOf(rt) }).catch(() => undefined);
      },
    );
    return () => { stop(); offState(); clearInterval(beat); window.removeEventListener('focus', used); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', bye); bye(); };
  }, [rt, on]);
  return null;
}

interface ClientRow { id: string; device: string; user: string; lastUsed: number; live: boolean; here: ConsoleHere; items: number }
interface RecentRow { at: string; by: string; target: string; path: string; action: string; ok: boolean; message: string; delivered: { client: string; ok: boolean; message: string }[] }

/** Settings → Plugins → Console commands: the open consoles and the last commands. */
function ConsolesPanel() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [err, setErr] = useState('');
  const load = () => Promise.all([
    pluginFetch(FOLDER, 'clients').then((r) => r.json()).then((j: { items?: ClientRow[] }) => setClients(j.items ?? [])),
    pluginFetch(FOLDER, 'recent').then((r) => r.json()).then((j: { items?: RecentRow[] }) => setRecent(j.items ?? [])),
  ]).then(() => setErr(''), () => setErr('The Console commands server part is not answering.'));
  useEffect(() => { void load(); }, []);
  const me = clientId();
  return (
    <div className="fx-stack">
      {err && <Note tone="warning">{err}</Note>}
      <Container title="Open consoles" icon="monitor">
        {clients === null ? <p className="axf-cc__muted">Loading…</p> : !clients.length ? <p className="axf-cc__muted">No console is open right now.</p> : (
          <ul className="axf-cc__list">
            {clients.map((c) => (
              <li key={c.id} className="axf-cc__row">
                <span className="axf-cc__id">{c.id}{c.id === me ? ' (this one)' : ''}</span>
                <span>{c.device || 'browser'} · {c.here?.screenLabel ?? c.here?.screen ?? '—'}</span>
                <span className="axf-cc__muted">{c.live ? 'open' : 'gone quiet'} · {c.lastUsed ? new Date(c.lastUsed).toLocaleTimeString() : 'not used yet'} · {c.items} items</span>
              </li>
            ))}
          </ul>
        )}
        <Button icon="refresh" onClick={() => void load()} data-help="cc-refresh">Refresh</Button>
      </Container>
      <Container title="Last commands" icon="list">
        {!recent.length ? <p className="axf-cc__muted">None yet. Ask Amber to open a screen, or run <code>axf console open plan studio</code>.</p> : (
          <ul className="axf-cc__list">
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="axf-cc__row">
                <span className="axf-cc__id">{r.ok ? '✓' : '✗'} {r.action} {r.path}</span>
                <span className="axf-cc__muted">{r.by} · {new Date(r.at).toLocaleTimeString()} · {r.ok ? r.delivered.map((d) => `${d.client}: ${d.message}`).join(' · ') || 'sent' : r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Note tone="info">
        Claude sessions call <code>console_open</code>, <code>console_settings</code>, <code>console_dialog</code>, <code>console_action</code>, <code>console_back</code>, <code>console_where</code>, <code>console_list</code> and <code>console_clients</code> (the console's MCP, also through axHub). REST: <code>POST /api/console/open</code> with <code>{'{"screen": "plan studio"}'}</code>. CLI: <code>axf console open plan studio</code>.
      </Note>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Console commands',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  appMenu,
  slots: { 'app.frame.cover': [{ id: 'console-commands.client', order: 99, render: () => <ConsoleCommandsClient /> }] },
  settingsTabs: [{ id: FOLDER, label: 'Console commands', icon: 'radio', order: 92, parent: 'plugins', description: 'Let Claude sessions open screens, dialogs and settings in this console' }],
  settings: [{
    id: 'console-commands.prefs', label: 'Console commands', icon: 'radio', tab: FOLDER, order: 10,
    description: 'When Brett tells Amber to load a screen, his open console goes there. Opening only navigates; an action that changes data keeps its own permission.',
    settings: [
      { key: KEYS.on, label: 'Let Claude sessions move this console', kind: 'toggle', default: true, scope: 'device', description: 'Off: this console stops listening; commands go to your other open consoles.' },
      { key: KEYS.toast, label: 'Show a note for each command', kind: 'toggle', default: true, scope: 'device', description: 'A short toast saying who opened what.' },
    ],
  }],
  settingsPanels: [
    { id: 'console-commands.consoles', tab: FOLDER, title: 'Open consoles and last commands', icon: 'monitor', order: 20, render: () => <ConsolesPanel /> },
    { id: 'console-commands.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
